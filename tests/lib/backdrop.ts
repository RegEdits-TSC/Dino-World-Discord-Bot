import { Image, createCanvas } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';

/**
 * Finds un-removed studio backdrop inside a 1024x1024 cutout.
 *
 * The defect this exists for: the generator draws every cutout subject on a light
 * grey studio backdrop. Where that backdrop shows through a gap BETWEEN parts of
 * the subject — the opening between two shell fragments on a hatch crack — the
 * background remover keeps it, because a region enclosed by subject reads as
 * foreground. `fit-art.mjs cutout`'s luminance peel cannot reach it either: the
 * peel only removes pixels already adjacent to transparency, three passes deep.
 * The result renders as an opaque pale smear where the embed should show through.
 *
 * How a backdrop blob is told apart from legitimate pale art (a white egg shell
 * is pale too): this art style draws a bold dark outline at every subject
 * boundary, so real art meets transparency THROUGH its outline. A pale opaque
 * pixel sitting directly against transparency with no dark pixel between is
 * backdrop that survived.
 *
 * The `atCrop` flag is not optional bookkeeping — it is what makes the check
 * usable at all. Where the subject is cut flat by the frame (house style, and
 * the archetype references are cut exactly that way) the art simply ends with no
 * outline, so a pale throat at the crop edge has the identical local signature.
 * An unfiltered pass over the dino portraits flagged 74,903px of a gallimimus's
 * cream throat and 69,101px of a tank-carnivore's chest, both perfect art.
 */
export interface BackdropBlob {
  px: number;
  x0: number; y0: number; x1: number; y1: number;
  /** True when the blob reaches the canvas margin, i.e. it is art cut by the frame. */
  atCrop: boolean;
}

const S = 1024;
const LUM_WHITE = 190;
const CHROMA_MAX = 34;
const LUM_DARK = 110;
const MIN_BLOB = 40;
const EDGE = 45;

const lum = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

export async function findBackdrop(absPath: string): Promise<BackdropBlob[]> {
  const img = new Image();
  img.src = readFileSync(absPath);
  await img.decode();
  const canvas = createCanvas(S, S);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, S, S);
  const p = ctx.getImageData(0, 0, S, S).data;

  const alpha = (i: number): number => p[i * 4 + 3]!;
  const pale = (i: number): boolean => {
    if (alpha(i) < 100) return false;
    const r = p[i * 4]!, g = p[i * 4 + 1]!, b = p[i * 4 + 2]!;
    return lum(r, g, b) >= LUM_WHITE && Math.max(r, g, b) - Math.min(r, g, b) <= CHROMA_MAX;
  };
  const dark = (i: number): boolean =>
    alpha(i) >= 100 && lum(p[i * 4]!, p[i * 4 + 1]!, p[i * 4 + 2]!) < LUM_DARK;

  const seeds: number[] = [];
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      if (!pale(i)) continue;
      const nbr = [i - 1, i + 1, i - S, i + S];
      if (nbr.some((n) => alpha(n) < 40) && !nbr.some(dark)) seeds.push(i);
    }
  }

  const seen = new Uint8Array(S * S);
  const blobs: BackdropBlob[] = [];
  for (const s of seeds) {
    if (seen[s]) continue;
    const stack = [s];
    seen[s] = 1;
    let px = 0, x0 = S, y0 = S, x1 = -1, y1 = -1;
    while (stack.length) {
      const q = stack.pop()!;
      px++;
      const x = q % S, y = (q - x) / S;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const nbr = [x > 0 ? q - 1 : -1, x < S - 1 ? q + 1 : -1, y > 0 ? q - S : -1, y < S - 1 ? q + S : -1];
      for (const m of nbr) {
        if (m < 0 || seen[m] || dark(m) || !pale(m)) continue;
        seen[m] = 1;
        stack.push(m);
      }
    }
    if (px < MIN_BLOB) continue;
    blobs.push({
      px, x0, y0, x1, y1,
      atCrop: x0 <= EDGE || y0 <= EDGE || x1 >= S - 1 - EDGE || y1 >= S - 1 - EDGE,
    });
  }
  return blobs.sort((a, b) => b.px - a.px);
}

/** Total interior backdrop, i.e. excluding art legitimately cut by the frame. */
export async function interiorBackdropPx(absPath: string): Promise<number> {
  const blobs = await findBackdrop(absPath);
  return blobs.filter((b) => !b.atCrop).reduce((sum, b) => sum + b.px, 0);
}
