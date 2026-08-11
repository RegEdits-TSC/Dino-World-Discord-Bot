# Spec 3b — Exhibition Duels

Part 3 of the three-part roadmap ("The Server Is A Park"), second of two
sub-specs. Written 2026-08-11, the day 3a merged and deployed (`372436d`,
PR #29).

## 1. Context and scope

3a shipped the surface a duel result has to be reported on: batched-aggregate
leaderboards with two new metrics, the park showcase, park visiting. 3b adds
the engine — player-versus-player exhibition duels — and slots one more metric
into that infrastructure.

The live database still holds one player. The owner's decision to build the
social layer before players arrive rather than after stands and is not
re-litigated here.

### Decisions locked before 3a, carried into this spec unchanged

- **Duels are free and pay nothing but a record.** No energy cost, no cash, no
  shards, no XP, no campaign progress. Two colluding accounts have nothing to
  farm, so 3b needs no anti-farm rules and battle energy remains the sole
  pacing gate on PvE.
- **Both formats ship**: an async ghost duel against the opponent's squad, and
  a live challenge with an Accept button. One `resolveDuel` core with two entry
  paths, never two engines.
- The global tour ring and the store-time-only markdown defanging decisions
  from 3a are untouched by this spec.

### Decisions settled during this brainstorm

| Question | Decision |
| --- | --- |
| Where the defender's squad comes from | Auto top 3 by battle level, overridable by `/duel squad` |
| What the `/top` duel metric measures | Elo, starting 1000 |
| Whose rating moves on an async ghost duel | Both — Elo stays zero-sum |
| How a result is presented | A single result embed, no cinematic |
| Pacing guard | Per-pair cooldown, derived from the duel log |
| Whether the defender is told | Yes, either way, respecting the existing mute |
| Command surface | A new `/duel` command in a new `duels` module |
| Which squad the challenger fields | The same resolver as the defender |
| What gets stored | The duel log and the Elo column; everything else derived |

## 2. The duel core

Two new files: `src/data/battle/duel.ts` (pure) and
`src/modules/duels/service.ts` (transactional).

### 2.1 Squad resolution — one function, both sides

`duelSquad(ctx, userId)`:

1. Read `users.duelSquad` (a JSON array of dino ids) and filter to ids the user
   still owns and that are not escaped.
2. If nothing survives, fall back to auto: top 3 by `battleXp` descending, ties
   broken by `id` ascending — deterministic, no rng.
3. Cap at 3. Zero eligible dinos throws `DuelError`.

Stale ids self-heal at read time. This is the same tolerance
`users.featuredDinoId` and `breedings.parentA` already have, and the reason the
column carries no foreign key: a dino can be sold, traded or reset between the
moment a squad is set and the moment it fights, and a dangling id must resolve
to "not in my squad" rather than to an error.

**Escaped-ness is evaluated read-only for the defender.** `settleEscapes`
(`src/modules/park/escapes.ts`) WRITES. Calling it against the defender during
the challenger's command would stamp another player's rows from a command they
never ran, breaking the documented rule that escapes settle only when a command
touches your park — the same rule `alert-sweep.ts` already refuses to break.
The defender's squad therefore filters on `escapeMoment(clockDino, now)`
(`src/core/clock.ts`, via `toClockDinos`), which is pure. The challenger's own
path calls `settleEscapes` exactly as `runFight` does, because they ran the
command.

**Escrowed dinos may duel.** Identical to `runFight`
(`src/modules/battles/service.ts:63-66`) and for its stated reason: a duel
neither consumes nor transfers anything, so it cannot violate a pending trade's
escrow. Only escaped dinos are unfit.

### 2.2 The fight

Both sides are built with the existing
`statsFor(speciesId, battleLevel(battleXp), traits)`. Note that `statsFor`'s
`traits` argument **defaults to `[]`** — that default exists to keep player
traits off NPCs, and copying the NPC call shape into a duel would silently
strip every combat trait from one or both sides with no type error and no test
failure. Both sides pass their real traits.

`resolveBattle(sideA, sideB, ctx.rng)` is reused unchanged.

**A coin flip decides who is side 0.** `Combatant.side` is a field on each
combatant, not a consequence of which argument array it was passed in, and
`resolveBattle` breaks initiative ties by `spd desc, side asc, combined index
asc`. Whoever holds side 0 therefore gets a free first strike on every speed
tie — decisive in a mirror match, which is the first thing players will test.
One `ctx.rng()` draw picks the side-0 player; the outcome maps back by
`Combatant.key`.

**No world event reaches a duel.** `eventMods(now)` is sampled by hand in
`runFight` and applied at exactly three places (`energyCostFor`, `enemyHp` on
the NPC side, `battleXp` on the total). A duel inherits none of them, which is
correct: `enemyHp` is meaningless in a symmetric match — applying it would hand
Blood Moon to whichever player was arbitrarily labelled the enemy — and the
other two scale things duels do not have.

### 2.3 Outcome: three values, not two

`BattleResult` has no `draw` field, and `won: false` covers both "wiped" and
"both sides still standing when `MAX_ROUNDS` runs out". The only correct
inference is:

```
challenger win   result.won
draw             !result.won && result.squadSurvivors.length > 0
challenger loss  !result.won && result.squadSurvivors.length === 0
```

`rounds === MAX_ROUNDS` is **not** equivalent (a fight can be decided on the
last round) and no `squadKos` test is equivalent either.

`squadKos`, `squadSurvivors` and `starsFor` are **side-0 only**. Side 1's
casualties must be recounted from `finalHp` by key. `starsFor` is unusable for
a duel: it returns 0 for both a loss and a draw, and grades one side.

`finalHp` is a flat record keyed by `Combatant.key` with no namespacing by
side, so two combatants sharing a key silently collapse into one entry. Duels
key on `d<dinoId>` for both sides, which is safe because dino row ids are
globally unique and a player cannot duel themselves.

### 2.4 Elo

`src/data/battle/elo.ts`, pure, no clock, no db:

```
expected(a, b) = 1 / (1 + 10 ** ((b - a) / 400))
delta          = Math.round(K * (score - expected(mine, theirs)))
score          = 1 (win) | 0.5 (draw) | 0 (loss)
K              = 32,  starting rating 1000
```

Two invariants, both silent if broken:

- **Compute the challenger's delta once and apply its negation to the
  defender.** Rounding each side independently does not conserve points:
  `Math.round(2.5) === 3` but `Math.round(-2.5) === -2`, so a half-point case
  would mint or burn a point per duel and the pool would drift.
- **No rating floor and no `CHECK` constraint on the column.** A floor breaks
  zero-sum; a non-negative CHECK turns an extreme losing streak into a crash
  instead of a low number. Elo self-limits: 400 points behind, a loss costs 3.

### 2.5 Pacing

`DUEL_PAIR_COOLDOWN_MS = 6h`, **directional**: derived as the maximum
`created_at_ms` over `duels` rows with this ordered `(challengerId,
defenderId)` pair, counting rows of either mode. You cannot re-ghost the same
person for six hours; they can counter-attack instantly. The live path is
gated by the defender's own click and carries no cooldown.

This is two unindexed table filters per duel, filtered in SQL — the `locksFor`
shape, sub-millisecond at current scale. The absence of an index is the known
scaling limit and is deliberate: nothing in `src/` ships one.

## 3. Data model

Migration `0013`, generated with `npx drizzle-kit generate --name=<slug>` after
the `schema.ts` edit. **There is no `db:generate` script in `package.json`.**
The generator must produce all three artifacts — `0013_<slug>.sql`,
`meta/0013_snapshot.json`, and an appended `_journal.json` entry whose `when`
exceeds 0012's `1786409357482` (drizzle applies in journal `when` order, and a
smaller value silently never runs on a DB that already applied 0012). Never
hand-write the snapshot or the journal: the snapshot is the diff base for 0014.

