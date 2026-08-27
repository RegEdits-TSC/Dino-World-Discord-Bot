import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton, replyText, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, pendingIncome, collectIncome, buildLot } from '../src/modules/park/service.js';
import { settleEscapes } from '../src/modules/park/escapes.js';
import { startBreeding, claimBreeding } from '../src/modules/genelab/service.js';
import { BREED_MS } from '../src/data/breeding.js';
import { requireOwner } from '../src/modules/admin/guard.js';
import { adminGive, adminReset, adminFastForward, adminReverse, AdminError } from '../src/modules/admin/service.js';
import { setMotto, setFeaturedDino } from '../src/modules/park/showcase.js';
import { adminModule } from '../src/modules/admin/index.js';
import { ledgerPayload } from '../src/modules/admin/ledger.js';
import { PAGE_SIZE } from '../src/core/paginate.js';
import { createTrade } from '../src/modules/trading/service.js';
import { locksFor } from '../src/core/locks.js';
import { TRADE_MIN_RATING, TRADE_EXPIRY_MS } from '../src/data/trade.js';
import { ENERGY_CAP, DUEL_START_RATING, DUEL_PAIR_COOLDOWN_MS } from '../src/data/battle/constants.js';
import { settleEnergy } from '../src/data/battle/energy.js';
import { track } from '../src/core/stats.js';
import { dayKeyUTC, DAY_MS } from '../src/core/clock.js';
import { QUESTS } from '../src/data/quests.js';
import { rollDailyQuests, claimQuests } from '../src/modules/daily/service.js';
import { recordSpeciesSeen, seenSpecies, firstSeenAt } from '../src/core/species-seen.js';
import { cooldownUntil } from '../src/modules/duels/service.js';
import { rollSeason } from '../src/modules/daily/season.js';

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
    expect(u.legacyRankBest).toBe(0);
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
  it('reset clears the legacy rank high-water, the one path that makes legacyPoints drop', () => {
    // legacyRank resolves against max(stored, computed) so an earned rank is never lost
    // (src/modules/park/ranks.ts) — but adminReset deletes species_seen, achievement_claims
    // and battle_progress, so it's the one path in the codebase that makes the COMPUTED
    // total drop. Without this, a wiped account would keep showing its pre-reset rank on
    // /park view and /dex list forever.
    getOrCreateUser(ctx, 'u1', 'U1');
    ctx.db.update(schema.users).set({ legacyRankBest: 50 }).where(eq(schema.users.discordId, 'u1')).run();
    adminReset(ctx, 'u1');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.legacyRankBest).toBe(0);
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

  // S3 finding: the dinos update shifted lastFedAt but not escapedAt, so a dino that
  // was already settled as escaped BEFORE the fast-forward could resume earning: the
  // shift moves lastCollectAt/hungerZero back while the stamped escapedAt stays put,
  // pulling it back inside the accrual window. Scenario verbatim from the finding: a
  // triceratops fed at t=0 in an undecored herbivore paddock escapes at 40h; the owner
  // collects at t=41h (settleEscapes stamps escapedAt=40h, Collect pays through 40h and
  // a second Collect correctly pays 0); a 24h fast-forward then shifts lastCollectAt
  // 41h->17h and lastFedAt 0h->-24h while escapedAt stays at 40h, so the next Collect's
  // window [17h, min(41h, 40h, 24h)] = [17h, 24h] pays for hours already both escaped
  // AND already collected — a double-pay on top of a dead dino earning at all.
  it('shifts escapedAt along with lastFedAt so a settled-escaped dino cannot resume earning', () => {
    const H = 3_600_000;
    getOrCreateUser(ctx, 'p', 'P');   // lastCollectAt = now = 0
    const lot = ctx.db.insert(schema.lots).values({ userId: 'p', type: 'paddock', kind: 'herbivore_paddock', name: 'Pen' }).returning().get();
    ctx.db.insert(schema.dinos).values({ userId: 'p', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();

    ctx.setNow(41 * H);
    settleEscapes(ctx, 'p');
    const dinoRow = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'p')).get()!;
    expect(dinoRow.escapedAt).toBe(40 * H);          // sanity: matches the finding's own scenario
    expect(collectIncome(ctx, 'p').amount).toBeGreaterThan(0);   // pays through the escape
    expect(collectIncome(ctx, 'p').amount).toBe(0);              // idempotent — nothing left pending

    adminFastForward(ctx, 'p', 24);   // 24h back

    // The wrong outcome, pre-fix: escapedAt stayed at 40h while lastFedAt/lastCollectAt
    // moved back 24h, reopening a window an already-escaped, already-paid dino could
    // earn against. Fixed: escapedAt shifts by the same amount, so the dino is exactly
    // as escaped (and exactly as fully paid) as it was before the fast-forward.
    expect(collectIncome(ctx, 'p').amount).toBe(0);
  });
});

