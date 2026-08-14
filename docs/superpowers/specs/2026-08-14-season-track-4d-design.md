# Spec 4d — The season track: a 30-day retention loop on the existing season cycle

The game's daily loop ends after claim, feed and collect. Achievements are lifetime
and one-time. Seasons already exist — a 30-day, three-flavour cycle derived from UTC —
and pay nothing at all. This spec gives that cycle stakes.

- **Season points** are a weighted sum of `user_stats` deltas against a per-season
  frozen baseline, capped per source. Derived at read time, never stored.
- **Eight reward rungs** paying cash, food, shards and eggs, plus a purely cosmetic
  **collectible capstone badge** numbered per season.
- **One new command**, `/season`, in the existing `daily` module.
- **A seventh `/top` metric**, a season-ending nudge on the existing alert sweep, and a
  rung-unlocked line folded into the hint that already fires.
- Migration **0015**: two new tables, no column drop, no table recreate.

Every balance figure below was measured against the real tables, not hand-computed.
The measurement pass and its `file:line` sources are summarised in §4.

---

## 1. Why a season track, and why not the three alternatives

Three other retention shapes were considered and rejected in order.

**A weekly quest layer** reuses `pickBoard`/`questProgress` wholesale and is by far the
cheapest to ship. Rejected because it is more of what already exists: a third streak
counter to explain, on a cadence that does nothing the daily board does not.

**A server co-op goal** has the most novelty and `user_guilds` is already populated on
every interaction. Rejected on cost and on shape: shared mutable state, per-member
contribution accounting, cross-server abuse surface, and it falls flat on the small
servers that make up most installs.

**A duel season with a ladder reset** fixes a real gap — Elo is permanent and pays
nothing — but reaches only players who duel.

The season cycle wins because **it is already there**. `seasonFor`/`seasonDay`
(`src/core/world.ts:58-71`) are pure functions of a UTC timestamp, already tested,
already displayed on `/world` and already re-tinting the park map's ground. The cadence,
the naming and the rollover arithmetic are all shipped. What is missing is the payoff.

---

## 2. Season identity, and the epoch that numbering needs

`seasonIndexFor(now)` = `Math.floor(dayIndex(now) / SEASON_DAYS)` — the absolute integer
already implied by `seasonFor`'s own modulo. **That integer is the storage key, and it is
never clamped or offset.**

Display numbering is separate: `index - SEASON_EPOCH + 1`, with `SEASON_EPOCH` set to the
absolute index live on ship day, so the first real season reads "Season 1". Flavour still
comes from `seasonFor`, so numbering and flavour cycle independently — Season 1 is
whichever of wet/dry/cold happens to be live, and Season 4 carries the same flavour as
Season 1 with a different number.

`dayIndex` counts from the Unix epoch, so the absolute index today is in the high
hundreds. Two consequences, both accepted:

1. `SEASON_EPOCH` must be **computed once and written down as a literal**, at
   implementation time, from the real ship date. It is not derived at runtime from
   anything — a constant that moved would renumber every badge already earned. As of
   2026-08-14 the value is **689** (`dayIndex` 20,679, season day 10). The next boundary
   falls at `dayIndex` 20,700 — 2026-09-04 — so if this ships after that date the constant
   must be recomputed, not copied from this line.
2. `makeCtx` defaults `nowMs` to 0 (`tests/harness.ts`), which is absolute index 0 and
   therefore a **non-positive display number**. The season embed tests must pin a real
   timestamp rather than day 0. Every other test in the suite keeps day 0, exactly as the
   `WORLD_SALT` calm-epoch property requires.

---

## 3. Data model

Two tables, both mirroring shapes already in the schema.

### `season_progress`

One row per `(userId, seasonIndex)`, unique on the pair.

| column | type | note |
|---|---|---|
| `userId` | text FK → `users.discordId` | |
| `seasonIndex` | integer | the absolute index from §2, never the display number |
| `baselines` | text JSON | `Partial<Record<StatId, number>>` |
| `headStart` | integer | §7, frozen at roll time, never recomputed |
| `badgeAt` | integer ms, nullable | stamped when points cross the capstone; §9 |
| `createdAt` | integer ms | |

