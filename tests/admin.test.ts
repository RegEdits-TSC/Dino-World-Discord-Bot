import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { makeCtx, fakeCommand, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, pendingIncome, buildLot } from '../src/modules/park/service.js';
import { startBreeding } from '../src/modules/genelab/service.js';
import { requireOwner } from '../src/modules/admin/guard.js';
import { adminGive, adminReset, adminFastForward, AdminError } from '../src/modules/admin/service.js';
import { setMotto, setFeaturedDino } from '../src/modules/park/showcase.js';
import { adminModule } from '../src/modules/admin/index.js';
import { createTrade } from '../src/modules/trading/service.js';
import { locksFor } from '../src/core/locks.js';
import { TRADE_MIN_RATING } from '../src/data/trade.js';
import { ENERGY_CAP } from '../src/data/battle/constants.js';
import { settleEnergy } from '../src/data/battle/energy.js';
import { track } from '../src/core/stats.js';
import { dayKeyUTC, DAY_MS } from '../src/core/clock.js';
import { QUESTS } from '../src/data/quests.js';
import { rollDailyQuests, claimQuests } from '../src/modules/daily/service.js';
import { recordSpeciesSeen, seenSpecies, firstSeenAt } from '../src/core/species-seen.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });   // config.ownerId === 'owner'

describe('requireOwner', () => {
  it('lets the owner through with no reply', async () => {
    const cmd = fakeCommand({ name: 'admin', sub: 'give', user: 'owner' });
    expect(await requireOwner(ctx, cmd.asChatInput())).toBe(true);
    expect(cmd.replies).toHaveLength(0);
  });
  it('rejects a non-owner ephemerally', async () => {
    const cmd = fakeCommand({ name: 'admin', sub: 'give', user: 'mallory' });
    expect(await requireOwner(ctx, cmd.asChatInput())).toBe(false);
    expect((cmd.replies[0] as { content: string }).content).toContain('Owner only');
  });
});

describe('adminGive', () => {
  it('grants cash + a dino atomically and recomputes rating', () => {
    getOrCreateUser(ctx, 'p', 'P');   // starts with 500 cash
    adminGive(ctx, 'p', 'P', { cash: 1000, dinoSpecies: 'triceratops' });
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.cash).toBe(1500);
    const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'p')).all();
    expect(dinos).toHaveLength(1);
    expect(dinos[0].speciesId).toBe('triceratops');
    expect(u.parkRating).toBeGreaterThan(0);   // recomputed with the new dino
  });
  it('grants an egg with the admin source and null species', () => {
    adminGive(ctx, 'p', 'P', { eggRarity: 'legendary' });   // getOrCreateUser seeds p
    const egg = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'p')).get()!;
    expect(egg.rarity).toBe('legendary');
    expect(egg.source).toBe('admin');
    expect(egg.speciesId).toBeNull();
  });
  it('rejects an empty give and an unknown species', () => {
    expect(() => adminGive(ctx, 'p', 'P', {})).toThrow(AdminError);
    expect(() => adminGive(ctx, 'p', 'P', { dinoSpecies: 'godzilla' })).toThrow(AdminError);
  });
  it('grants a typed food stack', () => {
    adminGive(ctx, 'p', 'P', { food: { foodId: 'goat', qty: 5 } });   // getOrCreateUser seeds p
    expect(ctx.economy.getFoodInventory('p').goat).toBe(5);
  });
});

