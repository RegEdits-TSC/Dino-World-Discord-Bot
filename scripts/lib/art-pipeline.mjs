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

// 0.94 of 1024 = 962px on the tight axis, i.e. a 31px margin — what the six committed
// hatch cracks and the dino cutouts were fitted at. 0.953125 = 976px, a 24px margin —
// what the eggs and boss portraits sit at. Do NOT unify these without re-fitting the
// committed families, which means regenerating shipped art.
export const FIT_31 = 0.94;
export const FIT_24 = 0.953125;

// 4-connected labelling. Keeps the largest opaque region and clears every other.
// Must NEVER be run on the hatch cracks: their falling shell fragments are
// disconnected on purpose and tests/images.test.ts:321-354 asserts they survive.
export function largestRegion(px, w, h) {
  const seen = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0;
  for (let s = 0; s < w * h; s++) {
    if (px[s * 4 + 3] === 0 || seen[s] !== -1) continue;
    const stack = [s];
    seen[s] = s;
    let size = 0;
    while (stack.length) {
      const p = stack.pop();
      size++;
      const x = p % w, y = (p - x) / w;
      const nbr = [];
      if (x > 0) nbr.push(p - 1);
      if (x < w - 1) nbr.push(p + 1);
      if (y > 0) nbr.push(p - w);
      if (y < h - 1) nbr.push(p + w);
      for (const n of nbr) {
        if (px[n * 4 + 3] === 0 || seen[n] !== -1) continue;
        seen[n] = s;
        stack.push(n);
      }
    }
    if (size > bestSize) { bestSize = size; best = s; }
  }
  if (best === -1) return;
  for (let p = 0; p < w * h; p++) if (seen[p] !== best) px[p * 4 + 3] = 0;
}

// Flood inward from the border through transparent and desaturated-light pixels to
// strip near-white matte residue clinging to the outer silhouette. Saturated art
// blocks the flood, so interior highlights walled off by dark outlines survive.
export function borderFlood(px, w, h) {
  const light = (p) => {
    const r = px[p * 4], g = px[p * 4 + 1], b = px[p * 4 + 2];
    return 0.299 * r + 0.587 * g + 0.114 * b > 180
      && Math.max(r, g, b) - Math.min(r, g, b) < 40;
  };
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (p) => { if (!seen[p]) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (px[p * 4 + 3] !== 0) {
      if (!light(p)) continue;      // saturated or dark art blocks the flood
      px[p * 4 + 3] = 0;
    }
    const x = p % w, y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
}

// Remove n rings of boundary pixels. Each ring is computed against the previous
// state, so the passes do not cascade within one ring.
export function shave(px, w, h, n = 2) {
  const at = (x, y) => (y * w + x) * 4;
  for (let pass = 0; pass < n; pass++) {
    const doomed = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (px[at(x, y) + 3] === 0) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1
          || px[at(x - 1, y) + 3] === 0 || px[at(x + 1, y) + 3] === 0
          || px[at(x, y - 1) + 3] === 0 || px[at(x, y + 1) + 3] === 0) doomed.push(at(x, y) + 3);
      }
    }
    if (!doomed.length) return;
    for (const a of doomed) px[a] = 0;
  }
}

// Re-measure the horizontal extent using only the top 45% of the silhouette, so
// asymmetric nest dressing does not push the egg off-centre. Vertical extent is
// unchanged — only the centring axis is biased.
export function eggAxisBBox(px, w, h, box) {
  const cut = box.y0 + Math.round((box.y1 - box.y0 + 1) * 0.45);
  let x0 = w, x1 = -1;
  for (let y = box.y0; y < cut; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  }
  return x1 < 0 ? box : { x0, y0: box.y0, x1, y1: box.y1 };
}

// The shared centring/scale arithmetic for cutout and portrait. fitBox drives the
// scale AND is what gets centred; box is the whole opaque source rectangle, drawn at
// that same scale, so an off-centre fitBox (the egg axis) shifts the subject without
// cropping anything box contains — for cutout and the whole-bbox portrait variant,
// fitBox === box and cx/cy reduce to the plain whole-bbox centring. bw/bh are not
// returned: the caller already needs them (derived from box) for the drawImage call
// itself, and for checking whether the drawn rect still fits the S x S canvas — a
// narrow fitBox inside a much wider box can drive that rect off-canvas, which this
// function does not itself guard against.
export function fitDraw(box, fitBox, FIT, S) {
  const fw = fitBox.x1 - fitBox.x0 + 1, fh = fitBox.y1 - fitBox.y0 + 1;
  const scale = Math.min((S * FIT) / fw, (S * FIT) / fh);
  const cx = (S - fw * scale) / 2 - (fitBox.x0 - box.x0) * scale;
  const cy = (S - fh * scale) / 2 - (fitBox.y0 - box.y0) * scale;
  return { scale, cx, cy };
}