JSON is the established idiom here (`users.duelSquad`, `lots.decor`, `dinos.traits`).

Frozen lazily by `rollSeason` on the season's first touch, the same shape as
`rollDailyQuests` (`src/modules/daily/service.ts:85-106`) — but **without its
delete-every-other-key sweep**. Rows are retained, one per season the player was active
in, because `badgeAt` on a past row is the permanent record of that season's capstone
(§9). Twelve rows per player per year; the sweep would destroy the collection it exists to
record.

**Never derive points for a past season.** Only the current season's row is read for
points, because `user_stats` keeps growing after a season ends — a delta computed against
an old baseline would climb forever. A past row's meaning is `badgeAt`, nothing else.

**The map freezes all 18 `StatId`s, not only the ones the ladder currently reads.** A
source added in a later season would otherwise find no key for its stat, read the
baseline as 0, and credit that player's entire lifetime counter in a single tick. Freezing
everything costs one extra `readStats` call — which `rollSeason` already makes — and
removes the failure mode permanently.

### `season_claims`

`(userId, seasonIndex, rung, claimedAt)`, unique on the first three. Exactly
`achievement_claims`.

**Rungs only.** The badge is deliberately *not* a row here — it is `season_progress.badgeAt`,
because it is granted on crossing rather than claimed (§9). Keeping the two apart is what
stops an unclaimed rung 8 from silently costing a permanent collectible.

### What is derived

Points are computed at read time: one `readStats`, subtract the frozen baseline per stat,
apply per-source rate and cap, add `headStart`. Nothing sweeps. A missing `user_stats`
row reads 0 on both sides of the subtraction and contributes nothing.

**The per-stat delta clamps at 0.** `adminReset` deletes `user_stats` rows; without the
clamp a surviving baseline against a wiped counter yields a negative delta.

### Reset and fast-forward

`adminReset` deletes from **both** new tables, **every season's rows, not just the current
one** — the standing "reset must delete from every table the feature reads" rule the Gene
Lab `breedings` fix established. That destroys the player's badge collection, which is the
correct reading of a reset and worth stating out loud, since `badgeAt` is otherwise the one
value in this feature that nothing else can ever clear.

`adminFastForward` deliberately touches **neither**. `seasonIndex` derives from the UTC
calendar, which fast-forward cannot move, exactly as it leaves `daily_quests.dayKey`
alone. There is no season streak, so there is no claim anchor worth shifting.

---

## 4. The measured economy this is priced against

Every figure below came from a measurement pass over the real tables. They are recorded
here because the ladder in §5 is meaningless without them, and because the next author
re-tuning a cap needs the denominator, not just the numerator.

| quantity | measured value | source |
|---|---|---|
| Mid-game park income | 36,036 cash/day | `src/core/clock.ts:119-166` (simulated) |
| Endgame reference park income | 4,561,920 cash/day | 48 legendary, fit 1.00, bonus 32% |
| 30 days of daily quests | ≈45,550 cash, ≈450 shards | `src/data/quests.ts` + `chestFor` |
| Energy ceiling | 144 fights/day | `ENERGY_CAP` 10, `ENERGY_REGEN_MS` 600,000 |
| Shard daily cap from sales | 60 | `src/modules/shop/shards.ts` |
| Mythic egg | 500 shards | `src/modules/shop/service.ts` |
| Splice cost | 15 shards | `SPLICE_SHARD_COST` |
| Landmark tier 1 | 5,000,000 cash | `src/data/landmarks.ts` |

The endgame figure is the one that shapes the reward design, and it is worth stating
bluntly rather than discovering later: **60,000 cash is 1.3% of one endgame day.** The
cash half of this track serves the mid-game and nobody else. The endgame payload is the
epic egg and the badge. That asymmetry is intentional, not a sizing miss.

---

## 5. The points ladder

Nine sources, each with a per-season cap. The cap is the whole design: it converts every
unbounded grind into early saturation instead of a treadmill.

