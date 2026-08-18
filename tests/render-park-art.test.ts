import { describe, it, expect } from 'vitest';
import { createCanvas, Image } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderParkPng, gridDims } from '../src/core/render/draw.js';
import { EMPTY_ART, loadParkArt, type ParkArt } from '../src/core/render/art.js';
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
const PAD = 20, HEADER_H = 64, TILE_W = 270, TILE_H = 150, GAP = 16;
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
    expect(art.ground, 'assets/images/park/ground.webp missing or undecodable').not.toBeNull();
    expect(art.platePaddock, 'assets/images/park/plate-paddock.webp missing or undecodable').not.toBeNull();
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

  // End-to-end proof that each season snapshot actually draws ITS OWN committed raster, not just "a"
  // raster that happens to differ from the others. Same positive-reference pattern as the ground
  // assertion in the test above, but the reference image is read straight off disk by EXPECTED
  // filename (assets/images/park/ground-<season>.webp) rather than through art.groundBySeason[season]
  // — sourcing the reference from loadParkArt's own output would make this test tautological against
  // exactly the defect it exists to catch: a swapped pair of entries in loadParkArt's groundBySeason
  // object literal (e.g. `wet: groundDry, dry: groundWet`) would then swap the reference right along
  // with the real render, and the two would keep agreeing by construction. A pairwise distinctness
  // check (wet !== dry !== cold, the previous version of this test) doesn't catch that swap either —
  // every pairwise inequality stays true — which is the whole reason for this rewrite.
  it('paints each season snapshot with its own committed ground raster', async () => {
    const art = await loadParkArt();
    const hasBuild = sample.lots.length < sample.lotCap;
    const cellCount = sample.lots.length + (hasBuild ? 1 : 0);
    const dims = gridDims(cellCount);
    for (const season of ['wet', 'dry', 'cold'] as const) {
      const img = new Image();
      img.src = readFileSync(resolve(process.cwd(), 'assets/images/park', `ground-${season}.webp`));
      await img.decode();

      const scale = Math.max(dims.width / img.width, dims.height / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      const gx = (dims.width - dw) / 2, gy = (dims.height - dh) / 2;
      const seasonRef = renderAlone(dims.width, dims.height, (c) => c.drawImage(img, gx, gy, dw, dh));

      const png = renderParkPng({ ...sample, season }, art);
      const real = await decodeToCanvas(png);
      expect(pixelAt(real, 10, 240), season).toEqual(pixelAt(seasonRef, 10, 240));
    }
  });

  it('EMPTY_ART initialises every landmark band, so a lookup never reads undefined', () => {
    for (const band of ['a', 'b', 'c'] as const) {
      expect(band in EMPTY_ART.landmarks, band).toBe(true);
      expect(EMPTY_ART.landmarks[band]).toBeNull();
    }
  });
  it('loadParkArt resolves with a landmarks record and never rejects', async () => {
    const art = await loadParkArt();
    expect(Object.keys(art.landmarks).sort()).toEqual(['a', 'b', 'c']);
  });

  // Every other family drawn on the grid (ground, plates, lot icons, dino chips) gets a positive
  // real-asset render check above; landmarks were the one exception, because the art didn't exist
  // until this task shipped it. Same pattern as the ground/plate/icon/chip assertions: render an
  // independent single-asset reference with the identical drawImage arguments draw.ts uses, then
  // compare a sample pixel in the real render against it — proof the raster was actually blitted,
  // not just loaded.
  it('paints the real landmark art onto the canvas at the landmark cell draw.ts targets', async () => {
    const art = await loadParkArt();
    expect(art.landmarks.a, 'assets/images/park/landmark-a.webp missing or undecodable').not.toBeNull();

    // `sample` has 2 lots and lotCap 5, so hasBuild is true (a build slot occupies cell index 2) and
    // a landmarkTier puts the monument at cell index 3 — draw.ts's own
    // `snap.lots.length + (hasBuild ? 1 : 0)` — which is column `3 % COLS = 0`, row
    // `floor(3 / COLS) = 1` at 3 columns. That resolves to origin
    // (PAD, HEADER_H + PAD + (TILE_H + GAP)) = (20, 64 + 20 + 166) = (20, 250).
    const snapWithLandmark: ParkSnapshot = { ...sample, landmarkTier: 1 };
    const png = renderParkPng(snapWithLandmark, art);
    const real = await decodeToCanvas(png);

    const cellX = PAD, cellY = HEADER_H + PAD + (TILE_H + GAP);

    const landmark = art.landmarks.a!;
    const landmarkRef = renderAlone(TILE_W, TILE_H, (c) => c.drawImage(landmark, 0, 0, TILE_W, TILE_H));
    // Tile-local (135, 60): horizontally centered, well clear of the rounded-rect corners and of the
    // label band, which `drawLandmark` paints at roughly tile-local y+118 to y+136 (18px text baseline
    // at y + TILE_H - 16 = y + 134).
    expect(pixelAt(real, cellX + 135, cellY + 60)).toEqual(pixelAt(landmarkRef, 135, 60));
  });

  // The attraction family's positive real-raster check, in the same shape as the landmark one above
  // and the seasonal-ground one before it: the reference image is read straight off disk BY EXPECTED
  // FILENAME and drawn alone with the identical drawImage arguments draw.ts uses — never sourced from
  // loadParkArt's own output. Sourcing it from loadParkArt makes the assertion tautological against
  // exactly the defect it exists to catch: a mis-paired kind→image entry moves the reference along
  // with the real render and the two agree by construction. A bare "differs from the flat fill" check
  // is not a substitute either — that shape already let a removed drawImage call through undetected
  // once (see this file's own note at the renderAlone helper).
  //
  // The six real attraction bands are committed now, so this reads the real
  // assets/images/park/attraction-gift_shop.webp raster by explicit filename, rather than the
  // landmark-a.webp stand-in an earlier draft of this test used before that art existed. It still
  // hand-builds a synthetic ParkArt below (EMPTY_ART plus one manually-set attractions entry) instead
  // of calling loadParkArt() itself — deliberately: this test's job is the DRAW-PATH geometry, that
  // drawAttraction blits whatever Image it is handed 1:1 at the cell draw.ts targets, never whether
  // loadParkArt wires the six real files to their catalog keys correctly. That second question is a
  // different failure mode (a filename/slug mismatch, not a bad blit) and is covered on its own by
  // tests/render-art.test.ts's "loads all six attraction bands from the real asset directory".
  it('blits the attraction image it is handed 1:1 into the attraction cell', async () => {
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/park', 'attraction-gift_shop.webp'));
    await img.decode();          // raster decode is async — an un-awaited decode draws a blank canvas

    // `sample` has 2 lots and lotCap 5, so hasBuild is true and, with no landmarkTier, the first
    // attraction takes cell index 3 — draw.ts's own
    // `snap.lots.length + (hasBuild ? 1 : 0) + (band ? 1 : 0)` — which is column `3 % COLS = 0`,
    // row `floor(3 / COLS) = 1` at 3 columns. Origin is
    // (PAD, HEADER_H + PAD + (TILE_H + GAP)) = (20, 64 + 20 + 166) = (20, 250).
    const art: ParkArt = { ...EMPTY_ART, attractions: { gift_shop: img } };
    const png = renderParkPng({ ...sample, attractions: [{ kind: 'gift_shop', level: 2 }] }, art);
    const real = await decodeToCanvas(png);

    const cellX = PAD, cellY = HEADER_H + PAD + (TILE_H + GAP);
    const ref = renderAlone(TILE_W, TILE_H, (c) => c.drawImage(img, 0, 0, TILE_W, TILE_H));
    // Tile-local (135, 100): horizontally centered, well clear of the rounded-rect corners and below
    // both labels, which drawAttraction paints at the tile's TOP (18px baseline at y + 34, 13px at
    // y + 54) rather than at the bottom the way drawLandmark does.
    expect(pixelAt(real, cellX + 135, cellY + 100)).toEqual(pixelAt(ref, 135, 100));

    // And the flat-fill sentinel is genuinely gone: #2d4a63 is what the null branch paints there.
    expect(pixelAt(real, cellX + 135, cellY + 100)).not.toEqual([0x2d, 0x4a, 0x63]);
  });
});
