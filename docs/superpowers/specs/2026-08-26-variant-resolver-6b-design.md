# Spec 6b — The Variant Resolver

**Date:** 2026-08-26
**Status:** design approved, ready for planning
**Follows:** [6a — The Art Bank](2026-08-24-art-bank-6a-design.md), merged as `daff817`

## Why this exists

6a banked 80 variant files — `<base>-v2.webp` through `-v4.webp` across four
families — and deliberately left them unreferenced. The art had a deadline; the
code did not. Nothing in `src/` reads a variant today.

This spec wires them up, so a surface a player sees constantly stops always
showing the same picture.

| Family | Variants | Bases |
|---|---|---|
| eggs | 18 | 6 rarities |
| hatch | 18 | 6 rarities |
| banners | 30 | the 10 most-seen |
| sites | 14 | 7 expedition sites |

## Scope

Changes `src/core/images.ts`, `src/core/rolls.ts`, and the call sites that gain a
seed. No new assets. No migration. No change to what any file on disk contains.

### Non-goals

- No new variants generated. The bank is closed; generator access has ended.
- No variant for `dinos` or `battles` — those families have no variant files, and
  `dinoImage`'s existence-based fallback is a different mechanism that stays as
  it is.
- No admin surface for forcing a variant. If one is ever wanted, the seed
  parameter is already the hook.

## §1 The resolver

### Signature

```ts
assetImage(kind, name, seed?: string): ImageRef | null
```

**Omitting the seed returns the base file.** That is what keeps roughly 180
pinned-filename assertions across 27 test files green, and every call site that
never gains a seed working exactly as it does now. The default is not a
convenience — it is the compatibility contract.

### The pick

```
index = floor(mulberry32(hashSeed(`${kind}:${name}:${seed}`))() * (variantCount + 1))
index === 0  ->  <name>.webp
index === n  ->  <name>-v{n+1}.webp
```

Three properties, each taken from what this repo already does rather than
invented for the occasion.

**The hashed string is composite — `kind:name:seed`.** Every seed in this
codebase is composite (`rollDailyQuests` hashes `${userId}:${dayKey}`), and here
it is load-bearing rather than stylistic. `eggs` and `hatch` both ship 18
variants over 6 bases, so a bare egg id would select the *same index* in both:
egg #42 would show `common-v2` and then `common-crack-v2`, halving the effective
variety for no perceptible gain, since the pairs were never drawn to match.
Including `kind` and `name` decorrelates them. This is the same reasoning behind
`WORLD_SALT` (`src/core/world.ts`) and `DEAL_SALT` (`src/modules/shop/service.ts`),
both of which exist to stop two features keying off one input from moving
together.

**The hash goes through `mulberry32`, never `hashSeed(...) % n`.** No code in
`src/` takes FNV-1a output modulo anything. Every selection in the repo —
`pickBoard`, `rollSpeciesInRarity`, `dailyDeal` — runs `mulberry32(seed)` and
then `Math.floor(rng() * n)`, because FNV-1a's low-order bits carry less
avalanche than a PRNG's. Following that convention costs one extra call and
avoids a bias that would be invisible until someone measured the distribution.

**`variantCount` comes from a cached disk scan.** `assetImage` already caches
`existsSync` per absolute path (`present()`); variant counts are cached the same
way, per `kind:name`, since assets do not change at runtime. A base with no
variants yields count 0, the index is always 0, and the base file is returned —
so the seeded and unseeded paths agree wherever no variant exists.

### `hashSeed` moves to `src/core/rolls.ts`

`hashSeed` is currently module-private in `src/modules/daily/service.ts`
(no `export` keyword), so `src/core/images.ts` cannot use it where it stands.

It moves to `src/core/rolls.ts`, which already exports `mulberry32` plus every
other seeded-draw helper in the repo, and `daily/service.ts` imports it from
there.

Worth being accurate about the reason, because the obvious justification is
false: `src/core/module-list.ts` **does** import runtime values from
`src/modules/`, so "core never imports modules at runtime" is not a rule this
repo has. But that file is the module registry — its whole purpose is
aggregating every module into one list, and it is the only such importer. A
general-purpose helper like `images.ts` reaching into a *feature* module for a
hash function would be a different and worse coupling: it would make the asset
layer depend on the daily-quest module for no reason other than where the
function happens to live. `rolls.ts` is where seeded-draw primitives already
live, so this is a move to the right home rather than a workaround.

**The move must be provably behaviour-preserving.** `rollDailyQuests` derives a
player's daily board from it, and a changed hash would silently reroll every
board in flight. The function is copied verbatim — FNV-1a 32-bit, offset basis
`2166136261`, prime `16777619`, `charCodeAt` per UTF-16 code unit, `>>> 0` — and
the plan must include a test pinning known input/output pairs before the move and
after.

## §2 Seeds per family

| Family | Seed | Threading required |
|---|---|---|
| eggs | egg row id | 6 sites already in scope; 1 one-hop; 1 has no egg |
| hatch | egg row id | 1 one-hop |
| banners | viewer's Discord user id | most already in scope; `fightFrames` needs it |
| sites | viewer's Discord user id | 2 paths free; same `fightFrames` thread |

### Eggs — the egg's own row id

