import { describe, it, expect } from 'vitest';
import { matches, respondRanked, emptyRow, fmtDuration, capitalize, eggLabel, dinoLabel, VERY_HUNGRY_MS, listCompleter } from '../src/core/autocomplete.js';
import type { AcEntry } from '../src/core/autocomplete.js';
import type { AutocompleteInteraction } from 'discord.js';
import { getSpecies } from '../src/data/species/index.js';

function fakeRespond() {
  const out: unknown[] = [];
  return { out, i: { respond: async (c: unknown) => { out.push(c); } } as unknown as AutocompleteInteraction };
}

describe('matches', () => {
  it('empty query matches everything', () => {
    expect(matches('', 12, 'Velociraptor')).toBe(true);
    expect(matches('   ', 12)).toBe(true);
  });
  it('substring-matches ids and names case-insensitively', () => {
    expect(matches('velo', 7, 'Velociraptor')).toBe(true);
    expect(matches('12', 12, 'Trike')).toBe(true);
    expect(matches('RARE', 3, 'rare')).toBe(true);
    expect(matches('zzz', 3, 'Velociraptor')).toBe(false);
  });
  it('skips null/undefined haystacks', () => {
    expect(matches('x', null, undefined)).toBe(false);
  });
});

describe('respondRanked', () => {
  it('ranks valid entries first, preserving in-group order', async () => {
    const { out, i } = fakeRespond();
    const entries: AcEntry[] = [
      { value: 1, label: 'a', valid: false },
      { value: 2, label: 'b', valid: true },
      { value: 3, label: 'c', valid: true },
    ];
    await respondRanked(i, entries);
    expect(out[0]).toEqual([
      { name: 'b', value: 2 }, { name: 'c', value: 3 }, { name: 'a', value: 1 },
    ]);
  });
  it('caps at 25 rows, valid entries never crowded out', async () => {
    const { out, i } = fakeRespond();
    const entries: AcEntry[] = [
      ...Array.from({ length: 30 }, (_, n) => ({ value: n, label: `inv${n}`, valid: false })),
      { value: 99, label: 'ok', valid: true },
    ];
    await respondRanked(i, entries);
    const rows = out[0] as Array<{ name: string; value: number }>;
    expect(rows).toHaveLength(25);
    expect(rows[0]).toEqual({ name: 'ok', value: 99 });
  });
  it('truncates labels to 100 chars', async () => {
    const { out, i } = fakeRespond();
    await respondRanked(i, [{ value: 1, label: 'x'.repeat(150), valid: true }]);
    expect((out[0] as Array<{ name: string }>)[0].name).toHaveLength(100);
  });
});

describe('emptyRow', () => {
  it('builds an invalid informational entry', () => {
    expect(emptyRow('No eggs', 0)).toEqual({ value: 0, label: 'No eggs', valid: false });
  });
});

describe('fmtDuration', () => {
  it('formats minutes, hours, days', () => {
    expect(fmtDuration(15 * 60_000)).toBe('15m');
    expect(fmtDuration(3 * 3_600_000 + 20 * 60_000)).toBe('3h 20m');
    expect(fmtDuration(4 * 3_600_000)).toBe('4h');
    expect(fmtDuration(25 * 3_600_000)).toBe('1d 1h');
    expect(fmtDuration(48 * 3_600_000)).toBe('2d');
  });
  it('floors to a 1m minimum', () => {
    expect(fmtDuration(1)).toBe('1m');
    expect(fmtDuration(0)).toBe('1m');
  });
});

describe('capitalize', () => {
  it('uppercases the first letter only', () => {
    expect(capitalize('rare')).toBe('Rare');
    expect(capitalize('')).toBe('');
  });
});

const H = 3_600_000;

function egg(over: Record<string, unknown> = {}) {
  return {
    id: 12, userId: 'u1', rarity: 'rare', speciesId: null, source: 'shop',
    viaTrade: false, locked: false, obtainedAt: 0, incubationStartedAt: null, hatchesAt: null,
    ...over,
  } as never;
}
function dino(over: Record<string, unknown> = {}) {
  return {
    id: 7, userId: 'u1', lotId: 3, speciesId: 'velociraptor', nickname: null,
    hunger: 100, lastFedAt: 0, escapedAt: null, viaTrade: false, locked: false, hatchedAt: 0,
    ...over,
  } as never;
}

