import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, fakeSelect, replyText, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino, assignableDinosFor } from '../src/modules/park/dinos.js';
import { parkModule } from '../src/modules/park/index.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
});

const buildCmd = () => parkModule.commands.find((c) => c.data.name === 'build')!;
const addDino = (speciesId: string, over: Record<string, unknown> = {}) =>
  ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId, lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();
const dinoOf = (id: number) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;

// Every customId on a recorded payload, read out of the REAL builder JSON (snake_case
// custom_id) rather than hand-typed, so these cases prove what the game actually mints.
const idsOf = (payload: unknown): string[] =>
  ((payload as { components?: ReadonlyArray<{ toJSON(): { components: Array<{ custom_id?: string }> } }> })
    .components ?? [])
    .flatMap((r) => r.toJSON().components)
    .map((c) => c.custom_id)
    .filter((x): x is string => typeof x === 'string');

// Whether any minted id belongs to a family, for the cases that assert a control is ABSENT.
// A negative `toContain` on one exact id would pass against `park:builddino:u1:99`.
const hasIdStarting = (payload: unknown, stem: string) =>
  idsOf(payload).some((id) => id.startsWith(stem));

// The option VALUES of every string select (ComponentType.StringSelect === 3) on a payload.
const optionsOf = (payload: unknown): string[] =>
  ((payload as {
    components?: ReadonlyArray<{ toJSON(): { components: Array<{ type: number; options?: Array<{ value: string }> }> } }>;
  }).components ?? [])
    .flatMap((r) => r.toJSON().components)
    .filter((c) => c.type === 3)
    .flatMap((c) => (c.options ?? []).map((o) => o.value));

describe('/build offers the next step as a control', () => {
  it('a paddock build mints the assign button, carrying the owner and the lot', async () => {
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'herbivore_paddock' } });
    await buildCmd().execute(ctx, i.asChatInput());
    // The WHOLE id, not a stem: a reply that merely carried something starting with
    // 'park:builddino' would still pass with the lot segment dropped — the segment that
    // stops one button opening a menu against the wrong lot.
    expect(idsOf(i.replies[0])).toContain('park:builddino:u1:1');
    // The whole content string, so "no longer names /dino assign" is proven by what the
    // reply IS rather than by a negative substring check.
    expect((i.replies[0] as { content: string }).content)
      .toBe('🏗️ Built **Herbivore Paddock** (lot #1).');
  });

  it('a facility build mints no assign button — nothing lives in a Visitor Center', async () => {
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'visitor_center' } });
    await buildCmd().execute(ctx, i.asChatInput());
    expect(hasIdStarting(i.replies[0], 'park:builddino')).toBe(false);
  });
});

describe('assignableDinosFor', () => {
  it('offers only free, unescaped, diet-matching dinos and reports whether there is room', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');   // level 1 → capacity 2
    const free = addDino('triceratops');
    const escaped = addDino('triceratops', { escapedAt: 1 });   // escaped — never offered
    addDino('velociraptor');                                    // carnivore — wrong diet
    const housed = addDino('triceratops');
    assignDino(ctx, 'u1', housed.id, lot.id);
    const pick = assignableDinosFor(ctx, 'u1', lot.id)!;
    // toEqual on the whole id list, not a .some(): three separate filters produce this
    // answer and a containment check would still pass with two of them deleted.
    expect(pick.dinos.map((d) => d.id)).toEqual([free.id]);
    // ofDiet is the WHOLE herbivore cohort — free, escaped and housed alike. It is what
    // lets the handler tell "you own none of this diet" from "none of yours is free",
    // and dropping the escaped or housed row from it collapses the two back into one.
    expect(pick.ofDiet.map((d) => d.id)).toEqual([free.id, escaped.id, housed.id]);
    expect(pick.hasRoom).toBe(true);          // 1 of 2 occupied
    expect(pick.lot.id).toBe(lot.id);
  });

  it('reports no room once the paddock is at its level capacity', () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    addDino('triceratops');                                     // free, but nowhere to put it
    expect(assignableDinosFor(ctx, 'u1', lot.id)!.hasRoom).toBe(false);
  });

  it('is null for a lot that is not an owned paddock', () => {
    const facility = buildLot(ctx, 'u1', 'visitor_center');
    expect(assignableDinosFor(ctx, 'u1', facility.id)).toBeNull();   // a facility, not a paddock
    const mine = buildLot(ctx, 'u1', 'herbivore_paddock');
    expect(assignableDinosFor(ctx, 'u2', mine.id)).toBeNull();       // somebody else's lot
    expect(assignableDinosFor(ctx, 'u1', 9_999)).toBeNull();         // no such lot
  });
});

