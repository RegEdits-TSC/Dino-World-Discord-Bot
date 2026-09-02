import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino } from '../src/modules/park/dinos.js';
import { careModule } from '../src/modules/care/index.js';
import { schema } from '../src/core/db/index.js';

const H = 3_600_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { cash: 100_000, foods: { ferns: 100 } }, 'seed', 0);
});

const rescueCmd = () => careModule.commands.find((c) => c.data.name === 'rescue')!;
const dinoOf = (id: number) =>
  ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, id)).get()!;
const fernsHeld = () => ctx.economy.getFoodInventory('u1').ferns ?? 0;

// Read out of the REAL builder JSON (snake_case custom_id), never hand-typed.
const idsOf = (payload: unknown): string[] =>
  ((payload as { components?: ReadonlyArray<{ toJSON(): { components: Array<{ custom_id?: string }> } }> })
    .components ?? [])
    .flatMap((r) => r.toJSON().components)
    .map((c) => c.custom_id)
    .filter((x): x is string => typeof x === 'string');

const embedOf = (payload: unknown) =>
  (payload as { embeds: Array<{ toJSON(): { description?: string } }> }).embeds[0].toJSON();

/**
 * An escaped, paddocked dino ready for /rescue, with the clock at day 1.
 *
 * The clock matters: feedCostFor multiplies by eventMods(now).feedCost, so a cost this file
 * pins as a whole rendered string only holds on a day whose event leaves it at 1. Verify with
 * `eventMods(24 * 3_600_000).feedCost` before changing this fixture's instant.
 */
const escapedDino = () => {
  const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
  const d = ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
  }).returning().get();
  assignDino(ctx, 'u1', d.id, lot.id);
  ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, d.id)).run();
  ctx.setNow(24 * H);
  return d;
};

describe('/rescue offers the next step as a control', () => {
  it('mints the feed button, carrying the owner and the dino', async () => {
    const d = escapedDino();
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: d.id } });
    await rescueCmd().execute(ctx, i.asChatInput());
    // The WHOLE id: a reply that merely carried something starting with 'care:feed' would
    // still pass with the dino segment dropped, and the button would then feed nothing.
    expect(idsOf(i.replies[0])).toContain(`care:feed:u1:${d.id}`);
  });
});

describe('care:feed — the care module\'s first component', () => {
  const click = async (customId: string, user: string) => {
    const b = fakeButton({ customId, user, componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    return b;
  };
  const rescued = async () => {
    const d = escapedDino();
    await rescueCmd().execute(ctx,
      fakeCommand({ name: 'rescue', user: 'u1', options: { dino: d.id } }).asChatInput());
    return d;
  };

  it('routes through the real registry and feeds the dino on one click', async () => {
    const d = await rescued();
    const before = fernsHeld();
    const b = await click(`care:feed:u1:${d.id}`, 'u1');
    expect(b.deferOpts).toHaveLength(0);      // dispatched, not swallowed by the router guard
    expect(b.replies).toHaveLength(1);
    // i.update, never i.reply. `replies` records both and both set `replied`, so this is the
    // only assertion that can tell them apart — and the difference is the whole one-shot
    // control: an i.reply would leave the spent Feed it button standing on a public message.
    expect(b.replyKinds).toEqual(['update']);
    // The whole rendered line, never a substring holding the number: a substring check on
    // '5' passes against a sentence quoting the wrong figure somewhere else in it.
    expect(embedOf(b.replies[0]).description).toBe('Fed your Triceratops (−5 Ferns).');
    expect(fernsHeld()).toBe(before - 5);
    expect(dinoOf(d.id).lastFedAt).toBe(24 * H);
    // The used button is REMOVED, not disabled: neither router guard reads `disabled`.
    expect(idsOf(b.replies[0])).not.toContain(`care:feed:u1:${d.id}`);
    // The rescue banner this update replaces must be shed, or the message keeps both.
    expect((b.replies[0] as { attachments?: unknown[] }).attachments).toEqual([]);
  });

  it('a second click spends nothing — the dino is already full', async () => {
    // The double-click-before-the-repaint case. The fixture deliberately does NOT model the
    // button being removed by the first update: on a public, durable message a stale control
    // is still clickable, and idempotence is what has to hold, not the repaint.
    const d = await rescued();
    await click(`care:feed:u1:${d.id}`, 'u1');
    const after = fernsHeld();
    const b = await click(`care:feed:u1:${d.id}`, 'u1');
    expect(embedOf(b.replies[0]).description).toBe('Your Triceratops is already full.');
    expect(fernsHeld()).toBe(after);
  });

  it('refuses a bystander clicking the public rescue reply', async () => {
    const d = await rescued();
    const before = fernsHeld();
    const b = await click(`care:feed:u1:${d.id}`, 'u2');
    expect(replyText(b.replies[0])).toBe('Not your dino.');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(fernsHeld()).toBe(before);
  });

  it('acknowledges an unrecognised care action instead of leaving it hanging', async () => {
    const b = await click('care:bogus:u1:1', 'u1');
    // A bare return would paint "This interaction failed" after three seconds, and a stale
    // id from an older deploy lands exactly here.
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(1);
    // deferReply would also satisfy the length check while posting a public "thinking…"
    // placeholder that never resolves. Only deferUpdate is a silent, correct no-op.
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });

  it('answers a malformed dino segment the way any unowned id is answered', async () => {
    // Number('abc') is NaN, better-sqlite3 binds NaN as a legal no-match, so both reads land
    // on their not-found arm and feedDino says what it says for every other id naming a dino
    // this player does not own. Pinned so "no parse branch here" stays a decision rather than
    // a gap: a guard for NaN alone, beside a `care:feed:u1:999999` that answers identically,
    // would be one no test could tell apart from this.
    await rescued();
    const b = await click('care:feed:u1:abc', 'u1');
    expect(replyText(b.replies[0])).toBe('You do not own that dino.');
  });

  it('names the shortfall when there is no food, and charges nothing', async () => {
    const d = await rescued();
    ctx.economy.apply('u1', { foods: { ferns: -fernsHeld() } }, 'seed', 0);
    const b = await click(`care:feed:u1:${d.id}`, 'u1');
    // feedDino auto-picks, so an empty pantry is a CareError that already carries the numbers.
    // The InsufficientFundsError arm beside it is a backstop this path cannot reach, and no
    // case here pretends otherwise.
    expect(replyText(b.replies[0]))
      .toBe('You have no herbivore food — buy Ferns with /shop food.');
    expect(fernsHeld()).toBe(0);
  });
});
