import { renderPark } from '../dist/core/render/client.js';

const snap = {
  parkName: 'Smoke Park', cash: 9999, parkRating: 350, dinoCount: 2, escapedCount: 0, lotCap: 5,
  lots: [{ id: 1, type: 'paddock', kind: 'herbivore_paddock', name: 'Vale', level: 2, decorCount: 1,
    dinos: [{ speciesId: 'triceratops', rarity: 'common', escaped: false }] }],
};
const png = await renderPark(snap);
console.log('PNG bytes:', png.length, 'magic:', [...png.subarray(0, 4)].map((b) => b.toString(16)).join(' '));
process.exit(png.length > 1000 ? 0 : 1);