**Read the emitted SQL by eye.** drizzle-kit sometimes emits a `__new_users`
table-recreate instead of `ALTER TABLE users ADD`, and a well-formed recreate
passes the entire test suite because `migrateDb`'s FK bracket saves it. If a
recreate appears: delete the generated `.sql`, hand-write the `ALTER` lines,
and keep the generated snapshot and journal entry. The file ends at the final
`;` with no trailing newline, matching 0011 and 0012.

### 3.1 `users` gains two columns

```ts
duelRating: integer('duel_rating').notNull().default(1000),
duelSquad: text('duel_squad', { mode: 'json' }).$type<number[]>().notNull().default([]),
```

All four calls on the json column are required. Every existing json array
column in the schema carries them and emits `text DEFAULT '[]' NOT NULL`; drop
the default and existing rows read back `NULL`, which no reader in `src/` is
written to handle. This is the first `number[]` json column in the schema —
the existing ones are `string[]` (`lots.decor`) and object shapes
(`trades.offer`).

### 3.2 `duels` — the log

One row per resolved duel, inserted once, never updated.

| column | type | note |
| --- | --- | --- |
| `id` | integer pk autoincrement | |
| `challenger_id` | text → `users.discord_id` | ordered pair; the cooldown is directional |
| `defender_id` | text → `users.discord_id` | |
| `mode` | text enum `'ghost' \| 'live'` | which entry path produced it |
| `result` | text enum `'win' \| 'loss' \| 'draw'` | always from the challenger's side |
| `elo_delta` | integer | the challenger's signed delta; the defender's is its exact negation |
| `created_at_ms` | integer | powers the cooldown, the record view and the double-accept guard |