describe('adminReset', () => {
  it('wipes a player’s stuff and restores new-player defaults', () => {
    getOrCreateUser(ctx, 'p', 'P');
    adminGive(ctx, 'p', 'P', { cash: 9000, shards: 50, dinoSpecies: 'triceratops', eggRarity: 'rare' });
    ctx.db.insert(schema.lots).values({ userId: 'p', type: 'paddock', kind: 'carnivore_paddock', name: 'Pen' }).run();
    adminReset(ctx, 'p');
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.cash).toBe(500);
    expect(ctx.economy.getFoodInventory('p')).toEqual({ ferns: 10, fish: 10 });
    expect(u.shards).toBe(0);
    expect(u.parkRating).toBe(0);
    expect(u.ratingHighWater).toBe(0);
    expect(u.parkName).toBe('New Park');
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'p')).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'p')).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'p')).all()).toHaveLength(0);
    expect(u.displayName).toBe('P');   // user row kept
  });
  it('reset clears the landmark tier', () => {
    getOrCreateUser(ctx, 'u1', 'U1');
    ctx.db.update(schema.users).set({ landmarkTier: 4 }).where(eq(schema.users.discordId, 'u1')).run();
    adminReset(ctx, 'u1');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.landmarkTier).toBe(0);
  });
  it('reset clears the park showcase', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const d = ctx.db.insert(schema.dinos)
      .values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 })
      .returning().get();
    setMotto(ctx, 'u1', 'Where the big ones live');
    setFeaturedDino(ctx, 'u1', d.id);
    adminReset(ctx, 'u1');
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.motto).toBe('');
    // featuredFor would already resolve a stale id to null, but SQLite reuses ids after a
    // delete (the table has no AUTOINCREMENT keyword), so a reset account's next hatch can
    // land on the very id left behind and silently re-feature a dino nobody chose.
    expect(row.featuredDinoId).toBeNull();
  });
});

describe('adminReset + trades', () => {
  it('unlocks a counterparty’s escrowed items when the reset target is the recipient', () => {
    getOrCreateUser(ctx, 'o', 'O');
    getOrCreateUser(ctx, 't', 'T');
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();   // both 4★ so createTrade passes
    const dino = ctx.db.insert(schema.dinos).values({ userId: 'o', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    createTrade(ctx, 'o', 't', { dinoIds: [dino.id], eggIds: [], cash: 0, foods: {} }, { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    // dino now escrowed, owned by o, in a pending o->t trade
    expect(locksFor(ctx, 'o').dinos.has(dino.id)).toBe(true);
    adminReset(ctx, 't');   // t is the RECIPIENT
    const d = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, dino.id)).get()!;
    expect(d.userId).toBe('o');                             // still o's
    expect(locksFor(ctx, 'o').dinos.has(dino.id)).toBe(false);   // freed, not stranded
  });
});

describe('adminReset + breedings', () => {
  it('clears pending breedings so no lock outlives the dinos it named', () => {
    getOrCreateUser(ctx, 'p', 'P');
    ctx.economy.apply('p', { cash: 500_000 }, 'test', 0);
    buildLot(ctx, 'p', 'gene_lab');
    const pen = buildLot(ctx, 'p', 'herbivore_paddock');
    const mk = (speciesId: string) => ctx.db.insert(schema.dinos).values({
      userId: 'p', lotId: pen.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const a = mk('triceratops'), b = mk('gallimimus');
    startBreeding(ctx, 'p', a.id, b.id, null);
    expect(locksFor(ctx, 'p').dinos.size).toBe(2);

    adminReset(ctx, 'p');

    expect(ctx.db.select().from(schema.breedings).where(eq(schema.breedings.userId, 'p')).all()).toHaveLength(0);
    expect(locksFor(ctx, 'p').dinos.size).toBe(0);
  });
});

describe('adminFastForward', () => {
  it('advances income and starves an assigned dino into escaping', () => {
    getOrCreateUser(ctx, 'p', 'P');   // lastCollectAt = now = 0
    const lot = ctx.db.insert(schema.lots).values({ userId: 'p', type: 'paddock', kind: 'carnivore_paddock', name: 'Pen' }).returning().get();
    ctx.db.insert(schema.dinos).values({ userId: 'p', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    const escaped = adminFastForward(ctx, 'p', 720);   // 30 days back
    expect(escaped).toBe(1);                            // starved past the escape threshold
    expect(pendingIncome(ctx, 'p')).toBeGreaterThan(0); // income accrued over the elapsed time
    const d = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'p')).get()!;
    expect(d.escapedAt).not.toBeNull();
  });
  it('rejects hours outside 1..720', () => {
    expect(() => adminFastForward(ctx, 'p', 0)).toThrow(AdminError);
    expect(() => adminFastForward(ctx, 'p', 721)).toThrow(AdminError);
  });
});

async function run(user: string, sub: string, options: Record<string, string | number>) {
  const cmd = fakeCommand({ name: 'admin', sub, user, options });
  await adminModule.commands[0].execute(ctx, cmd.asChatInput());
  return cmd;
}

describe('admin module', () => {
  it('blocks a non-owner and mutates nothing', async () => {
    getOrCreateUser(ctx, 't', 'T');
    const cmd = await run('mallory', 'give', { user: 't', cash: 5000 });
    expect((cmd.replies[0] as { content: string }).content).toContain('Owner only');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 't')).get()!.cash).toBe(500);
  });
  it('owner give adds the cash', async () => {
    await run('owner', 'give', { user: 't', cash: 250 });
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 't')).get()!.cash).toBe(750);
  });
  it('inspect returns an ephemeral embed with the player state', async () => {
    getOrCreateUser(ctx, 't', 'T');           // 500 cash by default
    adminGive(ctx, 't', 'T', { cash: 777 });  // -> 1277
    const cmd = await run('owner', 'inspect', { user: 't' });
    const reply = cmd.replies[0] as { embeds: Array<{ data: { fields: Array<{ value: string }> } }>; flags?: number };
    expect(reply.embeds).toHaveLength(1);
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    const values = reply.embeds[0].data.fields.map((f) => f.value).join(' ');
    expect(values).toContain('1277');   // cash field reflects the real state
  });
  it('reset requires the confirm to equal the target id', async () => {
    getOrCreateUser(ctx, 't', 'T');
    adminGive(ctx, 't', 'T', { cash: 9000 });
    const bad = await run('owner', 'reset', { user: 't', confirm: 'wrong' });
    expect((bad.replies[0] as { content: string }).content).toContain('confirm');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 't')).get()!.cash).toBe(9500);
    await run('owner', 'reset', { user: 't', confirm: 't' });
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 't')).get()!.cash).toBe(500);
  });
  it('reset on a player with no park aborts cleanly', async () => {
    const cmd = await run('owner', 'reset', { user: 'ghost', confirm: 'ghost' });
    expect((cmd.replies[0] as { content: string }).content).toContain('no park to reset');
  });
  it('/admin fast-forward shifts time through the command layer', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'target', 'target');
    const cmd = adminModule.commands[0];
    const i = fakeCommand({ name: 'admin', sub: 'fast-forward', user: 'owner', options: { user: 'target', hours: 24 } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Fast-forwarded');
  });
  it('/admin give rejects half-set food pairing', async () => {
    const ctx = makeCtx();
    const cmd = adminModule.commands[0];
    const i = fakeCommand({ name: 'admin', sub: 'give', user: 'owner', options: { user: 'target', 'food-item': 'ferns' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Set both food-item and food-qty');
  });
});

describe('adminFastForward + energy', () => {
  it('shifts energyUpdatedAt back so regeneration becomes visible', () => {
    getOrCreateUser(ctx, 'p', 'P');
    ctx.db.update(schema.users).set({ energy: 2, energyUpdatedAt: ctx.now() })
      .where(eq(schema.users.discordId, 'p')).run();
    adminFastForward(ctx, 'p', 1);   // 1 h back = 6 regen ticks at 10 min each
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.energyUpdatedAt).toBe(-3_600_000);
    expect(settleEnergy(u.energy, u.energyUpdatedAt, ctx.now()).energy).toBe(8);   // 2 + 6
  });
});

