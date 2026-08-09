import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand, fakeAutocomplete, fakeButton, replyText } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { recordSpeciesSeen } from '../src/core/species-seen.js';
import { dexRows, dexEntry, dexProgress, parseDexFilters, RARITIES, DIETS, ARCHETYPES } from '../src/modules/dex/service.js';
import { dexListPayload, dexViewPayload, dexPageRow } from '../src/modules/dex/embeds.js';
import { dexModule } from '../src/modules/dex/index.js';
import { allSpecies } from '../src/data/species/index.js';
import { RARITY } from '../src/data/rarity.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

describe('dexRows', () => {
  it('lists the whole roster in a stable order with seen marks', () => {
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const rows = dexRows(ctx, 'u1', {});
    expect(rows).toHaveLength(42);
    expect(rows.map((r) => r.species.id)).toEqual(allSpecies().map((s) => s.id));
    expect(rows.find((r) => r.species.id === 'triceratops')!.seen).toBe(true);
    expect(rows.find((r) => r.species.id === 'velociraptor')!.seen).toBe(false);
  });
  it('filters by rarity, diet and archetype, and combines them', () => {
    expect(dexRows(ctx, 'u1', { rarity: 'mythic' })).toHaveLength(3);
    expect(dexRows(ctx, 'u1', { diet: 'herbivore' })).toHaveLength(18);
    expect(dexRows(ctx, 'u1', { archetype: 'tank' })).toHaveLength(9);
    // rare has 9 species, of which ankylosaurus is the sole herbivore — the other 8
    // are carnivore (verified against src/data/species/*.ts). Unlike a mythic+carnivore
    // pair (all 3 mythic species are carnivore, so a dropped diet clause would still
    // pass), this pair has a real herbivore for a broken AND to leak through.
    const combo = dexRows(ctx, 'u1', { rarity: 'rare', diet: 'carnivore' });
    expect(combo).toHaveLength(8);
    expect(combo.some((r) => r.species.id === 'ankylosaurus')).toBe(false);
    for (const r of combo) {
      expect(r.species.rarity).toBe('rare');
      expect(r.species.diet).toBe('carnivore');
    }
  });
  // legendary+support is genuinely empty on the current roster (verified by counting
  // src/data/species/*.ts: the empty pairs are common+bruiser, rare+support,
  // legendary+support and mythic+support). If a future species fills it, move this to
  // another empty pair rather than deleting the case.
  it('returns an empty list when a filter combination matches nothing', () => {
    expect(dexRows(ctx, 'u1', { rarity: 'legendary', archetype: 'support' })).toEqual([]);
  });
});

describe('dexEntry', () => {
  it('carries the rarity-derived numbers and the enriching kinds', () => {
    const e = dexEntry(ctx, 'u1', 'triceratops');
    expect(e.species.name).toBe('Triceratops');
    expect(e.seen).toBe(false);
    expect(e.firstAt).toBeNull();
    // Pinned against the live table, not just >0, so a field-swap bug (incomePerHr and
    // incubationMs assigned from each other) turns this red instead of staying green —
    // both fields are positive numbers on every tier, so >0 could not catch a swap.
    expect(e.incomePerHr).toBe(RARITY.common.incomePerHr);
    expect(e.incubationMs).toBe(RARITY.common.incubationMs);
    expect(e.enrichingKinds).toContain('palm_tree');
  });
  it('reports the first-owned instant once seen', () => {
    ctx.setNow(1_234);
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const e = dexEntry(ctx, 'u1', 'triceratops');
    expect(e.seen).toBe(true);
    expect(e.firstAt).toBe(1_234);
  });
  it('throws on an unknown species, like getSpecies', () => {
    expect(() => dexEntry(ctx, 'u1', 'barney')).toThrow(/Unknown species/);
  });
});

describe('dexProgress', () => {
  it('counts seen against the full roster', () => {
    expect(dexProgress(ctx, 'u1')).toEqual({ seen: 0, total: 42 });
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    expect(dexProgress(ctx, 'u1')).toEqual({ seen: 1, total: 42 });
  });
  it('ignores a seen species that is no longer in the roster', () => {
    recordSpeciesSeen(ctx, 'u1', 'retired_dino');
    expect(dexProgress(ctx, 'u1').seen).toBe(0);
  });
});

