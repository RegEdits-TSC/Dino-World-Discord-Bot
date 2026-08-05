# The Living World — design

Spec 1a of a three-part roadmap. Global, double-edged world events derived from
the UTC day, a cosmetic season cycle, and three shipped defects fixed along the
way.

## 1. Why

Dino World is feature-complete and inert. The bot speaks proactively about
exactly four things — an egg finishing, an expedition returning, a breeding
finishing, and trade activity — and every one of them is a receipt for a timer
the player started themselves. Nothing ever happens *to* a player. The
simulation computes escapes, hunger crossings, and income caps continuously and
then discards all of it unread.

This spec makes the world act on its own clock. One event per UTC day, the same
for every player everywhere, with real trade-offs that reward adapting rather
than merely showing up.

### Roadmap context

| Part | Theme | Status |
| --- | --- | --- |
| 1a | The Living World — global events, seasons, `/world` | **this spec** |
| 1b | The Park Speaks First — proactive alerts, buttons on notifications, expedition dispatches | next |
| 2 | Depth & Endgame — habitat enrichment, prime decor sink, hatchery L4–L5, veteran ranks, `/dex` | later |
| 3 | The Server Is A Park — exhibition duels, rich park visits, wider leaderboards | last |

Part 3 is deliberately last: it is dead weight until real players exist, and it
is the cheapest of the three, so deferring it costs nothing.

## 2. Design decisions

These were settled during brainstorming and are not open questions.

| Decision | Choice | Why |
| --- | --- | --- |
| World scope | **Global** | One world for everyone, derived from a UTC time key. Costs no new table and behaves identically with 1 player or 10,000. Creates shared talking points the moment a crowd exists. |
| Event polarity | **Double-edged** | Every non-calm event gives something and costs something. This is the language the game already speaks: Grazer is +20% income / +20% drain, Glass Cannon is +25% attack / −15% HP. An event is a trait applied to the world. |
| Integrated effects | **Income only** | Income and hunger drain both accrue across a window. Income's fix generalizes existing code; drain's does not (see §5). Everything else is point-in-time. |
| Seasons | **Cosmetic only** | Ground re-tint and a line on `/world`, zero balance effect. Removes all season×event stacking. Modifiers remain a purely additive follow-up. |
| Announcement | **Passive + opt-in broadcast** | Always visible as a header line and on `/world`; a 00:00 UTC broadcast only for servers that explicitly opt in. Never a DM. |
| Storage | **Nothing stored** | `worldEventFor(now)` is pure. Same philosophy as derived escrow locks (`src/core/locks.ts`) and derived quest progress (`src/modules/daily/service.ts`). |

## 3. Architecture

Three new files plus one new module.

```
src/data/world-events.ts    WORLD_EVENTS roster, weights, effect records
src/core/world.ts           worldEventFor(now), eventMods(now), seasonFor(now)
src/modules/world/          /world command, header helper, broadcast handler
```

### The derivation

```ts
const WORLD_SALT = 0x9e37_79b9;             // any fixed non-zero constant
export function worldEventFor(now: number): WorldEvent {
  const day = Math.floor(now / DAY_MS);      // DAY_MS already exists in clock.ts
  return rollWeighted(WORLD_EVENTS_WEIGHTED, mulberry32(day ^ WORLD_SALT));
}
```

`DAY_MS` and `mulberry32` and `rollWeighted` all already exist
(`src/core/clock.ts:33`, `src/core/rolls.ts:5,15`). Nothing new is invented.

**The salt is load-bearing.** `dailyEggOffers` already seeds `mulberry32(day)`
raw (`src/modules/shop/service.ts:19`). Sharing that stream would permanently
correlate "Market Panic day" with "legendary egg in the shop day". A test
asserts the two streams are uncorrelated across 10,000 days.

### The modifier record

`eventMods(now)` returns a flat record of multipliers, every one defaulting to
`1` (or `null` for the non-numeric ones):