describe('adminReset + battles', () => {
  it('restores full energy and deletes battle progress', () => {
    getOrCreateUser(ctx, 'p', 'P');
    ctx.setNow(50_000);
    ctx.db.update(schema.users).set({ energy: 1, energyUpdatedAt: 7 })
      .where(eq(schema.users.discordId, 'p')).run();
    ctx.db.insert(schema.battleProgress).values({
      userId: 'p', stageId: 'coastal_dig_1', stars: 2, firstClearedAt: 5, attempts: 4,
    }).run();
    adminReset(ctx, 'p');
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.energy).toBe(ENERGY_CAP);
    expect(u.energyUpdatedAt).toBe(50_000);
    expect(ctx.db.select().from(schema.battleProgress)
      .where(eq(schema.battleProgress.userId, 'p')).all()).toHaveLength(0);
  });
});

describe('adminReset + daily loop', () => {
  it('wipes stats, quest board and achievement claims, zeroes streak columns, and leaves other users untouched', () => {
    getOrCreateUser(ctx, 'p', 'P');
    getOrCreateUser(ctx, 'other', 'O');
    const dayKey = dayKeyUTC(ctx.now());

    ctx.db.insert(schema.userStats).values({ userId: 'p', stat: 'dinos_fed', value: 5 }).run();
    ctx.db.insert(schema.dailyQuests)
      .values({ userId: 'p', dayKey, slot: 0, questId: 'feed_3', baseline: 0, target: 3 }).run();
    ctx.db.insert(schema.achievementClaims)
      .values({ userId: 'p', trackId: 'dinos_fed', tier: 0, claimedAt: ctx.now() }).run();
    ctx.db.update(schema.users)
      .set({ questStreak: 5, questStreakBest: 14, lastQuestClaimAt: 12_345 })
      .where(eq(schema.users.discordId, 'p')).run();

    // Same fixtures for a second user, to prove reset never crosses accounts.
    ctx.db.insert(schema.userStats).values({ userId: 'other', stat: 'dinos_fed', value: 9 }).run();
    ctx.db.insert(schema.dailyQuests)
      .values({ userId: 'other', dayKey, slot: 0, questId: 'feed_3', baseline: 0, target: 3 }).run();
    ctx.db.insert(schema.achievementClaims)
      .values({ userId: 'other', trackId: 'dinos_fed', tier: 0, claimedAt: ctx.now() }).run();
    ctx.db.update(schema.users)
      .set({ questStreak: 2, questStreakBest: 7, lastQuestClaimAt: 999 })
      .where(eq(schema.users.discordId, 'other')).run();

    adminReset(ctx, 'p');

    expect(ctx.db.select().from(schema.userStats).where(eq(schema.userStats.userId, 'p')).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, 'p')).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.achievementClaims).where(eq(schema.achievementClaims.userId, 'p')).all()).toHaveLength(0);
    const p = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(p.questStreak).toBe(0);
    expect(p.questStreakBest).toBe(0);
    expect(p.lastQuestClaimAt).toBe(0);

    // Other user's rows and streak columns are provably untouched.
    expect(ctx.db.select().from(schema.userStats).where(eq(schema.userStats.userId, 'other')).all()).toHaveLength(1);
    expect(ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, 'other')).all()).toHaveLength(1);
    expect(ctx.db.select().from(schema.achievementClaims).where(eq(schema.achievementClaims.userId, 'other')).all()).toHaveLength(1);
    const other = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'other')).get()!;
    expect(other.questStreak).toBe(2);
    expect(other.questStreakBest).toBe(7);
    expect(other.lastQuestClaimAt).toBe(999);
  });
});

