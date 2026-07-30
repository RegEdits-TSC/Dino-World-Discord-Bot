# Art assets, round 2 — design

Date: 2026-07-28

## Goal

Close the remaining art gaps in the bot and lift the surfaces that never had
art. Three things drive the round: the PvE campaign ships with an empty
`assets/images/battles/`, the park map PNG is the most-seen image in the bot
and is the only one drawn entirely from flat fills and stock unicode glyphs,
and an audit of all 113 user-visible surfaces found a long tail of
high-traffic replies carrying no image at all.

## Scope

In scope:

- 4 battle boss portraits (prompts already written, code path already live).
- Park map visual overhaul, Direction A — same geometry, real materials.
- New art for the bare high-traffic surfaces: hatch reveal, battle
  victory/defeat, `park:collect`, `/rescue`, `/dino list`, `/eggs`, `/sell`.
- Rewiring existing on-disk art into surfaces that never referenced it.
- Widening the `notify.ts` `Sender` contract so passive notifications can
  carry embeds and images.

Out of scope:

- **Dino species art (30 portraits).** `spriteRef` stays dead data. The hatch
  reveal therefore expresses the moment through rarity, not species.
- Park map layouts that change geometry (an illustrated diorama replacing the
  card grid was considered and rejected as a renderer rewrite).
- `/settings` and `/admin` surfaces. The audit rated every one of them
  negligible: owner-only or once-per-guild ephemerals.

## Asset inventory

### Generated with Higgsfield — 20 images

Model: Nano Banana Pro, 2 credits per image, 1 credit per background removal.
Total round cost is roughly 50 credits against a 1000-credit balance, so
credits do not constrain scope.

| Count | Asset | Size / form | Reference chain |
|---|---|---|---|
| 4 | `battles/boss-<site>-portrait.png` | 1024×1024, transparent | Prompts already in `docs/assets/prompts.md`. Coastal generated first; the other three are image-edits of the approved coastal portrait. |
| 3 | `park/ground.png`, `park/plate-paddock.png`, `park/plate-facility.png` | ground 3:2, cover-scaled to the canvas; plates 270×150 | Plates generated as edits of the ground so the materials share a light direction. |
| 6 | `hatch/<rarity>-crack.png` | 1024×1024, transparent | Each edited from its own existing `eggs/<rarity>.png` so the player sees the same egg they were shown, mid-burst. |
| 2 | `banners/battle_victory.png`, `banners/battle_defeat.png` | 1536×1024 | Defeat generated as an edit of victory — same arena, two moods, the `care` / `care_neglect` pattern. |
| 2 | `banners/collect.png`, `banners/rescue.png` | 1536×1024 | Independent. |
| 3 | `banners/dino_roster.png`, `banners/eggs_incubator.png`, `banners/sell.png` | 1536×1024 | Independent. |

`<rarity>` is one of `common`, `uncommon`, `rare`, `epic`, `legendary`,
`mythic`. `<site>` is one of `coastal_dig`, `amber_ridge`, `frozen_cliffs`,
`volcano_core`.

### Hand-authored SVG — 6 new icons

Authored in `assets/emojis/svg/`, rendered to committed PNGs by
`npm run build-emojis`, uploaded by `npm run deploy-emojis`.

The park renderer reads these as **SVG**, not PNG — the same trick
`hudCashIcon` already uses for `dw_cash.svg`. `@napi-rs/canvas` decodes SVG
buffers synchronously, so icons drawn this way need no preload and no await.

- 6 rarity dino chips: `dw_dino_common` … `dw_dino_mythic`. New. These replace
  the two Noto Color Emoji glyphs (🦕 / 🦖) currently drawn in park tiles, and
  deploy as app emojis so text embeds stop mixing custom icons with stock
  unicode.
- 5 lot-kind icons need **no new art**: `dw_lot_carnivore`, `dw_lot_herbivore`,
  `dw_lot_food_court`, `dw_lot_hatchery` and `dw_lot_visitor` already exist in
  `assets/emojis/svg/`. The renderer reads those SVGs directly, replacing the
  🦖🦕🍔🥚🏛️ glyph run at zero asset cost.

### Rewired, zero generation

Art already on disk that no surface references:

| Surface | Art |
|---|---|
| `/incubate` success | `eggs/<rarity>.png` |
| `/shop food` confirmation | `banners/shop_food_market.png` |
| `/expedition claim` | `sites/<siteId>-thumb.png` as thumbnail |
| `/battle chapters` | `sites/<chapterId>-thumb.png` as thumbnail |
| `/help topic:<t>` (all 9) | park→canvas render, eggs→egg art, expeditions→site banner, care→`care.png`, trading→`trading.png`, ranks→`leaderboards.png`, shop→`shop_food_market.png`, battles→`sites/coastal_dig-banner.png` (chapter 1), getting-started→`help.png` |
| `/trade offer`, `/trade accept` | `banners/trading.png` |
| `/sell` guard replies | `eggs/<rarity>.png` as thumbnail |

## Production pipeline

Every prompt ends with the shared style block already established in
`docs/assets/prompts.md`:

> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no characters, no UI elements.

Banners whose subject is dinosaurs drop the "no characters" clause and forbid
only human ones, matching the existing embed-banner section.

Assets destined for transparency (boss portraits, hatch cracks) carry the hard
no-glow rule verbatim:

> No glow, rays, embers, sparkles, or light effects extending beyond the
> silhouette; glowing details may appear only on the surfaces themselves.

Off-silhouette glow survives `remove_background` as floating islands or a halo
on transparency. Post-processing for those two sets is `remove_background`
followed by the defringe-and-fit pass documented in the Egg rarities section of
`docs/assets/prompts.md`.

`docs/assets/prompts.md` gains a section per new asset and remains the source
of truth for regeneration. `tests/battle-content.test.ts` already enforces that
every `bossId` appears there.

### Draft prompts for the new sets

**Park ground (`park/ground.png`):** generated at 3:2 and cover-scaled to the
canvas at draw time. Deliberately not a seamless tile — diffusion models do not
reliably close tile edges, and a single cover-scaled backdrop has no seams to
close.

> A top-down view of lush jungle-park ground filling the whole frame: mown
> green grass with subtle mowing bands, a few scattered fern fronds and small
> pebbles, faint dirt patches worn into the turf, no single focal point and
> nothing large enough to dominate the frame. Even flat lighting, no strong
> cast shadows. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

**Park paddock plate (`park/plate-paddock.png`):** generated with the ground
as the `image` reference.

> A single rectangular game-UI plate for a dinosaur paddock: a warm sandy-tan
> dirt enclosure floor framed by a rough-hewn wooden fence border on all four
> sides, corner posts, a calm untextured center area with no detail so text
> can sit on it legibly. Even flat lighting, no cast shadows. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, clean
> cel shading with smooth gradients, polished game-asset look. No text, no
> characters, no UI elements.

**Park facility plate (`park/plate-facility.png`):** generated with the paddock
plate as the `image` reference so the two plates match.

> Keep the exact same rectangular plate shape, same size, same border
> thickness, same calm untextured center area, same flat lighting. Change the
> material to a cool blue-gray steel and glass facility floor with riveted
> metal edging instead of wood. Glossy cartoon mobile-game art style, bold
> dark outlines, vibrant saturated colors, clean cel shading with smooth
> gradients, polished game-asset look. No text, no characters, no UI elements.

**Hatch cracks (`hatch/<rarity>-crack.png`):** each generated with its own
`eggs/<rarity>.png` attached as the `image` reference.

> Keep the exact same cartoon dinosaur egg and the exact same woven twig nest:
> same shell design, same colors, same size, same position, same framing, same
> plain flat light-gray studio background. Change only the state: the shell is
> now split wide open across the upper half, jagged shell fragments falling
> away and resting in the nest, the interior dark and empty. No glow, rays,
> embers, sparkles, or light effects extending beyond the egg or the nest;
> glowing details may appear only on the surfaces themselves. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

**Battle victory (`banners/battle_victory.png`):**

> A wide cartoon scene of a dinosaur park arena after a won battle: a proud
> victorious green cartoon dinosaur standing tall on a rocky outcrop with its
> head raised, banners and pennants flying on tall poles behind it, scattered
> broken wooden barricades on the sand floor, warm golden late-afternoon light
> breaking through dust in the air, triumphant and bright. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no human characters, no UI elements.

**Battle defeat (`banners/battle_defeat.png`):** generated with the victory
banner attached as the `image` reference.