`result` is stored from one perspective on purpose, so no reader has to
remember to flip it.

Everything else is derived: W/L/D by counting rows on either side, recent
opponents by reading the tail, the pair cooldown by `max(created_at_ms)`. There
is no status column, nothing sweeps, and no `expireStale`-shaped code appears
anywhere in 3b.

**No `TRADE_MIN_RATING`-style gate on duelling.** That gate exists because
trades move goods. Duels move points in a zero-sum pool, so an alt can only
feed its own rating to its main and lose exactly what the main gains. Stated
here so nobody adds one later for symmetry.

## 4. Command surface

One top-level command with four flat subcommands. Never a subcommand **group**:
`tests/contract.test.ts`'s `collect()` walker recurses one level only, so
options nested inside a group escape the bidirectional autocomplete check
silently.

| subcommand | behaviour |
| --- | --- |
| `/duel ghost opponent:<user>` | resolves immediately against the opponent's squad |
| `/duel challenge opponent:<user>` | posts a public challenge with Accept / Decline |
| `/duel squad [dino1] [dino2] [dino3]` | sets the duel squad; **no options clears it back to auto** |
| `/duel record [user]` | Elo, W/L/D and recent opponents |

`opponent` is a native Discord user option, not autocomplete. Only `/duel
squad`'s three dino options are flagged `.setAutocomplete(true)`, so the
manifest in `tests/contract.test.ts` gains exactly one entry:

```ts
'duel squad': ['dino1', 'dino2', 'dino3'],
```

The autocomplete provider follows the standing contract: `i.respond(...)` only,
never `getOrCreateUser`, read-only, and it guards the user row with a direct
select before touching anything.

### 4.1 Buttons

Module name `duels`, component prefix `duel` — the `battles`/`battle`
precedent. Component routing is **exact equality** on the first colon segment,
so the prefix and every customId must come from one constant or the button
dead-ends with "This interaction failed".

```
duel:accept:<challengerId>:<defenderId>:<expiresAtMs>
duel:decline:<challengerId>:<defenderId>:<expiresAtMs>
```

Worst case 68 of Discord's 100 customId characters with two 20-digit
snowflakes. Nothing about a pending challenge is stored — this is the landmark
lesson applied ahead of time: the button carries exactly what it was minted
for, because a Discord message is durable and its label is not re-derived.

Handler order: the clicker must equal `defenderId` → the expiry is checked
against `ctx.now()` → the duel resolves → `i.update` replaces the challenge
message with the result embed, so a challenge never accumulates messages. An
unknown `duel:*` action calls `deferUpdate()`, the `dex`/`ach`/`top`
discipline, so a customId shape from an older deploy never shows "This
interaction failed".

`DUEL_CHALLENGE_TTL_MS = 15 minutes`.