describe('adminFastForward + daily loop', () => {
  it('shifts a claimed lastQuestClaimAt back by the elapsed time', () => {
    getOrCreateUser(ctx, 'p', 'P');
    ctx.db.update(schema.users).set({ lastQuestClaimAt: 30 * 3_600_000 })
      .where(eq(schema.users.discordId, 'p')).run();
    adminFastForward(ctx, 'p', 26);
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.lastQuestClaimAt).toBe(4 * 3_600_000);   // 30h - 26h
  });

  it('leaves a never-claimed lastQuestClaimAt at 0 while the other users columns still shift', () => {
    getOrCreateUser(ctx, 'p', 'P');   // lastQuestClaimAt defaults to 0; lastCollectAt = ctx.now() = 0
    adminFastForward(ctx, 'p', 26);
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.lastQuestClaimAt).toBe(0);
    expect(u.lastCollectAt).toBe(-26 * 3_600_000);   // unrelated column still shifts unguarded
  });

  it('never touches daily_quests rows: dayKey stays exactly what it was', () => {
    getOrCreateUser(ctx, 'p', 'P');
    const dayKey = dayKeyUTC(ctx.now());
    ctx.db.insert(schema.dailyQuests)
      .values({ userId: 'p', dayKey, slot: 0, questId: 'feed_3', baseline: 0, target: 3 }).run();
    adminFastForward(ctx, 'p', 26);
    const row = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, 'p')).get()!;
    expect(row.dayKey).toBe(dayKey);
  });

  it('streak continuity: a claim, a 24h fast-forward, and a second claim on the same board tick the streak to 2', () => {
    // nowMs starts an hour into day 1 (not exactly DAY_MS, and not 0): lastQuestClaimAt's
    // "never claimed" sentinel is literal 0 (see tests/daily-claim.test.ts), and a claim
    // exactly at ms=0 OR a fast-forward that lands exactly back on 0 would both collide
    // with it and read as "never claimed" instead of "claimed yesterday".
    const ctx = makeCtx({ nowMs: DAY_MS + 3_600_000 });
    getOrCreateUser(ctx, 'p', 'P');
    rollDailyQuests(ctx, 'p');
    const dayKey = dayKeyUTC(ctx.now());
    const rows = ctx.db.select().from(schema.dailyQuests)
      .where(and(eq(schema.dailyQuests.userId, 'p'), eq(schema.dailyQuests.dayKey, dayKey))).all();
    expect(rows).toHaveLength(3);   // fresh account only rolls 'none'-requirement quests

    const [first, second] = rows;
    const firstDef = QUESTS.find((q) => q.id === first.questId)!;
    track(ctx, 'p', firstDef.stat, (first.target as number) - first.baseline);   // complete only 1 of 3

    const claim1 = claimQuests(ctx, 'p');
    expect(claim1.claimed).toHaveLength(1);
    expect(claim1.streak).toBe(1);
    expect(claim1.ticked).toBe(true);

    adminFastForward(ctx, 'p', 24);   // same dayKey -> no re-roll, still today's board

    const rowsAfterShift = ctx.db.select().from(schema.dailyQuests)
      .where(and(eq(schema.dailyQuests.userId, 'p'), eq(schema.dailyQuests.dayKey, dayKey))).all();
    expect(rowsAfterShift).toHaveLength(3);

    const secondDef = QUESTS.find((q) => q.id === second.questId)!;
    track(ctx, 'p', secondDef.stat, (second.target as number) - second.baseline);   // complete a second quest

    const claim2 = claimQuests(ctx, 'p');
    expect(claim2.claimed).toHaveLength(1);
    expect(claim2.claimed[0].def.id).toBe(second.questId);
    expect(claim2.ticked).toBe(true);
    expect(claim2.streak).toBe(2);   // the shifted anchor reads as yesterday
  });
});

