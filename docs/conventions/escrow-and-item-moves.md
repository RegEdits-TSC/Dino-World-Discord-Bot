# Escrow and item moves

Fires on: `src/core/locks.ts` and `src/core/species-seen.ts`, the five modules that move an
item (`trading`, `shop`, `hatchery`, `genelab`, `expeditions`), the data tables behind them
(`src/data/trade.ts`, `shop.ts`, `sell.ts`, `traits.ts`, `breeding.ts`), and the suites that
cover all of it.

## Headlines

- Escrow is DERIVED, never stored: `locksFor` builds it from live rows, so a stale lock is not representable and no caller ever has to sweep before reading one. This is the repo's home for derived-never-stored. §escrow-derived-never-stored
- Build ONE `Locks` map per user and test membership — a per-id `isLocked(dinoId)` becomes an N+1 inside `/dino list` and every autocomplete provider. §locks-batch-per-user
- Expiry is evaluated at READ time: a trade escrows iff `createdAt + TRADE_EXPIRY_MS > now`, and nothing sweeps. §locks-expiry-at-read-time
- `locksFor` resolves `breedings` AFTER `trades` so a doubly-locked id reads back `'breeding'` — the fail-safe overwrite direction, since a breeding lock can never be waived by a trade's `forTradeId` exemption. Never swap those two loops. §locksfor-loop-order-breedings-last
- Reject an escrowed row only at paths that CONSUME or transfer an item; battling an escrowed dino stays legal, and adding a guard there is the "fix" to resist. §escrow-enforced-only-at-consuming-paths
- `verifySide`'s `forTradeId` must stay a trade id, never a blanket boolean: waiving both reasons would let a breeding's parents be traded away mid-flight, which `schema.ts`'s `breedings` note relies on being impossible. §fortradeid-never-a-boolean
- `expireStale` is no longer load-bearing for escrow at all — the surviving calls live only in `src/modules/trading/index.ts` and only flip `status` for display and history. Never reintroduce it as a pre-read sweep. §expirestale-display-only
- The one autocomplete provider that still calls `expireStale` is `/trade accept|decline|cancel`, and only because that list's `status` filter is what hides a dead trade. §autocomplete-expirestale-trade-only
- `hatchEgg`'s escrowed-and-incubating guard is unreachable through the public API and covers legacy data only — it is not dead code, and its test has to build the state by inserting the pending trade row directly. §hatchegg-escrow-incubating-guard-unreachable
- The `/trade offer` autocomplete builds locks for the resolved `ownerId`, never `i.user.id`, because the `want-*` options list the TARGET's inventory. §trade-offer-autocomplete-uses-ownerid
- Breeding and splicing escrow a dino through the same `locksFor` path trading does — no second mechanism, and no second resolution order. §genelab-escrow-lock-order
- `hatchEgg` must insert the dino with `viaTrade: egg.viaTrade`; dropping the flag at the hatch boundary silently reopens the alt-to-main shard funnel. §viatrade-survives-the-hatch
- `startBreeding` is the sole writer of the `breedings` row's `viaTrade` and `claimBreeding` reads it back verbatim — never re-derive it from a fresh read of the live parents, which are nullable by claim time. §viatrade-frozen-on-breeding-row
- Any future path that MINTS an item from an existing one has to carry provenance across that boundary too. §mint-carries-provenance
- Credit `species_seen` from exactly three write sites, each INSIDE the transaction that mints or transfers the dino, and never credit an egg — not even a species-pinned Mythic bought with shards. §record-species-seen-write-sites
- A dino holds 0–2 traits and NEVER two from one `TraitDomain`: `pickTrait` and `spliceTrait` both exclude every occupied domain before drawing, so no caller checks and cancelling pairs are structurally impossible. §trait-domains-never-doubled
- `revealPayload` ships two files on one `i.update` payload — the rarity crack as `image`, the archetype as `thumbnail` — each degrading independently. §revealpayload-two-files-degrade-independently
- Quote and charge every price a world event can scale through its one helper, never a raw table value re-multiplied inline at a call site. §one-helper-per-scalable-price

## escrow-derived-never-stored

Escrow is DERIVED, never stored: `locksFor(ctx, userId)` (`src/core/locks.ts`) returns
`{ dinos, eggs }` maps of id → `LockReason`, built from the pending, unexpired trades the
user SENT (only the offer side is ever escrowed, and the offer belongs to `fromUser`) plus
their unclaimed `breedings` rows. The `dinos.locked`/`eggs.locked` columns were dropped in
migration 0005 — a stale lock is no longer representable, so **no caller ever has to sweep
before reading one**.

**This is the repo's home for DERIVED, NEVER STORED, and escrow is the worked example.**
The principle: when a value can be recomputed from rows that already exist, do not store a
copy of it and do not write a sweep to repair the copy. A stored copy has to be maintained
by every writer that could invalidate it, and the first writer to forget leaves it wrong
with nothing failing — a stale lock holds an item hostage forever, and no read can tell it
apart from a real one. Deriving the value at read time makes the wrong state
UNREPRESENTABLE rather than merely unlikely: **nothing sweeps, nothing drifts.** The cost
is paid in reads, which is why the two properties below — batch per user, and evaluate
expiry at read time — are what keep the design honest, and both must survive future work.