Squads and ratings both resolve at **click** time, not at challenge time. That
is what makes a 15-minute-old challenge honest: it fights the squad you have
when it lands.

### 4.2 Guards, in this order, on both paths

1. Self → "You can't duel yourself."
2. Bot → refused.
3. `getOrCreateUser` for the challenger; the defender **must already have a
   row** → "That player has no park yet." Unlike `/trade offer`, a duel never
   mints a park for someone who was merely mentioned.
4. The challenger's squad must resolve to at least one dino.
5. The defender's squad must resolve to at least one dino.
6. Ghost path only: the pair cooldown, answered with a `<t:…:R>` timestamp.

Every reject is ephemeral. Every `DuelError` message names the condition, never
"invalid input".

### 4.3 Reply visibility, and what `/duel squad` validates

| surface | visibility | why |
| --- | --- | --- |
| `/duel ghost` result | public | a duel is a spectacle; it is the whole point of the feature being social |
| `/duel challenge` card, and the result it becomes | public | the defender has to be able to click it |
| `/duel record` | public | it is a showcase surface, like `/top` |
| `/duel squad` confirmation | ephemeral | configuration, not content |

`/duel squad` validates at the boundary and stores validated ids: each id must
be a dino the caller owns and that is not escaped, and the same dino may not be
listed twice — "Each dino can only fight once per squad.", matching `runFight`.
Read-time filtering in `duelSquad` still happens regardless; boundary
validation exists so a typo is answered immediately rather than silently
dropping a slot at the next duel.

### 4.4 Constants

`DUEL_K = 32`, `DUEL_START_RATING = 1000`, `DUEL_PAIR_COOLDOWN_MS = 6h` and
`DUEL_CHALLENGE_TTL_MS = 15min` live in `src/data/battle/constants.ts`
alongside `MAX_ROUNDS` and `ENERGY_REGEN_MS` — the data layer holds tunables,
and `elo.ts` stays a pure function file with no policy in it.

## 5. Presentation

A single result embed. No frame loop, no skip button, no `queueEdit`
serialization, no presentation registry.

`fightFrames` is unusable here at any level: it takes a `FightOutcome` bound to
a `stageId`, calls `STAGES.get(...)` and throws on a miss, calls `rosterFor`,
and returns a fixed 4-tuple. Its F1/F4 `attachments: []` contract exists only
because four sequential edits race a Skip button.

The embed carries both squads with levels, the engine's two existing beat
fields, the result line, and the Elo line (`1000 → 1016` against
`1000 → 984`).

**Exactly one image reference**: the winner's lead dino via
`attach(embed, payload, 'thumbnail', assetImage('dinos', …))`, falling back to
the challenger's lead on a draw. Two references would collide whenever both
leads share an archetype×diet — attachment names are basenames with no kind
prefix, and `attach` appends without deduping, so one of the two slots would
render the wrong picture.

**No new art files in 3b.** A duel banner would pull in `tests/images.test.ts`'s
`BANNERS` source-scrape (which only sees a single-line `assetImage('banners',
'literal')`) and the two prose figures in `docs/assets/prompts.md` that are
regex-matched against a directory entry count.

## 6. The defender's notification, and the consent copy that moves with it

`ctx.notify(defenderId, challengerGuildId, <string>)`, called inline after the
reply — the trading precedent. There is no scheduler timer kind for this and
none is invented; the alert sweep is not reused either, since its 15-minute
cadence and DM-only `originGuildId: null` are wrong for a discrete event.

**A plain string, not a rich payload.** `Ctx.notify`'s third parameter is typed
`message: string` (`src/core/context.ts:14`) even though the transport beneath
it already accepts a full `NotifyPayload`. Widening it is a three-site typed
change — the `Ctx` interface plus **two independent spellings** in
`tests/harness.ts` (the fake's parameter type and `makeCtx`'s return-type
annotation) — and only `npm run typecheck` catches a stale one. Not worth it
for one line of text.

Passing the **challenger's** `i.guildId` means channel-first with the `<@id>`
ping via `withMention`, DM fallback. The defender's own guild is never
consulted and `deliverNotification` does not check their visibility of that
channel — the same accepted limitation the trade notification documents.

