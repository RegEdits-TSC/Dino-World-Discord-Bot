# Visual assets + QoL round — design

Date: 2026-07-22
Status: approved

## Goal

Make the game look unique with generated art (egg icons, expedition site art)
and clear the highest-pain quality-of-life gaps across the 18 commands.

## Locked decisions

- Asset scope this round: eggs (existing) + expedition site art (generated).
  Dino portraits (30), park-renderer sprites, badges: deferred.
- Art style: glossy cartoon mobile-game ("sticker") style matching the
  existing egg set — bold dark outlines, saturated fills, glossy highlights.
- Egg placement: full-width hero image on the `/hatch` pre-crack embed;
  thumbnail everywhere else.
- Site placement: full-width banner on `/expedition claim`; square thumbnail
  on `start` and `status`.
- Delivery: local files under `assets/images/`, sent per-reply via
  `AttachmentBuilder` + `attachment://` references (same pattern as the park
  PNG). No CDN, no external hosting.
- QoL scope: all 8 items listed below.

## Assets

```
assets/images/eggs/{common,uncommon,rare,epic,legendary,mythic}.png  (exist, 275×275, transparent)
assets/images/sites/<site_id>-banner.png   (4, 1536×1024, generated)
assets/images/sites/<site_id>-thumb.png    (4, 1024×1024, generated)
```

Site ids: `coastal_dig`, `amber_ridge`, `frozen_cliffs`, `volcano_core`.

Generation prompts live in `docs/assets/prompts.md` (shared style block + 8
per-image prompts). That file is the source of truth for regenerating or
extending the set. Workflow: generate the Volcano Core banner first as a
style test, compare against the eggs, adjust the shared style block if
needed, then batch the remaining 7 images.

Rarity color anchors (embed color bar must keep matching egg art):
common `#95a5a6`, uncommon `#2ecc71`, rare `#3498db`, epic `#9b59b6`,
legendary `#f1c40f`, mythic `#e74c3c` (`RARITY_COLOR` in
`src/modules/hatchery/embeds.ts`).

## Component 1 — image helper

`src/core/images.ts`: `assetImage(kind, name)` resolves a file under
`assets/images/`, returning `{ attachment, url }` (`AttachmentBuilder` plus
the `attachment://<file>` string) or `null` when the file is absent.

- File existence is scanned once at startup and cached — no fs hit per
  command.
- Every call site treats `null` as "render the embed without the image".
  The bot must work with zero, some, or all assets present; a missing file
  never crashes or logs per-interaction errors.

## Component 2 — embed wiring

Hatchery:
- `preHatchEmbed` gains the hero egg image (`.setImage`) + attachment.
- `/eggs` list embed gains a thumbnail for the egg the player most likely
  acts on next, by priority: ready-to-hatch, else currently incubating,
  else newest acquired.

Shop:
- `/shop view` embed gains a thumbnail of today's rotation egg rarity.
- `/shop egg` purchase reply upgrades from plain text to a small
  rarity-colored embed with egg thumbnail.

Expeditions:
- `start` + `status` embeds gain the site square thumb (`.setThumbnail`).
- `claim` embed gains the site banner (`.setImage`).

Plain-text replies elsewhere stay plain text. Park renderer untouched this
round.

## Component 3 — QoL items

1. **`/help`** — new module (touches all 5 registration sites). One command:
   `/help [topic]`; `topic` is a static choice list (getting-started, park,
   eggs, expeditions, shop, care, trading, ranks). Without a topic: overview
   embed with a command map and a "first 10 minutes" walkthrough.
2. **Escape countdown** — `/dino list` shows per-dino "⚠ escapes in Xh Ym"
   derived from the clock's `comfortCrossing`/`rawEscape` instants;
   `/park view` header shows "⚠ N dinos at risk" when any dino is near
   escape.
3. **Trade pings** — `/trade offer` notifies the recipient; `accept`/
   `decline` notify the offerer. Uses the existing channel→DM fallback in
   `src/core/notify.ts`.
4. **Pagination** — prev/next buttons on `/dino list`, `/eggs`,
   `/trade list`; 10 rows per page; stateless `customId` carries the page
   number and the handler re-queries on click (no session state, no cache).
5. **`/mythic` confirm** — confirm button (same pattern as `/sell`) before
   spending 500 shards.
6. **Next-step hints** — hatch reveal footer points to `/dino assign`;
   `/build` success for a paddock hints assigning a dino.
7. **Cap warning** — park embed Collect field shows "⛔ income capped" once
   pending income reaches the cap.
8. **`/top` your-rank** — footer with the caller's rank + value when they are
   outside the listed rows.

## Testing

Extends the existing vitest suite (228 tests):

- images helper: missing file → `null` → embed renders without image;
  present file → attachment with matching `attachment://` url.
- Pagination: empty list, exactly 10 rows, 11 rows (2 pages), last-page
  button disabled state.
- Escape countdown: time formatting, at-risk threshold, no warning when
  nothing at risk.
- Trade notifications: offer/accept/decline each notify the correct user.
- `/mythic` confirm: no shard spend before the confirm click.
- Cap warning appears only at `pending == cap`.
- `/top` rank row: caller inside vs outside top N.
- `/help`: every topic renders.
- Registry tests: command count 18 → 19; module list and `modules.json`
  gain `help`.

## Docs and deploy

- README: command table gains `/help`; note new visuals.
- Repo `CLAUDE.md`: one line for the image-fallback rule (missing asset =
  silent skip, never crash).
- New `/help` builder requires `npm run deploy-commands` after merge;
  exactly one bot instance per token as always.

## Out of scope (this round)

Dino portraits, park-renderer sprite swap, badges/achievements, battles,
per-user notification settings, `/admin` embellishments, render cache.