describe('adminFastForward + breeding', () => {
  function pairing() {
    getOrCreateUser(ctx, 'p', 'P');
    ctx.economy.apply('p', { cash: 500_000 }, 'test', 0);
    buildLot(ctx, 'p', 'gene_lab');
    buildLot(ctx, 'p', 'herbivore_paddock');
    const lot = ctx.db.select().from(schema.lots).all().find((l) => l.kind === 'herbivore_paddock')!;
    const mk = (species: string) => ctx.db.insert(schema.dinos)
      .values({ userId: 'p', speciesId: species, lotId: lot.id, hunger: 100, lastFedAt: 0, hatchedAt: 0 })
      .returning().get();
    return startBreeding(ctx, 'p', mk('triceratops').id, mk('gallimimus').id, null);
  }

  // The reported bug: the scheduler timer that ANNOUNCES a pairing is shifted
  // (timers.firesAt), but breedings.readyAt was not — so fast-forward delivered the
  // "breeding ready" notification while /breed claim still rejected it.
  it('advances a pairing past its ready time so it can actually be claimed', () => {
    const br = pairing();
    expect(br.readyAt).toBe(BREED_MS.common);   // 30 min out from now = 0

    adminFastForward(ctx, 'p', 1);              // 1 h back, comfortably past it

    const row = ctx.db.select().from(schema.breedings).where(eq(schema.breedings.id, br.id)).get()!;
    expect(row.readyAt).toBeLessThanOrEqual(ctx.now());
    expect(row.startedAt).toBe(br.startedAt - 3_600_000);   // duration preserved, not just readyAt
    expect(() => claimBreeding(ctx, 'p', br.id)).not.toThrow();
  });

  it('leaves an already-claimed pairing alone', () => {
    const br = pairing();
    ctx.db.update(schema.breedings).set({ claimedAt: 123 }).where(eq(schema.breedings.id, br.id)).run();

    adminFastForward(ctx, 'p', 5);

    const row = ctx.db.select().from(schema.breedings).where(eq(schema.breedings.id, br.id)).get()!;
    expect(row.readyAt).toBe(br.readyAt);       // history, not a live timer
    expect(row.claimedAt).toBe(123);
  });

  it('does not touch another player’s pairing', () => {
    const br = pairing();
    getOrCreateUser(ctx, 'other', 'Other');

    adminFastForward(ctx, 'other', 10);

    const row = ctx.db.select().from(schema.breedings).where(eq(schema.breedings.id, br.id)).get()!;
    expect(row.readyAt).toBe(br.readyAt);
  });
});

