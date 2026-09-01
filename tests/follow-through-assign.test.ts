import { describe, it, expect, beforeEach } from 'vitest';
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { eligiblePaddocks } from '../src/modules/park/dinos.js';
import { assignRow, assignSelectRow } from '../src/modules/park/embeds.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import type { Config } from '../src/core/config.js';

let ctx: ReturnType<typeof makeCtx>;

// makeCtx defaults to `modules: {}` (tests/harness.ts), and the hatch reveal in the last
// task of this slice gates its CROSS-MODULE mint on `ctx.config.modules.park` — because
// ModuleRegistry resolves a component handler only among ENABLED modules
// (src/core/modules.ts), so a `park:` id minted while park is off is a dead button. Under
// the default that gate is false, no row is minted, and those cases would go
// green-but-vacuous. Mirroring modules.json's live values here is what keeps them honest;
// the one case that deliberately wants the gate SHUT builds its own default ctx.
// Derived from ALL_MODULES, never a hand-written list of names: a gate added later on a
// module this literal happened not to name would read `undefined`, suppress its own control,
// and leave the test green with nothing to show for it. tests/harness.ts already compiles this
// exact expression for testRegistry, so it is proven under `npm run typecheck`.
const CONFIG: Config = {
  token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner',
  modules: Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])),
};
beforeEach(() => { ctx = makeCtx({ config: CONFIG }); });

// Defaults are a matched pair: `triceratops` is a common herbivore
// (src/data/species/triceratops.ts) and the default lot is a herbivore paddock
// (src/data/paddocks.ts), so every mismatch case states its own override.
const seedUser = (id = 'u1') => getOrCreateUser(ctx, id, id);
const seedLot = (over: Partial<typeof schema.lots.$inferInsert> = {}) =>
  ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock', ...over,
  }).returning().get();
const seedDino = (over: Partial<typeof schema.dinos.$inferInsert> = {}) =>
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();

describe('eligiblePaddocks', () => {
  it('returns only paddocks that match the diet and still have room', () => {
    seedUser();
    const match = seedLot();
    seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });              // off diet
    seedLot({ type: 'facility', kind: 'visitor_center', name: 'Visitor Center' });  // not a paddock
    const full = seedLot();
    seedDino({ lotId: full.id }); seedDino({ lotId: full.id });                     // 2/2 at level 1
    const d = seedDino();
    expect(eligiblePaddocks(ctx, 'u1', d.id).map((l) => l.id)).toEqual([match.id]);
  });

  it('still offers the paddock the dino already lives in, even at capacity', () => {
    seedUser();
    const lot = seedLot();
    const resident = seedDino({ lotId: lot.id });
    seedDino({ lotId: lot.id });      // 2/2 counting the resident itself
    // assignDino excludes the dino being moved from its own occupancy check
    // (ne(dinos.id, dinoId), src/modules/park/dinos.ts). A chooser that forgot that would
    // hide a move the service would happily accept.
    expect(eligiblePaddocks(ctx, 'u1', resident.id).map((l) => l.id)).toEqual([lot.id]);
  });

  it('reads capacity off the lot level rather than a constant', () => {
    seedUser();
    const lot = seedLot({ level: 2 });                     // paddockCapacity(2) === 4
    for (let n = 0; n < 3; n++) seedDino({ lotId: lot.id });
    const d = seedDino();
    expect(eligiblePaddocks(ctx, 'u1', d.id).map((l) => l.id)).toEqual([lot.id]);
    seedDino({ lotId: lot.id });                           // now 4/4
    expect(eligiblePaddocks(ctx, 'u1', d.id)).toEqual([]);
  });

  it('offers nothing for an escaped dino, a dino the caller does not own, or a junk id', () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    seedLot();
    const escaped = seedDino({ escapedAt: 1 });
    const mine = seedDino();
    expect(eligiblePaddocks(ctx, 'u1', escaped.id)).toEqual([]);
    expect(eligiblePaddocks(ctx, 'u2', mine.id)).toEqual([]);
    // Number('nope') is NaN, which better-sqlite3 binds as a legal no-match rather than
    // throwing — measured, not assumed. So a forged segment falls out as "offer nothing".
    expect(eligiblePaddocks(ctx, 'u1', Number('nope'))).toEqual([]);
  });
});

describe('assignRow — the shape is chosen at mint time', () => {
  const buttonsOf = (row: ActionRowBuilder<ButtonBuilder>) =>
    (row.toJSON() as { components: Array<{ custom_id: string; label: string }> }).components;

  it('mints a direct Assign button carrying the one eligible lot', () => {
    seedUser();
    const lot = seedLot();
    const d = seedDino();
    const [btn] = buttonsOf(assignRow('u1', d.id, eligiblePaddocks(ctx, 'u1', d.id)));
    expect(btn!.custom_id).toBe(`park:assign:u1:${d.id}:${lot.id}`);
    expect(btn!.label).toBe(`🦕 Assign to #${lot.id}`);
  });

  it('mints the picker when several paddocks are eligible', () => {
    seedUser();
    seedLot(); seedLot();
    const d = seedDino();
    const [btn] = buttonsOf(assignRow('u1', d.id, eligiblePaddocks(ctx, 'u1', d.id)));
    expect(btn!.custom_id).toBe(`park:assignpick:u1:${d.id}`);
    expect(btn!.label).toBe('🦕 Assign… ▼');
  });

  it('mints Build a paddock, and no assign control at all, when none is eligible', () => {
    seedUser();
    seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });   // off diet only
    const d = seedDino();
    const btns = buttonsOf(assignRow('u1', d.id, eligiblePaddocks(ctx, 'u1', d.id)));
    // One button, always: this builder's whole contract is that exactly one of the three
    // shapes is on the card, so the length IS the assertion here. (The payloads this row
    // gets PUSHED onto are a different matter — those are asserted with toContain, because
    // sibling work mints onto the same arrays.)
    expect(btns).toHaveLength(1);
    expect(btns[0]!.custom_id).toBe('park:goto:lots:u1');
    expect(btns[0]!.label).toBe('🏗️ Build a paddock');
  });

  it('assignSelectRow offers lot ids as values and nothing else', () => {
    seedUser();
    const a = seedLot(); const b = seedLot({ level: 2 });
    const d = seedDino();
    const menu = (assignSelectRow('u1', d.id, eligiblePaddocks(ctx, 'u1', d.id)).toJSON() as {
      components: Array<{ custom_id: string; options: Array<{ value: string; label: string }> }>;
    }).components[0]!;
    expect(menu.custom_id).toBe(`park:assignsel:u1:${d.id}`);
    expect(menu.options.map((o) => o.value)).toEqual([String(a.id), String(b.id)]);
    expect(menu.options[1]!.label).toBe(`#${b.id} Herbivore Paddock (lvl 2)`);
  });
});
