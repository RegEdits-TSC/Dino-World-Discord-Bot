import { describe, it, expect } from 'vitest';
import { gridDims, renderParkPng } from '../src/core/render/draw.js';
import type { ParkSnapshot } from '../src/modules/park/snapshot.js';

describe('gridDims', () => {
  it('rows scale with cell count at 3 columns; width is constant', () => {
    expect(gridDims(0).rows).toBe(1);
    expect(gridDims(3).rows).toBe(1);
    expect(gridDims(4).rows).toBe(2);
    expect(gridDims(9).rows).toBe(3);
    expect(gridDims(3).width).toBe(gridDims(9).width);
  });
});

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

describe('renderParkPng', () => {
  it('returns a non-empty PNG buffer (magic bytes)', () => {
    const png = renderParkPng(sample);
    expect(png.length).toBeGreaterThan(1000);
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
  it('renders an empty park without throwing', () => {
    const png = renderParkPng({ ...sample, lots: [], dinoCount: 0, escapedCount: 0 });
    expect(png.length).toBeGreaterThan(100);
  });
});