describe('adminFastForward + trades', () => {
  it('expires a pending trade and releases the escrow it held', () => {
    getOrCreateUser(ctx, 'o', 'O');
    getOrCreateUser(ctx, 't', 'T');
    ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
    const dino = ctx.db.insert(schema.dinos)
      .values({ userId: 'o', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    createTrade(ctx, 'o', 't', { dinoIds: [dino.id], eggIds: [], cash: 0, foods: {} }, { dinoIds: [], eggIds: [], cash: 0, foods: {} });
    expect(locksFor(ctx, 'o').dinos.has(dino.id)).toBe(true);

    // locksFor evaluates expiry at read time against createdAt, so shifting createdAt
    // is what makes elapsed time release the escrow — exactly as a real 25 h would.
    adminFastForward(ctx, 'o', TRADE_EXPIRY_MS / 3_600_000 + 1);

    expect(locksFor(ctx, 'o').dinos.has(dino.id)).toBe(false);
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

it('reset deletes duel rows on BOTH sides and restores the rating and squad', () => {
  getOrCreateUser(ctx, 'u1', 'U1');
  getOrCreateUser(ctx, 'u2', 'U2');
  ctx.db.insert(schema.duels)
    .values({ challengerId: 'u1', defenderId: 'u2', mode: 'ghost', result: 'win', eloDelta: 16, createdAt: 0 }).run();
  ctx.db.insert(schema.duels)
    .values({ challengerId: 'u2', defenderId: 'u1', mode: 'live', result: 'loss', eloDelta: -9, createdAt: 0 }).run();
  ctx.db.update(schema.users).set({ duelRating: 1300, duelSquad: [7, 8] })
    .where(eq(schema.users.discordId, 'u1')).run();

  adminReset(ctx, 'u1');

  expect(ctx.db.select().from(schema.duels).all()).toEqual([]);
  const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
  expect(row.duelRating).toBe(DUEL_START_RATING);
  expect(row.duelSquad).toEqual([]);
});

it('fast-forward shifts the duel log so a pair cooldown can lapse', () => {
  getOrCreateUser(ctx, 'u1', 'U1');
  getOrCreateUser(ctx, 'u2', 'U2');
  ctx.setNow(10 * 3_600_000);
  ctx.db.insert(schema.duels).values({
    challengerId: 'u1', defenderId: 'u2', mode: 'ghost', result: 'win', eloDelta: 16, createdAt: ctx.now(),
  }).run();
  expect(cooldownUntil(ctx, 'u1', 'u2')).not.toBeNull();
  adminFastForward(ctx, 'u1', DUEL_PAIR_COOLDOWN_MS / 3_600_000 + 1);
  expect(cooldownUntil(ctx, 'u1', 'u2')).toBeNull();
});

it('wipes every season row and claim, including past seasons, and leaves other users alone', () => {
  ctx.setNow(690 * 30 * 86_400_000);   // SEASON_EPOCH is 690
  getOrCreateUser(ctx, 'p', 'P');
  getOrCreateUser(ctx, 'other', 'O');
  for (const uid of ['p', 'other']) {
    ctx.db.insert(schema.seasonProgress)
      .values({ userId: uid, seasonIndex: 689, baselines: {}, headStart: 0, badgeAt: 1, createdAt: 0 }).run();
    ctx.db.insert(schema.seasonProgress)
      .values({ userId: uid, seasonIndex: 690, baselines: {}, headStart: 0, createdAt: 0 }).run();
    // A past-season claim, matching the badged past-season progress row above, so the
    // claims delete is proven unscoped by season the same way the progress delete is —
    // not just proven for whichever season happens to be current.
    ctx.db.insert(schema.seasonClaims)
      .values({ userId: uid, seasonIndex: 689, rung: 0, claimedAt: 0 }).run();
    ctx.db.insert(schema.seasonClaims)
      .values({ userId: uid, seasonIndex: 690, rung: 0, claimedAt: 0 }).run();
  }
  adminReset(ctx, 'p');
  expect(ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, 'p')).all()).toHaveLength(0);
  expect(ctx.db.select().from(schema.seasonClaims)
    .where(eq(schema.seasonClaims.userId, 'p')).all()).toHaveLength(0);
  expect(ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, 'other')).all()).toHaveLength(2);
  expect(ctx.db.select().from(schema.seasonClaims)
    .where(eq(schema.seasonClaims.userId, 'other')).all()).toHaveLength(2);
});

it('adminFastForward leaves season rows untouched — it cannot move the UTC calendar', () => {
  ctx.setNow(690 * 30 * 86_400_000);   // SEASON_EPOCH is 690
  getOrCreateUser(ctx, 'p', 'P');
  rollSeason(ctx, 'p');
  const before = ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, 'p')).get()!;
  adminFastForward(ctx, 'p', 48);
  const after = ctx.db.select().from(schema.seasonProgress)
    .where(eq(schema.seasonProgress.userId, 'p')).get()!;
  expect(after.seasonIndex).toBe(before.seasonIndex);
  expect(after.createdAt).toBe(before.createdAt);
});