| source | stat(s) | rate | cap | priced against |
|---|---|---|---|---|
| Campaign | `battles_fought` | 1 per 4 | 250 | 144 fights/day energy ceiling; moderate 30/day → 225 |
| Expeditions | `expeditions_claimed` | 5 each | 250 | single slot, 15 min–48 h sites; moderate 1.5/day → 225 |
| Hatchery | `eggs_hatched` | 3 each | 225 | incubator slots × `incubationMs`; moderate 2/day → 180 |
| Gene Lab | `breedings_claimed` | 5 each | 180 | breed slots + parent cooldown; moderate 1/day → 150 |
| Care | `dinos_fed` | 1 per 3 | 120 | no gate at all — worst rate on purpose |
| Sales | `dinos_sold` | 3 each | 100 | 1.13/day, far under the 60-shard/day cap |
| Splicing | `splices_done` | 15 each | 90 | 6 splices = 90 shards, under what the track returns |
| Commerce | `trades_completed` ×15 + `shop_purchases` ×1 | — | 60 | 4 trades **or** 60 transactions |
| Collections | `income_collections` | 1 each | 60 | participation floor, 60 clicks |

**Available 1,335. Capstone 800** — 60% of available, and no single source reaches 31% of
it. Breadth is forced; no individual source is mandatory.

### Six choices inside that table worth recording

**`battles_fought`, not `battles_won`.** Both sit under the same energy ceiling, but
`fought` never shuts out a player whose squad is under-geared for the chapter they are on.

**`eggs_hatched`, not `eggs_incubated`.** They share one ceiling — a slot is only freed by
a hatch — so crediting both double-pays a single action. That is exactly what `CHURN_STATS`
already prevents on quest boards.

**`breedings_claimed`, not `breedings_started`.** The claim is what consumes the pairing,
frees the slot and starts the parents' cooldown, and `claimed ≤ started` always holds.

**`income_collections`, not `income_collected`.** The sum stat spans 36,036/day mid-game
to 4,561,920/day endgame — a 126× spread no single points-per-cash rate can calibrate for
both ends. Any rate letting a mid-game park earn the cap in 30 days hands an endgame park
the entire cap on day 1.

**Splicing is priced so the source costs less than the track returns.** At 6 points per
splice its cap would take 15 splices — 225 shards, against the 110 the whole track pays
back. A source that is net-negative in the game's scarce currency is not a source for the
players it is meant to serve: a shard-poor mid-game player would rationally skip it, which
is exactly the population the 90 points exist for. At 15 points per splice the cap costs 6
splices, 90 shards, under what the track returns. The high per-unit rate means a wealthy
player saturates it in six clicks — acceptable, and contained the same way `dinos_fed` is,
by a cap worth 11% of the capstone. The cap is unchanged, so the day-1 bankable pool in
§10 does not move.

**Commerce pairs `trades_completed` with `shop_purchases` rather than dropping trading.**
`acceptTrade` requires a second player and only the recipient may accept, so trading
cannot be a source on its own without violating the solo-reachable rule. Pairing it with a
solo stat gives the source two honest routes — 4 trades or 60 shop transactions — and
keeps the social loop from earning literally nothing on the track. `shop_purchases`
increments **once per transaction, never scaled by units**
(`src/modules/shop/service.ts:140`), so 60 is 60 purchases.

### Finite counters are excluded

`stages_first_cleared`, `lots_built` and `lots_upgraded` are one-time lifetime counters. A
veteran who has cleared the campaign and maxed their park can never move them again, so
crediting them would hand new accounts a permanent advantage over the players the loop
most needs to keep. `dinos_rescued` is excluded on the same logic — it is an artifact of
neglect, and paying for it rewards letting dinos escape.

---

## 6. The rungs

The **moderate profile** used throughout this spec is the low end of each source's measured
band, summed over 30 days: campaign 225, expeditions 225, hatchery 180, Gene Lab 150, care
100, sales 90, splicing 90, collections 60 — **1,120 points, or 37.3/day**. It deliberately
scores Commerce at **zero**: a player who neither trades nor shops must still clear the
capstone, so the profile that sizes the rungs assumes they do not.