**Gating on `alertsEnabled` requires changing what the bot promises.** Today
that column is scoped to escape and income-cap alerts in its schema comment
(`src/core/db/schema.ts:19-22`), and `/park alerts state:off` replies with the
literal sentence "Egg, breeding, and expedition notifications are unaffected"
(`src/modules/park/index.ts:129`). Duel notifications are gated on it, so the
same PR updates: that schema comment, that reply sentence, and the alerts prose
in `docs/gameplay.md`. Silently widening a mute the player was told was
narrower is not acceptable.

No per-user mute helper exists to call — the only read site is a board-wide
`.where(eq(users.alertsEnabled, true))` in the sweep. The per-defender check is
a new read shape, but a free one: that row is already in hand for the Elo
write.

The notification payload is a string, so the "never carry an `attachments` key
into `deliverNotification`" rule is satisfied trivially. It still matters that
nobody later "improves" this into an embed with files without reading that rule
first.

## 7. `/top duels`

`Metric` gains a sixth value — seven type-level consumer sites, all inside the
leaderboards module.

Elo lives on `users`, so the metric belongs in `scored()`'s **cash/rating
ternary**, not the `byUser` chain. Wiring it into neither typechecks clean and
throws `TypeError: Cannot read properties of null (reading 'get')` at runtime,
because `byUser!` is a non-null assertion. Query cost is therefore unchanged
from cash/rating: **1 global, 2 server**.

`metricLabel` is an object literal indexed by `Metric`, so a missing key is a
build error. `formatValue` is a ternary with a default branch, so `duels` falls
through to `value.toLocaleString()` — **deliberate and correct**: Elo is a
plain integer, *not* stored ×100 the way `parkRating` is. Recorded here so
nobody "fixes" it into a divide.

Test edits land in five places inside `tests/leaderboards.test.ts`'s cost
describe block — both helper parameter unions (hand-written literals at :217
and :241, not `Metric`) and all three `it.each` tables, including the
zero-member one that pins 1 for every metric. Separately, :327's title ("offers
exactly the five metrics the service knows") and :333's ordered
`toEqual(['rating', 'cash', 'collection', 'legacy', 'stars'])` both change,
with `'duels'` appended **last**.

Adding a choice changes the deployed builder body, so `deploy-commands` is
mandatory. It does **not** change the 26→27 command count for any reason of its
own, and `/top`'s metric option stays static `addChoices` — six choices is far
under Discord's 25-choice cap, and `tests/harness.test.ts` actively asserts
that option is not autocomplete-flagged.

Known and accepted: `scored()` sorts by value with no tiebreak, and Elo
clusters at exactly 1000 on day one, so `/top duels` shows a large
arbitrary-order block until people duel. `docs/gameplay.md` already documents
that there is no tiebreak rule. Adding one for a single metric would change
shared sort code.

## 8. Admin obligations

**`adminReset` — both halves, or the reset is a lie.**

- Delete `duels` rows with `or(eq(challengerId, targetId), eq(defenderId,
  targetId))`. The log is two-sided; the trades precedent uses exactly this
  shape. A one-sided delete leaves the opponent's row naming a wiped account
  and a live cooldown against a park that no longer exists.
- Add `duelRating: 1000` and `duelSquad: []` to the single `users` update
  object (`src/modules/admin/service.ts:87-93`). SQLite reuses row ids after a
  delete — the exact argument the `featuredDinoId` comment already makes — so a
  surviving squad array can silently point at dinos the account hatches next.

`alertsEnabled` stays untouched, as it is today: communication consent, not
progress. 3b adds no second consent column.

**`adminFastForward` shifts `duels.created_at_ms`.** This is a judgment call
against the file's own precedent that historical records
(`species_seen.first_at_ms`) are never shifted, and it is made deliberately:
this log is also the **only anchor of the pair cooldown**, so leaving it
unshifted makes the one time-gated rule in 3b untestable by the admin tool.
`lastQuestClaimAt` is the precedent for shifting a gate anchor. Two consequences
are accepted and belong in the code comment: `/duel record` timestamps move
when an admin fast-forwards (a tool that already moves `lastFedAt` and every
timer), and because a duel row is two-sided, shifting "this player's" rows also
moves the opponent's cooldown against them — correct, since the cooldown is a
property of the pair.