```ts
interface EventMods {
  income: number;             // integrated — see §5
  feedCost: number;
  expeditionMs: number;
  expeditionFee: number;
  expeditionCash: number;
  expeditionOddsShift: -1 | 0 | 1;
  eggPrice: number;
  foodPrice: number;
  sellCash: number;
  energyCostDelta: number;    // added to stage.energyCost, result floored at 1
  battleXp: number;
  enemyHp: number;
  breedMs: number;
  hatchTraitOdds: [number, number, number] | null;
}
```

One record, resolved once per interaction, threaded to the call sites that need
it. Callers never re-derive it mid-request — a request that straddles 00:00 UTC
must behave consistently within itself.

**`income` is the one field that is never read off this record.** Every other
modifier describes an action happening *now*, so the request-time record is
correct for it. Income describes a rate applied *across a past window*, and must
be sampled per segment via `incomeMultAt(t)` (§5). The field is present on the
record only so `/world` and the header lines can display it; a production call
site that reads `eventMods(now).income` to compute a payout is the bug §5 exists
to prevent, and has its own failing test.

## 4. The roster

Nine outcomes. Clear Skies carries weight 4, the other eight weight 1 each, so
**one day in three is uneventful**. That is deliberate: an event every day is
not an event.

| Event | Gives | Costs | Layer |
| --- | --- | --- | --- |
| ☀️ Clear Skies | — | — | true no-op |
| 🌩️ Amber Storm | expedition duration ×0.75 | expedition fee ×2 | point-in-time |
| 🦴 Fossil Rush | expedition cash ×1.5 | egg rarity odds shift down one step | point-in-time |
| 🔥 Heat Wave | income ×1.20 | feed cost ×1.30 | income integrated |
| ❄️ Cold Snap | feed cost ×0.75 | income ×0.90 | income integrated |
| 🌾 Bumper Harvest | food price ×0.60 | egg price ×1.25 | point-in-time |
| 📉 Market Panic | egg price ×0.70 | sell cash ×0.80 | point-in-time |
| 🩸 Blood Moon | stage energy cost −1 (floor 1), battle XP ×1.5 | enemy HP ×1.15 | point-in-time |
| 🧬 Migration Season | wild hatch trait odds 45/40/15 | breeding time ×1.25 | point-in-time |

**Blood Moon is energy *cost*, not energy *regen*.** `energyAt`
(`src/data/battle/energy.ts:12`) derives the pool as
`floor((now − updatedAt) / ENERGY_REGEN_MS)` — that is integrated over time and
carries the same seam problem as income. Reading `stage.energyCost` at the
instant of the fight is point-in-time and delivers the same fiction. Bosses go
3 → 2, stage 4 goes 2 → 1, stages 1–3 are already at the floor and are
unchanged.

**Heat Wave and Cold Snap modify feed *cost*, not drain *rate*.** Drain rate is
inverted by `comfortCrossing` and `escapeAt` (`src/core/clock.ts:59-73`) to
solve for *when* hunger reaches a threshold. Making the rate piecewise turns
that inversion into a segment walk through the most load-bearing pure functions
in the game — which feed escape warnings, `/dino list`, autocomplete labels, and
Spec 1b's alert timers. `feedCostFor(rarity, traits)`
(`src/modules/care/service.ts:24`) is a single function and a single multiply.
Same fiction, a fraction of the risk.

### Hard invariant

**No event touches park rating, best-ever rating, chapter gates, expedition site
unlocks, the shop rarity ceiling, or the trading 4.0★ minimum.** Effects are
pure multipliers at the same layer as trait modifiers. A machine test asserts
`recomputeRating` returns an identical value under all nine events for a fixed
park.

### Effect call sites

Every hook already exists as a single clean seam. None requires restructuring.