describe('park:builddino — the assign menu', () => {
  // lotSeg is deliberately `number | string` so one case can send a MALFORMED segment
  // through the same real router path the well-formed ones take.
  const click = async (lotSeg: number | string, user: string) => {
    const customId = `park:builddino:u1:${lotSeg}`;
    // componentIds is STATED, never left to the harness default it happens to equal: these
    // cases must exercise the passing side of the router guard against a real button set.
    const b = fakeButton({ customId, user, componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    return b;
  };

  it('routes through the real registry and opens a private menu of the free matching dinos', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const a = addDino('triceratops');
    const c = addDino('triceratops');
    addDino('velociraptor');                              // wrong diet
    addDino('triceratops', { escapedAt: 1 });             // escaped
    const b = await click(lot.id, 'u1');
    expect(b.deferOpts).toHaveLength(0);      // dispatched, not swallowed by the default arm
    expect(b.replies).toHaveLength(1);
    expect(idsOf(b.replies[0])).toContain(`park:builddinosel:u1:${lot.id}`);
    // The whole option list: this is the filtered roster, not a components array, and it is
    // the only assertion that proves the three filters ran.
    expect(optionsOf(b.replies[0])).toEqual([String(a.id), String(c.id)]);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('refuses a bystander clicking the public build reply', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    addDino('triceratops');
    const b = await click(lot.id, 'u2');
    expect(replyText(b.replies[0])).toBe('Not your park.');
    expect(hasIdStarting(b.replies[0], 'park:builddinosel')).toBe(false);
  });

  it('names the real cause when the player owns no dino of that diet at all', async () => {
    // The operator's own first-run case: build a paddock, click Assign, own nothing that
    // eats there. "Every one you own is housed or escaped" would be a FALSE statement here
    // and /dino unassign cannot help — the same two-causes-two-messages split feedDino makes.
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    addDino('velociraptor');                              // carnivore only
    const b = await click(lot.id, 'u1');
    expect(replyText(b.replies[0]))
      .toBe('You own no herbivore dinos yet — hatch one from `/eggs`.');
    expect(hasIdStarting(b.replies[0], 'park:builddinosel')).toBe(false);
  });

  it('names the OTHER cause when every dino of that diet is housed or escaped', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const other = buildLot(ctx, 'u1', 'herbivore_paddock');
    assignDino(ctx, 'u1', addDino('triceratops').id, other.id);   // housed elsewhere
    addDino('triceratops', { escapedAt: 1 });                     // escaped
    addDino('velociraptor');                                      // carnivore — wrong diet
    const b = await click(lot.id, 'u1');
    expect(replyText(b.replies[0])).toBe(
      'No free herbivore dinos — every herbivore you own is housed or escaped.'
      + ' Free one with `/dino unassign`, or hatch another from `/eggs`.');
    expect(hasIdStarting(b.replies[0], 'park:builddinosel')).toBe(false);
  });

  it('says the paddock is full rather than offering a menu that cannot be used', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');         // capacity 2
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    addDino('triceratops');                                       // free, but nowhere to put it
    const b = await click(lot.id, 'u1');
    // PADDOCK_FULL — the same sentence assignDino throws and the same one park:assign
    // surfaces, so a player who fills a paddock between mint and click reads one
    // explanation whichever control they pressed.
    expect(replyText(b.replies[0])).toBe('That paddock is full.');
    expect(hasIdStarting(b.replies[0], 'park:builddinosel')).toBe(false);
  });

  it('refuses once the lot is gone rather than crashing on a missing paddock def', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    addDino('triceratops');
    ctx.db.delete(schema.lots).run();                             // what adminReset does
    const b = await click(lot.id, 'u1');
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
  });

  it('answers a malformed lot segment as a lot that changed, and never crashes', async () => {
    // An id from an older deploy, or a forged one. Number('abc') is NaN, better-sqlite3 binds
    // NaN as a legal no-match, and the lot read therefore lands on its not-found arm — the
    // same behaviour assignRefusal relies on, and the reason this handler grows no parse
    // branch of its own. Pinned so "no integer guard" stays a decision rather than a gap.
    buildLot(ctx, 'u1', 'herbivore_paddock');
    addDino('triceratops');
    const b = await click('abc', 'u1');
    expect(replyText(b.replies[0])).toBe('That lot changed — open `/park view` again.');
  });
});