Six features are built this way, and each keeps its own formula rather than restating the
philosophy:

- escrow locks, here;
- quest progress, `clamp(current - baseline, 0, target)` against a frozen `daily_quests`
  baseline — `§quest-progress-derived` in `docs/conventions/daily-quests-and-stats.md`;
- the day's world event, a pure function of a UTC timestamp —
  `§world-event-derived-not-stored` in `docs/conventions/world-events.md`;
- legacy rank, summed from three already-complete sources —
  `§legacy-rank-not-user-stats` in `docs/conventions/park-progression.md`;
- park attendance, recomputed from the live park —
  `§attendance-derived-read-time` in `docs/conventions/park-progression.md`;
- "has this ledger row been reversed?", the existence of a row whose `reverses_id` points
  at the target — `§reversed-flag-is-derived` in `docs/conventions/economy-core.md`.

Legacy rank and attendance each store a monotone HIGH-WATER beside the derived value.
That is not a cached copy and does not break the rule: the derived number is still
recomputed on every read, and the stored one exists only so a value that is allowed to
fall cannot drag a permanent achievement down with it.

One thing in this repo is deliberately NOT derived, and the exception is the shape of the
rule: `alerts_sent` records a SIDE EFFECT — a DM already sent for one specific instant —
rather than a value, and the conditions behind it are not monotone, so "has this already
been warned about" has no answer without a row that says so. That case is
`§alerts-sent-is-a-side-effect-record` in `docs/conventions/timers-and-alerts.md`.

## locks-batch-per-user

**Batch per user, not per row.** Callers build one `Locks` and test membership against it;
never add a per-id `isLocked(dinoId)`, because it becomes an N+1 inside `/dino list` and
inside every autocomplete provider. Pure formatters therefore take the lock as an
ARGUMENT — `eggLabel(egg, now, locked)` in `src/core/autocomplete.ts`,
`eggListPayload(..., locks)` in `src/modules/hatchery/embeds.ts` — and their callers build
the map once. `/top`'s `scored()` widened the same rule to batch-per-BOARD: one query per
source table, grouped in JS, never one per candidate. See
`§top-scored-fixed-query-count` in `docs/conventions/leaderboards.md`.

## locks-expiry-at-read-time

**Expiry is evaluated at read time** — a trade escrows iff
`createdAt + TRADE_EXPIRY_MS > now`. Nothing sweeps. This is the second of the two
properties that keep the derived design honest: a lock that expired a moment ago is
already gone the next time anything reads it, with no job, no timer and no call site
responsible for noticing.

## locksfor-loop-order-breedings-last

The escrow check reads back ONE reason per id, so `locksFor` resolves `breedings` AFTER
`trades` on purpose — the fail-safe overwrite direction. **Never swap those two loops.**

Escrow carries two reasons now and only one survives per id. Resolving breedings last
means a doubly-locked dino reads back as `'breeding'`, which is the safe answer, because a
breeding lock can never be waived by a trade's `forTradeId` exemption while a trade lock
can. Reverse the loops and the same dino reads back as `'trade'`, and the accept path's
waiver — which is scoped to exactly the trade being accepted, and correctly so — would
release a dino a breeding is still holding.

## escrow-enforced-only-at-consuming-paths

Enforcement lands only at paths that CONSUME an item, never at paths that merely use one:
`sellDino`, `incubateEgg` and `hatchEgg` reject escrowed rows, while battling an escrowed
dino stays legal (`src/modules/battles/service.ts`) because it neither consumes nor
transfers.

## fortradeid-never-a-boolean

`verifySide`'s `forTradeId` is not an exploit: at accept time the offer side is escrowed BY
THAT VERY TRADE, so `acceptTrade` waives that one lock and nothing else — a second pending
trade or an unclaimed breeding still blocks the transfer. It must stay a trade id, never a
blanket boolean: escrow carries two reasons now, and waiving both would let a breeding's
parents be traded away mid-flight, which `src/core/db/schema.ts`'s `breedings` note relies
on being impossible.

## expirestale-display-only

`expireStale` is no longer load-bearing for escrow at all. Migration 0005 dropped the lock
columns, so nothing has to be swept before a lock is read, and the calls that survive live
only in `src/modules/trading/index.ts` and exist only to flip `status` for `/trade list`
display and history. A call to it anywhere else is the regression to look for.

## autocomplete-expirestale-trade-only

The one AUTOCOMPLETE provider that still calls `expireStale` is
`/trade accept|decline|cancel`, and only because that list's `status` filter is what hides
a dead trade. It is not there for escrow. Every other provider in the repo is read-only
and needs no sweep at all, because `locksFor` is a pure read.

## hatchegg-escrow-incubating-guard-unreachable

`createTrade`'s `verifySide` refuses an incubating egg, so an escrowed *and* incubating row
can only be legacy data — `hatchEgg`'s guard is unreachable through the public API and its
test builds the state by inserting the pending trade row directly.

