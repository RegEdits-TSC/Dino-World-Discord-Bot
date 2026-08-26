// Counts disconnected opaque regions in a 1024x1024 cutout.
//
//   node scripts/count-regions.mjs assets/images/hatch/*.webp
//
// The hatch cracks' falling shell fragments are deliberately disconnected islands;
// a count of 1 means they were lost (the classic wrong-fit-mode failure).
// `significant` ignores specks under 40px, which are matte noise rather than art.
//
// READ THE SECOND COLUMN, not the first. `regions` counts every island including
// single-pixel matte dust, and clear-backdrop.mjs's repair pass leaves tens of those
// behind on the files it touched — common-crack reads 68 regions against 6 fragments.
// `significant` is the fragment count docs/assets/prompts.md's table records.
import { Image, createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';

const S = 1024;

export async function regions(path) {
  const img = new Image();
  img.src = readFileSync(path);
  await img.decode();
  const c = createCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const p = ctx.getImageData(0, 0, S, S).data;
  const seen = new Uint8Array(S * S);
  let total = 0, big = 0, largest = 0;
  for (let s = 0; s < S * S; s++) {
    if (p[s * 4 + 3] === 0 || seen[s]) continue;
    total++;
    const stack = [s];
    seen[s] = 1;
    let size = 0;
    while (stack.length) {
      const q = stack.pop();
      size++;
      const x = q % S, y = (q - x) / S;
      const nbr = [x > 0 ? q - 1 : -1, x < S - 1 ? q + 1 : -1, y > 0 ? q - S : -1, y < S - 1 ? q + S : -1];
      for (const m of nbr) {
        if (m < 0 || seen[m] || p[m * 4 + 3] === 0) continue;
        seen[m] = 1;
        stack.push(m);
      }
    }
    if (size > 40) big++;
    if (size > largest) largest = size;
  }
  return { total, big, largest };
}

const args = process.argv.slice(2);
if (args.length) {
  for (const a of args) {
    const r = await regions(a);
    const name = a.split(/[\\/]/).pop();
    console.log(`${name.padEnd(26)} regions=${String(r.total).padStart(4)}  significant=${String(r.big).padStart(3)}`);
  }
}