At 37.3/day the capstone lands on **day 21.4** — 8.6 days of slack in a 30-day season. A
10-day lapsed player reaches 373 and lands on rung 4, the middle, by construction.

| rung | points | reward | why here |
|---|---|---|---|
| 1 | 50 | 3,000 cash | same-session first payout, ~2× a daily board |
| 2 | 125 | 6,000 cash + 20 royal greens | tier-3 food is what sustains comfort 1.00 across a day |
| 3 | 225 | 8,000 cash + 15 shards | exactly one splice, recyclable into the splicing source |
| 4 | 350 | 10,000 cash + 1 rare egg | mirrors `chestFor`'s streak-14 rare |
| 5 | 475 | 12,000 cash + 25 shards | largest cash rung, just past the midpoint |
| 6 | 600 | 12,000 cash + 40 prime steak | food over shards, to hold the shard line down |
| 7 | 700 | 1 epic egg + 30 shards | matches `chestFor`'s 30-day epic cadence, does not stack a second one |
| 8 | 800 | 9,000 cash + 40 shards | capstone rung |

**The badge is not on this ladder.** Crossing 800 points grants it outright (§9); rung 8
pays only its cash and shards, claimable and forfeitable like every other rung.

Season totals: **60,000 cash** (1.32× a month of quests, inside the 1–1.5× target) and
**110 shards** (24% of the quest shard line, 22% of one mythic — materially below the cash
multiple, which was the explicit constraint, because shards buy mythic eggs and doubling
mythic acquisition is a real balance change, not a reward tweak).

---

## 7. The head start

`headStart = min(200, speciesSeen + battleStars + floor(ratingHighWater / 25))`.

Natural maximum 197 (52 + 105 + 40); the 200 clamp is belt-and-braces. That is 24.6% of
the capstone and lands just under rung 3, so no head start alone buys a shard rung.

**It pays on a player's first season ever, not on calendar season 1.** A returning veteran
who first plays in season 5 still gets credit for what they built; a genuinely new account
computes to ~0 naturally, with no special case needed. Stored on the baseline row at roll
time and never recomputed, so it cannot drift as the season's own progress moves.

### Why these three terms and no others

All three are **complete for every account**. `species_seen` is credited at all three mint
and transfer sites and was seeded for pre-existing inventory by
`scripts/backfill-species-seen.ts`; `battle_progress.stars` and `users.ratingHighWater`
both predate migration 0006 entirely.

**Achievement claims are excluded**, despite being the obvious fourth term. Every
`ACHIEVEMENTS` track is gated on a `user_stats` counter and 7 of the 12 sit on counters
0006 never backfilled, so 28 of 48 tiers are unreachable-from-history for a pre-0006
account. Including that term would under-credit exactly the oldest, most invested players
— the same inversion `legacyPoints` was built across three other tables to avoid.

`user_stats` deltas are excluded for the same reason at a larger scale: twelve of eighteen
counters are permanently 0 for pre-0006 accounts.

Rating is divided by 25 rather than 10 so its term (max 40) stays the smallest of the
three. Rating is the one signal a veteran can still move *during* the season, and
weighting it heavier would let the head start drift toward double-counting live progress.

Worked examples: new account **0**; mid veteran (30 species, 50 stars, rating 600) =
30 + 50 + 24 = **104**, rung 1 on login; maxed veteran = **197**.

---

## 8. Surfaces

### `/season`

One command, no subcommands, in the existing `daily` module — which already owns quests
and achievements, the claim family this belongs to. That placement skips `modules.json`
and `ALL_MODULES` entirely; only the command counts move (27 → 28).

The hub renders: season name and display number, days remaining, total points with a
**per-source breakdown** (the formula must be legible or the track is a black box), the
rung ladder with unlocked/claimed state, and a claim button. Claim pays every
unlocked-unclaimed rung at once, as `claimQuests` does.

### The claim button carries its season

`season:claim:<uid>:<seasonIndex>`. The handler validates the parsed index **equals the
current season**, after the owner check and before any read or write.