| Effect | Call site |
| --- | --- |
| `income` | `accruedIncome` — `src/core/clock.ts:82` (see §5) |
| `feedCost` | `feedCostFor` — `src/modules/care/service.ts:24` |
| `expeditionMs` | `now + site.durationMs` — `src/modules/expeditions/service.ts:31` |
| `expeditionFee` | `cash: -site.cost` — `src/modules/expeditions/service.ts:33` |
| `expeditionOddsShift` | `rollRarityFromOdds(site.eggOdds, …)` — `src/modules/expeditions/service.ts:46` |
| `expeditionCash` | `rollIntInclusive(site.bonusCash[0], …)` — `src/modules/expeditions/service.ts:50` |
| `eggPrice` | `SHOP_EGG_PRICES[rarity]` in `buyEgg` — `src/modules/shop/service.ts:29` |
| `foodPrice` | `buyFood` — `src/modules/shop/service.ts:40` |
| `sellCash` | `SELL_CASH[rarity]` — `src/data/sell.ts:14` (read at `shop/shards.ts:31,55` and `shop/index.ts:147`) |
| `energyCostDelta` | `stage.energyCost` — `src/modules/battles/service.ts` |
| `battleXp` | XP award in `runFight` — `src/modules/battles/service.ts` |
| `enemyHp` | `Math.round(s.hp * (boss?.hpMult ?? 1))` — `src/modules/battles/service.ts:92` |
| `breedMs` | `BREED_MS[sa.rarity] * timeMult` — `src/modules/genelab/service.ts:118` |
| `hatchTraitOdds` | wild hatch trait roll — `src/modules/hatchery/service.ts` |

Two of these deserve a note:

- **`breedMs` reuses `timeMult`**, the multiplier the Fertile trait already
  applies. The event multiplier composes into the same term; no new arithmetic.
- **`expeditionMs` and `breedMs` are captured at *start*, not at claim.** Both
  write a concrete `returnsAt` / `readyAt` into the row and enqueue a scheduler
  timer against it. An event that ends mid-flight must not retroactively move a
  timer that has already been scheduled.

## 5. Income across a seam

This is the only genuinely hard part of the spec.

`accruedIncome` (`src/core/clock.ts:82-111`) already splits each dino's window
at the hunger-100 knee, because a two-point trapezoid across it mis-pays
overfed dinos:

```ts
const seg = (a, b) => ((comfortAt(d, a) + comfortAt(d, b)) / 2) * ((b - a) / 3_600_000);
const knee = d.lastFedAt + Math.max(0, (d.hungerAtFed - 100) / 100) * drainMs;
const comfortHours = knee > from && knee < dinoEnd
  ? seg(from, knee) + seg(knee, dinoEnd)
  : seg(from, dinoEnd);
```

Events add a second kind of breakpoint. Generalize to a sorted breakpoint list,
and weight each segment by **its own day's** multiplier:

```ts
const breaks = [from, ...(kneeInRange ? [knee] : []), ...utcMidnightsBetween(from, dinoEnd), dinoEnd]
  .sort((a, b) => a - b);
let comfortHours = 0;
for (let i = 0; i < breaks.length - 1; i++) {
  const [a, b] = [breaks[i], breaks[i + 1]];
  if (b <= a) continue;
  comfortHours += seg(a, b) * incomeMultAt(a);
}
```

Properties this must hold, each with its own test:

1. **A window entirely inside one event pays exactly what it pays today** when
   that event's multiplier is 1.0. This is the regression gate: with all
   multipliers at 1.0 the function must be byte-identical to current output for
   every existing test fixture.
2. **A 30h window spanning Heat Wave → Cold Snap** pays ×1.20 for the Heat Wave
   hours and ×0.90 for the rest — never a single blended rate, and never
   "whatever event is live when Collect was pressed". The latter would let a
   player park income and time collections to farm the best multiplier.
3. **The knee and a midnight landing on the same instant** produce no
   zero-length segment and no double count. The `if (b <= a) continue` guard and
   deduplicating the sorted list both matter.
4. **At most two events** can ever be spanned: the income cap window is 24h at
   Visitor Center L5 (`capHours`), so `utcMidnightsBetween` yields at most one
   interior breakpoint. The implementation must not *assume* that — it should
   handle N — but the test suite pins the real-world bound.

`incomeMultAt(t)` is `eventMods(t).income`. It takes an instant, not the request
time. Passing the request time is the bug this whole section exists to prevent.

### Signature change

