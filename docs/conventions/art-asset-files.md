# Art asset files

Fires on: everything under `assets/images/`, the `scripts/fit-art.mjs` family that
produces it, `docs/assets/prompts.md`, and the tests that pin the bank
(`tests/images.test.ts`, `tests/asset-variants.test.ts`, `tests/art-pipeline.test.ts`,
`tests/fit-art-cli.test.ts`, `tests/docs-assets.test.ts`).

## Headlines

- A surface with more than one committed face ships `<base>-v2.webp`, `-v3.webp`, … beside an UNTOUCHED `<base>.webp` — numbering starts at 2 and never skips, and every variant needs its base committed. §variant-file-naming
- The families do not carry the same number of faces, so never write a uniform face count into code, a test or a doc — `ls assets/images/<kind> | grep -- '-v'` is the answer. §no-uniform-face-count
- §one-more-face-moves-half-the-seeds
- §new-face-is-inert-for-unseeded-bases
- §no-test-proves-a-variant-is-reachable
- Every file under `assets/images/` is WebP q95, and `tests/images.test.ts` guards that nothing regresses to another format. §assets-images-are-webp-q95
- Three things are deliberately NOT WebP, each for a reason that would break if you converted it. §three-deliberate-non-webp
- Never stage a test fixture inside `assets/images/` — vitest runs test files in parallel forks, so writing or deleting a committed asset path can be observed by another file mid-run. §no-test-fixtures-in-assets
- Boss portraits must never gain variant faces: a boss is a named individual and one face is the point. §boss-portraits-stay-single-faced
- The boss portraits are committed art, but the campaign stays fully playable if any of them is removed. §boss-portraits-committed-and-degradable
- Banners are 1536×1024 and transparent cutouts 1024×1024, asserted in `tests/images.test.ts`; `fit-art.mjs banner|ground|cutout` produces the banners, the cracks and the season grounds, but NOT the eggs or the boss portraits. §art-dimensions-and-fit-art-modes
- The hatch cracks keep multiple disconnected alpha regions on purpose, so the egg pass's "largest connected region" step must never be applied to them. §cracks-keep-disconnected-alpha
- Generation prompts live in `docs/assets/prompts.md`, and it is the record for every number the pipeline diverges on. §art-prompts-live-in-docs

## variant-file-naming

A surface with more than one committed face ships `<base>-v2.webp`, `-v3.webp`, … beside
an untouched `<base>.webp`. `tests/asset-variants.test.ts` enforces the shape: numbering
starts at 2, never skips, and every variant has a committed base. `assetImage`
(`src/core/images.ts`) is the only path builder for these files and the only thing that
picks between them.

The RESOLVED face is also the uploaded attachment's name — `${name}.webp`, or
`${name}-vN.webp` where a seed picked a variant, with no `kind` prefix either way — so
adding a face to a base that shares a payload with another can change whether two
attachment names collide. That hazard is stated at `§attachment-name-dedupe` in
`docs/conventions/embed-payload-builders.md`.

## no-uniform-face-count

The families do not carry the same number of faces — `sites` ships fewer per base than
`eggs`, `hatch` and `banners`, and `battles` and `dinos` ship none — so never write a
uniform face count into code, a test or a doc; `ls assets/images/<kind> | grep -- '-v'`
is the answer.

## one-more-face-moves-half-the-seeds

Shipping one more face for a base is either a real behaviour change or completely inert,
and which one it is turns on a single question: **does that base have a SEEDED call
site?** The only way to answer it is `grep -rn 'assetImage(' src/`, reading the third
argument of every call that names the base. This section is the SEEDED branch; the
unseeded branch is §new-face-is-inert-for-unseeded-bases, immediately below.

Shipping one more face needs no code edit and is **never inert — for a
base resolved through a SEEDED call site**: a seed's
draw is fixed and only `floor(draw * (count + 1))` moves, so raising a base's count
re-partitions that draw and **half of its seeds land on a different face** — exactly
half, provably, at every count. That is ONE rule, not a general case plus a mild one: the
`0 → 1` step that gives a variant-free base its first face obeys it too, and differs only
in that there is no other variant to move BETWEEN, so its moving half simply leaves the
base file — which is the whole point of shipping the face. Two real seeds that did move:
`banners/dino_roster` seed `u1` is `-v3` at three variants and `-v4` at four
(`tests/park.test.ts:1210`); `sites/coastal_dig-banner` seed `u2` is `-v2` at two and
`-v3` at three (`tests/battles-embeds.test.ts:290-291`). **Which half moves is not
knowable by eye, so budget for re-deriving every committed `-vN` pin on that base from
the real `assetImage`, never by hand** — half of them staying put is not something you
can find out without checking all of them.

## new-face-is-inert-for-unseeded-bases

This is the unseeded branch of the rule above: the base you are shipping a face for has
no `assetImage` call site anywhere in `src/` that passes a third argument.

