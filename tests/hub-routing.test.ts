import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeButton, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { getOrCreateUser, toClockDinos } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';
import { hungerAt, drainMsFor, escapeAt, ESCAPE_WARN_MS } from '../src/core/clock.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx({ nowMs: 1_000_000 }); getOrCreateUser(ctx, 'u1', 'U1'); });

// Mirrors tests/hub-service.test.ts's own seedHungryDino in shape (paddocked dino, fully
// fresh, then time pushed forward so hunger drains), but NOT in the elapsed time it uses.
// That fixture pushes `now` a full HUNGER_DRAIN_MS (48h) and is only ever read through
// hubView, a pure read. Here the click runs settleEscapes first (same entry sequence every
// hub component action uses), and at 48h this dino's comfort has already crossed
// ESCAPE_COMFORT (~32h) plus its 8h grace (~40h) — settleEscapes would mark it escaped
// before feedAll ever sees it, and feedAll silently excludes escaped dinos, so the
// fixture would stop being "hungry and feedable" and start being "gone". 24h leaves hunger
// genuinely below 100 while nowhere near that 40h escape instant — verified below rather
// than assumed.
const HUNGRY_NOT_ESCAPED_MS = 24 * 3_600_000;

const seedHungryDino = () => {
  const lot = ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock',
  }).returning().get();
  const dino = ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, lotId: lot.id,
  }).returning().get();
  ctx.setNow(HUNGRY_NOT_ESCAPED_MS);
  const { clockDinos, dinos } = toClockDinos(ctx, 'u1');
  const idx = dinos.findIndex((d) => d.id === dino.id);
  const c = clockDinos[idx];
  expect(hungerAt(c.hungerAtFed, c.lastFedAt, ctx.now(), drainMsFor(c.traits)), 'fixture is not actually hungry')
    .toBeLessThan(100);
  expect(escapeAt(c), 'fixture already reached its escape instant — settleEscapes would drop it as a feedAll candidate')
    .toBeGreaterThan(ctx.now());
  return dino;
};

// Mirrors tests/hub-service.test.ts's own seedAtRiskDino exactly (same lot/dino shape, same
// "one hour before the escape instant" placement). Used for the ordering-guard rehearsal
// below: unlike the hungry-but-safe fixture above, an at-risk dino changes the RENDERED
// card, not just the DB row, once fed — feeding resets hunger to 100, which pushes the
// escape instant from ~1h out to ~40h out, clear of the 12h warn window, so the
// 'dinos-at-risk' row must vanish from the re-rendered embed. A view built before the feed
// (the ordering bug Step 4 rehearses) would still be carrying it.
const seedAtRiskDino = () => {
  const lot = ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock',
  }).returning().get();
  const dino = ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, lotId: lot.id,
  }).returning().get();
  const before = toClockDinos(ctx, 'u1');
  const idx = before.dinos.findIndex((d) => d.id === dino.id);
  const at = escapeAt(before.clockDinos[idx]);
  if (at === null) throw new Error('fixture dino never crosses the escape threshold');
  ctx.setNow(at - 3_600_000);   // one hour before the escape instant — inside the 12h window
  const after = toClockDinos(ctx, 'u1');
  expect(escapeAt(after.clockDinos[idx]), 'fixture already escaped').toBeGreaterThan(ctx.now());
  expect(at - ctx.now(), 'fixture is not within the warn window').toBeLessThanOrEqual(ESCAPE_WARN_MS);
  return dino;
};