> Keep the exact same cartoon arena scene: same rocky outcrop, same banner
> poles, same barricades, same camera framing and composition. Change only the
> mood to defeat: the dinosaur now stands with its head lowered and shoulders
> dropped, the banners are torn and drooping, dust hangs heavy. Overcast grey
> light with muted desaturated colors and long dull shadows instead of golden
> sun. Glossy cartoon mobile-game art style, bold dark outlines, clean cel
> shading with smooth gradients, polished game-asset look. No text, no human
> characters, no UI elements.

**Collect (`banners/collect.png`):**

> A wide cartoon scene of a dinosaur park ticket booth at closing time: an
> open cash box on a wooden counter overflowing with gold coins and banknotes,
> stacks of coins beside it, a small chalkboard sign and a coil of ticket
> stubs, lush ferns and a park path behind, warm cheerful afternoon daylight.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no human characters, no UI elements.

**Rescue (`banners/rescue.png`):**

> A wide cartoon scene of a dinosaur recapture in a park at dusk: a broken
> section of tall wire perimeter fence with the gap being closed by a wooden
> barricade, a small worried green cartoon dinosaur being coaxed back toward
> the enclosure along a rope-marked path, a parked park jeep with its headlamp
> on and a net beside it, jungle treeline and deep blue evening sky behind.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no human characters, no UI elements.

**Dino roster (`banners/dino_roster.png`):**

> A wide cartoon scene of a dinosaur park roster board area: a row of five
> different friendly cartoon dinosaurs of assorted colors and sizes standing
> side by side along a wooden fence line as if lined up for a headcount, a
> long-necked sauropod, a horned ceratopsian, a plated stegosaur, a small
> theropod and a crested hadrosaur, lush ferns and palms behind, bright
> cheerful morning daylight. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no human
> characters, no UI elements.

**Eggs incubator (`banners/eggs_incubator.png`):**

> A wide cartoon scene of a dinosaur park hatchery incubation room: a curved
> bank of warm glass incubator domes on a steel bench, each holding a single
> speckled egg nested in straw, soft amber heat lamps overhead, coiled hoses
> and a temperature dial on the wall, dark room lit warmly from the domes
> themselves. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no human characters, no
> UI elements.

**Sell (`banners/sell.png`):**

> A wide cartoon scene of a prehistoric park buyer's stall: a heavy wooden
> counter with a brass weighing scale, an open ledger, a leather coin pouch
> spilling gold, and an empty transport crate with its lid propped open and
> straw inside, a dirt path and jungle ferns behind, warm late-afternoon
> daylight. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no human characters, no UI
> elements.

## Code changes

### Park renderer

A new `src/core/render/art.ts` exports `loadParkArt(): Promise<ParkArt>`, where
`ParkArt` is a record of `Image | null`. PNG art is decoded there with
`await img.decode()`; SVG art is decoded synchronously. A missing or
undecodable file yields `null` and never throws.

`worker.ts` top-level-awaits `loadParkArt()` before it handles its first
message, then passes the result into every render. `renderParkPng(snap, art =
EMPTY_ART)` **stays synchronous**, and every `null` entry falls back to the
current `fillRect` / glyph path. This is the load-bearing decision of the whole
renderer change: it keeps `@napi-rs/canvas`'s async PNG decode out of a
synchronous function, preserves the project-wide null-degrade rule (absent art
is never an error), and leaves `tests/render-draw.test.ts` passing unmodified.

`draw.ts` changes:

- background `fillRect('#356b2c')` → `drawImage(ground)` cover-scaled to the canvas
- tile fill + stroke → `drawImage(plate-paddock | plate-facility)`
- `lotIcon` emoji glyph run → `drawImage(lot icon)`
- `dinoGlyph` emoji glyph run → `drawImage(rarity dino chip)`

`src/data/render-icons.ts` keeps its palettes and glyph maps unchanged — they
are the fallback path, not dead code.

### notify.ts Sender

`Sender.channelSend` and `Sender.dmSend` take
`string | { content?: string; embeds?: EmbedBuilder[]; files?: AttachmentBuilder[] }`
instead of `string`. `deliverNotification` merges the `<@userId>` mention into
`content` rather than string-prefixing the message. `clientSender` passes the
payload through to `channel.send` / `user.send`. The notify fakes in
`tests/harness.ts` widen to match.

Handlers gain art: expedition-return sends the site banner, egg-hatch sends the
rarity egg.

### Replies promoted from content-only to embeds

`park:collect`, `/rescue`, `/incubate`, `/shop food` confirmation, and the
`/sell` confirmation prompt each become an embed with an image where they were
one line of text.

