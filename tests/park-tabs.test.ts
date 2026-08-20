import { describe, it, expect } from 'vitest';
import { PARK_TABS, isParkTab, tabRow, dashboardPayload, animalsPayload, lotsPayload } from '../src/modules/park/embeds.js';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';

const fieldsOf = (p: { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }) =>
  p.embeds[0].toJSON().fields ?? [];

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

describe('Park tab', () => {
  it('carries only the headline numbers, not the full card', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 0, { dinoCount: 3 });
    const names = fieldsOf(p).map((f) => f.name);
    expect(names.some((n) => n.includes('Cash'))).toBe(true);
    expect(names.some((n) => n.includes('Rating'))).toBe(true);
    expect(names.some((n) => n.includes('Dinos'))).toBe(true);
    // These four moved to other tabs — the whole point of the change.
    for (const gone of ['Food', 'Attendance', 'Achievements', 'Legacy']) {
      expect(names.some((n) => n.includes(gone)), gone).toBe(false);
    }
  });

  it('shows a compact attention marker so an escape is never hidden behind a click', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const calm = dashboardPayload(user, 0, { dinoCount: 5 });
    expect(fieldsOf(calm).find((f) => f.name.includes('Dinos'))!.value).toBe('5');
    const alarmed = dashboardPayload(user, 0, { dinoCount: 5, attention: 2 });
    expect(fieldsOf(alarmed).find((f) => f.name.includes('Dinos'))!.value)
      .toBe('5 · ⚠️ 2 need attention');
  });

  it('puts Collect first in the first row and the tab row second', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 1234, {});
    const row0 = p.components[0].toJSON().components;
    expect((row0[0] as { custom_id: string }).custom_id).toBe('park:collect');
    expect(p.components[1].toJSON().components).toHaveLength(4);
  });

  it('drops Collect entirely on a visited card', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 999, { visit: true });
    expect(JSON.stringify(p)).not.toContain('park:collect');
    expect(p.components[0].toJSON().components).toHaveLength(4);
  });
});

describe('Animals tab', () => {
  it('itemises what the Park tab only summarised', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 9, { escaped: 1, atRisk: 3, mismatch: 2 });
    const v = fieldsOf(p).find((f) => f.name.includes('Needs attention'))!.value;
    expect(v).toContain('1 escaped');
    expect(v).toContain('3 at risk');
    expect(v).toContain('2 wrong habitat');
  });

  it('omits the attention field entirely when nothing is wrong', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 9, {});
    expect(fieldsOf(p).some((f) => f.name.includes('Needs attention'))).toBe(false);
  });

  it('carries the roster banner, and the featured dino art second', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 1, {
      featured: { name: 'Trixie', speciesId: 'triceratops', archetype: 'tank', diet: 'herbivore' },
    });
    // Call order is upload order, and several tests across the suite pin files by name.
    expect(p.files!.map((f) => f.name)).toEqual(['dino_roster.webp', 'tank-herbivore.webp']);
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://tank-herbivore.webp');
  });

  it('drops the action buttons on a visited card but keeps the tab row', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 1, { visit: true });
    expect(JSON.stringify(p)).not.toContain('park:feedall');
    expect(p.components).toHaveLength(1);
  });
});

describe('Lots tab', () => {
  it('lists each lot with its level and shows slot usage', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const lots = [
      { id: 1, userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 4 },
      { id: 2, userId: 'u1', type: 'facility', kind: 'gene_lab', name: 'Gene Lab', level: 2 },
    ] as never;
    const p = lotsPayload(user, lots, 6);
    const built = fieldsOf(p).find((f) => f.name.includes('Built'))!.value;
    expect(built).toContain('#1');
    expect(built).toContain('Carnivore Paddock');
    expect(built).toContain('lvl 4');
    expect(fieldsOf(p).find((f) => f.name.includes('Slots'))!.value).toBe('2 / 6 used');
  });

  it('tells an empty park what to do instead of rendering a blank field', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = lotsPayload(user, [], 3);
    expect(fieldsOf(p).find((f) => f.name.includes('Built'))!.value).toContain('/build');
  });

  it('carries the lots banner', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = lotsPayload(user, [], 3);
    expect(p.files!.map((f) => f.name)).toEqual(['lots.webp']);
  });
});
