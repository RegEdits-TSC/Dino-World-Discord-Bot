# Art resolver

Fires on: `src/core/images.ts` and `src/core/rolls.ts` — `assetImage`, `dinoImage`,
`pickVariant` and the `hashSeed`/`mulberry32` pair they draw from — plus the tests that
pin them (`tests/dino-image.test.ts`, `tests/species-art.test.ts`, `tests/rolls.test.ts`).

## Headlines

- Omitting the seed returns the BASE file, and that default is a compatibility contract rather than a convenience: every call site that never gains a seed depends on it, as does every filename pin in the suite written against a base name. §unseeded-returns-base
- With a seed the pick is `mulberry32(hashSeed(...))` scaled over `variantCount + 1`, so index 0 is always the base and the seeded path agrees with the unseeded one wherever no variant exists. §seeded-pick-formula
- Hash the COMPOSITE `kind:name:seed`, never a bare id: `eggs` and `hatch` ship one equal-sized variant set per rarity apiece, so a bare egg id would collapse two independent picks into one. §composite-hash-key
- Never hardcode a variant count anywhere — `variantCount` scans from `-v2` upward and stops at the first gap, and the resolver DEPENDS on that invariant rather than merely agreeing with it: a gap makes a face unreachable, an orphan makes a resolved name miss. §variant-count-never-hardcoded
- Seeding a base that ships no variants is a documented no-op, not a defect, and those arms start working on their own the day their base gains a face. §seeding-variantless-base-is-noop
- Variant choice deliberately bypasses `ctx.rng()`: `pickVariant` is a pure function of `(kind, name, seed)`, which is what keeps `ctx` out of a dozen pure display builders and what makes a Discord edit re-render the same face it sent the first time. §variant-choice-bypasses-ctx-rng
- A missing art file is never an error: every resolver in this repo degrades rather than throwing, and every draw site that cannot degrade for free carries its own guard. §art-missing-file-degrades
- Embed art kinds are `eggs | sites | banners | battles | hatch | dinos`; `hatch/<rarity>-crack.webp` is named the way it is so its attachment name never collides with `eggs/<rarity>.webp`. §embed-art-kinds
- Dino art is keyed on archetype×diet with a per-species file as an OPTIONAL override — always go through `dinoImage`, never a bare `assetImage('dinos', …)`, so a species with no file of its own costs no art and adding a species stays a data-only change. §dino-art-archetype-diet-with-species-override
- `hashSeed` must never change: `rollDailyQuests` derives every player's daily board from it, so a changed hash silently rerolls every board in flight AND reshuffles every face, with nothing failing. §hashseed-must-never-change
- Never take `hashSeed`'s result modulo anything — FNV-1a's low bits carry less avalanche than a PRNG's, which is why every selection in this repo runs it through `mulberry32` first. §never-modulo-a-hash
- `/shop view`'s egg preview takes NO seed, because it previews which rarities CAN be bought before any egg exists; the second reason an earlier revision gave does not hold, so don't re-add it. §shop-preview-takes-no-seed
- Any mock of `assetImage` must forward EVERY argument — a two-parameter forwarder silently DROPS the seed and the test keeps passing while exercising nothing. §mock-assetimage-forwards-every-arg
- Mocking `assetImage` cannot intercept the two lookups inside `dinoImage`, so a test that needs a dino-art miss must mock `dinoImage` itself. §mock-dinoimage-not-assetimage

## unseeded-returns-base

A surface with more than one committed face ships `<base>-v2.webp`, `-v3.webp`, … beside
an untouched `<base>.webp`, and `assetImage(kind, name, seed?)` picks which one.
**Omitting the seed returns the base file**, and that default is a compatibility contract
rather than a convenience: every call site that never gains a seed depends on it, as does
every filename pin in the suite written against a base name.

How many such pins there are is a figure to derive and never to write down. That rule is
`§never-write-pin-counts-in-prose` in `docs/conventions/prose-and-specs.md`, and it
carries the recipe.

## seeded-pick-formula

With a seed the pick is ``mulberry32(hashSeed(`${kind}:${name}:${seed}`))`` scaled over
`variantCount + 1`, so index 0 is always the base and the seeded path agrees with the
unseeded one wherever no variant exists.

## composite-hash-key

The hashed string is **composite on purpose** — `kind:name:seed`. `eggs` and `hatch`
ship one variant set per rarity apiece, with equal counts, so hashing a bare egg id
would pick the same index in both — egg #42 showing `common-v2` and then
`common-crack-v2` — collapsing two independent picks into one for a consistency
nobody can perceive. Same reasoning as `WORLD_SALT` (`src/core/world.ts`) and
`DEAL_SALT` (`src/modules/shop/service.ts`).

## variant-count-never-hardcoded

**No variant count is hardcoded anywhere, and none should be.** `variantCount` scans
from `-v2` upward and stops at the first gap — exactly the invariant
`tests/asset-variants.test.ts` enforces (numbering starts at 2, never skips; every
variant has a committed base), which the resolver now DEPENDS on rather than merely
agrees with: a gap makes a face unreachable, an orphan makes a resolved name miss.

The families do not carry the same number of faces either, which is a second and
independent reason never to write one down;
see `§no-uniform-face-count` in `docs/conventions/art-asset-files.md`.

## seeding-variantless-base-is-noop

Seeding a base that ships no variants is a documented **no-op**, not a defect —
`pickVariant` returns the name unchanged when `variantCount` is 0 — which is why two
ternaries carry the seed across variant-free arms (`care_neglect` in
`src/modules/care/index.ts`; `care_neglect`/`season` in
`src/modules/park/alert-embeds.ts`) and why `/help` seeds both its no-variant topics and
its no-variant overview banner harmlessly. Those arms start working on their own the day
their base gains a face, with no edit here.

