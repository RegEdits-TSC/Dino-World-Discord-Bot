// Post-processing for generated art (see docs/assets/prompts.md).
//   node scripts/fit-art.mjs banner <src> <dest>   -> 1536x1024, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs ground <src> <dest>   -> 1200x800, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs band   <src> <dest>   -> 270x150, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs cutout <src> <dest>   -> 1024x1024 transparent, defringed and centered, WebP q95
//
// `cutout` is the processor for the hatch cracks and for any future cutout family.
// It is NOT the pass that produced assets/images/eggs/ or assets/images/battles/:
// those predate this script and were fitted by a one-off with a tighter margin and
// (for the eggs) an egg-axis bias. It also deliberately keeps every opaque region,
// not just the largest — the cracks' falling shell fragments are disconnected on
// purpose. prompts.md records the divergence and the numbers.
//
// The pure geometry/pixel helpers (COVER, Q, coverGeometry, alphaThreshold,
// luminancePeel, opaqueBBox) live in scripts/lib/art-pipeline.mjs so they can be
// tested — this file stays a thin CLI wrapper around them.
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, Image } from '@napi-rs/canvas';
import { COVER, Q, coverGeometry, alphaThreshold, luminancePeel, opaqueBBox, stripCaBX }
  from './lib/art-pipeline.mjs';

const [mode, src, dest] = process.argv.slice(2);
if (!(mode === 'cutout' || Object.hasOwn(COVER, mode)) || !src || !dest) {
  console.error('usage: node scripts/fit-art.mjs <banner|ground|band|cutout> <src> <dest.webp>');
  process.exit(2);
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

// cutout runs AFTER remove_background. The studio backdrop is light gray, so the
// matte leaves a light rim where the art's dark outline should be — peel it.
const w = img.width, h = img.height;
const work = createCanvas(w, h);
const wctx = work.getContext('2d');
wctx.drawImage(img, 0, 0);
const data = wctx.getImageData(0, 0, w, h);
const px = data.data;
alphaThreshold(px);
luminancePeel(px, w, h);
wctx.putImageData(data, 0, 0);
const box = opaqueBBox(px, w, h);
if (!box) { console.error('cutout: image is fully transparent'); process.exit(1); }
const { x0, y0, x1, y1 } = box;
// 0.94 of 1024 = 962px on the tight axis, i.e. a 31px margin — what the six
// committed hatch cracks were fitted at. The eggs and boss portraits sit at 24px
// (0.953); do not "unify" this number without re-fitting the cracks, which would
// mean regenerating committed art. Centering is on the whole opaque bbox.
const FIT = 0.94;
const S = 1024, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const scale = Math.min((S * FIT) / bw, (S * FIT) / bh);
const out = createCanvas(S, S);
out.getContext('2d').drawImage(work, x0, y0, bw, bh,
  (S - bw * scale) / 2, (S - bh * scale) / 2, bw * scale, bh * scale);
writeFileSync(dest, out.toBuffer('image/webp', Q));
console.log(`cutout ${dest} ${S}x${S} (opaque bbox ${bw}x${bh})`);
