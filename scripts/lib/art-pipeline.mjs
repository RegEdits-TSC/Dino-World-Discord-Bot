// Pure helpers for scripts/fit-art.mjs. Extracted so they can be tested — the CLI
// itself is a top-level-await script and cannot be imported.
// Keep scripts/lib/art-pipeline.d.mts in sync with every exported signature here.

// q95 is the committed setting for every asset under assets/images — the pass that
// introduced WebP took the 40 files committed at the time from 63.4 MB to 8.9 MB
// (~86% smaller), visually indistinguishable at the sizes Discord renders. Keep in
// sync with prompts.md.
export const Q = 95;

// The cover-scaled modes. `banner` and `ground` are both 3:2 and differ only in
// pixel size, because the park renderer's ground is cover-scaled onto a canvas
// that is at most 752px tall (gridDims in src/core/render/draw.ts: height =
// 88 + 166*rows, and rows maxes out at 4 — lotSlots caps at 10 in
// src/data/progression.ts, over a 3-wide grid), so 1536x1024 would ship ~64%
// more bytes than the renderer can ever use. 1200x800 is what the committed
// park/ground.webp already is; the season variants must match it exactly or
// they crop differently from each other at the same row count.
//
// `band` is 270x150 — TILE_W x TILE_H in src/core/render/draw.ts — and 1.8:1, an
// aspect ratio no generator offers, so the source is generated at 16:9 and
// cropped down. Committing at exactly the tile size is what the mode is for:
// drawTile and drawLandmark call drawImage(img, x, y, TILE_W, TILE_H) with an
// explicit destination size, so an off-size raster is silently squashed to fit
// and never throws — a 1024-square source ships stretched from 1.0 to 1.8 and
// still renders "successfully". Every 270x150 asset committed before this mode
// existed (the two plates, the three landmark bands) was fitted by a separate
// one-off pass; the plates additionally cropped to the plate object's own
// bounding box FIRST, which this mode does not do — see docs/assets/prompts.md.
export const COVER = { banner: [1536, 1024], ground: [1200, 800], band: [270, 150] };

// Cover, not contain: scale so the image covers BOTH axes, then centre the overflow.
export function coverGeometry(srcW, srcH, W, H) {
  const scale = Math.max(W / srcW, H / srcH);
  const w = Math.round(srcW * scale), h = Math.round(srcH * scale);
  return { w, h, dx: Math.round((W - w) / 2), dy: Math.round((H - h) / 2) };
}

export function alphaThreshold(px, cutoff = 32) {
  for (let i = 3; i < px.length; i += 4) if (px[i] < cutoff) px[i] = 0;
}

// The studio backdrop is light gray, so the matte leaves a light rim where the art's
// dark outline should be — peel it, repeatedly, until nothing more qualifies.
export function luminancePeel(px, w, h, passes = 3) {
  const at = (x, y) => (y * w + x) * 4;
  for (let pass = 0; pass < passes; pass++) {
    const doomed = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = at(x, y);
        if (px[i + 3] === 0) continue;
        const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
          || px[at(x - 1, y) + 3] === 0 || px[at(x + 1, y) + 3] === 0
          || px[at(x, y - 1) + 3] === 0 || px[at(x, y + 1) + 3] === 0;
        if (!edge) continue;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum > 180 && Math.max(r, g, b) - Math.min(r, g, b) < 40) doomed.push(i + 3);
      }
    }
    if (!doomed.length) break;
    for (const a of doomed) px[a] = 0;
  }
}

export function opaqueBBox(px, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A freshly generated PNG can carry a `caBX` chunk — an ancillary, private,
// safe-to-copy chunk holding a C2PA / Content Credentials (JUMBF) manifest whose
// payload contains the literal text `<svg`. @napi-rs/canvas's format sniffer scans
// the whole buffer for that substring instead of trusting the leading magic bytes,
// concludes the file is SVG, and fails with `Error: Invalid SVG image`
// (code 'InvalidArg') on a file that opens fine in every viewer.
//
// The chunk is pure provenance metadata, is read nowhere in this codebase, and would
// not survive re-encoding to WebP anyway, so removing it is content-neutral.
export function stripCaBX(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return buf;
  const out = [buf.subarray(0, 8)];
  let stripped = false;
  for (let p = 8; p + 8 <= buf.length; ) {
    const end = p + 12 + buf.readUInt32BE(p);
    if (end > buf.length || end <= p) break;   // malformed length: stop, don't overrun
    if (buf.toString('latin1', p + 4, p + 8) === 'caBX') stripped = true;
    else out.push(buf.subarray(p, end));
    p = end;
  }
  return stripped ? Buffer.concat(out) : buf;
}