`accruedIncome` currently takes `(dinos, facilityBonusPct, capHours, from, to)`.
It gains no parameter: `incomeMultAt` is imported directly from
`src/core/world.ts`, which is pure and has no `ctx` dependency. This keeps every
existing call site unchanged and keeps the function testable without a harness.

## 6. Surfaces

### `/world`

A new top-level command in a new `world` module. Shows:

- Today's event: emoji, name, flavour blurb, and every active effect spelled out
  in plain language ("Feeding costs 30% more food", not "feedCost ×1.30")
- The season and its day (`🌧️ Wet — day 12 of 30`)
- Time until rollover, as a Discord relative timestamp
- **Tomorrow's event name and emoji only** — no numbers. It is derivable either
  way, so hiding it entirely would be a fiction; the name is a hook and the
  numbers are the reveal.
- The event's banner as the embed image

### Header lines

One line at the top of `/park view`, `/shop view`, `/expedition start`, and
`/battle chapters`, naming **only the effects relevant to that screen**. A
screen with no relevant effect says so ("no market effect") rather than
repeating the whole roster.

The header helper lives in `src/modules/world/` and is imported by the four
modules. It returns a plain string; it must **not** be a module-level constant,
because it resolves `emojiTag` (see §10).

### Broadcast

A self-rescheduling `world_broadcast` scheduler timer fires at each 00:00 UTC
and fans out to every `guild_settings` row with `world_broadcast = 1` **and** a
non-null `notify_channel_id`.

- **No pings.** The client already sets `allowedMentions: { parse: [] }` globally
  (`src/index.ts:31`), but the payload also carries no mention.
- **Never a DM.** Daily unsolicited news in every player's DMs is how a bot gets
  blocked. The channel path is the only path.
- The timer re-arms itself for the next midnight as the last step of its own
  handler, so a restart mid-day recovers on the boot scan
  (`scheduler.tick` already runs on `ClientReady`, `src/index.ts:47`).
- A guild whose channel has become unpostable is skipped silently, matching
  `deliverNotification`'s existing tolerance.

Opt-in via a new `/settings world-news on|off` subcommand, **off by default**.

## 7. Seasons

A 30-day cycle derived the same way: `seasonFor(now)` returns
`'wet' | 'dry' | 'cold'` from `Math.floor(day / 30) % 3`.

Seasons **only**:

- re-tint the rendered park map's ground raster
- name and colour the season line on `/world`

They have **no balance effect at all**. That is the whole point: zero
season×event stacking to reason about, while still delivering the slow signal
that months are passing.

Implementation: three new rasters `assets/images/park/ground-{wet,dry,cold}.webp`.
`loadParkArt` (`src/core/render/art.ts`) decodes four ground rasters instead of
one, all `await img.decode()`'d at worker boot. The existing `ground.webp`
remains as the fallback when a season raster is missing, and `drawImage(null)`
guards stay in place (see §10).

## 8. The three defects

All three were verified against source during design. They ship in this spec
because they sit in the systems it touches.

### 8.1 Two banners are referenced and do not exist

`src/modules/daily/embeds.ts:60` calls `assetImage('banners', 'daily')` and
`:108` calls `assetImage('banners', 'achievements')`. Neither file is in
`assets/images/banners/`. `attach` null-degrades totally, so all 1023 tests
pass and the two screens whose entire job is bringing a player back render
bare.

Fix: ship both banners, **and** ship the guard that would have caught it.
`tests/images.test.ts:11-13` hand-types `BANNERS` as the 15 names that *do*
exist and iterates that list — it is structurally incapable of finding a missing
one. Replace with a source-scrape: regex every `assetImage('banners', '<literal>')`
under `src/` and assert each resolves to a file. Precedent for the technique is
the existing "no source file hand-assigns an embed payload files array" grep
test in the same file. It flags exactly two today and catches every future one
on the commit that introduces it.

### 8.2 The shop's "daily rotation" does not rotate

`dailyEggOffers` (`src/modules/shop/service.ts:14-25`) slices 3 offers from
`base`, but `base` holds only 2 entries below a Rare ceiling and 3 below an Epic
ceiling. Below **4.0★ best-ever rating the returned set is identical every single
day**, contradicting `docs/gameplay.md:611` and `docs/commands.md:71`, which both
promise it changes daily.