### Battles frame contract

Today every file uploads on F1 and F2–F4 re-reference by `attachment://` URL.
A file that the current embed does not reference renders as a bare attachment
card under the message, so a third file cannot simply be added to F1.

`runFight` is commit-before-present, so `outcome.won` is already known when
`fightFrames` builds its frames. F4 therefore re-attaches exactly
`[outcome banner, boss portrait]` and sets image to the outcome banner and
thumbnail to the portrait, dropping the chapter banner it no longer references.
Frames 1–3 are unchanged.

The invariant recorded in `CLAUDE.md` changes from "files attach on frame 1
only" to "files attach on frame 1 and frame 4, and each attaching frame uploads
exactly the files it references".

### Plumbing

`assetImage`'s `kind` union gains `'hatch'` only. Park art is **not** routed
through `assetImage` — that function returns Discord `AttachmentBuilder`s for
embeds, whereas park art is decoded into canvas `Image`s by `art.ts` and never
leaves the renderer.

`docs/assets/prompts.md` gains a section per generated asset.

## Testing

Existing tests stay green except for deliberate churn: journey tests asserting
content-only strings for `park:collect`, `/rescue`, `/incubate`, `/shop food`
and `/sell` move to embed assertions. Those updates are the regression pins for
the promotion work.

New coverage:

- `tests/render-draw.test.ts` — an all-null `ParkArt` produces output identical
  to today's (pins the fallback path), and a stub-art case proves `drawImage`
  replaces the glyph run. Stubs are tiny **SVG** buffers, which decode
  synchronously and so need no `await` inside a synchronous render test.
- `art.ts` — a missing file yields `null` and does not throw.
- `notify.ts` — the fake sender receives `{ embeds, files }`, the mention is
  merged into `content`, and the channel-then-DM fallback still works in both
  directions.
- `battles/embeds.ts` — a frame-contract test walking all four frames: every
  `attachment://` URL a frame references was uploaded by that frame or by F1,
  and no frame uploads a file it does not reference. This is the bug class with
  no offline coverage today.
- Emoji assets — the 6 new dino chips run through the existing
  `tests/emoji-assets.test.ts` guards, including `MAX_BLACK_SHARE`.

Gates before merge: `npm run typecheck` (tests and scripts are not typechecked
by `npm run build`), `npm run test`, and `npm run test:live` to review the
payload gallery. The live gallery is the only real check on any image work.

## Risks

1. **Style drift** across 20 images produced in five separate sittings.
   Mitigated by the shared style block plus reference chaining — defeat off
   victory, cracks off their own eggs, plates off the ground texture.
2. **Text legibility on textured plates.** The plate prompts specify a calm,
   untextured center band; tile text colors are unchanged; verified in the live
   gallery, not asserted offline.
3. **Emoji black-share guard.** `tests/emoji-assets.test.ts` rejects any PNG
   whose opaque pixels are more than 2% pure `#000000`. Six dinosaur silhouette
   chips are exactly the shape that trips it — author their outlines in dark
   brown (`#2b1d10`), never pure black. Raise `MAX_BLACK_SHARE` only as a
   deliberate, separately justified decision.
4. **Bare-attachment regressions are invisible offline.** `npm run test:live`
   before merge is mandatory.
5. **Worker boot cost.** Decoding three PNGs at worker startup delays the first
   render only; renders are already serialized through a single worker.

## Sequencing

Four waves, each independently shippable and green:

1. **Rewires and notify** — no generation. Existing art into `/help topic:`,
   `/incubate`, `/shop food`, `/expedition claim`, `/battle chapters` and
   `/trade *`, plus the `Sender` widening.
2. **Boss portraits** — 4 images against prompts that already exist. A data-only
   drop; no code change.
3. **Park Direction A** — 3 rasters, 6 new dino-chip SVGs, `art.ts`, the worker
   preload, and the `draw.ts` swap (which also picks up the 5 existing lot
   SVGs).
4. **New banners** — hatch cracks (6), victory/defeat (2), collect and rescue
   (2), the roster trio (3), and the embed promotions that carry them.

## Operator steps

- `npm run build-emojis` then `npm run deploy-emojis` after wave 3, for the new
  icons.
- `npm run deploy-commands` is **not** required in any wave — no command builder
  changes.
- `npm run test:live` needs `TEST_CHANNEL_ID` set; it is REST-only and safe to
  run while the bot is live.