This is the landmark stale-button lesson applied without waiting to relearn it
(`park:landmark:buy` originally carried no tier and charged up to 32× its own label). A
Discord message is durable and its label is not re-derived, so a `/season` card left open
across a rollover would otherwise pay this season's rungs against last season's ladder.
The success path additionally answers with `i.update` of a freshly built payload — a
second layer only, never the guard, since any *other* open message still holds a stale
button.

### The park card badge

An inline `🎖️ Seasons` field after `🏛️ Legacy` in `dashboardPayload`: the count of
`season_progress` rows with `badgeAt` set, plus the latest badged season's name.

Layout consequence, measured: Achievements + Legacy + Featured currently form exactly one
inline row of three, so a fourth inline field wraps Featured onto its own row. Accepted —
the income-capped case already breaks that row with a full-width field, so the two layouts
differ regardless.

**The badge count must be a pure read.** `visitPayload` renders this card for another
player's id, and the rule there is explicit: a read path on someone else's park must never
become a write path. `earnedTierCount` is the precedent to copy — one select, `.all()
.length`, no write. `visitPayload` reuses `dashboardPayload`'s embeds by reference, so the
badge appears on the visit card automatically; what it does **not** reuse is components,
which is why nothing about the claim button leaks there.

### `/top season`

A seventh metric ranking **live** season points — the same function `/season` renders,
never a high-water. The board answers "who is ahead right now"; the park card answers
"what have you ever earned". That is the same split the repo already drew between
`legacyScores` and `legacyRankBest`, and conflating them would let a wiped account keep
outranking players actually ahead of it.

Batched, no N+1: one `user_stats` select scoped by `inArray(userId, memberIds)` returns
every counter for the whole board (the per-stat filter is a JS predicate, not a second
query), plus one `season_progress` select scoped the same way **and filtered to the current
`seasonIndex`** — rows are retained per season now, so an unfiltered read would return a
player's whole history and pick an arbitrary baseline. Costs: **3 global / 4 server /
1 zero-member** — that last one only if the new builder keeps the
`userIds.length ? … : []` short-circuit, which is the only assertion in the cost test that
proves a builder is actually member-scoped rather than reading the whole table.

Five production sites change (the `Metric` union, both ternary chains in `scored()`, a new
batched builder, and `metricLabel`/`formatValue`/`addChoices` in `index.ts`) and four test
sites in `tests/leaderboards.test.ts`. Note that adding a metric to only the second ternary
chain dereferences `byUser!` as null — the compiler does not catch it, and neither does
`npm test`, since vitest transpiles without typechecking.

### Season-ending nudge

Rides the existing 15-minute `alert_sweep`, as a new alert kind. `firedForMs` is the
**season's end instant**, so exactly one DM per season regardless of how many sweeps run
inside the window. It fires only to players holding unclaimed unlocked rungs — a player
with nothing to lose gets nothing.

This exists because the forfeit rule in §9 would otherwise bite silently after 30 days of
accumulation.

### Rung-unlocked hint

Folded into `dailyRouterHooks.postDispatch`'s **existing single combined followUp** — never
a second one, or quest-complete and rung-unlocked stack into hint fatigue on the same
dispatch. `/season` joins `EXEMPT_COMMANDS` and `season` joins `EXEMPT_PREFIXES`, so no
hint fires about the screen the player is already reading.

---

## 9. Rollover

Rungs unlock as points cross them and are claimable at any time until the season ends.
**Unclaimed rungs are forfeited at rollover**, exactly as `claimQuests` already forfeits an
unclaimed board after midnight ("forfeited by design").

Uniform with both claim surfaces already shipped, and the deadline is the urgency the loop
runs on. The hub shows days remaining and the nudge in §8 fires in the final window, so the
forfeit is never a surprise.

### The badge is granted, never claimed — and never forfeited

Cash, shards, food and eggs are re-earnable next season, so a deadline on them is a fair
deadline. **The badge is re-earnable by nothing, ever** — that season is gone. Forfeiting a
unique unrepeatable collectible because a button went unpressed punches a permanent hole in
a collection whose entire meaning is that a gap says *I did not play enough that season*. A
gap that says *I forgot to click* corrupts the record instead of keeping it.