Both obligations get **paired** tests in `tests/admin.test.ts`. The audit found
that `landmarkTier` and the showcase columns shipped with reset-only tests, so
the "paired test for every new column" precedent is weaker than it reads; 3b
restores it because it has a genuine time column.

## 9. Module registration — six sites

1. `modules.json` — a **single-line** JSON object; the `"duels": true` key goes
   inline. Nothing about this file is "adding a line".
2. `src/core/module-list.ts` — the import, and the manifest appended to
   `ALL_MODULES`.
3. `tests/registry-load.test.ts` — **two** literals on adjacent lines: module
   count `15 → 16` (:9) and command count `26 → 27` (:10).
4. `tests/config.test.ts:22` — the exact `toEqual` literal gains `duels: true`.
   `toEqual` is exact in both directions.
5. `tests/contract.test.ts:51` — `toHaveLength(26)` becomes `27`. (CLAUDE.md
   says "contract.test.ts:49"; that is the `it(...)` header. The assertion is
   on :51.)
6. `tests/contract.test.ts`'s `AUTOCOMPLETE_OPTIONS` — the one `'duel squad'`
   entry.

`src/index.ts` and `src/deploy-commands.ts` need **no** edit; both already
import `ALL_MODULES` from the single list, and adding an import to either
reintroduces the drift that list exists to prevent.

**Declined, deliberately:** `duel` is not added to `daily/hooks.ts`'s
`EXEMPT_PREFIXES`. `/battle` is not exempt either, and a quest-complete hint
after a duel is the standard behaviour, not a bug.

**The hole in this checklist, stated so the plan can guard it:** forgetting
`modules.json` alone leaves the module silently disabled in production, because
every registry-building test constructs its flags from `ALL_MODULES` rather
than from the file. `tests/config.test.ts` is the single test standing between
that and a dead command — and only because site 4 is done. A green suite is not
by itself evidence the module is enabled on the live bot.

## 10. Help, docs and the live gallery

**`HELP_TOPICS.duel`**, with **no `art` descriptor**: art-bearing topics must
appear in a hard-coded 9-name sorted list in `tests/help.test.ts`, deliberately
not derived from the map. Adding a topic **key** changes `/help`'s builder
choices, the same redeploy the new command already forces.

**`docs/gameplay.md`** gets its duel section **appended at the end**. Sections
are numbered 1-18 in their headings and `docs/ops.md` cites "§4" and "§11" by
number, so a mid-file insert renumbers silently and nothing tests it. The
alerts section is edited in place for the mute-scope change (§6).

**`docs/commands.md`** gains a `/duel` row and updates `/top`'s metric list.

**Four stale figures are corrected in the same PR** rather than propagated.
None is machine-gated, all were found during this design's audit:

| file | today | correct after 3b |
| --- | --- | --- |
| `docs/ops.md:223` | "Fourteen modules ship today" (and its bullet list omits `dex`) | sixteen, with `dex` and `duels` listed |
| `docs/ops.md:352` | "Should report `25` commands deployed" | 27 |
| `docs/ops.md:232` | `leaderboards` module "rankings by rating, cash, and collection" | the six metrics |
| `README.md:33` | leaderboards "ranked by rating, cash, or collection" | the six metrics |
| `README.md:121`, `docs/commands.md:115` | `/help` has "ten topics" | twelve (11 keys today plus `duel`) |

**`scripts/test-live.ts`: 52 → 54 cases.** A ghost result and a challenge card,
inserted **before** the `alert sweep` case (currently second-to-last, followed
by `alert:mute`). That ordering is load-bearing: `sweepCapture` rewrites
`lastFedAt` on every P1 dino and `lastCollectAt` on the shared ctx, so anything
placed after it reads corrupted timings. A case whose `run()` returns zero
replies counts as a failure, not a skip.

## 11. Errors and the one race

