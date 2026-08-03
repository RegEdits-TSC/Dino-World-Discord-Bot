# Animated bot branding — design

Date: 2026-08-03
Status: approved, ready for implementation planning

An animated avatar and profile banner for the Dino World bot, generated with
Higgsfield (Nano Banana Pro for the still frames, Seedance 2.0 for the motion),
encoded to GIF with ffmpeg, and applied to the bot's Discord profile by a new
`npm run deploy-branding` script.

## Why this shape

Discord accepts **GIF only** for animated avatars and banners — no MP4, no WebM,
no animated WebP. Animated avatars for *bot* accounts have been supported since
February 2024 ([discord-api-docs discussion
#3353](https://github.com/discord/discord-api-docs/discussions/3353)); the bot
profile banner field lives in Developer Portal → Bot and takes a GIF at a
recommended 680×240.

Seedance 2.0 emits MP4, so a conversion stage is unavoidable. GIF's 256-colour
palette is the binding quality constraint, and it is what drives both the
"subtle ambient motion, locked camera" art direction and the ffmpeg flag choices
below: the fewer pixels that change per frame, the more of the palette and the
bitrate go to the pixels that do.

## Artifacts

| File | Size | Format | Use |
| --- | --- | --- | --- |
| `assets/branding/avatar.gif` | 512×512 | GIF89a, `loop 0` | bot avatar (animated) |
| `assets/branding/banner.gif` | 680×240 | GIF89a, `loop 0` | bot profile banner (animated) |
| `assets/branding/icon.png` | 1024×1024 | PNG | Developer Portal **App Icon** — a static-only field, distinct from the bot user's avatar |
| `assets/branding/banner-still.png` | 1360×480 | PNG | static fallback, and the source for any future App Directory cover |

`assets/branding/`, not `assets/images/`: `tests/images.test.ts` asserts every
file under `assets/images/` is WebP, so a GIF committed there is a failing test,
not a new asset.

Discord's hard ceiling is 10 MB per file. The encoder budgets **8 MB** and fails
loudly rather than shipping something Discord will reject at upload time.

### Framing constraints

- **Avatar is circle-cropped.** The T-rex head must sit inside the inscribed
  circle; the corners carry embers and glow only.
- **Banner's lower-left is covered by the avatar overlay.** The left ~25% stays
  quiet — sky and distant canopy, no focal subject.
- **Banner aspect is 2.83:1; Seedance's widest is 21:9 (2.33:1).** The banner
  still is therefore composed with roughly 18% dead headroom split top and
  bottom, and the encoder crops vertically. Nothing load-bearing goes in that
  margin.

### Art direction

Avatar: the shipped `assets/images/dinos/bruiser-carnivore.webp` T-rex, in a
volcanic setting — dark basalt, lava-orange rim light, drifting embers, deep
charcoal-to-ember-red background. Chosen for silhouette contrast against
Discord's dark theme at 40 px, and because embers and lava flicker are naturally
loopable motion.

Banner: a golden-hour park panorama — gate with lit torches, valley path,
grazing sauropods, a gliding pterosaur. The avatar's volcano and the banner's
park are tied together by a smoking volcano cone on the banner's right horizon
and a shared warm sunset palette, so the two read as one world rather than two
brands.

## Pipeline

### Stage 1 — stills (`nano_banana_pro`)

The shipped dino cutout is uploaded as a real reference (`media_upload` →
presigned PUT → `media_confirm` → `media_id`), so the avatar's character is
identity-locked to committed art rather than re-described in prose.

Avatar still, aspect `1:1`, reference = `assets/images/dinos/bruiser-carnivore.webp`:

> Keep the exact character from the reference image — same crimson-red T-rex,
> charcoal dorsal ridge, cream underbelly, amber-orange eye, same bold dark
> outlines and glossy cel shading. Head-and-shoulders close-up, three-quarter
> view facing right, head filling the center of a square frame. Volcanic
> setting: dark basalt rock, molten lava-orange rim light along the jaw and
> crest, embers floating upward, deep charcoal-to-ember-red radial background,
> soft heat haze. Head fully inside the central circle; only embers and glow in
> the corners. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no UI elements.

Banner still, aspect `21:9`:

> Wide panoramic dinosaur park at golden-hour sunset. Left third quiet: open
> warm sky, soft clouds, distant birds, low canopy silhouette, no focal subject.
> Center: lush valley, winding dirt path, palms and ferns, wooden park gate with
> lit torches. Right third: sauropods grazing by a lake, a gliding pterosaur,
> and a smoking volcano cone on the far horizon with faint ember glow. Generous
> empty sky above and open ground below for cropping to a short wide strip.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no UI elements.

Both prompts close with the repo's shared style block from
`docs/assets/prompts.md`, which is what keeps them consistent with the 40+ assets
already shipped.

### Stage 2 — motion (`seedance_2_0`)

`start_image` **and** `end_image` are both set to the stage-1 job id. That is the
loop trick: the clip is constrained to end where it began, so the GIF cycles
without a visible cut. Stage-1 output chains natively by `job_id`, so no
re-upload is needed between stages.

| | aspect | resolution / mode | duration | audio | cost |
| --- | --- | --- | --- | --- | --- |
| avatar | `1:1` | 720p / std | 5 s | off | 22.5 credits |
| banner | `21:9` | 1080p / std | 5 s | off | 45 credits |

Avatar motion prompt:

> Subtle ambient loop. The T-rex breathes slowly once, blinks once, slight jaw
> shift. Embers drift upward, lava glow flickers. Camera locked — no zoom, no
> pan, no push-in. Nothing enters or leaves frame. Ends exactly as it began.

Banner motion prompt:

> Subtle ambient loop. Torch flames flicker, fronds sway in a light breeze,
> clouds drift, water ripples, one pterosaur glides across the sky, a distant
> sauropod dips its head to drink and lifts it, volcano smoke curls. Camera
> locked — no pan, no zoom, no parallax. Ends exactly as it began.

Free-generation path: Seedance 2.0 declares `supports_unlim`, so the request is
sent with `use_unlim: true`. A request that cannot be served free is **rejected,
never silently charged** — on rejection the reason is reported and the operator
decides before any credits are spent.

Review gate between stages: compare first and last frame. Camera drift or a
subject that fails to return to its start pose earns one reroll with harder
camera-lock wording; a second failure falls back to boomerang encoding. Stills
reroll independently of clips, so a motion miss never costs a re-render of the
art.

### Stage 3 — encode (`scripts/make-gif.mjs`)

New dev dependency: `ffmpeg-static`, pinned to the newest stable release
verified against npm at implementation time. Script sits beside
`scripts/fit-art.mjs` and follows the same plain-`.mjs` convention.

```
node scripts/make-gif.mjs <src.mp4> <dest.gif> \
  --width 512 --height 512 --fps 12 [--crop-aspect 2.8333] [--boomerang] [--max-bytes 8388608]
```

Filter chain:

```
fps=12,crop=in_w:in_w/2.8333,scale=680:240:flags=lanczos,split[a][b];
[b]palettegen=stats_mode=diff[p];[a][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle
```

with `-loop 0`.

Why these flags, since they are not obvious and are the whole reason the file
fits in budget:

- `palettegen=stats_mode=diff` spends the 256-colour budget on pixels that
  actually change between frames instead of averaging over the whole static
  scene.
- `paletteuse=diff_mode=rectangle` leaves unchanged regions byte-identical
  frame to frame, which is where nearly all of the compression comes from on an
  ambient loop.
- `dither=bayer` rather than the default error diffusion: Floyd-Steinberg
  re-dithers the static background differently on every frame, which both
  destroys that inter-frame redundancy and visibly shimmers on flat gradients.
  Ordered dithering is stable across frames.

Size ladder, applied only when over budget and logged at each step: **frame rate
only**, `12 → 10 → 8` fps, hard-failing below 8. Output dimensions are
deliberately invariant — 512×512 and 680×240 are contract values the tests assert
exactly, and a ladder that shrank the canvas would make the committed asset's
size depend on how much the clip happened to move. The avatar renders at ~152 px
in the profile modal, so 512 is the size that stays crisp on a 2× display and is
not negotiable against file size.

A clip that will not fit at 8 fps is a signal about the clip, not the encoder:
it means the motion is broader than the "subtle ambient" direction called for,
and the fix is a reroll, not a blurrier asset.

Boomerang is a fallback, not the default: forward frames concatenated with the
reversed sequence, one seam frame dropped at each join so the turnaround does
not stutter. It doubles the frame count, so the size ladder re-runs afterward.

The two static PNGs come from the stage-1 stills, not from decoded video frames,
which are only 720p and already palette-quantised. If a still comes back smaller
than its target, it is upscaled once with Lanczos to 1024×1024 / 1360×480 rather
than being regenerated — these are fallback assets, not embed art.

### Stage 4 — apply (`src/deploy-branding.ts`)

Placed in `src/` alongside `deploy-emojis.ts`, exposed as `npm run
deploy-branding`.

```
npm run deploy-branding                    # avatar + banner
npm run deploy-branding -- --avatar-only
npm run deploy-branding -- --banner-only
```

The call is `rest.patch(Routes.user(), { body: { avatar, banner } })` with
`data:image/gif;base64,…` URIs.

Preflight refuses to send a file with the wrong magic bytes, one over 10 MB, or
a missing path. Afterwards the script reads the returned `avatar` / `banner`
hash: an `a_` prefix is Discord's own confirmation that it stored an **animated**
asset. No prefix means it kept a single static frame, and the script fails rather
than reporting success.

Discord rate-limits profile edits to roughly two per hour, which is why the
single-asset flags exist — re-uploading one asset should not consume the budget
for both. A 429 prints `retry_after` and exits non-zero.

The script reuses the existing `loadConfig()` token; no new secret and no new
environment variable are introduced, so `.env.example` is unchanged. Error
handling logs the HTTP status and Discord error code only — never the token,
request headers, or raw error body, since an API error response can echo request
context back.

## Testing

`tests/branding.test.ts`, using a small hand-rolled GIF header reader (~40 lines,
no new dependency):

- both GIFs exist and start with the `GIF89a` magic
- logical screen descriptor reports exactly 512×512 and 680×240
- frame count is greater than one — this is what catches a silently static
  export, the failure mode most likely to slip through visual review
- a `NETSCAPE2.0` application extension is present with loop count 0
- file size is within the 8 MB budget and under Discord's 10 MB ceiling

Unit tests on the exported pure helpers, so the shell-out and the network are
never exercised in tests:

- `nextStep(fps)` — the frame-rate ladder: each step lowers the rate, and the
  sequence terminates at the 8 fps floor instead of looping forever
- `toDataUri(buf, mime)` — correct prefix and base64 body
- `assertUploadable(buf, kind)` — rejects wrong magic bytes, rejects oversize
  input, accepts a valid GIF and a valid PNG

## Documentation

- `docs/assets/prompts.md` gains a bot-branding section carrying both prompts,
  the reference chain off `dinos/bruiser-carnivore.webp`, the Seedance
  parameters, the `start_image == end_image` loop trick, the ffmpeg chain with
  the reasoning above, and the size budgets. It is the source of truth for
  regenerating these assets.
- `CLAUDE.md` gains a short note: branding GIFs live in `assets/branding/`
  because `assets/images/` is WebP-guarded; `deploy-branding` is an operator step
  with a ~2/hour ceiling; the `a_` hash prefix is the animated-accepted proof.
- `.env.example` is explicitly unchanged.

## Failure modes

| Failure | Behaviour |
| --- | --- |
| `use_unlim` rejected | report the reason and stop; ask before spending credits |
| Seedance drifts or morphs despite camera lock | one reroll, then boomerang encode |
| GIF over the 8 MB budget | frame-rate ladder with logging, hard fail below 8 fps |
| Discord returns a hash without the `a_` prefix | fail loudly — a static frame was stored |
| HTTP 429 on profile edit | print `retry_after`, exit non-zero |
| `ffmpeg-static` missing | actionable install message |

## Rollout

Stills → review → clips → review → encode → review → commit → operator runs
`npm run deploy-branding` → verify in the Discord client.

## Known risks

Banding across the volcano's smooth gradient is the likeliest cosmetic miss, GIF
being a 256-colour format. The diff palette and ordered dithering are the first
mitigations; if it still bands, adding basalt grain and ash texture to the still
prompt breaks up the flat ramp, which quantises far better than a clean gradient.

The 21:9 to 2.83:1 crop is the second risk, handled by the dead-headroom
instruction in the banner still prompt and verified at review before encoding.

## Out of scope

App Directory cover art, server icon and splash, seasonal or event variants,
audio, and any format Discord will not accept for these two fields.
