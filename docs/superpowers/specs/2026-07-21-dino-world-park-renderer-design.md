# Dino World — Park-Map Renderer (Plan 5) Design

**Status:** Approved 2026-07-21. Builds on Plans 1–4 (merged to `main`; 8 modules, 17 commands).

**Scope note:** The roadmap bundled "renderer + admin" as Plan 5. They are independent subsystems (read-only visualization vs. owner-gated mutation) sharing no data flow, so they are split. **This spec is the renderer only.** Admin tooling becomes a later plan (Plan 6) with its own spec.

## Goal

Attach a rendered PNG "park map" image to `/park view` (self and `user:@other`), giving the text dashboard a Zoo-Tycoon-style visual. The map is a top-down grid of lot tiles ("Zoo Grid" style, chosen during brainstorming).

## Architecture

```
/park view  ──▶ buildParkSnapshot(ctx, userId)      (main thread, read-only; settleEscapes first)
            ──▶ renderPark(snapshot)  ──postMessage──▶ render worker (@napi-rs/canvas, Skia)
            ◀── PNG Buffer  |  timeout/error ◀──────────
            ──▶ embed.setImage('attachment://park.png') + files:[png]     (png ok)
            ──▶ embed only (today's behavior), no image                   (png failed)
```

**Hard constraint (from `dino-world-roadmap.md`):** better-sqlite3 is synchronous and not thread-safe. The render worker **never receives or touches the DB handle**. The main thread serializes a plain `ParkSnapshot` (no DB objects, no functions) and posts it; the worker returns only a PNG `Buffer`.

**Worker model:** one long-lived worker, lazily spawned on first render, reused across calls, with a FIFO request queue. Each render has a **timeout (~3s)**; on timeout or worker error the wrapper rejects and the caller falls back to the text-only embed. `/park view` must never fail because rendering failed.

**No caching:** render fresh each call. Parks mutate on many actions (feed, build, trade, collect, escape); a stale cached image would mislead. A tile grid is cheap to draw, and the worker is reused, so per-call cost is acceptable. (If load ever justifies it, a short-TTL cache keyed on a park "version" counter is the future hardening — not built now.)

## Components (files)

- **`src/core/render/draw.ts`** — pure `renderParkPng(snapshot: ParkSnapshot): Buffer`. All canvas drawing lives here; imports `@napi-rs/canvas`. Pure and synchronous → importable directly in tests without spawning a Worker. Registers the bundled fonts (idempotent) on first call.
- **`src/core/render/worker.ts`** — worker-thread entry. Receives `{ snapshot }` on the message port, calls `renderParkPng`, posts back `{ png }` or `{ error }`.
- **`src/core/render/client.ts`** — main-thread wrapper. Lazy-spawns the worker, maintains the request queue, applies the per-render timeout, exposes `renderPark(snapshot: ParkSnapshot): Promise<Buffer>`. Rejects on timeout/worker error.
- **`src/modules/park/snapshot.ts`** — `buildParkSnapshot(ctx, userId: string): ParkSnapshot`. Calls `settleEscapes(ctx, userId)` (read-only lazy pattern), reads the user row + lots + dinos, groups dinos by `lotId`, computes totals and escaped count. Returns a plain serializable object.
- **`src/data/render-icons.ts`** — static maps: lot `kind` → icon emoji + tile palette (paddock tan / facility blue), rarity → accent color. Small pure data module.
- **`assets/fonts/`** — **Noto Sans** (UI text, deterministic across OS) + **Noto Color Emoji** (emoji glyphs), both SIL OFL — redistributable, committed to the repo. Loaded via `@napi-rs/canvas` `GlobalFonts.registerFromPath` in `draw.ts`.
- **Modify `src/modules/park/index.ts`** — the `/park view` handler (both self and `user:@other` read-only paths) builds the snapshot, `await renderPark(...)` inside a try/catch, and on success sets the embed image + attaches the file; on failure replies with the embed alone.

### `ParkSnapshot` shape (serializable)

```
ParkSnapshot = {
  parkName: string;
  cash: number;
  parkRating: number;          // ×100 as stored; formatted /100 in draw
  dinoCount: number;
  escapedCount: number;
  lotCap: number;              // for the trailing "+ /build" hint
  lots: Array<{
    id: number;
    type: 'paddock' | 'facility';
    kind: string;
    name: string;
    level: number;
    decorCount: number;
    dinos: Array<{ speciesId: string; rarity: string; escaped: boolean }>;
  }>;
}
```

## What the map draws (Zoo Grid)

- **Header bar:** `🏞️ {parkName} · ⭐ {rating} · 💰 {cash} · 🦕 {dinoCount}` (with escaped count if any).
- **Body:** a 3-column grid of lot tiles. Paddocks tan, facilities blue, rounded rectangles. Each tile shows: the kind icon, the lot name, `Lv{level}`, the assigned dinos as rarity-colored emoji glyphs, a `🚨` badge if any assigned dino has escaped, and decor as small dots (count only, not art). A trailing dashed "+ /build" slot appears when the lot count is under the user's cap.
- Canvas width fixed (e.g. ~900px); height grows with the number of tile rows.

## Error handling & reliability

- `renderPark` rejects on timeout or worker error; the `/park view` handler catches and degrades to the existing text embed. No user-visible failure.
- The worker is isolated: a render crash rejects the in-flight request and the worker is respawned lazily on the next call; it cannot take down the bot process.
- `buildParkSnapshot` validates nothing external (all inputs are internal DB rows past the command boundary) but must produce a fully plain object — no Drizzle row proxies, Dates, or functions cross the thread boundary.

## Testing

- **`buildParkSnapshot`** (unit): escapes are settled before reading; escaped dinos carry `escaped: true`; dinos grouped under the correct `lotId`; counts (`dinoCount`, `escapedCount`) correct; output is plain/serializable.
- **Grid geometry** (unit): row/column count and tile positions for N lots (e.g. 0, 1, 5, 8 lots) — pure math, no rasterization.
- **Render smoke** (unit): `renderParkPng(sampleSnapshot)` returns a non-empty `Buffer` beginning with the PNG magic bytes `89 50 4E 47`. Exercises the real canvas path in-process (no Worker).
- **Fallback** (unit): a `renderPark` that rejects (timeout/error) leaves the `/park view` handler replying with the embed and no attachment (no throw).

## Dependencies

- Add **`@napi-rs/canvas`** — pinned to the current latest stable release at plan-writing time (native, prebuilt binaries, no VPS system libraries, worker-thread safe, Skia color-emoji support).
- Bundle font assets (Noto Sans + Noto Color Emoji, both SIL OFL) under `assets/fonts/`. No runtime download.

## Non-goals (deferred)

Isometric/3D map, animation, decoration artwork (dots only), image caching, per-guild themes/branding, admin tooling (separate plan).
