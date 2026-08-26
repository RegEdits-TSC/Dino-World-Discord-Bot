// Reproduces the landmark-band contrast gate documented in docs/assets/prompts.md
// ("Contrast requirement (hard gate, not a style preference)"). It ships with the repo
// because that section presents its figures as measured rather than asserted, and a
// measurement nobody can re-run is prose.
//
//   node scripts/check-band-contrast.mjs assets/images/park/landmark-*.webp
//
// The park renderer paints a landmark's tier name in #f5e6b8 directly over its
// 270x150 band, so the band must stay dark enough behind that text to keep it
// legible. This measures the WCAG contrast ratio of the text colour against the
// exact pixels the glyphs land on.
//
// Geometry is taken from drawLandmark (src/core/render/draw.ts), not guessed:
//   c.font = '18px SANS'
//   c.fillText(name, x + 14, y + TILE_H - 16)   // baseline at y=134 of 150
//   truncated to TILE_W - 28 = 242px wide
// An 18px face has ~13px cap height and ~4px descender, so the glyph band runs
// roughly y=121..138, x=14..256.
//
// Two numbers are reported. `mean` is the whole text box. `worst-patch` is the
// darkest-losing 24x14 window inside it -- a band can average dark and still
// have one bright blowout under a single word, which is what actually breaks
// legibility.
import { Image, createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';

const TEXT = { r: 0xf5, g: 0xe6, b: 0xb8 };
const W = 270, H = 150;
const BOX = { x0: 14, x1: 256, y0: 121, y1: 138 };

const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

const textLum = lum(TEXT.r, TEXT.g, TEXT.b);

for (const path of process.argv.slice(2)) {
  const img = new Image();
  img.src = readFileSync(path);
  await img.decode();
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  const p = ctx.getImageData(0, 0, W, H).data;

  let sum = 0, n = 0;
  for (let y = BOX.y0; y < BOX.y1; y++) {
    for (let x = BOX.x0; x < BOX.x1; x++) {
      const i = (y * W + x) * 4;
      sum += lum(p[i], p[i + 1], p[i + 2]); n++;
    }
  }
  const mean = ratio(textLum, sum / n);

  let worst = Infinity;
  const pw = 24, ph = BOX.y1 - BOX.y0;
  for (let px = BOX.x0; px + pw <= BOX.x1; px += 4) {
    let pl = 0, pn = 0;
    for (let y = BOX.y0; y < BOX.y1; y++) {
      for (let x = px; x < px + pw; x++) {
        const i = (y * W + x) * 4;
        pl += lum(p[i], p[i + 1], p[i + 2]); pn++;
      }
    }
    const r = ratio(textLum, pl / pn);
    if (r < worst) worst = r;
  }

  const name = path.split(/[\\/]/).pop();
  const verdict = worst >= 4.5 ? 'PASS' : worst >= 3 ? 'MARGINAL' : 'FAIL';
  console.log(
    `${name.padEnd(16)} mean=${mean.toFixed(2)}:1  worst-word=${worst.toFixed(2)}:1  ${verdict}`,
  );
}
