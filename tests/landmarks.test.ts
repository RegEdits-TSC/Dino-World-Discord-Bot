import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { LANDMARKS, MAX_LANDMARK_TIER, landmarkFor, landmarkBandFor } from '../src/data/landmarks.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { InsufficientFundsError } from '../src/core/economy.js';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { buyLandmark, nextLandmark, LandmarkMaxedError } from '../src/modules/park/landmarks.js';
import { landmarkPayload } from '../src/modules/park/embeds.js';
import { parkModule } from '../src/modules/park/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
});

// The invariant the whole feature rests on, given a machine gate instead of a promise.
// The design's argument for putting the tier on a `users` column rather than shipping it as
// a DECOR kind is that its power-freedom is STRUCTURAL — nothing in rating.ts, clock.ts,
// lotSlots or matchedKindCount reads the column, so there is no filter anyone can forget.
// That argument is only true while the set of files touching it stays this small, and
// "structural rather than remembered" is not something a comment can enforce. Same idiom as
// tests/images.test.ts's "no source file hand-assigns an embed payload files array".
//
// The list is CLOSED in both directions: a new file mentioning the tier fails, and so does an
// allowlisted file that stops mentioning it, so the list cannot rot into a superset that
// quietly re-permits a reader it no longer names.
const LANDMARK_TIER_READERS = [
  'core/db/schema.ts',            // the column itself
  'core/render/draw.ts',          // draws the cosmetic tile — pixels, never mechanics
  'modules/admin/service.ts',     // adminReset zeroes it
  'modules/park/index.ts',        // /park landmark and its buy button
  'modules/park/landmarks.ts',    // the ladder: the only reader AND the only writer
  'modules/park/snapshot.ts',     // stamps it onto ParkSnapshot for the renderer
];

describe('landmark power-freedom', () => {
  const srcFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? srcFiles(p) : e.name.endsWith('.ts') ? [p] : [];
    });

  it('is read by exactly the files allowed to read it, and by nothing that computes power', () => {
    const root = resolve(process.cwd(), 'src');
    // The drizzle FIELD name, not the raw `landmark_tier` column: every `sql` template in
    // src/ interpolates drizzle column references rather than name strings (there is no raw
    // SQL outside drizzle/), so `landmarkTier` is the only way code can reach the value. The
    // raw name is deliberately not matched — src/data/landmarks.ts names it in prose, in the
    // comment explaining why the tier lives on a users column at all.
    const mentions = srcFiles(root)
      .filter((f) => /\blandmarkTier\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1).replaceAll('\\', '/'))
      .sort();
    expect(mentions, [
      'users.landmark_tier is a purely cosmetic prestige counter and its power-freedom is',
      'structural: it must never reach parkRaw, paddockFit, lotSlots, matchedKindCount or any',
      'income path. This list is closed on purpose — if you are adding a file, the tier is',
      'about to become a filter someone has to remember, which is exactly the design the',
      'spec rejected. If you are removing one, delete its entry in the same change.',
      `expected: ${LANDMARK_TIER_READERS.join(', ')}`,
    ].join('\n')).toEqual([...LANDMARK_TIER_READERS].sort());
  });
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
    // A rung AHEAD of the next one is not built, so it must not claim otherwise. Reachable
    // without forging a customId: adminReset zeroes the tier while an old higher-rung message
    // is still live.
    expect(replyText(i.replies[0])).not.toContain('already built');
    expect(replyText(i.replies[0])).toContain('you can buy tier 1');
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
    const i = await click('park:landmark:buy:u1:1', 'u2');
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

  it('ships the landmark banner as the embed image with its file', async () => {
    const i = await run();
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://landmark.webp');
    // toEqual on the whole list, not toContain: attach() appends, so a second slot wired
    // later shows up here rather than hiding behind a membership check.
    expect(payload.files!.map((f) => f.name)).toEqual(['landmark.webp']);
  });

  // The buy button answers with i.update, and an update carrying `files` replaces the
  // message's whole attachment set. The success path spreads landmarkPayload's output, so
  // the banner is re-attached and the set is replaced with an identical one — without
  // this, the message the player just paid on would silently lose its image.
  it('the buy button re-renders with the banner rather than blanking the message art', async () => {
    ctx.db.update(schema.users).set({ cash: 5_000_000 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = await click('park:landmark:buy:u1:1');
    const update = i.replies[0] as {
      embeds: Array<{ toJSON(): { image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    expect(update.embeds[0].toJSON().image?.url).toBe('attachment://landmark.webp');
    expect(update.files!.map((f) => f.name)).toEqual(['landmark.webp']);
    // And no hand-set attachments key. The fightFrames rule (attachments: [] mandatory
    // and unconditional) exists because one MessagePayload object reaches two send sites
    // and each must shed the other's set; landmarkPayload builds a fresh object on every
    // call and this spread is sent exactly once.
    expect('attachments' in update).toBe(false);
  });
});