So crossing the capstone stamps `season_progress.badgeAt` directly. The write lives in
`dailyRouterHooks.postDispatch`, which already runs after every successful dispatch and
already computes progress for the rung-unlocked hint — a write in a **write** context, so
no read path becomes a write path and `visitPayload`/`/top` stay pure. The stamp is an
idempotent update guarded on `badgeAt IS NULL`.

Three consequences, all intended:

- The crossing action and the stamp are the same interaction, because the action is what
  moved the counter that crossed the threshold.
- Autocomplete never reaches hooks and never moves a stat, and an errored dispatch rolled
  its stat write back, so neither can strand a badge.
- `EXEMPT_COMMANDS`/`EXEMPT_PREFIXES` suppress the hint **text** only. The badge stamp must
  run for exempt commands too, or crossing the capstone while looking at `/season` itself
  would silently not record it.

The collectible is earned by playing; the consumables are earned by showing up to claim.

Two alternatives were rejected. **Auto-granting on crossing** removes the deadline and the
ritual, and needs a grant record to stay idempotent anyway, so it saves nothing. **A grace
window into the next season** means two seasons are live at once, and every read, embed and
claim path would have to disambiguate which season a rung belongs to — for a case the days-
remaining counter already prevents.

---

## 10. Tests

### `tests/season-content.test.ts` (new) — the machine gate for the ladder

- Source caps sum strictly above the capstone (1,335 > 800), so no player must max
  every source.
- No single source reaches the capstone alone (max 250 < 800).
- Every source is solo-reachable — specifically, no source's only path requires a second
  player. This is the assertion that would have caught the dropped-trading design.
- Rungs strictly ascending; the capstone is the last rung.
- Every stat referenced exists in `STATS`, and none is a finite lifetime counter.

### `tests/season-balance.test.ts` (new)

- The moderate profile clears the capstone inside 30 days (day 21.4).
- **A lab-less moderate profile still clears inside 30 days.** Strip the two Gene Lab
  sources — 1,120 − 150 − 90 = 880 over 30 days, 29.3/day, capstone on **day 27.3**. This
  is the assertion that converts §13's judgement call into a machine gate: any retune that
  pushes a Gene-Lab-less player past day 30 fails here rather than in a player's inbox.
- **The day-1 bankable pool stays below rung 5.** Feeds 120 + sales 100 + splices 90 +
  commerce 60 + collections 60 = **430**, 54% of the capstone, below the 475 rung. That
  number is the real guard on the ungated sources, and it is the first thing that breaks
  if any of those five caps is ever raised. Assert the arithmetic, not a comment.

### Everything else

- Baseline freeze: all 18 stats present in a fresh row; a stat added later still has one.
- Delta clamps at 0 against a wiped `user_stats` (the `adminReset` interaction).
- Rollover by injected clock: consumable rungs forfeit, past rows are **retained**, a new
  season rolls a fresh baseline rather than reusing the old one.
- **A badge survives an unclaimed rung 8** — cross the capstone, never claim, roll the
  season, assert `badgeAt` is still stamped and the cash/shards were forfeited. This is the
  §9 decision's only real gate.
- The badge stamp is idempotent, fires for exempt commands, and never fires from a read
  path (`visitPayload` and `topPlayers` leave `badgeAt` untouched).
- Claim idempotency, and a stale `seasonIndex` in the customId rejected.
- Head start: complete-signal terms only, first-season-ever, never recomputed.
- Badge on **both** surfaces — own park and other-player — following the doubled pattern
  `tests/park.test.ts` already uses for the two existing badges, where the other-player
  case asserts the target's value **and** `not.toContain` the viewer's. A title mismatch
  fails louder than present-vs-absent, and no existing test pins the card's full field
  list, so absence would otherwise go uncaught.
- `adminReset` deletes from both new tables; `adminFastForward` touches neither.
- Leaderboard cost pins extended: 3 / 4 / 1.

---

## 11. Docs and comments that go false