describe('eggLabel', () => {
  it('labels inventory, incubating, and ready states', () => {
    expect(eggLabel(egg(), 0)).toBe('🥚 #12 Rare — in inventory');
    expect(eggLabel(egg({ incubationStartedAt: 0, hatchesAt: 4 * H }), 40 * 60_000))
      .toBe('🥚 #12 Rare — hatching, 3h 20m left');
    expect(eggLabel(egg({ incubationStartedAt: 0, hatchesAt: 100 }), 100)).toBe('🥚 #12 Rare — READY');
  });
  it('tags a trade-locked egg, ahead of every other state', () => {
    expect(eggLabel(egg({ locked: true }), 0)).toBe('🥚 #12 Rare — locked in a trade');
    // Lock wins over READY: a pre-existing locked+incubating row predates the
    // incubate guard, and the lock is the state that blocks the player.
    expect(eggLabel(egg({ locked: true, incubationStartedAt: 0, hatchesAt: 100 }), 100))
      .toBe('🥚 #12 Rare — locked in a trade');
  });
});

describe('dinoLabel', () => {
  const species = getSpecies('velociraptor');
  it('shows fed-ago and lot for a healthy dino', () => {
    expect(dinoLabel(dino(), species, 20 * H)).toBe('🦖 #7 Velociraptor — fed 20h ago (lot 3)');
  });
  it('shows fed just now under an hour, unassigned without a lot', () => {
    expect(dinoLabel(dino({ lotId: null }), species, 30 * 60_000))
      .toBe('🦖 #7 Velociraptor — fed just now (unassigned)');
  });
  it('flips to VERY HUNGRY at the 36h threshold', () => {
    expect(dinoLabel(dino(), species, VERY_HUNGRY_MS)).toBe('🦖 #7 Velociraptor — VERY HUNGRY (lot 3)');
    expect(dinoLabel(dino(), species, VERY_HUNGRY_MS - 1)).toBe('🦖 #7 Velociraptor — fed 35h ago (lot 3)');
  });
  it('ESCAPED overrides everything', () => {
    expect(dinoLabel(dino({ escapedAt: 5 }), species, 100 * H))
      .toBe('🦖 #7 Velociraptor — ESCAPED, rescue first');
  });
});

describe('listCompleter', () => {
  const cands = [
    { id: 12, label: '🦖 Velociraptor (rare)' },
    { id: 45, label: '🦖 Triceratops (common)' },
    { id: 47, label: '🥚 rare egg' },
  ];

  it('suggests all candidates for empty input', () => {
    const rows = listCompleter('', cands, { maxItems: 5 });
    expect(rows).toEqual([
      { name: '12 — 🦖 Velociraptor (rare)', value: '12' },
      { name: '45 — 🦖 Triceratops (common)', value: '45' },
      { name: '47 — 🥚 rare egg', value: '47' },
    ]);
  });

  it('completes the last token and re-emits the prefix', () => {
    const rows = listCompleter('12, 4', cands, { maxItems: 5 });
    expect(rows).toEqual([
      { name: '12, 45 — 🦖 Triceratops (common)', value: '12, 45' },
      { name: '12, 47 — 🥚 rare egg', value: '12, 47' },
    ]);
  });

  it('treats a trailing separator as a fresh token and dedupes entered ids', () => {
    const rows = listCompleter('12, ', cands, { maxItems: 5 });
    expect(rows.map((r) => r.value)).toEqual(['12, 45', '12, 47']);
  });

  it('matches the active token against labels too', () => {
    const rows = listCompleter('12, velo', cands, { maxItems: 5 });
    expect(rows).toEqual([]);  // 12 already taken; only id 12 matches 'velo'
    expect(listCompleter('velo', cands, { maxItems: 5 }))
      .toEqual([{ name: '12 — 🦖 Velociraptor (rare)', value: '12' }]);
  });

  it('caps at maxItems prior ids', () => {
    const rows = listCompleter('1, 2, 3, 4, 5, ', cands, { maxItems: 5 });
    expect(rows).toEqual([{ name: 'Max 5 items per side', value: '1, 2, 3, 4, 5' }]);
  });

  it('bails out when the value would exceed 100 chars', () => {
    const longPrefix = Array.from({ length: 24 }, (_, n) => String(1000 + n)).join(', ');  // 24*6-2 = 142 chars
    const rows = listCompleter(`${longPrefix}, 4`, cands, { maxItems: 99 });
    expect(rows).toEqual([{ name: 'List too long — type manually', value: longPrefix }]);
  });

  it('front-elides names over 100 chars but keeps the value intact', () => {
    const bigLabel = { id: 45, label: 'x'.repeat(95) };
    const rows = listCompleter('12, 4', [bigLabel], { maxItems: 5 });
    expect(rows[0].value).toBe('12, 45');
    expect(rows[0].name).toHaveLength(100);
    expect(rows[0].name.startsWith('…')).toBe(true);
    expect(rows[0].name.endsWith('x')).toBe(true);
  });
});
