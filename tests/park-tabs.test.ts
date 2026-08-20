import { describe, it, expect } from 'vitest';
import { PARK_TABS, isParkTab, tabRow, dashboardPayload, animalsPayload, lotsPayload, prestigePayload } from '../src/modules/park/embeds.js';
import { makeCtx, fakeButton } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { tierForPoints } from '../src/modules/park/ranks.js';
import { ATTENDANCE_MAX } from '../src/data/attendance.js';
import { parkModule } from '../src/modules/park/index.js';

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

describe('Prestige tab', () => {
  it('gathers every standing number onto one screen', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = prestigePayload(user, {
      attendance: 18420, earnedTiers: 31, legacyRank: tierForPoints(120),
      seasonBadges: { count: 3, latest: 690 },
    });
    const names = fieldsOf(p).map((f) => f.name);
    expect(names.some((n) => n.includes('Attendance'))).toBe(true);
    expect(names.some((n) => n.includes('Achievements'))).toBe(true);
    expect(names.some((n) => n.includes('Legacy'))).toBe(true);
    expect(names.some((n) => n.includes('Seasons'))).toBe(true);
  });

  it('omits Achievements and Seasons at zero rather than printing a 0', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = prestigePayload(user, { earnedTiers: 0, seasonBadges: { count: 0, latest: null } });
    const names = fieldsOf(p).map((f) => f.name);
    expect(names.some((n) => n.includes('Achievements'))).toBe(false);
    expect(names.some((n) => n.includes('Seasons'))).toBe(false);
  });

  it('offers Landmark and Guests on your own card and neither on a visit', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const mine = JSON.stringify(prestigePayload(user, {}));
    expect(mine).toContain('park:goto:landmark');
    expect(mine).toContain('park:goto:guests');
    const theirs = JSON.stringify(prestigePayload(user, { visit: true }));
    expect(theirs).not.toContain('park:goto:');
  });

  // Pins the real ATTENDANCE_MAX as the denominator, imported rather than hardcoded —
  // ATTENDANCE_MAX is 1920, not the 1000 ATTENDANCE_SCALE understates it by (see the repo
  // CLAUDE.md note on that 92% gap). Nothing else in this file reads the Attendance
  // field's rendered VALUE, so swapping ATTENDANCE_MAX for ATTENDANCE_SCALE at the call
  // site would otherwise leave the whole suite green.
  it('renders the real ATTENDANCE_MAX as the denominator', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = prestigePayload(user, { attendance: 100 });
    const field = fieldsOf(p).find((f) => f.name.includes('Attendance'))!;
    expect(field.value).toContain(ATTENDANCE_MAX.toLocaleString());
  });

  it('carries the landmark banner', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = prestigePayload(user, {});
    expect(p.files!.map((f) => f.name)).toEqual(['landmark.webp']);
  });
});

const parkComp = () => parkModule.components.find((c) => c.prefix === 'park')!;

describe('tab dispatcher', () => {
  it('renders another tab in place, shedding the previous tab uploads', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:tab:u1:prestige', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as { attachments: unknown[]; embeds: Array<{ toJSON(): { title: string } }> };
    // Without attachments: [] the outgoing tab's uploads survive as orphan cards.
    expect(sent.attachments).toEqual([]);
    expect(sent.embeds[0].toJSON().title).toContain('Prestige');
  });

  it('defers before rendering the Park tab, because renderPark can eat the whole window', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:tab:u1:park', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(b.deferOpts).toEqual([{ kind: 'update' }]);
    // The Park branch is the one exit that reaches editReply rather than update — its own
    // attachments: [] contract (named requirement of this task) was otherwise unpinned,
    // since nothing above read b.replies[0] on this branch.
    expect((b.replies[0] as { attachments: unknown[] }).attachments).toEqual([]);
  });

  it('refuses a stranger driving somebody else own-park tabs', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Other');
    const b = fakeButton({ customId: 'park:tab:u1:lots', user: 'u2' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(JSON.stringify(b.replies[0])).toContain('Not your park');
  });

  it('absorbs an unknown tab name rather than rendering a default screen', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:tab:u1:map', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(b.deferOpts).toEqual([{ kind: 'update' }]);
    expect(b.replies).toEqual([]);
  });

  // ADDED DURING EXECUTION — recovers coverage this plan would otherwise have lost.
  // Task 2 deleted the /park view `foodLine` local and Task 3's animalsPayload takes
  // `foodLine?: string` as an opaque value, so between them nothing tested the
  // DB-to-string formatting any more: the food-line test retargeted in Task 3 now only
  // asserts that the Food field echoes a hardcoded string. This task is where that
  // formatting is reintroduced (the getFoodInventory / FOODS / foodEmoji join in
  // renderTab's animals branch), so this is where it has to be tested again.
  it('formats the food line from real inventory rows, not a passed-in string', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    // getOrCreateUser seeds STARTER_FOOD (10 ferns, 10 fish); cleared here so the two
    // items asserted below are the whole story, not two of four.
    ctx.economy.apply('u1', { foods: { ferns: -10, fish: -10 } }, 'test', 0);
    ctx.economy.apply('u1', { foods: { fruit_basket: 10 } }, 'test', 0);
    ctx.economy.apply('u1', { foods: { prime_steak: 2 } }, 'test', 0);
    const b = fakeButton({ customId: 'park:tab:u1:animals', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const food = (sent.embeds[0].toJSON().fields ?? []).find((f) => f.name.includes('Food'))!.value;
    // Both items present, joined — the grouping and separator are the thing under test.
    expect(food).toContain('×10');
    expect(food).toContain('×2');
    expect(food).toContain(' · ');
  });

  it('falls back to the shop hint when the player holds no food at all', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    // getOrCreateUser seeds STARTER_FOOD (10 ferns, 10 fish) — clear it so this case
    // actually exercises the empty-inventory fallback rather than the starter pantry.
    ctx.economy.apply('u1', { foods: { ferns: -10, fish: -10 } }, 'test', 0);
    const b = fakeButton({ customId: 'park:tab:u1:animals', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const food = (sent.embeds[0].toJSON().fields ?? []).find((f) => f.name.includes('Food'))!.value;
    expect(food).toContain('/shop food');
  });
});