describe('the hub component', () => {
  it('hub:open REPLIES a fresh ephemeral and never updates the clicked message', async () => {
    // It is clicked on the park card and on an alert DM. An i.update there would destroy
    // the surface the player came from.
    const b = fakeButton({ customId: 'hub:open:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies, 'hub:open answered nothing').toHaveLength(1);
    // harness.ts has no `updates` accessor — reply vs update is discriminated through the
    // parallel `replyKinds` array (all four ack methods push into the same `replies`).
    expect(b.replyKinds, 'hub:open updated the message it was clicked on').toEqual(['reply']);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('hub:refresh UPDATES in place, shedding the previous render', async () => {
    const b = fakeButton({ customId: 'hub:refresh:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replyKinds).toEqual(['update']);
    // attachments: [] sheds the previous render's uploads; content: '' clears any result
    // line a previous hub:feedall wrote above the card.
    expect((b.replies[0] as { attachments?: unknown[] }).attachments).toEqual([]);
  });

  it('refuses a click by someone who is not the owner', async () => {
    const b = fakeButton({ customId: 'hub:refresh:u1', user: 'intruder' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replyKinds ?? []).not.toContain('update');
    // Indexing [0] with nothing recorded reads `undefined`, and `undefined.flags` throws a
    // TypeError that reads as a broken test rather than as the refusal never happening.
    expect(b.replies, 'the refusal answered nothing at all').toHaveLength(1);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('acknowledges an unknown action instead of leaving it to time out', async () => {
    // A stale id from an older deploy lands here. deferUpdate is a silent ack; a bare
    // return paints "This interaction failed" after three seconds.
    const b = fakeButton({ customId: 'hub:whatever:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts, 'the default arm did not acknowledge').toHaveLength(1);
    expect(b.replies).toHaveLength(0);
  });
});

describe('hub:feedall — the one proxy', () => {
  it('feeds, then UPDATES with the hub card (never the Animals tab), naming how many were fed', async () => {
    const dino = seedHungryDino();
    const b = fakeButton({ customId: 'hub:feedall:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replyKinds, 'hub:feedall replied instead of updating the clicked message').toEqual(['update']);
    const payload = b.replies[0] as { content?: string; embeds?: Array<{ data: { title?: string } }> };
    expect(payload.content).toMatch(/Fed 1 dino/);
    // '🧭 What now?' is the hub's own fixed title (src/modules/hub/embeds.ts); the Animals
    // tab park:feedall would otherwise render carries `${parkName} — Animals` instead. This
    // is the proof the re-render is the hub card and not a park tab wearing the hub's frame.
    expect(payload.embeds?.[0]?.data.title).toBe('🧭 What now?');
    // A repaint with no feed would also pass a bare content-shape assertion — this is what
    // actually proves the feed happened, not just that a line claims it did.
    const row = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, dino.id)).get()!;
    expect(row.lastFedAt, 'lastFedAt did not move — the dino was never actually fed').toBe(ctx.now());
  });

  it('with no food in stock, the content carries feedSkipReport\'s text, not a bare success line', async () => {
    seedHungryDino();
    ctx.db.delete(schema.foodInventory).run();
    const b = fakeButton({ customId: 'hub:feedall:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    const content = (b.replies[0] as { content?: string }).content ?? '';
    expect(content, 'the bare "nothing needed feeding" line, with no skip report appended').not.toBe('Nothing needed feeding.');
    expect(content).toContain('skipped — not enough food');
    expect(content).toContain('Restock with `/shop food`.');
  });

  it('refuses a click by someone who is not the owner, exactly as hub:refresh does', async () => {
    const b = fakeButton({ customId: 'hub:feedall:u1', user: 'intruder' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replyKinds ?? []).not.toContain('update');
    // Same length guard as the hub:refresh refusal above, and for the same reason.
    expect(b.replies, 'the refusal answered nothing at all').toHaveLength(1);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('clicking twice in a row does not throw and does not double-charge', async () => {
    seedHungryDino();
    const first = fakeButton({ customId: 'hub:feedall:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, first.asInteraction());
    const afterFirst = ctx.economy.getFoodInventory('u1');

    const second = fakeButton({ customId: 'hub:feedall:u1', user: 'u1' });
    await expect(routeInteraction(ctx, testRegistry, second.asInteraction())).resolves.not.toThrow();
    const afterSecond = ctx.economy.getFoodInventory('u1');
    expect(afterSecond, 'the second click spent food a fully-fed dino no longer needed').toEqual(afterFirst);
  });

  it('the re-rendered card reflects the feed — an at-risk row it showed pre-feed must not survive into it', async () => {
    seedAtRiskDino();
    const b = fakeButton({ customId: 'hub:feedall:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    const payload = b.replies[0] as { embeds?: Array<{ data: { fields?: Array<{ name: string; value: string }> } }> };
    const fieldText = (payload.embeds?.[0]?.data.fields ?? []).map((f) => f.value).join('\n');
    expect(fieldText, 'the re-rendered card still carries the pre-feed at-risk warning')
      .not.toContain('at risk of escaping');
  });
});