It also shuffles with `[...base].sort(() => rng() - 0.5)`, a biased comparator
shuffle. A correct Fisher-Yates `shuffle` **already exists** at
`src/modules/daily/service.ts:22-28`.

Fix, in three parts:

1. Lift `shuffle` into `src/core/rolls.ts` and use it in both places.
2. Add a **daily deal** drawn from the same day-keyed stream: one egg rarity at
   −20% and one food item at −25%, both `Math.ceil`'d so nothing is ever free.
   This is what makes the shop genuinely change day to day even at a two-rarity
   ceiling. Real prices: common 500 → 400, rare 8,000 → 6,400, legendary
   120,000 → 96,000; ferns 10 → 8, prime steak 24 → 18.
3. Make the docs truthful about what rotates and when.

**The deal must flow through `buyEgg` and `buyFood`, not only the display.** A
discount applied at render time and not at charge time means the shop quotes one
price and takes another. This is the single most likely way to ship a bug in
this spec, and it gets an explicit test that purchases at the deal price and
asserts the balance delta.

Note the interaction with §3's salt. Three day-keyed streams now exist: the egg
rotation, the daily deal, and the world event. The rotation and the deal are both
shop concerns and **may** draw from one `mulberry32(day)` stream, in a fixed
order, since correlation between them is harmless and even desirable. Neither may
share the world event's salted stream — otherwise Market Panic permanently
implies the same shop rotation, forever.

### 8.3 The tundra biome matches zero species

`ice_block` costs 700 cash and carries `biomeTags: ['tundra']`. `grep -rn
"tundra" src/data/species/` returns nothing across all 40 species. It is a dead
item in a live shop, sitting next to a whole Frozen Cliffs chapter and
expedition site.

Fix: add **two new species tagged `tundra`** — data-only, reusing shipped
`archetype × diet` cutouts exactly as Archelon did, so **zero new art**.
Roster 40 → 42.

Deliberately **not** retagging existing species: `paddockFit`
(`src/core/clock.ts:45`) reads biome tags live, so a retag would silently change
the comfort — and therefore the income and escape timing — of dinos in live
players' parks.

`COLLECTION_TARGET` stays frozen at 190. That is exactly what makes new species
alternate routes to the same target rather than a moving goalpost, and it is
recorded as a deliberate decision in `CLAUDE.md`. Do not make it a live sum.

## 9. Assets

14 WebP + 9 SVG emoji.

| What | Count | Spec |
| --- | --- | --- |
| Event banners | 9 | 1536×1024, `node scripts/fit-art.mjs banner`, one per event including Clear Skies |
| Season grounds | 3 | `assets/images/park/ground-{wet,dry,cold}.webp` |
| Defect banners | 2 | `banners/daily.webp`, `banners/achievements.webp`, 1536×1024 |
| Event emoji | 9 | `assets/emojis/svg/dw_event_<id>.svg` → `npm run build-emojis` |

Everything under `assets/images/` is WebP q95, guarded by `tests/images.test.ts`.
Prompt rows for all 14 rasters go in `docs/assets/prompts.md`. The emoji manifest
moves 43 → 52, and the counts quoted in `docs/ops.md` and `docs/assets/prompts.md`
move with it — enforced by `tests/docs-assets.test.ts`.

## 10. Traps

Conventions this repo has already paid for, which a naive implementation of this
spec would violate.

**Emoji**

- **Never call `emojiTag` in a module-level constant.** The emoji map loads after
  client ready, so module init would freeze the unicode fallback permanently.
  `WORLD_EVENTS` stores the emoji *name*; the tag resolves at render time. The
  header helper is a function for this reason.
- **Never put a custom emoji tag in an autocomplete label** — Discord renders it
  as literal text. This spec adds no autocomplete, but `/settings world-news`
  uses choices, not autocomplete, and must stay that way.
- **Never pass a possibly-empty tag to `ButtonBuilder.setEmoji`** — unlike every
  other call site, `setEmoji` throws rather than degrading. This spec adds no
  buttons; Spec 1b does.