One `DuelError` class — the `BattleError` shape — for every user-facing reject,
answered ephemerally. Anything else propagates to the router's ephemeral
"Something went wrong — nothing was charged." That sentence stays true for
duels only because they charge nothing and because both writes (two ratings,
one log row) sit in one transaction that closes before the reply.
Commit-before-present, as `runFight` established.

**The race: a double-clicked Accept.** `i.update` removes the buttons, but
Discord can deliver two clicks before that lands, and each would resolve a full
duel and move Elo twice. The guard is derived, not stored: a live duel is
refused if a `duels` row already exists for this ordered pair with
`mode = 'live'` and `created_at_ms > expiresAtMs - DUEL_CHALLENGE_TTL_MS` —
that is, this very challenge already resolved. The customId's expiry stamp
doubles as an idempotency key, so there is still no table and still nothing to
sweep.

## 12. Testing

Two new files:

- **`tests/elo.test.ts`** — expectation symmetry, zero-sum conservation
  **including the half-point rounding case**, draw scoring at 0.5, absence of a
  floor, and the far-gap asymptote.
- **`tests/duels.test.ts`** — the squad resolver (explicit set, stale ids
  dropped, empty falls back to auto top-3, ties by id ascending, escaped
  excluded, none at all throws), win/loss/**draw** mapping, the side-0 coin
  flip, both ratings and the log row written in one transaction, the pair
  cooldown, the double-accept guard, every guard message, and the button flows
  (wrong clicker, expired, decline, unknown action).

Six existing files change: `migration.test.ts` (a new 0013 production-path
block), `admin.test.ts` (paired reset and fast-forward), `leaderboards.test.ts`
(costs and choices), `contract.test.ts`, `registry-load.test.ts`,
`config.test.ts`.

**The 0013 migration test.** There is no count literal in that file to bump.
The new block's filename regex **and** journal filter widen together: the regex
must cover 0012 (0012's own block uses `/^00(0[0-9]|1[01]).*\.sql$/` to include
0011) and the filter becomes `e.idx <= 12`. Copying 0012's regex while bumping
only the idx yields a test that passes against a 0011 baseline — green for the
wrong reason, which 0012's in-file comment already warns about. The block seeds
a parent `users` row and a child `dinos` row, calls the real `migrateDb`, and
closes by asserting the dino survived, `PRAGMA foreign_keys` reads 1, and both
new columns store and read back.

**No hand-computed fight outcomes.** The engine draws exactly two rng values
per attack in the fixed order variance→crit, and damage floors at 1 *before* a
crit multiplier. Duel tests drive a scripted rng and assert relationships; any
exact HP or Elo figure is pinned from an executed run, never from arithmetic in
the plan. This is the repo's standing "hand-computed values are hypotheses"
rule, and the fight engine is where it has bitten hardest.

## 13. Operator steps

1. `npm run typecheck` and `npm test` green. Typecheck is the only gate that
   sees `tests/` and `scripts/`.
2. Back up the live DB — **all three** files: `.db`, `-wal`, `-shm`.
3. `npm run build`, then restart the single bot instance. Migration 0013
   applies on boot. The bot runs compiled `dist/`, so build before restart.
4. `npm run deploy-commands` — 27 commands.
5. `npm run test:live` **after** the restart. It issues the same
   `rest.put(applicationGuildCommands(...))` that `deploy-commands` does, so
   running it first opens a window where the guild advertises new builders
   against the old process (3a accepted that window knowingly; 3b avoids it).
6. No `deploy-emojis` — 3b ships no new emoji — and no new art files.

## 14. Out of scope

- **Duel rewards of any kind** — the locked decision. Duels pay a record.
- **Tournaments, brackets, or a season structure.**
- **Elo decay or seasonal resets** — meaningful only with a population.
- **Spectate or replay** — `runFight` uses ambient `ctx.rng` rather than a
  seeded stream, so no fight in this codebase is reproducible today. Making
  duels replayable is a change of practice, not a continuation of one.
- **A `/top` tiebreak** — see §7.
- **New banner or emoji art** — see §5.
- **Widening `Ctx.notify` to `NotifyPayload`** — see §6.
