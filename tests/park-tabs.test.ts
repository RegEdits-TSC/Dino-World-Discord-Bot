import { describe, it, expect } from 'vitest';
import { PARK_TABS, isParkTab, tabRow } from '../src/modules/park/embeds.js';

describe('tab row', () => {
  it('mints one button per tab, owner ids for the own-park family', () => {
    const row = tabRow('u1', 'animals').toJSON();
    expect(row.components).toHaveLength(4);
    expect(row.components.map((c) => (c as { custom_id: string }).custom_id)).toEqual([
      'park:tab:u1:park', 'park:tab:u1:animals', 'park:tab:u1:lots', 'park:tab:u1:prestige',
    ]);
  });

  it('uses the vtab family when visiting', () => {
    const row = tabRow('target', 'park', true).toJSON();
    expect(row.components.map((c) => (c as { custom_id: string }).custom_id)).toEqual([
      'park:vtab:target:park', 'park:vtab:target:animals',
      'park:vtab:target:lots', 'park:vtab:target:prestige',
    ]);
  });

  it('disables the active tab so it cannot re-render itself', () => {
    const row = tabRow('u1', 'lots').toJSON();
    const disabled = row.components
      .filter((c) => (c as { disabled?: boolean }).disabled)
      .map((c) => (c as { custom_id: string }).custom_id);
    expect(disabled).toEqual(['park:tab:u1:lots']);
  });

  it('isParkTab rejects anything not in the union', () => {
    expect(PARK_TABS).toEqual(['park', 'animals', 'lots', 'prestige']);
    for (const t of PARK_TABS) expect(isParkTab(t)).toBe(true);
    expect(isParkTab('map')).toBe(false);
    expect(isParkTab('')).toBe(false);
    expect(isParkTab('__proto__')).toBe(false);
  });
});