it('adminReset clears attractions, milestone claims and the attendance high-water', () => {
  const ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.db.insert(schema.attractions).values({
    userId: 'u1', kind: 'gift_shop', level: 2, builtAt: 0,
  }).run();
  ctx.db.insert(schema.attendanceClaims).values({
    userId: 'u1', milestone: 200, claimedAt: 0,
  }).run();
  ctx.db.update(schema.users).set({ attendanceHighWater: 900 })
    .where(eq(schema.users.discordId, 'u1')).run();

  adminReset(ctx, 'u1');

  expect(ctx.db.select().from(schema.attractions).all()).toHaveLength(0);
  expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(0);
  expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(0);
});

// Reads one row's own rendered line out of the embed description — never the whole
// JSON blob. A whole-blob substring match (the shape this replaced) is satisfied by an
// implementation that stamps "already reversed" on EVERY row, or by a reversal row's own
// "reverses #N" text standing in for the charge's presence — exactly the confusion this
// feature exists to prevent. Matching per-line is what actually pins which row a mark
// belongs to.
function lineFor(ctx: ReturnType<typeof makeCtx>, targetId: string, page: number, id: number): string {
  const description = ledgerPayload(ctx, targetId, page).embeds[0].data.description!;
  return description.split('\n').find((l) => l.startsWith(`\`#${id}\``))!;
}

describe('/admin ledger', () => {
  it('lists rows newest first with ids, and marks the three row states', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: -300 }, 'build:paddock_plains', 100);
    const charge = ctx.db.select().from(schema.txLog).all().at(-1)!;
    ctx.economy.apply('u1', { cash: -50 }, 'decorate:fern', 200);
    const untouched = ctx.db.select().from(schema.txLog).all().at(-1)!;
    const { reversalId } = ctx.economy.reverse(charge.id, 300);

    expect(lineFor(ctx, 'u1', 1, reversalId)).toMatch(/reverses/i);        // the reversal row identifies its target
    expect(lineFor(ctx, 'u1', 1, charge.id)).toMatch(/already reversed/i); // and the charge is marked as made good
    expect(lineFor(ctx, 'u1', 1, charge.id)).toMatch(/lot still stands/i); // side-effect note from Task 3
    // Discriminating: an implementation that stamped "already reversed" on every row would
    // pass every assertion above for free. The untouched charge's OWN line must not claim it.
    expect(lineFor(ctx, 'u1', 1, untouched.id)).not.toMatch(/already reversed/i);
  });

  it('suppresses the side-effect note on a payout, but keeps it for an unrecognised charge', () => {
    // collect is the single most frequent row in the real table and carries no
    // SIDE_EFFECTS entry — before this fix every one of them read "unrecognised — check
    // manually", burying the note on the one row type where it actually matters.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 40 }, 'collect', 100);
    const payout = ctx.db.select().from(schema.txLog).all().at(-1)!;
    // A genuine debit under a reason SIDE_EFFECTS has never heard of must still warn —
    // fail closed for money actually taken, never for money paid out.
    ctx.economy.apply('u1', { cash: -1 }, 'totally-unknown-reason', 200);
    const mystery = ctx.db.select().from(schema.txLog).all().at(-1)!;

    expect(lineFor(ctx, 'u1', 1, payout.id)).not.toMatch(/unrecognised/i);
    expect(lineFor(ctx, 'u1', 1, mystery.id)).toMatch(/unrecognised — check manually/i);
  });

  it('marks rows that predate a reset, using a real reset — not a hand-inserted row', () => {
    // adminReset UPDATEs the users row and never touches createdAt (that column means
    // account CREATION), so the boundary cannot be users.createdAt — it has to come from
    // the marker row adminReset itself writes into tx_log.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: -50 }, 'build:x', 100);   // before the reset
    const before = ctx.db.select().from(schema.txLog).all().at(-1)!;

    ctx.setNow(200);
    adminReset(ctx, 'u1');   // writes the boundary marker at createdAt=200
    const marker = ctx.db.select().from(schema.txLog).all().at(-1)!;

    ctx.economy.apply('u1', { cash: 20 }, 'collect', 300);    // after the reset
    const after = ctx.db.select().from(schema.txLog).all().at(-1)!;

    expect(lineFor(ctx, 'u1', 1, before.id)).toMatch(/pre-reset/i);
    expect(lineFor(ctx, 'u1', 1, after.id)).not.toMatch(/pre-reset/i);
    // The marker itself must never read like a chargeable row an operator might try to
    // reverse: no reason tag in the ordinary `reason` format, no "unrecognised" warning.
    const markerLine = lineFor(ctx, 'u1', 1, marker.id);
    expect(markerLine).toMatch(/account reset/i);
    expect(markerLine).not.toMatch(/unrecognised/i);
    expect(markerLine).not.toContain('`admin:reset`');
  });

  it('pages, and the page buttons carry the TARGET id', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    for (let n = 0; n < PAGE_SIZE + 3; n++) ctx.economy.apply('u1', { cash: 1 }, 'collect', n);
    const p = ledgerPayload(ctx, 'u1', 1);
    expect(JSON.stringify(p.components)).toContain('admin:ledger:u1:2');
  });
});