it('adminReset deletes alert records but preserves an explicit mute', async () => {
  const ctx = makeCtx();
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
  ctx.db.update(schema.users).set({ alertsEnabled: false })
    .where(eq(schema.users.discordId, 'u1')).run();
  ctx.db.insert(schema.alertsSent).values({
    userId: 'u1', kind: 'escape', refId: 1, tier: 'heads_up', firedForMs: 5, sentAt: 5,
  }).run();

  adminReset(ctx, 'u1');

  // Reset must clear every table the feature reads — the breedings/user_stats lesson.
  expect(ctx.db.select().from(schema.alertsSent).all()).toHaveLength(0);
  // But NOT the mute: it is communication consent, not progress. Un-muting a player who
  // explicitly opted out would be a reset that talks to them again without asking.
  expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(false);
});

it('adminFastForward does not shift alert records, which is what lets it force an alert', () => {
  // Shifting lastFedAt moves escapeAt; firedForMs then stops matching and the next sweep
  // alerts. Shifting the record too would keep them in lockstep and force nothing.
  const ctx = makeCtx({ nowMs: 100 * 3_600_000 });
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: ctx.now(), createdAt: 0 }).run();
  ctx.db.insert(schema.alertsSent).values({
    userId: 'u1', kind: 'income_cap', refId: 0, tier: '', firedForMs: 5, sentAt: 5,
  }).run();
  adminFastForward(ctx, 'u1', 24);
  const row = ctx.db.select().from(schema.alertsSent).all()[0];
  expect(row.firedForMs).toBe(5);
  expect(row.sentAt).toBe(5);
});

it('reset clears the species-seen record', () => {
  getOrCreateUser(ctx, 'u1', 'U1');
  recordSpeciesSeen(ctx, 'u1', 'triceratops');
  adminReset(ctx, 'u1');
  expect(seenSpecies(ctx, 'u1').size).toBe(0);
});

it('fast-forward leaves first_at_ms alone', () => {
  getOrCreateUser(ctx, 'u1', 'U1');
  ctx.setNow(10 * 3_600_000);
  recordSpeciesSeen(ctx, 'u1', 'triceratops');
  const before = firstSeenAt(ctx, 'u1', 'triceratops');
  adminFastForward(ctx, 'u1', 48);
  expect(firstSeenAt(ctx, 'u1', 'triceratops')).toBe(before);
});