describe('dexListPayload', () => {
  it('pages the roster ten at a time and clamps an out-of-range page', () => {
    const first = dexListPayload(ctx, 'u1', {}, 1);
    expect(JSON.stringify(first)).toContain('Page 1/5');
    const clamped = dexListPayload(ctx, 'u1', {}, 99);
    expect(JSON.stringify(clamped)).toContain('Page 5/5');
  });
  it('drops the page row when a filter fits on one page', () => {
    const payload = dexListPayload(ctx, 'u1', { rarity: 'mythic' }, 1);
    expect(payload.components ?? []).toHaveLength(0);
  });
  it('shows progress and marks a seen species', () => {
    recordSpeciesSeen(ctx, 'u1', 'triceratops');
    const text = JSON.stringify(dexListPayload(ctx, 'u1', {}, 1));
    expect(text).toContain('1/42');
    expect(text).toContain('Triceratops');
  });
  it('renders an empty filter result without throwing', () => {
    // legendary+support is empty on the current roster — see the note in the dexRows
    // tests above for the other three empty pairs.
    const payload = dexListPayload(ctx, 'u1', { rarity: 'legendary', archetype: 'support' }, 1);
    expect(JSON.stringify(payload)).toContain('No species');
  });
});

describe('dexViewPayload', () => {
  it('names the decor kinds that enrich the species', () => {
    const text = JSON.stringify(dexViewPayload(ctx, 'u1', 'triceratops'));
    expect(text).toContain('Palm Tree');
    expect(text).toContain('Cycad Grove');
  });
  it('says so when the reader has never owned it', () => {
    expect(JSON.stringify(dexViewPayload(ctx, 'u1', 'triceratops'))).toContain('Never owned');
  });
  it('ships at most one file and never an empty files array', () => {
    const payload = dexViewPayload(ctx, 'u1', 'triceratops');
    // assetImage returns null for a missing asset and attach is then a total no-op,
    // so files must be undefined rather than [].
    expect(payload.files === undefined || payload.files.length === 1).toBe(true);
  });
});

describe('dex module', () => {
  it('/dex list replies with the first page', async () => {
    const i = fakeCommand({ name: 'dex', sub: 'list', user: 'u1' });
    await dexModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('Page 1/5');
  });
  it('/dex list accepts filters', async () => {
    const i = fakeCommand({ name: 'dex', sub: 'list', user: 'u1', options: { rarity: 'mythic' } });
    await dexModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('Mythic');
  });
  it('/dex view renders a species', async () => {
    const i = fakeCommand({ name: 'dex', sub: 'view', user: 'u1', options: { species: 'triceratops' } });
    await dexModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('Triceratops');
  });
  it('/dex view answers an unknown species without throwing', async () => {
    const i = fakeCommand({ name: 'dex', sub: 'view', user: 'u1', options: { species: 'barney' } });
    await dexModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('No such species');
  });
  it('the species provider suggests names and never creates a user row', async () => {
    const i = fakeAutocomplete({
      name: 'dex', sub: 'view', user: 'u_new',
      focused: { name: 'species', value: 'trice' },
    });
    await dexModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: string }>;
    expect(rows.some((r) => r.value === 'triceratops')).toBe(true);
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(1);   // only the beforeEach u1
  });
  it('the page button rejects a click from another player', async () => {
    const i = fakeButton({ customId: 'dex:page:u1:2:-:-:-', user: 'u2' });
    await dexModule.components[0].execute(ctx, i.asInteraction() as never);
    expect(replyText(i.replies[0])).toContain('Not your dex');
  });
  it('an unrecognised action still degrades to deferUpdate', async () => {
    const i = fakeButton({ customId: 'dex:sort:u1:2:-:-:-', user: 'u1' });
    await dexModule.components[0].execute(ctx, i.asInteraction() as never);
    expect(i.deferOpts).toHaveLength(1);        // deferred, not answered
    expect(i.replies).toHaveLength(0);
  });
});