**The converse is the trap, and it is the majority case: a base reached only by UNSEEDED
calls gains nothing from a new face — not eventually, but never — and nothing fails to
say so.** Dropping `banners/lots-v2.webp` into the repo today changes nothing, forever:
`lotsPayload` (`src/modules/park/embeds.ts`) is that base's only call site and it omits
the seed, so `assetImage` returns `lots.webp` and no test moves. Same for
`banners/rescue`, `achievements`, `dex`, `gene_splice`, `landmark` and every `event-*`;
for every `sites/<id>-thumb`; for every `battles/boss-<id>-portrait` (which must never
gain faces anyway — a boss is a named individual, one face is the point, and
`src/modules/battles/embeds.ts` says so at the call site); and for all of `dinos/`,
since `dinoImage` passes no seed on either of its two lookups. That list is a snapshot,
not an invariant — re-derive it with `grep -rn 'assetImage(' src/` and read the third
argument, because a call site gaining a seed moves its base out of this class silently.

## no-test-proves-a-variant-is-reachable

**Nothing in the suite proves a committed variant is REACHABLE**, and that is a
deliberate omission rather than a gap to close: `tests/asset-variants.test.ts` proves the
inverse — every variant has a committed base, numbering starts at 2 and never skips — so
a face shipped for an unseeded-only base is a dead file that passes every gate green. A
machine gate was declined because the art bank is closed, which leaves this paragraph as
the only thing standing between a future art drop and a file nothing can ever render.

## assets-images-are-webp-q95

Every file under `assets/images/` is **WebP q95** — `assetImage`
(`src/core/images.ts`) is the only path builder for them and appends `.webp`,
so flipping the format there propagates to every `attachment://` URL and every
`files[].name`. `scripts/fit-art.mjs` emits the same format. `tests/images.test.ts`'s
"ships every file under assets/images as .webp" test guards that nothing under
`assets/images/` regresses to another format.

## three-deliberate-non-webp

Three things are
deliberately NOT WebP: `assets/emojis/png/` (Discord's app-emoji upload expects
PNG and `manifest.json` hashes those exact bytes), `assets/emojis/svg/` (the
park renderer needs synchronous decode), and `park.png` — the `/park view`
render OUTPUT buffer from `renderParkPng`, an in-memory PNG (`canvas.toBuffer
('image/png')`), not a committed asset.

Each of the three has its reason stated where the code that depends on it lives: the
upload manifest at `§emoji-build-and-deploy-pipeline` in
`docs/conventions/emoji-pipeline.md`, and the synchronous-decode requirement at
`§svg-decodes-synchronously` in `docs/conventions/park-png-renderer.md`.
The bot's profile art is a fourth format exception, and it lives outside
`assets/images/` entirely rather than inside it as an exception; that is
`§branding-not-under-assets-images` in `docs/conventions/bot-profile-branding.md`.

## no-test-fixtures-in-assets

Never stage a test
fixture inside `assets/images/` — vitest runs test files in parallel forks,
so a `writeFileSync`/`rmSync` on a committed asset path can be observed (or
deleted) by another file mid-run; `tests/battles-embeds.test.ts` mocks
`assetImage` instead.

## boss-portraits-stay-single-faced

A boss portrait must never gain variant faces — a boss is a named individual, one face is
the point, and `src/modules/battles/embeds.ts` says so at the call site.

## boss-portraits-committed-and-degradable

`assets/images/battles/` ships committed boss portraits
(`boss-<siteId>-portrait.webp`, 1024×1024 transparent cutouts pinned by
`tests/images.test.ts`); `assetImage`'s null-degrade still holds, so the
campaign stays fully playable if any of them is removed. This is one instance of the
guarantee stated in full at `§art-missing-file-degrades` in
`docs/conventions/art-resolver.md`.

## art-dimensions-and-fit-art-modes

Banners are
1536×1024 (asserted in `tests/images.test.ts`) and transparent cutouts
1024×1024; `node scripts/fit-art.mjs banner|ground|cutout <src> <dest>`
produces the banners and the hatch cracks via `banner`/`cutout`, but NOT the
eggs or the boss portraits — those came from a one-off pass with a tighter
24px margin (vs the script's 31px) and, for the eggs, an egg-axis bias. The
season ground rasters (`park/ground-wet|dry|cold.webp`) come from `ground`,
cover-scaled to 1200×800 rather than banner's 1536×1024 — the park renderer's
canvas never needs more than that.

The eight `dinos/<archetype>-<diet>.webp` files are 1024×1024 transparent cutouts from
`fit-art.mjs cutout`, so they carry the script's 31px margin against the boss portraits'
24px — deliberate, and recorded in `docs/assets/prompts.md`.

## cracks-keep-disconnected-alpha

`docs/assets/prompts.md` carries the
numbers and the two families' divergence; the cracks additionally keep
multiple disconnected alpha regions on purpose (falling shell fragments), so
the egg pass's "largest connected region" step must never be applied to them.

## art-prompts-live-in-docs

Generation prompts live in `docs/assets/prompts.md`. It is the record for every number
the pipeline diverges on rather than a scratch file: the two margin passes, the two
families' dimension divergence, the branding regeneration prompts and the ffmpeg flag
reasoning are all there, and `tests/battle-content.test.ts` requires every `bossId` to
appear in it.