describe('park:builddinosel — the pick', () => {
  const pickDino = async (lotId: number, dinoId: number, user: string) => {
    const customId = `park:builddinosel:u1:${lotId}`;
    const s = fakeSelect({
      customId, user, values: [String(dinoId)], options: [String(dinoId)], componentIds: [customId],
    });
    await routeInteraction(ctx, testRegistry, s.asInteraction());
    return s;
  };

  it('routes the pick through the registry and reads the LOT from the id, the DINO from the value', async () => {
    // Two lots on purpose, so the paddock is #2 while the dino is #1. This mirror of
    // park:assignsel carries the two the other way round, and with both ids equal to 1 a
    // swapped pair would assign correctly by coincidence and prove nothing.
    buildLot(ctx, 'u1', 'carnivore_paddock');
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = addDino('triceratops');
    const s = await pickDino(lot.id, d.id, 'u1');
    expect(s.deferOpts).toHaveLength(0);
    expect(replyText(s.replies[0])).toBe(`🦕 Assigned to lot #${lot.id}.`);
    expect((s.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(dinoOf(d.id).lotId).toBe(lot.id);
  });

  it('says the paddock is full when it filled up between the mint and the pick', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');         // capacity 2
    const d = addDino('triceratops');
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    assignDino(ctx, 'u1', addDino('triceratops').id, lot.id);
    const s = await pickDino(lot.id, d.id, 'u1');
    expect(replyText(s.replies[0])).toBe('That paddock is full.');
    expect(dinoOf(d.id).lotId).toBeNull();
  });

  it('refuses a dino that found a home between the mint and the pick', async () => {
    // The shared first-home rule, reached through this menu: the chooser is an ephemeral that
    // survives a /dino assign run beside it, and this is the arm that stops a stale pick
    // dragging a dino back out of the paddock the player last chose.
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const other = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = addDino('triceratops');
    assignDino(ctx, 'u1', d.id, other.id);
    const s = await pickDino(lot.id, d.id, 'u1');
    expect(replyText(s.replies[0])).toBe(`Already assigned to lot #${other.id}.`);
    expect(dinoOf(d.id).lotId).toBe(other.id);
  });

  it('refuses a bystander submitting against somebody else\'s menu', async () => {
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const d = addDino('triceratops');
    const s = await pickDino(lot.id, d.id, 'u2');
    expect(replyText(s.replies[0])).toBe('Not your park.');
    expect(dinoOf(d.id).lotId).toBeNull();
  });
});

describe('park:buildyes also mints the assign control', () => {
  // The trailing :0 is the lot-count anchor the handler validates against a fresh read before
  // it builds — the player owns no lots, so the id is not stale.
  const confirm = async (kind: string) => {
    const customId = `park:buildyes:u1:${kind}:0`;
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    return b;
  };

  it('follows the Lots tab render with a private Assign control for the new paddock', async () => {
    const b = await confirm('herbivore_paddock');
    // Two payloads: renderTab's i.update of the Lots tab, then the ephemeral follow-up. The
    // control cannot ride on the tab itself — renderTab owns that whole payload and sends it.
    expect(b.replies).toHaveLength(2);
    expect(idsOf(b.replies[1])).toContain('park:builddino:u1:1');
    expect((b.replies[1] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('mints no assign control when the confirm built a facility', async () => {
    const b = await confirm('visitor_center');
    expect(b.replies).toHaveLength(1);
  });
});
