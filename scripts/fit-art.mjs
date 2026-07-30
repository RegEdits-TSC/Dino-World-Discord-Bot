// Post-processing for generated art (see docs/assets/prompts.md).
//   node scripts/fit-art.mjs banner <src> <dest>   -> 1536x1024, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs cutout <src> <dest>   -> 1024x1024 transparent, defringed and centered, WebP q95
//
// `cutout` is the processor for the hatch cracks and for any future cutout family.
// It is NOT the pass that produced assets/images/eggs/ or assets/images/battles/:
// those predate this script and were fitted by a one-off with a tighter margin and
// (for the eggs) an egg-axis bias. It also deliberately keeps every opaque region,
// not just the largest — the cracks' falling shell fragments are disconnected on
// purpose. prompts.md records the divergence and the numbers.
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, Image } from '@napi-rs/canvas';

const [mode, src, dest] = process.argv.slice(2);
if (!['banner', 'cutout'].includes(mode) || !src || !dest) {
  console.error('usage: node scripts/fit-art.mjs <banner|cutout> <src> <dest.webp>');
  process.exit(2);
}

// q95 is the committed setting for every asset under assets/images (83-87% off PNG,
// visually indistinguishable at the sizes Discord renders). Keep in sync with prompts.md.
const Q = 95;

const img = new Image();
img.src = readFileSync(src);
await img.decode();

if (mode === 'banner') {
  const W = 1536, H = 1024;
  const scale = Math.max(W / img.width, H / img.height);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const canvas = createCanvas(W, H);
  canvas.getContext('2d').drawImage(img, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
  writeFileSync(dest, canvas.toBuffer('image/webp', Q));
  console.log(`banner ${dest} ${W}x${H} (source ${img.width}x${img.height})`);
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
const at = (x, y) => (y * w + x) * 4;
for (let i = 3; i < px.length; i += 4) if (px[i] < 32) px[i] = 0;
for (let pass = 0; pass < 3; pass++) {
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
wctx.putImageData(data, 0, 0);
let x0 = w, y0 = h, x1 = -1, y1 = -1;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (px[at(x, y) + 3] === 0) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
}
if (x1 < 0) { console.error('cutout: image is fully transparent'); process.exit(1); }
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