## trade-offer-autocomplete-uses-ownerid

One subtlety survives the rewrite: the `/trade offer` autocomplete builds locks for the
resolved `ownerId`, NOT `i.user.id`, because the `want-*` options list the TARGET's
inventory. A test pins this by escrowing the target's dino in a trade with a third user, so
reading the wrong id fails it.

## genelab-escrow-lock-order

Breeding and splicing both hold a dino in escrow the same way trading does: through
`locksFor`, with no second mechanism and no second resolution order. The order itself, and
why a doubly-locked dino must resolve as `'breeding'`, is §locksfor-loop-order-breedings-last
above.

## viatrade-survives-the-hatch

Provenance survives the hatch: `hatchEgg` inserts the dino with `viaTrade: egg.viaTrade`.
`eggs.viaTrade` had no reader before this, and the three readers of `dinos.viaTrade` are
all in the shop module, so dropping it at the hatch boundary silently reopened the
alt-to-main shard funnel.

## viatrade-frozen-on-breeding-row

Breeding is the third provenance boundary: `startBreeding` snapshots
`parentA.viaTrade || parentB.viaTrade` onto the `breedings` row (both parents are
guaranteed present there, and the flag is only ever set, never cleared), and
`claimBreeding` reads that frozen column back verbatim — `startBreeding` is the column's
sole writer. It is deliberately NOT re-derived from a fresh read of the live parents at
claim time: they are nullable by then (a parent can be sold or traded away between start
and claim) and a second source would only give the two a way to disagree.

## mint-carries-provenance

Any future path that MINTS an item from an existing one has to carry provenance too. The
hatch and the breeding claim above are the two worked instances.

## record-species-seen-write-sites

`recordSpeciesSeen` (`src/core/species-seen.ts`) has exactly three write sites, each inside
the transaction that mints or transfers the dino so a rollback can't leave a credit behind:
`hatchEgg` (`src/modules/hatchery/service.ts`), a trade's receiving side
(`src/modules/trading/service.ts`), and `/admin give`
(`src/modules/admin/service.ts`). Eggs are deliberately NOT credited at any point,
including a species-pinned Mythic egg bought with shards — the dex only credits a species
once a DINO of it actually exists, never a promise of one.

A fourth writer exists, runs exactly once and is an operator step rather than a code path:
see `§species-seen-backfill-is-an-operator-step` in
`docs/conventions/schema-and-migrations.md`.

## trait-domains-never-doubled

A dino holds 0–2 traits (`src/data/traits.ts`) and **never two from one domain** —
`TraitDomain` is `income | care | combat | meta`, and both `pickTrait` (fresh rolls) and
`spliceTrait` (re-rolls) exclude every domain already occupied by the dino's surviving
traits before drawing, so the rule holds without any caller checking it. That is also what
makes cancelling pairs like `prolific` + `runt` structurally impossible — they share the
`income` domain, so a dino can never hold both.

The enrichment gate derives its worst-case drain multiplier from this same fact, taking
the product of the two largest per-domain `drain` maxima
(`§dead-window-gate-derives-from-traits-table` in
`docs/conventions/clock-comfort-and-feeding.md`), so relaxing the rule moves a balance
guard nobody would think to look at.

## revealpayload-two-files-degrade-independently

`revealPayload` is the hatch-reveal surface, and the second place archetype art is dressed
onto an embed: it ships the rarity crack as `image` and the archetype as `thumbnail`, two
files on one `i.update` payload, each degrading independently. The two names cannot
collide, which is why the cracks are `hatch/<rarity>-crack.webp` rather than
`hatch/<rarity>.webp` — `§attachment-name-dedupe` in
`docs/conventions/embed-payload-builders.md` has the general rule. The archetype half
resolves through `dinoImage`, never a bare `assetImage('dinos', …)`:
`§dino-art-archetype-diet-with-species-override` in `docs/conventions/art-resolver.md`.

## one-helper-per-scalable-price

Every price or cost a world event can scale is quoted and charged through exactly one
helper — `eggPriceAt` / `foodPriceAt` / `roundCharge` (`src/modules/shop/service.ts`),
`sellCashAt` / `roundPayout` (`src/modules/shop/shards.ts`), `feedCostFor`
(`src/modules/care/service.ts`), `energyCostFor` (`src/modules/battles/service.ts`) —
never a raw table value re-multiplied inline at each call site. When this pattern was
introduced, each of those surfaces already had three to five separate read sites — a
display quote, an autocomplete label, and the actual charge or payout — that would
otherwise have had to agree by hand. Route any future price or cost surface through the
matching helper rather than re-deriving it.

This is the pricing half of the repo's one-helper rule; the ledger half, and the reason it
is stated as a rule at all — the two surfaces DID disagree once — is
`§one-helper-two-surfaces` in `docs/conventions/economy-core.md`. The same argument is why
`feedCostFor` and `energyCostFor` take `now` as a REQUIRED parameter rather than defaulting
it: a helper with a default lets a call site keep the unmodified cost while looking like it
went through the helper.
