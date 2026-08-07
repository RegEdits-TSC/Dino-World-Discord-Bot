import { describe, it, expect } from 'vitest';
import { paddockFit } from '../src/core/clock.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { allSpecies } from '../src/data/species/index.js';

describe('the tundra biome', () => {
  it('is claimed by at least one species', () => {
    const tundra = allSpecies().filter((s) => s.biomeTags.includes('tundra'));
    expect(tundra.length).toBeGreaterThanOrEqual(2);
  });

  it('lets an Ice Block reach full comfort for a tundra species', () => {
    const s = allSpecies().find((x) => x.biomeTags.includes('tundra'))!;
    const paddock = s.diet === 'herbivore'
      ? PADDOCKS.herbivore_paddock : PADDOCKS.carnivore_paddock;
    // NOTE: pass the decor KIND SLUG, never the biome tag — clock.ts:47 maps
    // kind -> DECOR[kind].biomeTags before comparing.
    expect(paddockFit(s, paddock, ['ice_block'])).toBe(1.0);
    expect(paddockFit(s, paddock, [])).toBe(0.75);
  });
});