Six of eight call sites already have it in local scope: `notify.ts:78`
(`egg.id`), `hatchery/index.ts:38`, `hatchery/embeds.ts:27` (`preHatchPayload`
already takes `eggId` for the crack button's customId), `hatchery/embeds.ts:83`
(`featured.id`), and `shop/index.ts:94` (`egg.id`, already printed in the embed).

One needs a one-hop thread: `claimPayload` (`genelab/embeds.ts:64`) takes an
`opts` object with no id, while its only caller has `egg.id` one frame up. Add
`eggId` to the opts type.

**`/shop view` (`shop/index.ts:82`) gets no seed and stays on the base file.**
That is correct rather than a gap: the branch previews which rarities *can* be
bought, so no egg exists yet to have an identity. A seeded value there would have
to come from the viewer, which would mean a shop preview and the egg actually
bought showing different pictures of the same rarity.

### Hatch — the same egg id, one hop

`revealPayload(species)` (`hatchery/embeds.ts:49`) has no id. Its only caller —
the `hatch:crack` handler — already parses the egg id out of the customId
(`hatch:crack:<eggId>`) before calling `hatchEgg`. Widen to
`revealPayload(species, eggId)` and pass it.

Note the id is available at the caller even though `hatchEgg` does not return it,
so no service signature changes.

### Banners and sites — the viewer's user id

A banner is a per-command surface with no object to key on, so it keys on who is
looking. Each player gets a stable face per surface: your `/daily` always looks
the same, another player's may not.

The cost is that a player never sees the other three faces of a banner they use
daily. That is accepted deliberately. The alternative — varying per invocation —
buys visible rotation at the price of no single rule, since not every banner has
an object to key on, and each call site's seed would have to be read and
remembered individually.

`userId` is already a parameter at most of these builders (`carePayload`,
`dinoListPayload`, `hubPayload`, `eggListPayload`, `alertPayload`) or directly in
scope in an inline `execute(ctx, i)` body (`/shop`, `/sell`).

**`fightFrames` is the one real signature change.** `FightOutcome`
(`battles/service.ts`) carries no user id at all; `presentFight` has it one frame
up, already using it for the skip and replay button customIds. Threading it
covers both the `battle_victory`/`battle_defeat` banner and the chapter's site
banner — one change, two families.

Two builders take a pure display object with no id and no caller-side thread
worth adding — `collectPayload(amount)` and daily's `claimPayload(result)`. Both
may take a `userId` parameter, since both callers have `i.user.id` in scope; the
plan should treat that as a one-line thread, not a refactor.

## §3 What must not break

6a shipped guards written on the assumption that variants are unreferenced.
Wiring them up must not invalidate any.

**The banner count stays 33.** `tests/docs-assets.test.ts` counts base banners
only, excluding `-vN`, and asserts every `<N> banners` figure in `prompts.md`
matches. A variant is another face of a banner, not a new banner. Resolving them
at runtime does not change that.

**The orphan guard's `-vN` stripping stays correct.** `tests/images.test.ts`
asserts every committed non-`event-` banner is referenced from `src/`, stripping
`-vN` first. Variants are still never named literally in `src/` — the resolver
composes the filename at runtime — so the stripping remains exactly right.

**The naming guards are untouched.** `tests/asset-variants.test.ts` enforces that
every variant has a committed base and that numbering starts at 2 with no gaps.
The resolver depends on both: numbering with a gap would make an index
unreachable, and an orphan would make a resolved name miss.

**No new collision risk.** `assetImage` names attachments by basename with no
kind prefix, so two refs on one payload must resolve to distinct names. Every
2+-file payload today already pairs two structurally distinct base names, and
appending the same `-vN` suffix to two distinct bases keeps them distinct.
`duels/embeds.ts` documents the live version of this hazard — its `resultPayload`
carries exactly one dino ref — and nothing here changes that.

## §4 Testing

The resolver is a pure function of `(kind, name, seed)` and a disk listing, so it
is directly unit-testable — no `ctx`, no clock, no rng injection.

- **Determinism**: the same triple returns the same file every time.
- **Distribution**: over many seeds, every variant *and the base* are selected.
  A resolver that never returns the base, or never returns `-v4`, is a real bug
  that a naive "it returns something" test would miss.
- **Decorrelation**: the same seed under `eggs` and `hatch` for the same rarity
  selects independently. This is the property the composite string exists for and
  the one most likely to be silently lost in a refactor.
- **No-variant bases**: a base with no variants returns the base file for every
  seed.
- **The compatibility contract**: omitting the seed returns the base file, always.
- **`hashSeed` after the move**: pinned input/output pairs, proving the daily
  board is unaffected.

Every seeded call site additionally needs its existing pinned filename either
updated to the resolved name or re-pointed at a seed whose pick is asserted, and
the plan must enumerate them rather than discovering them at execution.

## Deliverables

1. `src/core/rolls.ts` — `hashSeed` exported, behaviour pinned.
2. `src/core/images.ts` — `assetImage(kind, name, seed?)` plus the variant-count
   cache.
3. `src/modules/daily/service.ts` — imports `hashSeed` rather than defining it.
4. Seeds threaded at the call sites in §2, including three signature changes:
   `revealPayload`, genelab's `claimPayload`, and `fightFrames`.
5. Tests per §4, and every affected filename pin updated.
6. `CLAUDE.md` — a note on the resolver, the composite-seed rule, and why
   variant selection is the one deliberate exception to the repo's
   `randomness comes from ctx.rng()` convention.

## Risks

- **The `hashSeed` move touches a live feature.** Daily boards are derived from
  it. Mitigated by pinning known pairs before and after, and by copying the
  function verbatim rather than retyping it.
- **A pinned-filename update is the easiest place to weaken a test.** Re-pointing
  an assertion at "whatever the resolver returned" would make it vacuous. Each
  updated pin must assert a specific expected filename for a specific seed.
- **Distribution bugs are invisible without a distribution test.** An off-by-one
  in the index arithmetic that simply never returns `-v4` would pass every
  functional test.