// The brief's own three tests above only call ledgerPayload directly — never the component
// handler, never routeInteraction. Dispatching through the real ModuleRegistry (testRegistry)
// is what catches a wiring mistake findComponent's PREFIX match can make: it compares only
// customId.split(':')[0], so a component registered with prefix 'admin:ledger' (three
// segments long) would never match an 'admin:ledger:<uid>:<page>' click at all and the pager
// would be a dead button in production while every offline test above still passed.
describe('/admin ledger component', () => {
  function build() {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    for (let n = 0; n < PAGE_SIZE + 3; n++) ctx.economy.apply('u1', { cash: 1 }, 'collect', n);
    return ctx;
  }
  function nextButtonId(ctx: ReturnType<typeof makeCtx>): string {
    const p = ledgerPayload(ctx, 'u1', 1);
    const json = p.components[0]!.toJSON() as { components: Array<{ custom_id: string; label: string }> };
    return json.components.find((c) => c.label === 'Next ▶')!.custom_id;
  }

  it('routes the real Next button through the registry and pages the ledger', async () => {
    const ctx = build();
    const customId = nextButtonId(ctx);
    const b = fakeButton({ customId, user: 'owner', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts).toHaveLength(0);   // dispatched, not rejected by the router guard
    expect(b.replies).toHaveLength(1);     // i.update() ran — the handler, not the no-op arm
    expect(JSON.stringify(b.replies[0])).toContain('Page 2/2');
  });

  it('the target clicking their own audit log is rejected — the gate is ownerId, never the customId segment', async () => {
    const ctx = build();
    const customId = nextButtonId(ctx);   // customId's own segment names u1, the target
    const b = fakeButton({ customId, user: 'u1', componentIds: [customId] });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);          // no i.update() — the target never sees page 2
    expect(b.deferOpts).toHaveLength(1);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });
});

