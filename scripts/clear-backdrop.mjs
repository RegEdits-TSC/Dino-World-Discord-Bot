// Repairs un-removed studio backdrop in a committed cutout.
//
// THIS SCRIPT PRODUCED COMMITTED ART. Seven files under assets/images/hatch/ were
// rewritten by it — the four `common-crack` files, `mythic-crack-v2`, and
// `rare-crack-v2`/`-v3` — so it ships with the repo rather than living in a
// throwaway workspace: the art it repaired cannot be regenerated, and a repair pass
// nobody can re-run is a repair nobody can reproduce. `tests/lib/backdrop.ts` is the
// DETECTOR for the same defect (read its header for the false-positive classes before
// pointing either at another family); this is the repair. Documented in
// docs/assets/prompts.md, "Backdrop in the crack gaps".
//
// ROOT CAUSE (confirmed by comparing raw / nobg / final at each stage):
// the generator draws the subject on a light-grey studio backdrop. Where that
// backdrop shows through a gap BETWEEN parts of the subject -- the opening
// between two shell fragments -- `remove_background` keeps it, because an
// enclosed region surrounded by subject reads as foreground. Measured on
// mythic-crack-v2: 7040 backdrop px going in, 6791 still there coming out.
// `fit-art.mjs cutout`'s luminance peel then cannot reach it, since the peel
// only removes pixels already adjacent to transparency, three passes deep.
//
// THE REPAIR: flood from each backdrop seed through connected pale, desaturated
// pixels, stopping at the art's own dark outlines, and zero the alpha.
//
// TWO SAFETY PROPERTIES, both load-bearing:
//
// 1. The flood is bounded by dark outlines. This art style draws a bold dark
//    outline at every subject boundary, so the flood cannot escape a gap into
//    the pale shell beside it. Without that bound this would eat a white egg.
//
// 2. Seeds must be INTERIOR. Where the subject is cut flat by the frame (house
//    style), the art just ends with no outline, so a pale throat meeting the
//    crop edge has the same local signature as backdrop. Verified the hard way:
//    an unfiltered pass flagged 74,903px of a gallimimus's cream throat and
//    69,101px of a tank-carnivore's chest, both perfectly good art.
//
// Always run with --preview first and LOOK at the mask before committing a repair.
import { Image, createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';

const S = 1024;
const LUM_WHITE = 190;
const CHROMA_MAX = 34;
const LUM_DARK = 110;
const MIN_BLOB = 40;
const EDGE = 45;
const Q = 95;

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const [src, dest] = args.filter((a) => !a.startsWith('--'));

const img = new Image();
img.src = readFileSync(src);
await img.decode();
const c = createCanvas(S, S);
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0, S, S);
const data = ctx.getImageData(0, 0, S, S);
const p = data.data;

const A = (i) => p[i * 4 + 3];
const pale = (i) => {
  if (A(i) < 25) return false;
  const r = p[i * 4], g = p[i * 4 + 1], b = p[i * 4 + 2];
  return lum(r, g, b) >= LUM_WHITE && Math.max(r, g, b) - Math.min(r, g, b) <= CHROMA_MAX;
};
const dark = (i) => A(i) >= 100 && lum(p[i * 4], p[i * 4 + 1], p[i * 4 + 2]) < LUM_DARK;

const seeds = [];
for (let y = 1; y < S - 1; y++) {
  for (let x = 1; x < S - 1; x++) {
    const i = y * S + x;
    if (!pale(i)) continue;
    const nbr = [i - 1, i + 1, i - S, i + S];
    if (nbr.some((n) => A(n) < 40) && !nbr.some(dark)) seeds.push(i);
  }
}

const seen = new Uint8Array(S * S);
const kill = new Uint8Array(S * S);
let cleared = 0, blobs = 0;
for (const s of seeds) {
  if (seen[s]) continue;
  const st = [s]; seen[s] = 1;
  const members = [];
  let x0 = S, y0 = S, x1 = -1, y1 = -1;
  while (st.length) {
    const q = st.pop();
    members.push(q);
    const x = q % S, y = (q - x) / S;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (const m of [x > 0 ? q - 1 : -1, x < S - 1 ? q + 1 : -1, y > 0 ? q - S : -1, y < S - 1 ? q + S : -1]) {
      if (m < 0 || seen[m] || dark(m) || !pale(m)) continue;
      seen[m] = 1; st.push(m);
    }
  }
  const atCrop = x0 <= EDGE || y0 <= EDGE || x1 >= S - 1 - EDGE || y1 >= S - 1 - EDGE;
  if (members.length < MIN_BLOB || atCrop) continue;
  blobs++;
  cleared += members.length;
  for (const m of members) kill[m] = 1;
}

if (preview) {
  // Mask: cleared pixels in red over the original, everything else dimmed.
  for (let i = 0; i < S * S; i++) {
    if (kill[i]) { p[i * 4] = 255; p[i * 4 + 1] = 0; p[i * 4 + 2] = 255; p[i * 4 + 3] = 255; }
    else if (A(i) > 0) { p[i * 4] = (p[i * 4] * 0.35) | 0; p[i * 4 + 1] = (p[i * 4 + 1] * 0.35) | 0; p[i * 4 + 2] = (p[i * 4 + 2] * 0.35) | 0; }
  }
  ctx.putImageData(data, 0, 0);
  writeFileSync(dest, c.toBuffer('image/png'));
  console.log(`PREVIEW ${dest}: would clear ${cleared} px in ${blobs} blob(s)`);
} else {
  for (let i = 0; i < S * S; i++) if (kill[i]) p[i * 4 + 3] = 0;
  ctx.putImageData(data, 0, 0);
  writeFileSync(dest, c.toBuffer('image/webp', Q));
  console.log(`REPAIRED ${dest}: cleared ${cleared} px in ${blobs} blob(s)`);
}
