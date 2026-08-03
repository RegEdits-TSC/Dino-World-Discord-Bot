# Daily loop — quests, streaks, and achievements

Sub-project 2 of the three-part endgame roadmap. Adds a daily quest board,
a claim streak with milestone chests, and lifetime achievements — all three
reading one new stat-tracking substrate. Two new commands (`/daily`,
`/achievements`), one new module, one migration.

## 1. Why

The Gene Lab gave shards somewhere to go (splice re-rolls, 15 shards each,
uncapped). What the game still lacks is a reason to come back *today*:

| Gap | Evidence |
| --- | --- |
| No daily rhythm | The shop rotation and the rolling shard-sell window are the only day-scale mechanics, and neither asks the player to do anything |
| No short-term goals | Every goal is long-horizon: rating stars, campaign chapters, 500-shard Mythic |
| No recognition of accumulation | The game counts almost nothing. A player who has hatched 200 eggs looks identical to one who hatched 2 |

The daily loop closes all three: quests give today a goal, streaks reward
consecutive days, achievements recognize lifetime totals. Ordering rationale
from the roadmap holds: quest shard rewards are worth something now because
the Gene Lab created the sink first.

### Roadmap position

1. Gene Lab — done (PR #11, merged)
2. **Daily loop** (this spec)
3. Content volume — chapters 5–8, new sites, new species; data-only

### Scope decisions taken during design

- **All three pieces ship together.** Quests, streaks, and achievements share
  the stat substrate; building them apart means rework.
- **UTC midnight is the day boundary.** One global reset, no timezone
  storage. The shop rotation already flips at UTC midnight (its offers seed
  from `Math.floor(now / 86_400_000)`), so the boundary agrees with existing
  behavior; `dayKey` is merely the repo's first *stored* calendar-day value,
  chosen as a `YYYY-MM-DD` string for legibility in DB rows.
- **Manual claim, in `/daily`.** Progress accrues passively; rewards are a
  deliberate moment. Unclaimed quests expire at reset — a claim clicked
  after midnight forfeits yesterday's completed board by design.
- **Streak chests pay on personal bests only.** Milestones re-reached after
  a reset pay nothing until the previous best streak is exceeded — this is
  what makes streak-cycling strictly worse than loyalty (§5).
- **No grace day for streaks in v1.** A missed day resets the streak to 1.
  Revisit only if streaks feel brutal in play.
- **No per-quest reroll, no quest trading, no weekly quests.** YAGNI — v1 is
  three daily slots and nothing else.
- **Veteran seeding is partial.** Counters derivable from live tables are
  backfilled in the migration; the rest start at zero, stated explicitly
  in §2 — the game only starts counting what it never recorded.

## 2. Architecture

### The substrate: lifetime stat counters, derived progress

One new table `user_stats` holds lifetime counters, incremented only through
one helper:

```ts
// src/core/stats.ts
track(ctx, userId, stat: StatId, delta: number): void
```

`track` upserts `(userId, stat) += delta`. It lives in `src/core/` — not in
the daily module — because its call sites span eight modules, the same
layering reason `locks.ts` is core. Call sites sit inside the action's
existing transaction, so a rolled-back action never counts.

Every `StatId` is tagged **count** or **sum** in the union. Count stats
increment by 1 per event; sum stats add a quantity (cash collected). The
content gate enforces that count-shaped quests reference count stats — a
"do X twice" quest over a sum counter would complete on the first event.

**Quest progress is derived, never stored** — the same philosophy as the
Gene Lab's derived escrow locks. A quest row stores the counter's value at
roll time (`baseline`) and a `target`; progress is
`clamp(current − baseline, 0, target)` computed at read. A missing
`user_stats` row reads as 0, both at baseline snapshot and at progress read.
Nothing sweeps, nothing drifts. Achievements are thresholds over the same
lifetime counters, also evaluated at read.

### New files

| Path | Purpose |
| --- | --- |
| `src/core/stats.ts` | `track()` + the `StatId` union (count/sum tagged). Core substrate, like `locks.ts` |
| `src/data/quests.ts` | `QUESTS` pool: id, stat, target (fixed or roll-computed), rewards, description, requirement. Pure data |
| `src/data/achievements.ts` | `ACHIEVEMENTS` tracks: id, stat, name, 4 tiers of threshold + rewards. Pure data |
| `src/modules/daily/index.ts` | `ModuleManifest` — `/daily`, `/achievements`, `daily` + `ach` component prefixes |
| `src/modules/daily/service.ts` | `rollDailyQuests`, `questProgress`, `claimQuests`, `claimAchievements`, streak logic |
| `src/modules/daily/embeds.ts` | Hub + achievements payloads, art via `attach` |

### Schema

One drizzle migration (`npx drizzle-kit generate`, next index 0006):

- **`user_stats`** — `userId` FK → users, `stat` text, `value` int ≥ 0.
  Composite PK `(userId, stat)`.
- **`daily_quests`** — `id` PK autoincrement, `userId` FK, `dayKey` text
  (`YYYY-MM-DD`, UTC), `slot` int 0–2, `questId` text, `baseline` int,
  `target` int, `claimedAt` ms nullable, `notifiedAt` ms nullable. Unique
  `(userId, dayKey, slot)`.
- **`achievement_claims`** — `userId` FK, `trackId` text, `tier` int,
  `claimedAt` ms. Composite PK `(userId, trackId, tier)`.
- **users, three added columns** (additive ALTER, no table recreate):
  `quest_streak` int NOT NULL default 0,
  `quest_streak_best` int NOT NULL default 0,
  `last_quest_claim_at_ms` int NOT NULL default 0.
- **eggs `source` enum widens** to include `'quest'` (TS-only, no migration —
  same as `'admin'` and `'battle'` were).
- **Backfill** (hand-appended SQL after the generated DDL — the established
  0001 practice): seed the counters derivable from live tables so veterans
  open `/achievements` with visible progress —
  `stages_first_cleared` (battle_progress rows with `firstClearedAt` set),
  `lots_built` (lot rows), `trades_completed` (accepted trades, credited to
  both parties; the non-empty rule below is not applied to history),
  `breedings_started` (breedings rows), `breedings_claimed` (claimed ones).
  Everything else (`eggs_hatched`, `dinos_fed`, …) starts at zero: the data
  was never recorded and is not derivable.

`dayKeyUTC(ms): string` joins the pure helpers in `src/core/clock.ts`. The
streak anchor is epoch ms — never a day string — so `/admin fast-forward`'s
column-shifting idiom applies to it unchanged.

### Day-roll mechanics

`rollDailyQuests(ctx, userId)` is idempotent (no-op when today's rows exist)
and is called from three places:

1. A **pre-dispatch hook in `routeInteraction`** — commands and buttons only,
   never autocomplete (read-only contract), and only when the users row
   already exists. Rolling *before* dispatch means the day's first action
   counts toward its own quest.
2. A **post-dispatch check in the same hook path** — covers the brand-new
   player whose row was just created by `getOrCreateUser` mid-dispatch. The
   very first command of a brand-new account therefore doesn't count toward
   its own quest (the baseline snapshots after it); everything later that
   day does. Accepted and pinned by a test.
3. `/daily` itself, after `getOrCreateUser`.

The roll is **deterministic**: seeded from `hash(userId + dayKey)` via a
local mulberry32, not `ctx.rng()`. Concurrent first-interactions roll
identical quests, and the unique `(userId, dayKey, slot)` constraint
backstops the race (`INSERT OR IGNORE`). Rolling also deletes the user's
rows from prior dayKeys — quest history is not kept; lifetime history lives
in `user_stats`.

## 3. Stat catalog and track() call sites

Eighteen stats v1. Each is incremented only via `track`; the table lists
every call site — most stats have exactly one, the exceptions are called out
in the Trap column. Sites verified against the code at `origin/main`
post-PR-#11.

| Stat | Kind | Site | Trap honored |
| --- | --- | --- | --- |
| `dinos_fed` | count | `feedDino` txn + `feedAll` per-dino loop txn | `feedAll` never calls `feedDino` — both sites. Counts only when the dino's settled hunger was < 100 before the feed (`feedAll` already filters on that; `feedDino` must apply the same condition to its `track` call) — re-feeding a full dino is not care |
| `eggs_hatched` | count | `hatchEgg` txn | — |
| `eggs_incubated` | count | `incubateEgg` | no existing txn; `track` is atomic on its own |
| `income_collected` | sum | `collectIncome`, inside the `amount > 0` block | zero-amount presses count neither this nor `income_collections` |
| `income_collections` | count | same block, delta 1 | — |
| `expeditions_claimed` | count | `claimExpedition` txn | — |
| `battles_fought` | count | `runFight` txn | fires on losses too — always counts |
| `battles_won` | count | `runFight` txn, `won` branch | — |
| `stages_first_cleared` | count | `runFight` txn, `firstClear` branch | — |
| `trades_completed` | count | `acceptTrade` txn, **both** `toUser` and `fromUser` | the only two-user action; credited only when the trade moves at least one item, cash, or food on either side — empty-for-empty trades count nothing |
| `breedings_started` | count | `startBreeding` txn | below the `dryRun` early-return — previews must not count |
| `breedings_claimed` | count | `claimBreeding` txn | — |
| `splices_done` | count | `spliceDino` txn | — |
| `dinos_sold` | count | `sellDino` txn | — |
| `shop_purchases` | count | `buyEgg` txn, `buyFood`, `buyMythicEgg` txn | three functions, no shared choke point; delta 1 per purchase transaction regardless of units |
| `lots_built` | count | `buildLot` txn | — |
| `lots_upgraded` | count | `upgradeLot` txn | — |
| `dinos_rescued` | count | `rescueDino` txn | — |

Admin paths (`adminGive`, `adminFastForward`) bypass the service functions
above and therefore never increment stats — deliberate; admin minting is not
play.

## 4. Daily quests

- **3 per day, per user.** Roller rules, all hard: (a) no two slots share a
  stat — draw without replacement over stats, then pick a def per stat;
  (b) at most one churn-stat quest (`eggs_incubated`, `dinos_sold`) per
  board; (c) at most one food-paying quest per board. All three pinned by
  the roll-determinism test.
- **Eligibility**: `requirement` on each QuestDef, each predicate reading
  exactly one thing:
  - `'none'` — always eligible.
  - `'income'` — at least one dino assigned to a lot (`dinos.lotId` set).
  - `'battles'` — any `battle_progress` row exists (the player has actually
    fought; a rating gate would be vacuous — chapter 1 unlocks at rating 0).
  - `'trading'` — `ratingHighWater` at or above the trade minimum rating.
  - `'genelab'` — the Gene Lab facility is built.

  The content gate requires ≥ 3 `'none'` defs on distinct stats, which
  guarantees the filtered pool always fills 3 slots — no fallback path
  exists or is needed.
- **Pool v1 — exactly 17 defs** (`x/y` in earlier drafts meant two defs
  sharing a stat at two targets; enumerated fully here):

  | Def | Stat | Target | Requirement |
  | --- | --- | --- | --- |
  | Feed 3 dinos | `dinos_fed` | 3 | none |
  | Feed 8 dinos | `dinos_fed` | 8 | none |
  | Collect income twice | `income_collections` | 2 | income |
  | Collect half a day's earnings | `income_collected` | roll-computed | income |
  | Hatch an egg | `eggs_hatched` | 1 | none |
  | Hatch 3 eggs | `eggs_hatched` | 3 | none |
  | Incubate 2 eggs | `eggs_incubated` | 2 | none |
  | Claim an expedition | `expeditions_claimed` | 1 | none |
  | Claim 2 expeditions | `expeditions_claimed` | 2 | none |
  | Fight 5 battles | `battles_fought` | 5 | battles |
  | Win a battle | `battles_won` | 1 | battles |
  | Win 3 battles | `battles_won` | 3 | battles |
  | Complete a trade | `trades_completed` | 1 | trading |
  | Start a breeding | `breedings_started` | 1 | genelab |
  | Claim a breeding | `breedings_claimed` | 1 | genelab |
  | Splice a trait | `splices_done` | 1 | genelab |
  | Sell 2 dinos | `dinos_sold` | 2 | none |

  The collect-cash def's target is **computed at roll time**: 50% of the
  park's current daily earning capacity (sum over assigned dinos of hourly
  rate × cap hours), clamped to [500, 50,000], stored in the row's `target`
  column like any other. Fixed absolute targets cannot span the ~200× income
  range between a first paddock and an endgame park. There is no
  buy-from-shop quest: 1-unit fern purchases made it a free-money button,
  and the buy→incubate→hatch→sell churn chain is further broken by roller
  rule (b) and by the sell def paying cash only.
- **Rewards per quest**: 300–800 cash + 3–8 shards, with two exceptions:
  the sell-dinos def pays cash only (no shard top-up on a shard faucet),
  and two defs pay a food item instead of shards. With roller rule (c),
  a claimed board pays 900–2,400 cash and roughly 6–24 shards
  (typical ~12–16).
- **Shard faucet ruling**: quest shards **bypass** the 60/day sell window —
  the battle first-clear precedent (`economy.apply` without touching
  `shardsWindowEarned`). All-in pace check, counting quests (~12/day EV),
  chests (§5, ~2/day amortized), one-time achievements (§6, 300 total) and
  campaign first-clears (93 one-time): a no-selling active player reaches a
  500-shard Mythic in roughly 28–30 days; combined with max selling, ~6.5
  days. Ship checklist: update the recorded pacing rationales in
  `src/data/sell.ts` and `src/data/breeding.ts` comments, which currently
  assume selling is the only repeatable faucet.
- **Claiming**: `claimQuests` operates on rows where
  `dayKey = dayKeyUTC(now)` **only** — never on stale rows, regardless of
  what the roll hook has or hasn't deleted. The Claim button claims all of
  today's completed-unclaimed quests in one transaction: single
  `economy.apply` with reason `quest:daily`, stamp each `claimedAt`, tick
  streak if first claim today, grant any milestone chest in the same txn as
  a **second** `economy.apply` with reason `quest:chest` (chest visible in
  the ledger). Reply is a fresh ephemeral embed itemizing quest rewards +
  chest. When nothing is claimable the button replies ephemeral "Nothing to
  claim — quests reset at UTC midnight" and performs no writes. A quest def
  removed by a deploy while rolled rows still reference it: those rows are
  skipped at render and at claim — never crash, never pay.

## 5. Streaks and milestone chests

Streak ticks on the **first claim of a UTC day** (claiming is the observable
moment; completion is derived and has none). Same/yesterday/older is decided
by **dayKey comparison** — `dayKeyUTC(last_quest_claim_at_ms)` against
today's and yesterday's keys, never an elapsed-ms window; a claim at exactly
00:00:00.000 belongs to the new day. Logic, in the claim txn:

```
same day   → no tick
yesterday  → quest_streak += 1
older/none → quest_streak = 1
last_quest_claim_at_ms = now  (always, on any claim)
```

**Chests pay on new personal bests only**: when the post-tick streak equals
a milestone AND exceeds `quest_streak_best`. `quest_streak_best` then rises
to the new streak (it is monotonic; it also rises on non-milestone days).
One column kills the cycling exploit outright — deliberately breaking a
streak and re-running 3/7/14 re-grants nothing, because those milestones are
no longer personal bests. A player who broke a 40-day streak earns their
next chest at 60.

| Streak | Chest |
| --- | --- |
| 3 | 1,500 cash |
| 7 | 3,000 cash + 20 shards |
| 14 | rare egg + 2,500 cash |
| 30, 60, 90, … | epic egg + 40 + 10×(n−1) shards, capped at 100 (30→40, 60→50, 90→60…) |

Later milestones weight toward shards on purpose — cash and eggs are large
early-game rewards and rounding errors at endgame; shards are the endgame
currency. Chest eggs insert with `source: 'quest'`, `speciesId: null`,
rolled at hatch like expedition eggs. Chest shards bypass the sell window.

## 6. Achievements

Twelve tracks — exactly these stats: `eggs_hatched`, `dinos_fed`,
`income_collected`, `expeditions_claimed`, `battles_fought`, `battles_won`,
`stages_first_cleared`, `trades_completed`, `breedings_claimed`,
`splices_done`, `dinos_sold`, `lots_built`. (The six excluded:
`income_collections`, `eggs_incubated`, `breedings_started`,
`lots_upgraded`, `dinos_rescued`, `shop_purchases` — process stats, not
accomplishments.) Four tiers (bronze/silver/gold/platinum). Representative
thresholds (full table in `src/data/achievements.ts`):

| Track | Tiers |
| --- | --- |
| `eggs_hatched` | 10 / 50 / 200 / 500 |
| `battles_won` | 5 / 25 / 100 / 250 |
| `dinos_fed` | 25 / 150 / 500 / 1500 |
| `income_collected` | 10k / 100k / 1M / 10M |
| `splices_done` | 1 / 10 / 50 / 200 |

Tier rewards are uniform across tracks: bronze 500 cash, silver 1,250 cash,
gold 2,500 cash + 5 shards, platinum 5,000 cash + 20 shards. Full-sweep
lifetime total: 111,000 cash + 300 shards — about one legendary egg plus
60% of a Mythic, spread across months. The content gate enforces hard
ceilings: total achievement shards ≤ 350, total cash ≤ 150,000. Achievement
shards bypass the sell window like the rest.

A tier is **claimable** when `value ≥ threshold` and no `achievement_claims`
row exists — derived at read, like everything else. `/achievements` renders
progress bars per track, paginated; one **Claim all** button pays every
claimable tier in one transaction (reason `quest:achievements`). The
`/park view` dashboard gains an earned-tier count line.

## 7. Command surfaces and UX

New `daily` module — 12 → 13 modules, 22 → 24 top-level commands.

- **`/daily`** — public hub embed: three quest lines
  (`emoji description ▰▰▰▱▱ 3/5` or ✅), streak line with next-chest
  countdown, Claim button `daily:claim:<userId>` (owner-locked by customId
  segment, the pagination-button style). Banner `banners/daily.webp` via
  `attach`. Claim replies ephemeral; the hub re-renders on demand, not live.
- **`/achievements`** — paginated tracks (`pageRow('ach', 'page', …)`,
  standard clamped pagination), Claim-all button `ach:claimall:<userId>`,
  owner-locked. Banner `banners/achievements.webp`.
- **Quest-complete hint** — post-execute hook in `routeInteraction`, the one
  choke point every command and button already flows through. After a
  successful non-autocomplete dispatch: collect **all** of today's quests
  that are complete, unclaimed, and `notifiedAt IS NULL`; if any, stamp
  `notifiedAt` on **every** one of them and send **one** combined ephemeral
  `followUp` ("🎯 Quest complete — /daily to claim"). Exemptions and guards:
  the `/daily` and `/achievements` commands and the `daily`/`ach` component
  prefixes never trigger the hint (no hint about the screen the user is
  looking at); skip when the interaction never replied (errored path);
  never `setFooter` (list embeds' footers carry pagination). One action
  completing two quests — a battle win crossing both "fight 5" and "win 3"
  — produces exactly one followUp with both stamped.
- **Emojis**: `dw_quest`, `dw_streak`, `dw_chest` — SVG → `build-emojis` →
  `deploy-emojis`, unicode fallbacks (🎯 🔥 🎁) in `EMOJI_FALLBACK`. Never in
  module-level constants, never in autocomplete labels, never in `setEmoji`.
- **Help**: new `daily` topic in `HELP_TOPICS` (builder change → redeploy),
  lazy art descriptor `{ kind: 'banners', name: 'daily' }`.

## 8. Admin integration

- **`adminReset`** additionally deletes the target's `user_stats`,
  `daily_quests`, and `achievement_claims` rows and zeroes `quest_streak`,
  `quest_streak_best`, and `last_quest_claim_at_ms` — the Gene Lab lesson:
  reset must cover every table the feature reads.
- **`adminFastForward`** shifts `last_quest_claim_at_ms` back with the other
  time columns. `daily_quests.dayKey` rows are **deliberately excluded** —
  fast-forward cannot move the UTC calendar, so today's board stays today's;
  the shifted claim anchor is what lets a streak-gap scenario be simulated.
  Documented at the shift site.

## 9. Testing

- **Content gate** (the `battle-content.test.ts` pattern): every QuestDef
  and achievement tier references a real `StatId`; count-shaped quests
  reference count stats only; ids unique; pool is exactly 17 defs with
  ≥ 3 `'none'` defs on distinct stats; targets and thresholds positive and
  ascending; every `requirement` value handled by the roll filter; exactly
  12 achievement tracks; total achievement shards ≤ 350 and cash ≤ 150,000.
- **Migration**: production-path test — parent + child rows seeded, real
  `migrateDb`, FK pragma restored (the false-green lesson); backfill
  assertions: a user with two first-cleared stages, three lots, an accepted
  trade, and a claimed breeding opens with those counters seeded.
- **Substrate**: `track` increments inside a rolled-back txn leave no
  trace; a missing stat row reads 0 at baseline and progress; baseline
  snapshot means pre-roll actions don't count; the brand-new-account first
  command doesn't count, the second does; roll determinism (same user+day →
  same quests, different day → different; no two slots share a stat, ≤ 1
  churn def, ≤ 1 food def, for any seed); old-day rows deleted on roll;
  `feedDino` on a full dino counts nothing; empty-for-empty trade counts
  nothing; `buyFood` with units > 1 counts 1.
- **Streak boundaries**: same-day second claim no-tick; consecutive-day
  tick with a > 24h gap between the two claims (day 1 09:00 → day 2 10:00 —
  pins the dayKey comparison against an elapsed-window implementation); gap
  resets to 1; complete at 23:59 → claim at 00:01 → empty claim, no streak
  tick, no forfeit crash; chest at exactly 3/7/14/30 and escalation at 60;
  personal-best rule: break a 14-streak, re-reach 14 → no chest; exceed the
  old best → chest; fast-forward-simulated gap.
- **Claim**: idempotent under double-click (second claim finds nothing
  claimable, replies the empty form, writes nothing); claims only today's
  dayKey rows; economy conservation (quest rewards equal data-file sums
  under reason `quest:daily`, chest under `quest:chest`); unknown `questId`
  rows skipped at render and claim; claim-all achievements pays each tier
  once under `quest:achievements`.
- **Hint hook**: stamps every crossing quest, sends one combined followUp;
  never fires for autocomplete, for the exempt commands/prefixes, or when
  quests are already claimed or already notified; survives an errored
  command without replying.
- **Registration**: the standard 5 sites (modules.json, `ALL_MODULES`,
  registry-load 12→13 + 22→24, config expected-modules, contract count
  22→24). No autocomplete on either new command, so `AUTOCOMPLETE_OPTIONS`
  is untouched.

## 10. Operator steps at ship

1. `npm run deploy-commands` — 22 → 24, plus the changed `/help` builder.
   Exactly one bot instance per token.
2. `npm run build-emojis && npm run deploy-emojis` — 3 new emojis; commit
   the updated `assets/emojis/manifest.json` immediately.
3. `npm run test:live` — gains `/daily` and `/achievements` gallery cases.