describe('/admin reverse', () => {
  const seed = (c: ReturnType<typeof makeCtx>) => {
    getOrCreateUser(c, 'u1', 'One');                                     // 500 cash
    c.economy.apply('u1', { cash: -300 }, 'build:paddock_plains', 100);  // -> 200
    return c.db.select().from(schema.txLog).all().at(-1)!;
  };
  const cashOf = (c: ReturnType<typeof makeCtx>, id: string) =>
    c.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!.cash;
  const reversalOf = (c: ReturnType<typeof makeCtx>, id: number) =>
    c.db.select().from(schema.txLog).all().find((r) => r.reversesId === id);

  it('reverses and reports what the money did not undo', () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    const out = adminReverse(ctx, 'u1', charge.id);
    expect(out.sideEffect).toMatch(/lot still stands/i);
    expect(out.notified).toBe(false);
    expect(cashOf(ctx, 'u1')).toBe(500);
    // The money came back as a compensating row pointing at the charge, never an edit of it.
    expect(reversalOf(ctx, charge.id)!.cashDelta).toBe(300);
  });

  it('refuses an unknown transaction id', () => {
    const ctx = makeCtx();
    seed(ctx);
    expect(() => adminReverse(ctx, 'u1', 9999)).toThrow(AdminError);
    expect(() => adminReverse(ctx, 'u1', 9999)).toThrow(/no transaction/i);
  });

  it('refuses a row belonging to another player', () => {
    // The user option is redundant on purpose: it is the confirmation step that turns a
    // mistyped id into a refusal rather than a refund to the wrong person.
    const ctx = makeCtx();
    const charge = seed(ctx);
    getOrCreateUser(ctx, 'u2', 'Two');
    expect(() => adminReverse(ctx, 'u2', charge.id, 'sorry about that')).toThrow(AdminError);
    expect(() => adminReverse(ctx, 'u2', charge.id, 'sorry about that')).toThrow(/different player/i);
    // Discriminating: neither the named player nor the row's real owner was paid.
    expect(cashOf(ctx, 'u2')).toBe(500);
    expect(cashOf(ctx, 'u1')).toBe(200);
    // ORDERING, checked with a note in hand: a refusal must never tell a player money moved.
    // This one catches a notify hoisted above the guards; the overdraw test below catches the
    // narrower hoist, above the reversal but below them.
    expect(ctx.notifications).toHaveLength(0);
  });

  it('refuses a charge that predates a reset, using a real reset — not a hand-inserted row', () => {
    // adminReset UPDATEs the users row and never touches createdAt (that column means account
    // CREATION), so the boundary cannot come from users.createdAt — it is the marker row the
    // reset itself writes into the ledger.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: -50 }, 'build:x', 100);
    const before = ctx.db.select().from(schema.txLog).all().at(-1)!;
    ctx.setNow(200);
    adminReset(ctx, 'u1');                                   // writes the marker at 200
    ctx.economy.apply('u1', { cash: -20 }, 'build:y', 300);
    const after = ctx.db.select().from(schema.txLog).all().at(-1)!;

    expect(() => adminReverse(ctx, 'u1', before.id)).toThrow(/reset/i);
    expect(reversalOf(ctx, before.id)).toBeUndefined();
    // Discriminating: it is the boundary that refuses, not the reversal path being broken —
    // the same shape of charge on the other side of the marker reverses cleanly.
    expect(() => adminReverse(ctx, 'u1', after.id)).not.toThrow();
    expect(cashOf(ctx, 'u1')).toBe(500);
  });

  it('refuses the reset marker row itself', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.setNow(200);
    adminReset(ctx, 'u1');
    const marker = ctx.db.select().from(schema.txLog).all().at(-1)!;
    expect(() => adminReverse(ctx, 'u1', marker.id)).toThrow(AdminError);
    // Reversing a zero-delta row is economically inert, so a balance assertion would prove
    // nothing. What must not happen is a nonsense "reverses #<marker>" row landing in the
    // very ledger this feature exists to make readable.
    expect(reversalOf(ctx, marker.id)).toBeUndefined();
  });

  it('refuses a reversal that would overdraw the player, and names the shortfall', () => {
    // Reversal is symmetric on purpose: reversing a credit takes the cash back. A player who
    // already spent it cannot pay, and "insufficient cash" alone does not tell the operator
    // whether they are 5 short or 5,000,000 short.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');                             // 500
    ctx.economy.apply('u1', { cash: 1000 }, 'admin:give', 100);    // -> 1500
    const credit = ctx.db.select().from(schema.txLog).all().at(-1)!;
    ctx.economy.apply('u1', { cash: -1400 }, 'build:x', 200);      // -> 100
    expect(() => adminReverse(ctx, 'u1', credit.id, 'clawing back a mis-grant')).toThrow(AdminError);
    expect(() => adminReverse(ctx, 'u1', credit.id, 'clawing back a mis-grant')).toThrow(/900 short/);
    // The rollback is the guard, not a pre-check: nothing moved and nothing was recorded.
    expect(cashOf(ctx, 'u1')).toBe(100);
    expect(reversalOf(ctx, credit.id)).toBeUndefined();
    // ORDERING — the assertion that pins "notify AFTER the commit, never before". This refusal
    // comes from inside the economy transaction, i.e. BELOW every guard, so a notify block
    // hoisted above the reverse call would queue a note here even though the money never
    // moved. It is the only case in this suite that can see that hoist.
    expect(ctx.notifications).toHaveLength(0);
  });

  it('surfaces the ledger primitive’s own refusals as operator errors', () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    adminReverse(ctx, 'u1', charge.id);
    const reversal = reversalOf(ctx, charge.id)!;
    expect(() => adminReverse(ctx, 'u1', charge.id)).toThrow(AdminError);
    expect(() => adminReverse(ctx, 'u1', charge.id)).toThrow(/already reversed/i);
    expect(() => adminReverse(ctx, 'u1', reversal.id)).toThrow(AdminError);
    expect(() => adminReverse(ctx, 'u1', reversal.id)).toThrow(/terminal/i);
  });

  it('leaves the side-effect note empty for a payout, but keeps it for an unrecognised charge', () => {
    // The ledger view suppresses that note on a payout for a reason (no payout reason carries
    // a SIDE_EFFECTS entry, so every one of them read "unrecognised — check manually" and
    // trained the operator to skip the column). Both halves of this feature answer for the
    // same row, so the reversal reply has to agree — and reversing a CREDIT, the symmetric
    // case, is exactly where they disagreed.
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 40 }, 'collect', 100);
    const payout = ctx.db.select().from(schema.txLog).all().at(-1)!;
    expect(adminReverse(ctx, 'u1', payout.id).sideEffect).toBe('');
    expect(cashOf(ctx, 'u1')).toBe(500);
    // Discriminating: this is not a blanket suppression. A genuine debit under a reason
    // nothing recognises must still warn — fail CLOSED for money actually taken.
    ctx.economy.apply('u1', { cash: -5 }, 'totally-unknown-reason', 200);
    const mystery = ctx.db.select().from(schema.txLog).all().at(-1)!;
    expect(adminReverse(ctx, 'u1', mystery.id).sideEffect).toMatch(/unrecognised/i);
  });

  it('drops the whole clause from the reply when the reversed row was a payout', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 40 }, 'collect', 100);
    const payout = ctx.db.select().from(schema.txLog).all().at(-1)!;
    const i = fakeCommand({ name: 'admin', sub: 'reverse', user: 'owner',
      options: { user: 'u1', tx: payout.id } });
    await adminModule.commands[0].execute(ctx, i.asChatInput());
    const text = replyText(i.replies[0]);
    expect(text).toMatch(/reversed/i);
    expect(text).not.toMatch(/unrecognised/i);
    expect(text).not.toMatch(/not undone/i);
    expect(cashOf(ctx, 'u1')).toBe(500);
  });

  it('queues a note to the player when one is given, and keeps it on the row', () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    const out = adminReverse(ctx, 'u1', charge.id, 'double-charged by a stale button');
    expect(out.notified).toBe(true);
    expect(ctx.notifications.map((n) => n.message).join(' ')).toMatch(/stale button/);
    expect(reversalOf(ctx, charge.id)!.note).toBe('double-charged by a stale button');
  });

  it('caps the note it stores', () => {
    // The note is rendered into /admin ledger's embed description, which Discord caps at
    // 4096 characters — a page of uncapped notes would overflow it and reject the reply.
    const ctx = makeCtx();
    const charge = seed(ctx);
    adminReverse(ctx, 'u1', charge.id, 'x'.repeat(500));
    expect(reversalOf(ctx, charge.id)!.note).toHaveLength(200);
  });

  it('keeps the reversal committed when the notification throws', () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    ctx.notify = () => Promise.reject(new Error('DMs closed'));
    expect(() => adminReverse(ctx, 'u1', charge.id, 'here you go')).not.toThrow();
    // The money moved even though telling the player failed.
    expect(cashOf(ctx, 'u1')).toBe(500);
    expect(reversalOf(ctx, charge.id)).toBeDefined();
  });

  it('replies through the command layer, saying the note was queued rather than sent', async () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    const i = fakeCommand({ name: 'admin', sub: 'reverse', user: 'owner',
      options: { user: 'u1', tx: charge.id, note: 'double-charged by a stale button' } });
    await adminModule.commands[0].execute(ctx, i.asChatInput());
    const text = replyText(i.replies[0]);
    expect(text).toMatch(/lot still stands/i);
    // Delivery depends on the player's routing and mute settings, so the reply must claim
    // only that the note was queued.
    expect(text).toMatch(/queued/i);
    expect(text).not.toMatch(/\bsent\b/i);
    expect(cashOf(ctx, 'u1')).toBe(500);
  });

  it('answers a refusal ephemerally through the command layer instead of throwing', async () => {
    const ctx = makeCtx();
    const charge = seed(ctx);
    getOrCreateUser(ctx, 'u2', 'Two');
    const i = fakeCommand({ name: 'admin', sub: 'reverse', user: 'owner',
      options: { user: 'u2', tx: charge.id } });
    await adminModule.commands[0].execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toMatch(/different player/i);
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(cashOf(ctx, 'u2')).toBe(500);
  });
});