| location | change |
|---|---|
| `src/core/world.ts:62-64` | "Seasons are COSMETIC" — **rewrite, do not delete**. The rewrite must preserve the true half: seasons still carry **no modifiers**, so every season×event stacking question stays dead. Rewards are not modifiers. |
| `docs/gameplay.md:905-907` | "/top ranks players by one of six metrics" → seven |
| `docs/commands.md:123` | the `/top` row, plus a new `/season` row |
| `CLAUDE.md:867` | the per-metric query counts (1/1/2/2/4) gain a sixth entry |
| `docs/gameplay.md` | a new Seasons section: how points are earned, the forfeit rule, the badge |
| `HELP_TOPICS` | a season line. Adding a topic **key** forces `deploy-commands`; adding a line to an existing body does not. |

---

## 12. Explicitly not in scope

- **No season modifiers.** Seasons remain mechanically inert. Rewards are not modifiers,
  and the season×event stacking question stays closed.
- **No duel-season reset.** Elo stays permanent; that is its own spec.
- **No new species, chapter, site or decor.**
- **No seasonal decor rewards.** `recomputeRating` sums `l.level + l.decor.length` flat,
  so granting decor grants rating — a decor reward is a power reward wearing a cosmetic
  hat, and the capstone must not touch `parkRating`.
- **No retro-credit from `user_stats`.** §7 covers why.

---

## 13. Known and accepted

**`dinos_fed` saturates in about 8 interactions.** Tier-1 food fills to exactly 100 and
`hungerAt` drops strictly below 100 after any `dt > 0`, so a dino re-qualifies almost
immediately, and `feedAll` credits one per dino per interaction. A 48-dino roster banks the
full 120-point cap for roughly 720 cash of ferns. The cap contains it: the exploit buys
days, never points. It is priced at the worst rate in the ladder for exactly this reason.

**Expeditions is the cheapest legitimate cap** — `coastal_dig` at 15 minutes and 200 cash
means 50 claims is 12.5 hours of wall clock. Lowering the per-unit rate is the wrong fix:
5 points per claim exists to protect the player running 48-hour Founder's Park expeditions
for the egg odds, who would otherwise be punished into coastal spam. If it ever matters,
the fix is a per-source daily sub-cap.

**270 points sit behind a 20,000-cash Gene Lab** (breeding 180 + splicing 90). A lab-less
player has 1,065 available against an 800 capstone — still clearable, but headroom
(`(available − capstone) / capstone`) drops from **66.9% to 33.1%**, and they must near-max
four of the remaining seven sources. A lab-less **moderate** player clears on **day 27.3**,
with 2.7 days of slack instead of 8.6. Tight, and deliberate.

Lowering the capstone to 750 was considered and rejected: it buys the lab-less player 1.7
days, costs every other player 1.3, and changes no category's outcome, since both clear
either way. The lab itself is 20,000 cash against 36,036/day of mid-game income — 0.55
days. Its real cost is a **lot slot**, and a player choosing another paddock over a lab is
making an income trade the season track has no business relitigating.

What *was* wrong next to it is fixed rather than papered over: splicing's original 6
points/splice made its cap cost 225 shards to earn 90 points, against 110 returned by the
whole track — see §5. The gate that keeps this honest is the lab-less clear assertion in
§10, not this paragraph.

**There is no QA path to advance a season on the live bot.** `adminFastForward` cannot move
the UTC calendar, and `season_progress` is the first stored season state in the repo.
Rollover is testable only by injecting the clock offline. Do not add a live season-skip
command as a workaround — it would be an admin path capable of destroying real progress.

---

## 14. Operator steps

In order:

1. Back up the live DB (online SQLite backup, per `docs/ops.md`).
2. `npm run build`.
3. Restart the bot — **exactly one instance per token**. Migration 0015 applies on boot.
4. `npm run deploy-commands` — one new command (`/season`) plus one new `/top` choice.
   Restart before deploy, per the ordering established in the 2b work.
5. Extend the `test:live` gallery with a season case (the hub at partial progress, and a
   capstone-claimed park card), then run it.

No emoji work: the badge uses an existing unicode glyph, so `deploy-emojis` is not run and
`assets/emojis/manifest.json` is not touched.
