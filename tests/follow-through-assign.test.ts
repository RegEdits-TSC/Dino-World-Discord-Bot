import { describe, it, expect, beforeEach } from 'vitest';
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeButton, fakeSelect, replyText, testRegistry } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { assignDino, eligiblePaddocks } from '../src/modules/park/dinos.js';
import { assignRow, assignSelectRow } from '../src/modules/park/embeds.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import type { Config } from '../src/core/config.js';
import { routeInteraction } from '../src/core/router.js';

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

// fakeButton defaults the message's component list to [customId] (tests/harness.ts), which
// is exactly the well-formed shape: in a real client the only button you can click is one
// the message carries. A fixture opts out with `componentIds: []` to model a forged id, and
// none of these cases wants that — they model real clicks on real cards.
const lotOf = (dinoId: number) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, dinoId)).get()!.lotId;

describe('park:assign — the one-eligible follow-through button', () => {
  it('routes the minted id through the registry and assigns the dino', async () => {
    seedUser();
    const lot = seedLot();
    const d = seedDino();
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts).toHaveLength(0);         // dispatched, not absorbed by the default arm
    expect(replyText(b.replies[0])).toBe(`🦕 Assigned to lot #${lot.id}.`);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(lotOf(d.id)).toBe(lot.id);
  });

  it('refuses a bystander and writes nothing', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    const lot = seedLot();
    const d = seedDino();
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('Not your assignment.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('says the paddock is full when it filled up between mint and click', async () => {
    seedUser();
    // seedLot() defaults to level 1; the two seedDino calls below fill it to
    // paddockCapacity(1) exactly, so it is full by the time the button is clicked.
    const lot = seedLot();
    const d = seedDino();
    seedDino({ lotId: lot.id }); seedDino({ lotId: lot.id });
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    // NOT the staleness line: a full paddock is a state the player can do something about,
    // and the /build follow-through's picker says exactly this sentence for the same cause.
    expect(replyText(b.replies[0])).toBe('That paddock is full.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('says the dino has escaped rather than blaming the lot', async () => {
    seedUser();
    const lot = seedLot();
    // Reachable in production by escaping (which needs a paddock) and then running
    // /dino unassign, which clears lotId without clearing escapedAt.
    const d = seedDino({ escapedAt: 1 });
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That dino has escaped — rescue it first.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('refuses when the lot is gone', async () => {
    seedUser();
    const lot = seedLot();
    const d = seedDino();
    ctx.db.delete(schema.lots).where(eq(schema.lots.id, lot.id)).run();
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('refuses a forged id naming somebody else’s dino, and leaves that dino alone', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    const lot = seedLot();
    const theirs = ctx.db.insert(schema.dinos).values({
      userId: 'u2', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const b = fakeButton({ customId: `park:assign:u1:${theirs.id}:${lot.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
    expect(lotOf(theirs.id)).toBeNull();
  });

  it('refuses a forged id naming an off-diet paddock, and never halves comfort', async () => {
    seedUser();
    const carn = seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });
    const d = seedDino();                                  // triceratops, herbivore
    const b = fakeButton({ customId: `park:assign:u1:${d.id}:${carn.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('is a first-home control: a later click never drags the dino back', async () => {
    seedUser();
    const a = seedLot(); const b2 = seedLot();
    const d = seedDino();
    const customId = `park:assign:u1:${d.id}:${a.id}`;
    const first = fakeButton({ customId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, first.asInteraction());
    expect(replyText(first.replies[0])).toBe(`🦕 Assigned to lot #${a.id}.`);
    // The player then moves the dino with /dino assign. The reveal card is durable and is
    // never repainted, so it still holds the old button — this is stale SAME-MESSAGE
    // replay, which the router guard does not and cannot see.
    assignDino(ctx, 'u1', d.id, b2.id);
    const again = fakeButton({ customId, user: 'u1' });
    await routeInteraction(ctx, testRegistry, again.asInteraction());
    expect(replyText(again.replies[0])).toBe(`Already assigned to lot #${b2.id}.`);
    expect(lotOf(d.id)).toBe(b2.id);
  });
});

const menuOf = (reply: unknown) => (JSON.parse(JSON.stringify(reply)) as {
  components: Array<{ components: Array<{ custom_id: string; options: Array<{ value: string }> }> }>;
}).components[0]!.components[0]!;

describe('park:assignpick and park:assignsel', () => {
  it('the picker opens an ephemeral menu of exactly the currently eligible paddocks', async () => {
    seedUser();
    const a = seedLot(); const b2 = seedLot();
    seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });   // never offered
    const d = seedDino();
    const btn = fakeButton({ customId: `park:assignpick:u1:${d.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, btn.asInteraction());
    expect(btn.deferOpts).toHaveLength(0);
    expect((btn.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    const menu = menuOf(btn.replies[0]);
    expect(menu.custom_id).toBe(`park:assignsel:u1:${d.id}`);
    expect(menu.options.map((o) => o.value)).toEqual([String(a.id), String(b2.id)]);
  });

  it('the picker refuses a bystander', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    seedLot(); seedLot();
    const d = seedDino();
    const btn = fakeButton({ customId: `park:assignpick:u1:${d.id}`, user: 'u2' });
    await routeInteraction(ctx, testRegistry, btn.asInteraction());
    expect(replyText(btn.replies[0])).toBe('Not your assignment.');
  });

  it('the picker refuses a dino that already has a home', async () => {
    seedUser();
    const a = seedLot(); seedLot();
    const d = seedDino({ lotId: a.id });
    const btn = fakeButton({ customId: `park:assignpick:u1:${d.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, btn.asInteraction());
    expect(replyText(btn.replies[0])).toBe(`Already assigned to lot #${a.id}.`);
  });

  it('the picker refuses rather than opening an empty menu', async () => {
    seedUser();
    seedLot({ kind: 'carnivore_paddock', name: 'Carnivore Paddock' });   // off diet only
    const d = seedDino();
    const btn = fakeButton({ customId: `park:assignpick:u1:${d.id}`, user: 'u1' });
    await routeInteraction(ctx, testRegistry, btn.asInteraction());
    expect(replyText(btn.replies[0])).toBe('That lot changed — open `/park view` again.');
  });

  it('routes the select through the registry and assigns to the picked lot', async () => {
    seedUser();
    const a = seedLot(); const b2 = seedLot();
    const d = seedDino();
    const s = fakeSelect({
      customId: `park:assignsel:u1:${d.id}`, user: 'u1',
      values: [String(b2.id)], options: [String(a.id), String(b2.id)],
    });
    await routeInteraction(ctx, testRegistry, s.asInteraction());
    expect(replyText(s.replies[0])).toBe(`🦕 Assigned to lot #${b2.id}.`);
    expect(lotOf(d.id)).toBe(b2.id);
  });

  it('says the paddock is full when an offered lot filled up before the pick', async () => {
    seedUser();
    const a = seedLot(); const b2 = seedLot();
    const d = seedDino();
    seedDino({ lotId: b2.id }); seedDino({ lotId: b2.id });   // b2 (level 1) is now at paddockCapacity(1)
    const s = fakeSelect({
      customId: `park:assignsel:u1:${d.id}`, user: 'u1',
      values: [String(b2.id)], options: [String(a.id), String(b2.id)],
    });
    await routeInteraction(ctx, testRegistry, s.asInteraction());
    // Same sentence the button path gives for the same cause — the two share
    // assignFollowThrough precisely so they cannot disagree.
    expect(replyText(s.replies[0])).toBe('That paddock is full.');
    expect(lotOf(d.id)).toBeNull();
  });

  it('refuses a bystander submitting the menu', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    const a = seedLot();
    const d = seedDino();
    const s = fakeSelect({
      customId: `park:assignsel:u1:${d.id}`, user: 'u2',
      values: [String(a.id)], options: [String(a.id)],
    });
    await routeInteraction(ctx, testRegistry, s.asInteraction());
    expect(replyText(s.replies[0])).toBe('Not your park.');
    expect(lotOf(d.id)).toBeNull();
  });
});

describe('park:goto:lots — the Build a paddock landing', () => {
  it('routes the button to an ephemeral Lots surface carrying the Build and Upgrade menus', async () => {
    seedUser();
    seedLot({ type: 'facility', kind: 'gene_lab', name: 'Gene Lab' });
    const b = fakeButton({ customId: 'park:goto:lots:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts).toHaveLength(0);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    const json = JSON.stringify(b.replies[0]);
    expect(json).toContain('park:build:u1');
    expect(json).toContain('park:upgrade:u1');
    // lotsPayload appends tabRow on EVERY call, unlike landmarkPayload/guestsPayload/
    // dinoListPayload. This reply is not the card the player is navigating — it is a routed
    // ephemeral opened FROM one — so the row is stripped: leaving it would turn this
    // ephemeral into a second, parallel park dashboard on the first tab click, which is
    // exactly the duplication the goto family exists to avoid.
    expect(json).not.toContain('park:tab:u1:');
  });

  it('refuses a bystander', async () => {
    seedUser(); getOrCreateUser(ctx, 'u2', 'u2');
    const b = fakeButton({ customId: 'park:goto:lots:u1', user: 'u2' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(replyText(b.replies[0])).toBe('Not your park.');
  });

  it('the Lots TAB still keeps its tab row after the extraction', async () => {
    seedUser();
    seedLot({ type: 'facility', kind: 'gene_lab', name: 'Gene Lab' });
    const b = fakeButton({ customId: 'park:tab:u1:lots', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    const json = JSON.stringify(b.replies[0]);
    expect(json).toContain('park:build:u1');
    expect(json).toContain('park:upgrade:u1');
    expect(json).toContain('park:tab:u1:animals');
  });
});