// The filters ride in the customId because pageRow (src/core/paginate.ts) has no room
// for them: paging with `{}` returned the UNFILTERED page — wrong rows, wrong title,
// wrong page count, and no error anywhere.
describe('/dex list paging carries its filters', () => {
  type ListEmbed = { title?: string; footer?: { text: string }; description?: string };
  const embedOf = (payload: unknown) =>
    (payload as { embeds: Array<{ toJSON(): ListEmbed }> }).embeds[0].toJSON();
  const buttons = (payload: { components?: Array<{ toJSON(): unknown }> }) =>
    (payload.components![0].toJSON() as { components: Array<{ custom_id: string }> }).components;

  it('the Next button carries the active filters as slugs', () => {
    const payload = dexListPayload(ctx, 'u1', { diet: 'herbivore' }, 1);
    expect(buttons(payload)[1].custom_id).toBe('dex:page:u1:2:-:herbivore:-');
  });

  it('clicking Next on a filtered list stays filtered', async () => {
    // diet:herbivore is 18 of 42 species — two pages, so the row renders and page 2 is
    // real. Unfiltered the same click used to answer 'Page 2/5' with no filter suffix.
    const first = dexListPayload(ctx, 'u1', { diet: 'herbivore' }, 1);
    const i = fakeButton({ customId: buttons(first)[1].custom_id, user: 'u1' });
    await dexModule.components[0].execute(ctx, i.asInteraction() as never);
    const embed = embedOf(i.replies[0]);
    expect(embed.footer!.text).toContain('Page 2/2');
    expect(embed.title).toBe('📖 Dex — Herbivore');
    // ...and the rows really are the filtered ones: no carnivore leaked onto page 2.
    for (const row of dexRows(ctx, 'u1', { diet: 'carnivore' })) {
      expect(embed.description).not.toContain(row.species.name);
    }
  });

  it('an unrecognised filter slug degrades to no filter rather than an empty dex', async () => {
    const i = fakeButton({ customId: 'dex:page:u1:2:banana:tofu:wizard', user: 'u1' });
    await dexModule.components[0].execute(ctx, i.asInteraction() as never);
    const embed = embedOf(i.replies[0]);
    expect(embed.title).toBe('📖 Dex');                    // no filter suffix
    expect(embed.footer!.text).toContain('Page 2/5');      // the whole roster
    expect(embed.description).not.toContain('No species match');
  });

  it('parseDexFilters accepts only real union members', () => {
    expect(parseDexFilters('mythic', 'herbivore', 'tank'))
      .toEqual({ rarity: 'mythic', diet: 'herbivore', archetype: 'tank' });
    // '-' is the absent-filter placeholder, and a swapped-in value from another union
    // (a diet in the rarity slot) is just as unrecognised as nonsense.
    expect(parseDexFilters('-', 'herbivore', '-')).toEqual({ rarity: undefined, diet: 'herbivore', archetype: undefined });
    expect(parseDexFilters('herbivore', 'mythic', 'legendary'))
      .toEqual({ rarity: undefined, diet: undefined, archetype: undefined });
  });

  it('the worst-case page customId fits Discord’s 100-character limit', () => {
    // 19-digit snowflake (the widest Discord issues), the longest member of each union,
    // and a two-digit page: 59 characters. Recompute this pin if a union grows a longer
    // value — the ≤ 100 assertion is the actual contract.
    const longest = <T extends string>(pool: T[]) => pool.reduce((a, b) => (b.length > a.length ? b : a));
    const row = dexPageRow(
      '1234567890123456789',
      { rarity: longest(RARITIES), diet: longest(DIETS), archetype: longest(ARCHETYPES) },
      10, 99,
    ).toJSON() as { components: Array<{ custom_id: string }> };
    for (const b of row.components) expect(b.custom_id.length).toBeLessThanOrEqual(100);
    expect(row.components[1].custom_id).toHaveLength(59);
  });
});
