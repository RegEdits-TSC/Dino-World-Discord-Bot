# Bot profile branding

Fires on: `assets/branding/`, the GIF pipeline that fills it (`scripts/make-gif.ts`), the
code that uploads it (`src/core/branding.ts`, `src/deploy-branding.ts`) and its tests
(`tests/branding.test.ts`, `tests/make-gif.test.ts`).

## Headlines

- Bot profile branding lives in `assets/branding/`, NOT `assets/images/`, because every file under the latter must be WebP and Discord takes GIF only. §branding-not-under-assets-images
- 512×512 and 680×240 are contract values asserted in `tests/branding.test.ts`, so an over-budget GIF lowers frame rate and NEVER the canvas. §branding-gif-dimensions-are-contract
- `npm run deploy-branding` is an operator step, not part of any build: Discord rate-limits profile edits to roughly 2/hour, hence `--avatar-only` / `--banner-only`. §deploy-branding-is-an-operator-step
- Deploy asserts the returned asset hash starts with `a_` — Discord's own confirmation that it stored the animation rather than a single static frame, which is otherwise a silent failure. §deploy-branding-asserts-animated-hash

## branding-not-under-assets-images

Bot profile branding lives in `assets/branding/` — **not** `assets/images/`, whose
every file must be WebP (`tests/images.test.ts`). Discord takes GIF only for an
animated avatar or banner, so the branding art could never have satisfied that rule; it
sits outside the tree rather than inside it as a fourth exception. The three exceptions
that do live inside are at `§three-deliberate-non-webp` in
`docs/conventions/art-asset-files.md`.

Regeneration prompts and the ffmpeg flag reasoning are in `docs/assets/prompts.md`.

## branding-gif-dimensions-are-contract

An animated avatar is 512×512 and an animated banner 680×240; those dimensions are
contract
values asserted in `tests/branding.test.ts`, so `scripts/make-gif.ts`'s over-budget
ladder lowers frame rate (12 → 10 → 8) and never the canvas.

## deploy-branding-is-an-operator-step

`npm run deploy-branding`
is an operator step, not part of any build: Discord rate-limits profile edits to
roughly 2/hour, hence `--avatar-only` / `--banner-only`.

## deploy-branding-asserts-animated-hash

It asserts the returned
asset hash starts with `a_` — Discord's own confirmation that it stored the
animation rather than a single static frame, which is otherwise a silent failure.
