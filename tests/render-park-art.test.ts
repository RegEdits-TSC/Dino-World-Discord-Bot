import { describe, it, expect } from 'vitest';
import { createCanvas, Image } from '@napi-rs/canvas';
import { renderParkPng, gridDims } from '../src/core/render/draw.js';
import { loadParkArt } from '../src/core/render/art.js';
import type { ParkSnapshot } from '../src/modules/park/snapshot.js';

const sample: ParkSnapshot = {
  parkName: 'Jurassic Cove', cash: 12400, parkRating: 420, dinoCount: 3, escapedCount: 1, lotCap: 5,
  lots: [
    { id: 1, type: 'paddock', kind: 'carnivore_paddock', name: 'T-Rex Pen', level: 3, decorCount: 2,
      dinos: [
        { speciesId: 'tyrannosaurus', rarity: 'legendary', escaped: false },
        { speciesId: 'tyrannosaurus', rarity: 'legendary', escaped: true },
      ] },
    { id: 2, type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab With A Very Long Name', level: 2, decorCount: 0, dinos: [] },
  ],
};

// Tile/grid geometry mirrors src/core/render/draw.ts's own module-private constants (COLS, TILE_W,
// TILE_H, GAP, PAD, HEADER_H are not exported), the same way tests/render-draw.test.ts already
// restates them for its own pixel assertions. Tile 0 sits at (PAD, HEADER_H + PAD).
const PAD = 20, HEADER_H = 64, TILE_W = 270, TILE_H = 150;
const TILE0_X = PAD, TILE0_Y = HEADER_H + PAD;

async function decodeToCanvas(png: Buffer) {
  const img = new Image();
  img.src = png;
  await img.decode();          // PNG decode is async — skipping this yields a blank canvas
  const canvas = createCanvas(img.width, img.height);
  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0);
  return c;
}

function pixelAt(c: ReturnType<typeof decodeToCanvas> extends Promise<infer T> ? T : never, x: number, y: number): number[] {
  return Array.from(c.getImageData(x, y, 1, 1).data).slice(0, 3) as number[];
}

// Renders exactly one asset, alone, on its own blank canvas, with the identical drawImage
// arguments draw.ts uses for that asset. Sampling this reference and the real render at the
// corresponding point is a *positive* check — "this exact art landed here" — not just "something
// non-default is here", which is what let a removed drawImage call slip through undetected before
// (see task-19-report.md, fix round 1).
function renderAlone(width: number, height: number, draw: (c: ReturnType<ReturnType<typeof createCanvas>['getContext']>) => void) {
  const canvas = createCanvas(width, height);
  const c = canvas.getContext('2d');
  draw(c);
  return c;
}

describe('park render with the committed art', () => {
  // Every other test in this wave proves a piece in isolation: art.ts loads files, draw.ts draws
  // whatever ParkArt it is handed, the worker passes one in. None of them fails if the real assets go
  // missing from the repo or the loader's filenames drift — the renderer would just keep drawing the
  // flat fallback, green all the way. This walks the whole path with the real files on disk, and for
  // each asset compares the real render's pixel against an independently-rendered reference of that
  // same asset at that same spot — not merely "different from the flat-fill sentinel", which a
  // half-broken draw (art loaded, but never actually blitted) can also satisfy by accident.
  it('paints the real ground, plate, lot-icon and dino-chip art onto the canvas at the exact spots draw.ts targets', async () => {
    const art = await loadParkArt();
    expect(art.ground, 'assets/images/park/ground.png missing or undecodable').not.toBeNull();
    expect(art.platePaddock, 'assets/images/park/plate-paddock.png missing or undecodable').not.toBeNull();
    expect(art.lotIcons.carnivore_paddock, 'assets/emojis/svg/dw_lot_carnivore.svg missing or undecodable').not.toBeNull();
    expect(art.dinoChips.legendary, 'assets/emojis/svg/dw_dino_legendary.svg missing or undecodable').not.toBeNull();

    const png = renderParkPng(sample, art);
    const real = await decodeToCanvas(png);

    const hasBuild = sample.lots.length < sample.lotCap;
    const cellCount = sample.lots.length + (hasBuild ? 1 : 0);
    const dims = gridDims(cellCount);

    // Ground: reproduce drawGround's own cover-scale-and-center formula (Math.max, centered) against
    // the real ground image, then compare the real render at an unoccluded point — outside the header
    // bar and every tile — to that independently-computed expectation. A cover-scale regression (the
    // brief's Math.max → Math.min failure mode) changes dw/dh here exactly as it would in production,
    // so the two stop agreeing at this point; a merely-missing drawImage call would leave the flat
    // #356b2c fallback there instead, which also disagrees with the reference.
    const g = art.ground!;
    const scale = Math.max(dims.width / g.width, dims.height / g.height);
    const dw = g.width * scale, dh = g.height * scale;
    const gx = (dims.width - dw) / 2, gy = (dims.height - dh) / 2;
    const groundRef = renderAlone(dims.width, dims.height, (c) => c.drawImage(g, gx, gy, dw, dh));
    // (10, 240) is the left margin below the header, clear of the header bar and every tile.
    expect(pixelAt(real, 10, 240)).toEqual(pixelAt(groundRef, 10, 240));

    // Paddock plate: authored at exactly TILE_W×TILE_H and drawn 1:1 with no scaling, so the plate's
    // own pixel at a given local offset is exactly the pixel that belongs at tile-origin + that
    // offset — no coordinate transform to get wrong, just "was this actually blitted or not".
    const plate = art.platePaddock!;
    const plateRef = renderAlone(TILE_W, TILE_H, (c) => c.drawImage(plate, 0, 0, TILE_W, TILE_H));
    // (260, 210) sits inside tile 0, clear of the icon, name, level, dino chips, escape alert and
    // decor dots.
    expect(pixelAt(real, 260, 210)).toEqual(pixelAt(plateRef, 260 - TILE0_X, 210 - TILE0_Y));

    // Lot icon: drawTile draws it scaled to 30×30 at (tileX + 14, tileY + 15).
    const icon = art.lotIcons.carnivore_paddock!;
    const iconRef = renderAlone(30, 30, (c) => c.drawImage(icon, 0, 0, 30, 30));
    const iconX = TILE0_X + 14, iconY = TILE0_Y + 15;
    expect(pixelAt(real, iconX + 15, iconY + 15)).toEqual(pixelAt(iconRef, 15, 15));

    // Dino chip: drawTile draws the first dino's chip scaled to 28×28 at (tileX + 16, tileY + 75).
    const chip = art.dinoChips.legendary!;
    const chipRef = renderAlone(28, 28, (c) => c.drawImage(chip, 0, 0, 28, 28));
    const chipX = TILE0_X + 16, chipY = TILE0_Y + 75;
    expect(pixelAt(real, chipX + 14, chipY + 14)).toEqual(pixelAt(chipRef, 14, 14));
  });
});
