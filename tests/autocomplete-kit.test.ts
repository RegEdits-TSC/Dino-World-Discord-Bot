import { describe, it, expect } from 'vitest';
import { matches, respondRanked, emptyRow, fmtDuration, capitalize } from '../src/core/autocomplete.js';
import type { AcEntry } from '../src/core/autocomplete.js';
import type { AutocompleteInteraction } from 'discord.js';

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
