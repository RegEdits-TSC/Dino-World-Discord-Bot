import { describe, it, expect } from 'vitest';
import { createCanvas, Image } from '@napi-rs/canvas';
import { renderParkPng } from '../src/core/render/draw.js';
import { loadParkArt } from '../src/core/render/art.js';
import { PADDOCK_PALETTE } from '../src/data/render-icons.js';
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

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('park render with the committed art', () => {
  // Every other test in this wave proves a piece in isolation: art.ts loads files, draw.ts draws
  // whatever ParkArt it is handed, the worker passes one in. None of them fails if the real assets go
  // missing from the repo or the loader's filenames drift — the renderer would just keep drawing the
  // flat fallback, green all the way. This walks the whole path with the real files on disk.
  it('paints the ground raster and the paddock plate, not the flat fills', async () => {
    const art = await loadParkArt();
    expect(art.ground, 'assets/images/park/ground.png missing or undecodable').not.toBeNull();
    expect(art.platePaddock, 'assets/images/park/plate-paddock.png missing or undecodable').not.toBeNull();

    const png = renderParkPng(sample, art);
    const img = new Image();
    img.src = png;
    await img.decode();
    const canvas = createCanvas(img.width, img.height);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    const at = (x: number, y: number) => Array.from(c.getImageData(x, y, 1, 1).data).slice(0, 3);

    // (10, 240) is the left margin below the header, which the flat path fills with exactly #356b2c;
    // (260, 210) is inside tile 0, clear of the icon, name, level, dino chips, escape alert and decor
    // dots, which the flat path fills with exactly PADDOCK_PALETTE.fill.
    expect(at(10, 240)).not.toEqual(rgb('#356b2c'));
    expect(at(260, 210)).not.toEqual(rgb(PADDOCK_PALETTE.fill));
  });
});
