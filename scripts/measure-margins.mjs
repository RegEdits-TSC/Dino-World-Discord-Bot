// Reports the transparent margin on each side of a 1024x1024 cutout.
//
//   node scripts/measure-margins.mjs assets/images/eggs/*.webp
//
// docs/assets/prompts.md's egg-margin and boss-portrait-margin tables are this
// script's output; re-run it against any regenerated file rather than trusting them.
// The egg family is fitted with `fit-art.mjs portrait --axis=egg`: the vertical
// margins land at 24px exactly, while left/right are asymmetric on purpose
// (the fit is centred on the egg's own axis, not the whole nest bbox).
// A symmetric 31/31 reading means `cutout` was used by mistake.
import { Image, createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';

const S = 1024;

for (const path of process.argv.slice(2)) {
  const img = new Image();
  img.src = readFileSync(path);
  await img.decode();
  const c = createCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const p = ctx.getImageData(0, 0, S, S).data;
  let x0 = S, y0 = S, x1 = -1, y1 = -1;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (p[(y * S + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const name = path.split(/[\\/]/).pop();
  const vert = Math.min(y0, S - 1 - y1);
  console.log(
    `${name.padEnd(24)} L=${String(x0).padStart(3)} R=${String(S - 1 - x1).padStart(3)}` +
    ` T=${String(y0).padStart(3)} B=${String(S - 1 - y1).padStart(3)}  min(T,B)=${vert}`,
  );
}