## variant-choice-bypasses-ctx-rng

Variant choice is a deliberate carve-out from "randomness comes from `ctx.rng()`", taken
knowingly rather than assumed. It is not the only seeded draw that bypasses `ctx.rng()`
— `rollDailyQuests`, `worldEventFor`, `dailyEggOffers` and `dailyDeal` all do — but it
is the only one that needs neither a clock nor a `ctx` at all: all four key off a day
derived from `ctx.now()`, while `pickVariant` is a pure function of
`(kind, name, seed)` over ids already in scope. That is what keeps `ctx` out of a dozen
pure display builders, and it is also what makes a Discord edit re-render the same face
it sent the first time.

## art-missing-file-degrades

Embed art ships from `assets/images/` via `assetImage` (`src/core/images.ts`); a missing
file means the embed renders without the image — **absent art is never an error**. That
is the whole guarantee, stated here once for the resolver side, and every art path in
this repo is built to keep it: `dinoImage` falls back from `dinos/<speciesId>.webp` to
`dinos/<archetype>-<diet>.webp`; a boss stage whose portrait is missing degrades to no
thumbnail at all rather than to archetype art; a missing emoji falls back to unicode; the
park renderer falls back to a flat fill or an emoji glyph. Each of those is an INSTANCE
of this rule rather than a rule of its own, and each keeps only what is peculiar to it —
the boss portraits at `§boss-portraits-committed-and-degradable` in
`docs/conventions/art-asset-files.md`, the emoji map at
`§emoji-runtime-lookup-degrades` in `docs/conventions/emoji-pipeline.md`.

Two halves of this guarantee are worth keeping apart, because the mechanism differs. On
the RESOLVER side, degrading is free: `assetImage` returns a null ref and `attach` makes
that a total no-op. On the CANVAS side it is not free — `drawImage(null)` throws, so
every draw site has to carry its own guard and its own fallback. That half is stated at
`§drawimage-null-needs-guard` in `docs/conventions/park-png-renderer.md`.

There is exactly one place in this codebase where a missing asset THROWS rather than
degrading, and it is a discord.js builder rather than one of ours: an empty rarity tag
passed to `ButtonBuilder.setEmoji`. That exception is stated at
`§never-rarity-emoji-to-seticon` in `docs/conventions/embed-payload-builders.md`.

## embed-art-kinds

Embed art kinds are `eggs | sites | banners | battles | hatch | dinos`
(`assetImage`, `src/core/images.ts`); `hatch/<rarity>-crack.webp` is the
hatch-reveal image and its attachment name never collides with
`eggs/<rarity>.webp`.

## dino-art-archetype-diet-with-species-override

`assets/images/dinos/<archetype>-<diet>.webp` is a fixed
set of 8: **art is keyed on archetype×diet, with a per-species file
as an OPTIONAL override** — `dinoImage(speciesId, archetype, diet)`
(`src/core/images.ts`) tries `dinos/<speciesId>.webp` first and falls back to
`dinos/<archetype>-<diet>.webp`, so a species with no file of its own costs no art and
adding a species stays a data-only change. All five dino-art call sites go through that
helper (`park/embeds.ts`, `duels/embeds.ts`, `dex/embeds.ts`, `hatchery/embeds.ts`,
`battles/embeds.ts`), never a bare `assetImage('dinos', …)`; `park/embeds.ts` needed
`Featured` (`park/showcase.ts`) to carry `speciesId` for it, a typecheck-only break that
`npm run build` and `npm test` both miss.

The fidelity price that fixed cost carries — `archetype` is a combat concept, not a
body-plan one, so outliers share art loosely — is a roster decision rather than a
resolver one, and it is recorded at `§archetype-art-fidelity-accepted` in
`docs/conventions/species-and-dex.md`.

## hashseed-must-never-change

`hashSeed` moved into `src/core/rolls.ts`
for this and now has two callers with different reasons to care that it never changes:
`rollDailyQuests` derives every player's daily board from it, so a changed hash
silently rerolls every board in flight AND reshuffles every face, with nothing failing.
`tests/rolls.test.ts` pins known input/output pairs.

## never-modulo-a-hash

**Never take `hashSeed`'s result modulo
anything** — FNV-1a's low bits carry less avalanche than a PRNG's, which is why every
selection in this repo runs it through `mulberry32` first.

## shop-preview-takes-no-seed

`/shop view`'s egg preview is a deliberate departure from the default of seeding a
banner on the viewer's Discord id: it
takes **no** seed at all, because it previews which rarities CAN be bought
before any egg exists — there is simply nothing there to seed from. That is the whole
reason, and an earlier revision of this line added a second one that does not hold:
seeding it on the viewer would NOT be what makes the preview disagree with the egg
actually bought, because it disagrees either way — every other egg surface resolves on
`String(egg.id)`, so an unseeded preview shows the base while the bought egg usually
shows a face. Don't re-add it. The banner on that same reply does take a seed: a banner
has no object to key on, so it keys on who is looking.

## mock-assetimage-forwards-every-arg

The matching hazard, on the mock side of a seeded call site's test:
`mockImplementationOnce((kind, name) => realAssetImage(kind, name))` silently DROPS the
seed and the test keeps passing while exercising nothing. Three files carried mocks of
that shape, one of them a file-wide spy that would have handed the base file to every
new pin in the file it governs. **Any mock of `assetImage` must forward every
argument** — `(...args) => realAssetImage(...args)`.

## mock-dinoimage-not-assetimage

Mocking `assetImage` can NOT intercept the two
lookups inside `dinoImage` — that call is module-internal — so a test that needs a
dino-art miss must mock `dinoImage` itself (`tests/hatchery.test.ts` and
`tests/battles-embeds.test.ts` both do).
