import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { LANDMARKS, MAX_LANDMARK_TIER, landmarkFor, landmarkBandFor } from '../src/data/landmarks.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { InsufficientFundsError } from '../src/core/economy.js';
import { makeCtx, fakeCommand, fakeButton } from './harness.js';
import { buyLandmark, nextLandmark, LandmarkMaxedError } from '../src/modules/park/landmarks.js';
import { landmarkPayload } from '../src/modules/park/embeds.js';
import { parkModule } from '../src/modules/park/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
});

describe('landmark ladder', () => {
  it('is six rungs of strictly increasing cost', () => {
    expect(LANDMARKS).toHaveLength(6);
    expect(MAX_LANDMARK_TIER).toBe(6);
    LANDMARKS.forEach((l, i) => expect(l.tier, l.name).toBe(i + 1));
    for (let i = 1; i < LANDMARKS.length; i++) {
      expect(LANDMARKS[i].cost, LANDMARKS[i].name).toBeGreaterThan(LANDMARKS[i - 1].cost);
    }
  });
  it('matches the spec values', () => {
    expect(LANDMARKS.map((l) => l.cost)).toEqual([5_000_000, 10_000_000, 20_000_000, 40_000_000, 80_000_000, 160_000_000]);
    expect(LANDMARKS.map((l) => l.band)).toEqual(['a', 'a', 'b', 'b', 'c', 'c']);
    expect(LANDMARKS.map((l) => l.name)).toEqual([
      'Stone Marker', 'Fossil Plinth', 'Bronze Sentinel', 'Amber Obelisk', 'Grand Rotunda', 'Titan Monument',
    ]);
  });
  it('totals 315,000,000 — the sink sizing the spec is built on', () => {
    expect(LANDMARKS.reduce((s, l) => s + l.cost, 0)).toBe(315_000_000);
  });
  it('every band is used, so no art file is orphaned', () => {
    expect(new Set(LANDMARKS.map((l) => l.band))).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('landmark lookups', () => {
  it('resolve a real tier', () => {
    expect(landmarkFor(1)!.name).toBe('Stone Marker');
    expect(landmarkFor(3)!.cost).toBe(20_000_000);
    expect(landmarkBandFor(5)).toBe('c');
  });
  it('return null outside the ladder rather than throwing or reading past the table', () => {
    for (const t of [0, -1, 7, 99, 1.5, NaN]) {
      expect(landmarkFor(t), `tier ${t}`).toBeNull();
      expect(landmarkBandFor(t), `tier ${t}`).toBeNull();
    }
  });
});

describe('buyLandmark', () => {
  const rich = (c: ReturnType<typeof makeCtx>, cash: number) =>
    c.db.update(schema.users).set({ cash }).where(eq(schema.users.discordId, 'u1')).run();

  it('charges the next tier and increments by exactly one', () => {
    rich(ctx, 5_000_000);
    const def = buyLandmark(ctx, 'u1');
    expect(def.tier).toBe(1);
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(1);
    expect(row.cash).toBe(0);
  });

  it('walks the ladder one rung at a time', () => {
    rich(ctx, 15_000_000);
    buyLandmark(ctx, 'u1');
    const second = buyLandmark(ctx, 'u1');
    expect(second.tier).toBe(2);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(0);
  });

  it('refuses past the top rung', () => {
    ctx.db.update(schema.users).set({ landmarkTier: MAX_LANDMARK_TIER, cash: 999_999_999 })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(() => buyLandmark(ctx, 'u1')).toThrow(LandmarkMaxedError);
  });

  it('refuses without the cash and leaves the tier untouched', () => {
    rich(ctx, 4_999_999);
    expect(() => buyLandmark(ctx, 'u1')).toThrow(InsufficientFundsError);
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(0);
    expect(row.cash).toBe(4_999_999);
  });

  it('reports the next rung and stops reporting one at the top', () => {
    expect(nextLandmark(ctx, 'u1')!.tier).toBe(1);
    ctx.db.update(schema.users).set({ landmarkTier: MAX_LANDMARK_TIER })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(nextLandmark(ctx, 'u1')).toBeNull();
  });
});

type EmbedFields = Array<{ name: string; value: string }>;
const fieldsOf = (payload: unknown): EmbedFields =>
  (payload as { embeds: Array<{ toJSON(): { fields?: EmbedFields } }> }).embeds[0].toJSON().fields!;
const replyText = (payload: unknown): string => (payload as { content?: string }).content ?? '';

const click = async (customId: string, user = 'u1') => {
  const i = fakeButton({ customId, user });
  await parkModule.components.find((c) => c.prefix === 'park')!.execute(ctx, i.asInteraction() as never);
  return i;
};

describe('/park landmark', () => {
  const run = async (user = 'u1') => {
    const i = fakeCommand({ name: 'park', sub: 'landmark', user });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('shows the next rung with a grouped price and a buy button carrying that rung', async () => {
    const i = await run();
    const text = JSON.stringify(i.replies[0]);
    expect(text).toContain('Stone Marker');
    // Exact field value, not toContain('5,000,000') — a substring check is satisfied by
    // '15,000,000' just as happily, so it cannot tell a right price from a wrong one.
    expect(fieldsOf(i.replies[0]).find((f) => f.name === 'Next')!.value)
      .toBe('Stone Marker — 5,000,000 cash');
    expect(text).toContain('park:landmark:buy:u1:1');
  });

  it('shows the current rung once one is built', async () => {
    ctx.db.update(schema.users).set({ landmarkTier: 2 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = await run();
    // Asserting on the field values directly, not the stringified whole payload: the
    // description line also carries current.name, so a substring check on 'Fossil Plinth'
    // would still pass even if the Built field itself regressed (e.g. a wrong tier number
    // or a hardcoded 'Nothing yet') — the description's redundant mention would mask it.
    const fields = fieldsOf(i.replies[0]);
    expect(fields.find((f) => f.name === 'Built')!.value).toBe('Tier 2 — Fossil Plinth');
    expect(fields.find((f) => f.name === 'Next')!.value).toBe('Bronze Sentinel — 20,000,000 cash');
  });

  it('mints a customId that fits Discord\'s 100-character cap at the widest snowflake', () => {
    const wide = '9'.repeat(20);        // 20 digits — the widest a 64-bit snowflake prints
    const user = getOrCreateUser(ctx, wide, 'Wide');
    const row = landmarkPayload(user, LANDMARKS[MAX_LANDMARK_TIER - 2], LANDMARKS[MAX_LANDMARK_TIER - 1]);
    const id = (row.components[0].toJSON().components[0] as { custom_id: string }).custom_id;
    expect(id).toBe(`park:landmark:buy:${wide}:${MAX_LANDMARK_TIER}`);
    expect(id.length).toBe(40);
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it('offers no button at the top of the ladder', async () => {
    ctx.db.update(schema.users).set({ landmarkTier: MAX_LANDMARK_TIER }).where(eq(schema.users.discordId, 'u1')).run();
    const i = await run();
    expect(JSON.stringify(i.replies[0])).toContain('Titan Monument');
    expect((i.replies[0] as { components?: unknown[] }).components ?? []).toHaveLength(0);
  });

  it('buys on click and refreshes the same message to the next rung', async () => {
    ctx.db.update(schema.users).set({ cash: 5_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = await click('park:landmark:buy:u1:1');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.landmarkTier).toBe(1);
    // i.update, not i.reply: the payload carries the freshly built embed, so the message the
    // player just clicked now offers tier 2 instead of the rung it already sold.
    expect((i.replies[0] as { content?: string }).content).toContain('Stone Marker');
    const fields = fieldsOf(i.replies[0]);
    expect(fields.find((f) => f.name === 'Built')!.value).toBe('Tier 1 — Stone Marker');
    expect(fields.find((f) => f.name === 'Next')!.value).toBe('Fossil Plinth — 10,000,000 cash');
    expect(JSON.stringify(i.replies[0])).toContain('park:landmark:buy:u1:2');
  });

  // THE finding this branch exists for. Pre-fix the customId carried no tier and the handler
  // answered with i.reply, so the original message kept its "Build Stone Marker" label and a
  // live button forever while buyLandmark re-derived current+1 on every click: four clicks of
  // that one button charged 5,000,000 + 10,000,000 + 20,000,000 + 40,000,000 = 75,000,000,
  // 32x the label, with no refund path anywhere in the feature.
  it('honours one button once: four clicks of the tier-1 button charge 5,000,000 in total', async () => {
    ctx.db.update(schema.users).set({ cash: 100_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    for (let n = 0; n < 4; n++) await click('park:landmark:buy:u1:1');
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(1);
    expect(row.cash).toBe(95_000_000);           // pre-fix: 25,000,000
  });

  it('rejects a stale button whose rung is already built, charging nothing', async () => {
    ctx.db.update(schema.users).set({ landmarkTier: 1, cash: 100_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const i = await click('park:landmark:buy:u1:1');
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(1);
    expect(row.cash).toBe(100_000_000);
    expect(replyText(i.replies[0])).toContain('already built');
    expect(replyText(i.replies[0])).toContain('/park landmark');
  });

  it('rejects a rung further up the ladder than the next one', async () => {
    ctx.db.update(schema.users).set({ cash: 300_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = await click('park:landmark:buy:u1:6');
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(0);
    expect(row.cash).toBe(300_000_000);
    expect(replyText(i.replies[0])).toContain('Titan Monument');
  });

  // Everything after the prefix is CLIENT-supplied, so a forged or truncated tier segment must
  // be refused rather than coerced: Number('abc') is NaN, Number('') is 0, and both would have
  // sailed past a bare `!==` comparison into buyLandmark at whatever rung was next. What is
  // validated is the numeric VALUE, not the spelling — '1e0' is tier 1 and buying it when tier
  // 1 is next is correct, so it is deliberately absent from this list.
  it.each(['abc', '', '0', '-1', '7', '1.5', 'NaN', '1;2'])('rejects the non-rung tier segment %o', async (seg) => {
    ctx.db.update(schema.users).set({ cash: 100_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = await click(`park:landmark:buy:u1:${seg}`);
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier, seg).toBe(0);
    expect(row.cash, seg).toBe(100_000_000);
    expect(replyText(i.replies[0]), seg).toContain('no longer valid');
  });

  it('rejects a click from another player before charging anyone', async () => {
    ctx.db.update(schema.users).set({ cash: 5_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = fakeButton({ customId: 'park:landmark:buy:u1:1', user: 'u2' });
    await parkModule.components.find((c) => c.prefix === 'park')!.execute(ctx, i.asInteraction() as never);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.landmarkTier).toBe(0);
    expect(replyText(i.replies[0])).toContain('Not your park');
  });

  it('reports insufficient cash with the exact price of the rung the button offered', async () => {
    const i = await click('park:landmark:buy:u1:1');
    expect(replyText(i.replies[0]))
      .toBe('Not enough cash — the Stone Marker costs 5,000,000.');
  });

  // The LandmarkMaxedError branch, which nothing reached before: at tier 6 there is no next
  // rung, so a button minted for tier 6 and clicked after it was built falls through to
  // buyLandmark and surfaces the error whose text is derived from LANDMARKS' own top entry.
  it('reports the ladder complete when the top rung is clicked again', async () => {
    ctx.db.update(schema.users).set({ landmarkTier: MAX_LANDMARK_TIER, cash: 500_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const i = await click(`park:landmark:buy:u1:${MAX_LANDMARK_TIER}`);
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.landmarkTier).toBe(MAX_LANDMARK_TIER);
    expect(row.cash).toBe(500_000_000);
    expect(replyText(i.replies[0])).toContain(LANDMARKS[MAX_LANDMARK_TIER - 1].name);
    expect(replyText(i.replies[0])).toContain('nothing further to build');
  });
});