- `tests/emoji-assets.test.ts` rejects any PNG whose opaque pixels are more than
  2% pure `#000000`. Blood Moon and Amber Storm are the at-risk designs — author
  the darks in `#1a1512`, do not raise the threshold.
- **resvg gotcha:** `<ellipse fill="url(#gradient)">` with default
  `objectBoundingBox` gradient units renders solid black. Use
  `gradientUnits="userSpaceOnUse"` with `y1 = cy − ry`, `y2 = cy + ry`.
  `circle`/`rect`/`polygon` are unaffected. Nine new SVGs is nine chances to hit
  this.

**Rendering**

- **`renderParkPng` must stay synchronous.** `@napi-rs/canvas` decodes raster
  buffers (PNG *and* WebP) asynchronously and silently yields a blank canvas with
  no error. The three season grounds are rasters and must be `await
  img.decode()`'d inside `loadParkArt` at worker boot, never inside the render.
- **`loadParkArt` must never reject.** A rejected worker module boot fires
  `client.ts`'s `error` handler, which terminates and nulls the worker; every
  later `/park view` then silently loses its image and respawns another doomed
  worker.
- **`drawImage(null)` throws**, and a throw there costs the user the whole park
  image. The season ground needs its own non-null guard falling back to
  `ground.webp` and then to the flat fill in `src/data/render-icons.ts`.
- Art never crosses `postMessage` — a canvas `Image` is not
  structured-cloneable. The season *id* crosses; the raster does not.

**Attachments**

- **Never write `payload.files = [...]`.** `tests/images.test.ts` bans the idiom
  by source-grep. Always `attach(embed, payload, slot, assetImage(...))`.
- **`attach` appends and call order is upload order.** Several tests pin
  `files.map(f => f.name)` with `toEqual`. `/world` ships one banner, so this is
  low risk here, but the rule holds.
- **`attach` cannot dedupe** — attachment names are basenames only. Event banners
  are `event-<id>.webp`; nothing else in the repo uses that prefix.
- **`withParkImage` (`src/modules/park/embeds.ts:48-51`) assigns `files`** and so
  drops anything `attach` added to the payload it wraps. `/park view`'s new
  header line is text on an existing embed, not a new attachment, so this spec
  does not trip it — but do not add art to the `park` help topic without fixing
  `withParkImage` first.

**Data and balance**

- **Simulate every balance number before shipping it.** Every multiplier in §4
  gets a simulation over a representative park, exactly as the Abyssal Trench
  and Containment Site boss tuning did. Record the numbers in the chapter-file
  style: a comment at the constant, not in a PR description.
- Quest, chest, and achievement shards **already bypass `SHARD_DAILY_CAP = 60`**,
  putting a non-selling active player at a 500-shard Mythic in roughly 28–30
  days. This spec adds no shard faucet, and must not.
- `hungerAt` takes `drainMs` as a **required** parameter on purpose. Any new call
  site passes `drainMsFor(d.traits)`, never the bare 48h constant.
- Any new income multiplier goes beside `modProduct(d.traits, 'income')` at the
  end of `accruedIncome`, **never inside `comfortAt`** — the piecewise
  integration across the hunger-100 knee is what makes overfed dinos pay
  correctly.

**Registration, migration, ops**

- **The 5-site module checklist** for the new `world` module: `modules.json`,
  `ALL_MODULES` in `src/core/module-list.ts`, `tests/registry-load.test.ts`
  (13 → 14 modules, 24 → 25 commands), `tests/config.test.ts`, and
  `tests/contract.test.ts:49` (top-level command count).
- **Any builder change needs `npm run deploy-commands`**, with exactly one bot
  instance running per token. `/world` is new and `/settings` gains a
  subcommand, so both force it.
- **Migration 0008 is a plain `ADD COLUMN`** (`guild_settings.world_broadcast`,
  integer, default 0). Not a table recreate, so the `PRAGMA foreign_keys` gotcha
  does not apply — but the migration test still seeds a parent **and** a child
  row and runs the real `migrateDb`, because an empty-DB test or a raw `db.exec`
  replay gives a false green.
