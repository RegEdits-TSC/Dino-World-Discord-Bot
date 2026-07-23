# Emoji & Currency Assets — Design

Date: 2026-07-23
Status: Approved

## Goal

Replace unicode placeholder glyphs (💰🍖💎⭐ etc.) with a bot-owned custom
icon set, and give the remaining art-less surfaces (trading, leaderboards,
help, care) painterly banner art matching the existing site banners.

## Scope

**In:**
- 21 custom Discord application emojis (SVG-authored, glossy game-icon style)
- 5 embed banners (AI-generated, painterly, matching site-banner style)
- Park-map HUD: cash PNG icon replacing the 💰 glyph in `draw.ts`
- Build/deploy/runtime pipeline for app emojis with unicode fallback

**Out (explicitly deferred):**
- 30 dino sprites (`spriteRef` remains dead data)
- Egg mini-emojis
- Park-map canvas lot-tile icons or textured tile art (HUD-only decision)
- Any new slash commands or modules (no registration-checklist impact)

## Art direction

Decided via visual companion session (browser mockups, three rounds):

- **Style: glossy chunky game icon** — vertical gradient fill, dark outline
  (~3px at 64 viewBox), white sheen highlight. Middle ground between the
  painterly embed art and flat vector; holds a silhouette at 16–18px.
- **Rarity gems: same diamond cut + escalating flair** — one shape, six
  `RARITY_COLOR` fills; epic adds sparkles, legendary a glow ring, mythic a
  double aura. Color-first with top-tier pop.
- **Currency motifs: Fossil set** — footprint-imprint gold coin (cash),
  meat-on-bone (food), cyan DNA-helix crystal (shards). Shard color
  deliberately avoids all six rarity-gem colors.

Banners are unaffected by the emoji style choice: they stay in the existing
painterly site-art style (same pipeline as `assets/images/sites/`).

## Asset inventory

### Application emojis (21) — names use `dw_` prefix

| Name | Motif | Used in |
|---|---|---|
| `dw_cash` | Gold coin, footprint imprint | park, shop, trading, admin, expeditions, leaderboards |
| `dw_food` | Meat-on-bone | admin, expeditions, care |
| `dw_shard` | Cyan DNA-helix crystal | admin, shop, trading |
| `dw_rarity_common` … `dw_rarity_mythic` (6) | Diamond gem, RARITY_COLOR fills, escalating flair | hatchery, shop, trading, rosters |
| `dw_star` | Glossy gold star | leaderboards rating |
| `dw_alert` | Red warning triangle | escape warnings (`notify.ts`) |
| `dw_hunger` | Desaturated meat-on-bone + red `!` badge | care hunger displays |
| `dw_site_volcano_core` | Lava cone | expeditions site lists |
| `dw_site_coastal_dig` | Spiral shell | expeditions site lists |
| `dw_site_amber_ridge` | Amber drop | expeditions site lists |
| `dw_site_frozen_cliffs` | Ice peak | expeditions site lists |
| `dw_lot_carnivore` | Claw slash | park embeds (text side) |
| `dw_lot_herbivore` | Fern frond | park embeds (text side) |
| `dw_lot_food_court` | Burger | park embeds (text side) |
| `dw_lot_hatchery` | Egg | park embeds (text side) |
| `dw_lot_visitor` | Columned building | park embeds (text side) |

### Banners (5) — `assets/images/banners/`, 1536×1024

| File | Scene | Surface |
|---|---|---|
| `trading.png` | Market-stall scene, two dinos exchanging goods | trade offer/confirm embeds |
| `leaderboards.png` | Podium/trophy scene | rankings embed |
| `help.png` | Park gates welcome scene | `/help` walkthrough |
| `care.png` | Feeding scene | care status embed |
| `care_neglect.png` | Hungry dino variant | care embed when dino hungry/neglected |

### HUD

`assets/images/hud/cash.png` — 64×64 render of the `dw_cash` SVG, drawn
by `src/core/render/draw.ts` in the stats bar (at the existing HUD icon
size) instead of the 💰 text glyph.

## Production pipeline

### Icons: hand-authored SVG → PNG

```
assets/emojis/svg/dw_cash.svg …   ← 21 hand-authored SVG sources
assets/emojis/png/dw_cash.png …   ← 128×128 rendered output, committed
assets/images/hud/cash.png        ← HUD-size render
```

- `src/build-emojis.ts` (`npm run build-emojis`): renders every SVG in
  `assets/emojis/svg/` to a 128×128 transparent PNG via `@napi-rs/canvas`
  (existing dependency — no new packages). Deterministic: same SVG, same PNG.
