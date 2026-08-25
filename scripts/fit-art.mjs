// Post-processing for generated art (see docs/assets/prompts.md).
//   node scripts/fit-art.mjs banner   <src> <dest>            -> 1536x1024, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs ground   <src> <dest>            -> 1200x800, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs band     <src> <dest>            -> 270x150, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs cutout   <src> <dest>            -> 1024x1024 transparent, defringed and centered
//                                                                 at a 31px margin, every opaque region kept, WebP q95
//   node scripts/fit-art.mjs portrait [--axis=egg] <src> <dest> -> 1024x1024 transparent, largest-region-only,
//                                                                 border-flooded and shaved, fitted at a 24px
//                                                                 margin, WebP q95
//
// `cutout` is the processor for the hatch cracks and for any future cutout family. It
// deliberately keeps every opaque region, not just the largest — the cracks' falling
// shell fragments are disconnected on purpose.
//
// `portrait` implements the one-off pass that produced assets/images/eggs/ and
// assets/images/battles/: single silhouette only, a tighter 24px margin, a border
// flood pass and a 2px shave. `--axis=egg` re-centres on the egg's own axis (top ~45%
// of the silhouette) instead of the whole bbox, matching the committed eggs — it is
// inert for every other mode. `cutout` and `portrait` are NOT interchangeable: running
// `portrait` on a hatch crack would silently delete its disconnected shell fragments.
// prompts.md records the divergence and the numbers.
//
// The pure geometry/pixel helpers (COVER, Q, coverGeometry, alphaThreshold,
// luminancePeel, opaqueBBox, largestRegion, borderFlood, shave, eggAxisBBox, fitDraw,
// FIT_31, FIT_24) live in scripts/lib/art-pipeline.mjs so they can be tested — this
// file stays a thin CLI wrapper around them.
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, Image } from '@napi-rs/canvas';
import {
  COVER, Q, coverGeometry, alphaThreshold, luminancePeel, opaqueBBox, stripCaBX,
  largestRegion, borderFlood, shave, eggAxisBBox, fitDraw, FIT_31, FIT_24,
} from './lib/art-pipeline.mjs';

const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const [mode, src, dest] = argv;
const CUTOUTS = new Set(['cutout', 'portrait']);
if (!(CUTOUTS.has(mode) || Object.hasOwn(COVER, mode)) || !src || !dest) {
  console.error('usage: node scripts/fit-art.mjs <banner|ground|band|cutout|portrait> [--axis=egg] <src> <dest.webp>');
  process.exit(2);
}
// A misspelled flag (e.g. --axis=eggs) would otherwise be silently ignored: it lands
// unvalidated in `flags`, the egg-axis branch below never matches it, and the run
// exits 0 with a whole-bbox-centred subject instead of the intended egg-axis one.
const KNOWN_FLAGS = new Set(['--axis=egg']);
for (const f of flags) {
  if (!KNOWN_FLAGS.has(f)) { console.error(`unknown flag ${f}`); process.exit(2); }
}

// Freshly generated PNGs can carry a C2PA `caBX` chunk that makes @napi-rs/canvas
// misidentify the file as SVG. stripCaBX removes it; see its comment for the detail.
const img = new Image();
img.src = stripCaBX(readFileSync(src));
await img.decode();

if (Object.hasOwn(COVER, mode)) {
  const [W, H] = COVER[mode];
  const { w, h, dx, dy } = coverGeometry(img.width, img.height, W, H);
  const canvas = createCanvas(W, H);
  canvas.getContext('2d').drawImage(img, dx, dy, w, h);
  writeFileSync(dest, canvas.toBuffer('image/webp', Q));
  console.log(`${mode} ${dest} ${W}x${H} (source ${img.width}x${img.height})`);
  process.exit(0);
}

// cutout/portrait both run AFTER remove_background. The studio backdrop is light
// gray, so the matte leaves a light rim where the art's dark outline should be — peel
// it. portrait then narrows to a single silhouette (largestRegion), strips border
// matte a border-following flood can reach (borderFlood) and shaves 2px of residual
// edge (shave) — cutout does none of that, which is what lets the hatch cracks' loose
// shell fragments survive.
const w = img.width, h = img.height;
const work = createCanvas(w, h);
const wctx = work.getContext('2d');
wctx.drawImage(img, 0, 0);
const data = wctx.getImageData(0, 0, w, h);
const px = data.data;
alphaThreshold(px);
luminancePeel(px, w, h);

// portrait implements the one-off pass that produced assets/images/eggs/ and
// assets/images/battles/: single silhouette, 24px margin. cutout keeps every opaque
// region at 31px, which is what the hatch cracks need. The two are NOT interchangeable
// — running portrait on a crack silently deletes its falling shell fragments.
//
// Order deviates from prompts.md's documented one-off pass, which runs the
// largest-region step BEFORE the luminance peel: here alphaThreshold + luminancePeel
// run first (shared with cutout, above), then largestRegion + borderFlood + shave.
// Verified byte-identical (buffer-for-buffer) to the documented order on all four
// committed egg/battle portrait files it was checked against, so it is inert today.
// It is unverified on raw generated art, though: a peel that severs a thin bridge
// before largestRegion runs would delete real subject matter as a "spurious" second
// region, rather than an actual spurious island being peeled first and never
// reaching largestRegion at all.
if (mode === 'portrait') {
  largestRegion(px, w, h);
  borderFlood(px, w, h);
  shave(px, w, h, 2);
}
wctx.putImageData(data, 0, 0);

const box = opaqueBBox(px, w, h);
if (!box) { console.error(`${mode}: image is fully transparent`); process.exit(1); }
// --axis=egg re-centres on the egg's own axis (top ~45% of the silhouette) instead of
// the whole bbox, so asymmetric nest dressing along the bottom doesn't push the egg
// off-centre. Inert for cutout and the cover modes — only portrait reaches this branch.
const fitBox = (mode === 'portrait' && flags.has('--axis=egg'))
  ? eggAxisBBox(px, w, h, box) : box;
const FIT = mode === 'portrait' ? FIT_24 : FIT_31;

const S = 1024;
const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
// Centre the FIT box, then draw the whole opaque box at the same scale around it.
const { scale, cx, cy } = fitDraw(box, fitBox, FIT, S);
// --axis=egg's stated purpose is to shift the egg WITHOUT cropping the nest, so a
// fitBox narrower than the whole box can drive the whole box's drawn rect off the
// canvas — verified with a synthetic 300px egg centred in a 900px nest (scale 1.22,
// cx -37.00, 37px clipped on each side). There is no legitimate case to let through.
const R = cx + bw * scale, B = cy + bh * scale;
if (cx < -0.5 || cy < -0.5 || R > S + 0.5 || B > S + 0.5) {
  console.error(`${mode}: subject does not fit — drawn rect x:[${cx.toFixed(1)},${R.toFixed(1)}] y:[${cy.toFixed(1)},${B.toFixed(1)}] on a ${S}px canvas`);
  process.exit(1);
}
const out = createCanvas(S, S);
out.getContext('2d').drawImage(work, box.x0, box.y0, bw, bh, cx, cy, bw * scale, bh * scale);
writeFileSync(dest, out.toBuffer('image/webp', Q));
console.log(`${mode} ${dest} ${S}x${S} (opaque bbox ${bw}x${bh})`);