- **The broadcast timer is not per-user, and `Scheduler.enqueue` requires a
  `userId`.** Use the sentinel `'0'` — Discord snowflakes are numeric strings but
  never `0`, so it can never collide with a real player. This matters because
  `adminReset` deletes from `timers` **by `userId`**
  (`src/modules/admin/service.ts:51`): a sentinel that could collide would let
  resetting one player silently kill the world broadcast for every server. A test
  asserts `adminReset` on an arbitrary player leaves the pending broadcast timer
  intact.
- `adminReset` correctly does **not** touch `guild_settings` — it resets a
  player, and the opt-in is guild state. No change needed there, but do not
  "helpfully" add one.
- **`adminFastForward` must not shift the world clock.** Like
  `daily_quests.dayKey`, the UTC calendar cannot move; fast-forward shifts a
  player's own time columns only. A fast-forwarded player still sees today's real
  event, and their income integrates against real timestamps.
- **`npm run build` does not typecheck tests.** Run `npm run typecheck`
  (`tsconfig.test.json`) before any commit touching `tests/` or `scripts/`.
  `Sender` fakes are hand-rolled per test file, and only `typecheck` catches a
  stale one.
- **Never stage a test fixture inside `assets/images/`** — vitest runs test files
  in parallel forks. Mock `assetImage` instead.
- Select menus and modals are **not** available: `routeInteraction` dispatches
  `isChatInputCommand()` and `isButton()` only, and `ComponentDef.execute` is
  typed `ButtonInteraction`. Nothing in this spec needs one.

## 11. Testing

Beyond per-effect coverage, these are the tests that must exist.

**Derivation**

- Same day key → same event, across process restarts.
- Distribution over 10,000 days matches the declared weights within tolerance,
  and Clear Skies lands at ~1/3.
- The world stream and the shop stream are uncorrelated across 10,000 days.
- An event's effects are a true no-op under Clear Skies — every modifier is
  exactly `1` / `0` / `null`.

**Income seam** (the four properties enumerated in §5)

- Regression: all multipliers at 1.0 reproduces today's output exactly, for
  every existing income fixture.
- A 30h window spanning two events pays the correct split.
- Knee and midnight coinciding produces no zero-length or double-counted
  segment.
- `incomeMultAt` is called with a segment instant, never the request time — a
  test that fails if the request time is threaded through.

**Invariants**

- `recomputeRating` is identical under all nine events for a fixed park.
- No gate — lot slots, site unlocks, chapter gates, shop ceiling, trade minimum
  — changes under any event.

**Defects**

- The banner source-scrape guard fails on a deliberately-removed banner.
- Buying at the daily deal price charges the deal price, asserted on the balance
  delta, not the rendered string.
- `shuffle` is Fisher-Yates: a uniformity test over permutations that the
  comparator shuffle would fail.
- The two new tundra species make `paddockFit` return 1.0 with an Ice Block, and
  `COLLECTION_TARGET` is still 190.

**Broadcast**

- Fires only for guilds with `world_broadcast = 1` and a non-null channel.
- Re-arms itself for the next midnight.
- An unpostable channel is skipped without throwing and without falling back to
  a DM.

## 12. Ops checklist

Operator steps after merge, in order:

1. `npm run build-emojis` then `npm run deploy-emojis` (manifest 43 → 52)
2. `npm run deploy-commands` (24 → 25 top-level commands) — exactly one bot
   instance per token
3. `npm run test:live` — posts the payload gallery to `TEST_CHANNEL_ID` for
   cosmetic review of the 9 event banners and the season grounds
4. Migration 0008 applies automatically on next boot via `migrateDb`

## 13. Out of scope

Explicitly deferred, and each is additive rather than blocked:

- Season balance modifiers — seasons are cosmetic in this spec by design
- Proactive hunger and escape alerts, notification buttons, expedition
  dispatches — all Spec 1b
- Per-server world flavour or server-scoped event goals — Part 3
- Any new currency, any new shard faucet
- Player-facing control over which events they see