- SVGs are the source of truth; PNGs are committed so deploy needs no build
  step. Iteration = edit SVG text, re-render, re-deploy.

### Banners: AI-generated

Same pipeline as site banners (Nano Banana Pro, painterly style match,
1536×1024). Generation prompts recorded in `docs/assets/prompts.md`.

## Emoji deploy & runtime

### Deploy: `src/deploy-emojis.ts` (`npm run deploy-emojis`)

Syncs `assets/emojis/png/` to Discord **application emojis** (bot-owned,
usable in every guild the bot posts in, 2000-slot cap — 21 used, no
server emoji slots consumed). Sync by name:

- missing on Discord → create
- PNG changed → delete + recreate (accepts new emoji ID; runtime fetches
  IDs at startup so nothing is hardcoded)
- on Discord but not in `png/` → report as orphan (manual delete decision)

Mirrors the `deploy-commands` script pattern.

### Runtime: `src/core/emojis.ts`

- On client ready: `client.application.emojis.fetch()` → module-level map
  `name → '<:name:id>'`.
- `emojiTag(name)`: returns the custom emoji tag, or the unicode fallback
  from a built-in table when the map has no entry. The table covers all 21
  names: currency/status/sites/lots map to their current unicode glyphs
  (`dw_cash` → 💰, `dw_food` → 🍖, `dw_shard` → 💎, `dw_star` → ⭐,
  `dw_lot_food_court` → 🍔, …); the six rarity gems fall back to the empty
  string, since rarity is always also conveyed by text. Missing emoji is
  never an error — same null-degrade philosophy as `assetImage`.
- Button helper for `ButtonBuilder.setEmoji` (custom emoji ID object, or
  unicode fallback).
- Pre-fetch window (first moments after login) serves unicode fallbacks —
  acceptable degrade.
- Tests inject the map via an exported setter; no Discord calls in tests.

### Constraint

Autocomplete choice labels cannot render custom emojis (Discord
limitation) — autocomplete text keeps unicode/plain text. Embeds, fields,
message content, and buttons all switch to `emojiTag`.

## Integration points

| Site | Change |
|---|---|
| `trading/index.ts` | 💰 in offer summaries → `emojiTag`; trade embeds get `trading.png` banner |
| `shop/index.ts` | sell button + sale message → `emojiTag`; listings get rarity gems |
| `park/embeds.ts`, `park/index.ts` | cash field, collect button/reply → `emojiTag` |
| `admin/index.ts` | 💰/🍖/💎 resource field → `emojiTag` |
| `expeditions/index.ts` | loot fields → `emojiTag`; site lists get `dw_site_*` |
| `leaderboards/index.ts` | ⭐ → `dw_star`, 💰 → `dw_cash`; 🦕 collection metric stays unicode (no dino emoji; sprites deferred) |
| care module | hunger displays get `dw_hunger`; care embeds get `care.png` / `care_neglect.png` |
| `notify.ts` | escape alerts get `dw_alert` |
| hatchery/shop/trading rosters | rarity gems prefix rarity text |
| park embeds (text side) | lot lines get `dw_lot_*`; canvas map tiles keep emoji glyphs |
| `render/draw.ts` | HUD 💰 glyph → draw `hud/cash.png` |
| `core/images.ts` | `assetImage` gains kind `'banners'` |

## Testing

- **Asset tests** (extend existing image tests): every SVG in
  `assets/emojis/svg/` has a PNG sibling; PNGs are 128×128 with an alpha
  channel and non-empty content; 5 banners + HUD PNG exist with correct
  dimensions.
- **`core/emojis.ts` unit tests**: unknown name → unicode fallback; map
  loaded → custom tag; button-emoji variant shape correct.
- **Existing embed tests**: run without an emoji map, so `emojiTag` falls
  back to unicode and most assertion strings survive unchanged.
- **Deploy script**: not tested against the live API (same stance as
  `deploy-commands`).

## Documentation

- `docs/assets/prompts.md`: 5 banner prompts + a note that emoji icons are
  SVG-authored (not prompt-generated) with the build command.
- Repo `CLAUDE.md`: emoji pipeline convention — app-emoji sync via
  `deploy-emojis`, unicode-fallback rule, autocomplete-labels-stay-unicode.

## Failure handling

- Missing PNG at deploy time: script skips and reports; runtime falls back
  to unicode.
- Emoji fetch fails at startup: log warning, map stays empty, all surfaces
  degrade to unicode — bot fully functional.
- Missing banner file: `assetImage` returns null, embed renders without
  image (existing behavior).
