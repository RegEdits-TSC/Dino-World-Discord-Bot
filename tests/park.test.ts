import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, replyText } from './harness.js';
import { getOrCreateUser, buildLot, collectIncome, capHours, facilityBonusPct, LotLimitError, UnknownKindError, upgradeLot, BASE_LOT_SLOTS } from '../src/modules/park/service.js';
import { InsufficientFundsError } from '../src/core/economy.js';
import { schema } from '../src/core/db/index.js';
import { parkModule } from '../src/modules/park/index.js';
import { dashboardPayload } from '../src/modules/park/embeds.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { DECOR } from '../src/data/decor.js';

const H = 3_600_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

describe('park service', () => {
  it('creates a user once with starting wallet', () => {
    const u1 = getOrCreateUser(ctx, 'u1', 'Reg');
    const u2 = getOrCreateUser(ctx, 'u1', 'Reg');
    expect(u1.cash).toBe(500);
    expect(u2.discordId).toBe('u1');
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(1);
  });

  it('builds lots up to the slot limit, charging cash', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 20_000 }, 'test:seed', 0);
    buildLot(ctx, 'u1', 'herbivore_paddock');     // 2,000
    buildLot(ctx, 'u1', 'visitor_center');        // 5,000
    buildLot(ctx, 'u1', 'food_court');            // 8,000
    expect(() => buildLot(ctx, 'u1', 'herbivore_paddock')).toThrow(LotLimitError);
    expect(BASE_LOT_SLOTS).toBe(3);
  });

  it('derives capHours and bonus from facilities', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 20_000 }, 'test:seed', 0);
    buildLot(ctx, 'u1', 'visitor_center');
    buildLot(ctx, 'u1', 'food_court');
    const lots = ctx.db.select().from(schema.lots).all();
    expect(capHours(lots)).toBe(8);               // VC level 1
    expect(facilityBonusPct(lots)).toBe(4);       // VC lvl1 0% + food court lvl1 4%
  });

  it('collectIncome pays integrated income and stamps lastCollectAt', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 2_000 }, 'test:seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops',
      hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    ctx.db.update(schema.lots).set({ decor: ['forest'] }).run();
    ctx.setNow(12 * H);
    const { amount } = collectIncome(ctx, 'u1');
    // no Visitor Center => 8h cap; window truncates to 0..8h of the 12h elapsed.
    // hunger 100->83.33% over 8h of the 48h drain; comfort 1.0->0.8333, mean 0.91667;
    // 60/hr * 0.91667 * 8h = 440 (same integral as the capped clock test).
    expect(amount).toBe(440);
    expect(collectIncome(ctx, 'u1').amount).toBe(0);  // idempotent within same instant
  });

  it('recomputes park rating after building a lot', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 20_000 }, 'test:seed', 0);
    const before = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(before.parkRating).toBe(0);
    buildLot(ctx, 'u1', 'herbivore_paddock');
    const after = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    // one level-1 lot => park term (1+0)/40; rating round(500 * 0.35 * 0.025) = 4.
    expect(after.parkRating).toBeGreaterThan(0);
    expect(after.ratingHighWater).toBeGreaterThan(0);
  });

  it('rolls back the charge when the build insert fails (proves buildLot atomicity)', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 20_000 }, 'test:seed', 0);
    const before = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(before.cash).toBe(20_500);                  // 500 starting + 20,000 seed

    // raw better-sqlite3 handle; drizzle exposes it as db.$client (same pattern as
    // the rollback test in tests/economy.test.ts)
    const raw = ctx.db.$client;
    raw.exec(`CREATE TRIGGER block_build BEFORE INSERT ON lots
              WHEN NEW.kind = 'herbivore_paddock'
              BEGIN SELECT RAISE(ABORT, 'forced'); END;`);

    // Without the Fix 1 transaction wrapper in buildLot, ctx.economy.apply's -2,000
    // charge commits on its own (EconomyService.apply opens its own transaction)
    // before the insert below ever runs — leaving cash at 18,500 despite the throw
    // and no lot ever being created. With the fix, the charge and the insert share
    // one outer transaction, so the failed insert rolls the charge back too.
    expect(() => buildLot(ctx, 'u1', 'herbivore_paddock')).toThrow();

    const after = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(after.cash).toBe(20_500);                   // unchanged from before the attempt
    expect(ctx.db.select().from(schema.lots).all()).toHaveLength(0);
  });
});

describe('park module commands', () => {
  it('/park view returns a dashboard payload', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: unknown[]; components: unknown[] };
    expect(payload.embeds).toHaveLength(1);
    expect(payload.components).toHaveLength(1);
  });
  it('/build paddock reply hints at assigning a dino', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'herbivore_paddock' } });
    await parkModule.commands.find((c) => c.data.name === 'build')!.execute(ctx, i.asChatInput());
    expect((i.replies[0] as { content: string }).content).toContain('/dino assign');
  });
});

describe('Collect button', () => {
  it('shows a plain numeric label with the coin as a real emoji, not text', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 0, 1234, 0, {});
    const button = (p.components[0] as {
      toJSON(): { components: Array<{ label: string; emoji?: { name: string; animated: boolean } }> };
    }).toJSON().components[0];
    expect(button.label).toBe('Collect 1,234');
    // No app emoji map is loaded in tests, so this is the unicode fallback for dw_cash,
    // resolved by discord.js into the button's structured emoji field (not embedded in the label).
    expect(button.emoji).toEqual({ name: '💰', animated: false });
  });
});

describe('dashboard warnings', () => {
  it('shows the at-risk count in the dino field', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 3, 0, 0, { atRiskCount: 2 });
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name === '🦕 Dinos')!;
    expect(field.value).toContain('⚠ 2 at risk');
  });
  it('omits the warning at zero', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 3, 0, 0, {});
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name === '🦕 Dinos')!;
    expect(field.value).toBe('3');
  });
  it('adds a capped field when capped', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 1, 480, 0, { capped: true });
    const names = p.embeds[0].toJSON().fields!.map((f) => f.name);
    expect(names).toContain('⛔ Income capped');
  });
  it('no capped field otherwise', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 1, 480, 0, {});
    const names = p.embeds[0].toJSON().fields!.map((f) => f.name);
    expect(names).not.toContain('⛔ Income capped');
  });
});

describe('/park view cap warning condition', () => {
  const viewFields = async () => {
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, i.asChatInput());
    return (i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string }> } }> }).embeds[0].toJSON().fields!.map((f) => f.name);
  };
  it('warns once pending income has saturated the cap window', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    ctx.setNow(9 * H); // past the default 8h cap, dino still earning (escape at 40h)
    expect(await viewFields()).toContain('⛔ Income capped');
  });
  it('does not warn when nothing is earning, however long you idle', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.setNow(9 * H); // same elapsed time, zero pending
    expect(await viewFields()).not.toContain('⛔ Income capped');
  });
});

describe('/dino list escape countdown', () => {
  it('warns only inside the ESCAPE_WARN_MS window', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const H = 3_600_000;
    ctx.setNow(100 * H);
    const esc = 40 * H; // escapeAt - lastFedAt for this species/paddock
    // escapes in 11h → inside the 12h window
    ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: ctx.now() - (esc - 11 * H), hatchedAt: 0 }).run();
    // escapes in 13h → outside
    ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: ctx.now() - (esc - 13 * H), hatchedAt: 0 }).run();
    const i = fakeCommand({ name: 'dino', sub: 'list', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'dino')!.execute(ctx, i.asChatInput());
    const desc = (i.replies[0] as { embeds: Array<{ toJSON(): { description?: string } }> }).embeds[0].toJSON().description!;
    expect(desc.match(/⚠ escapes/g)).toHaveLength(1);
  });
});

describe('dashboard food line', () => {
  it('/park view lists held food items grouped after cash', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const parkCmd = parkModule.commands.find((c) => c.data.name === 'park')!;
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkCmd.execute(ctx, i.asChatInput());
    const fields = (i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> })
      .embeds[0].toJSON().fields!;
    const food = fields.find((f) => f.name.includes('Food'))!;
    expect(food.value).toContain('🌿 Ferns ×10');               // starter pantry
    expect(food.value).toContain('🐟 Fish ×10');
  });
});

describe('upgradeLot service', () => {
  it('charges and bumps the level', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const upgraded = upgradeLot(ctx, 'u1', lot.id);
    expect(upgraded.level).toBe(2);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBeLessThan(before);
  });
  it('throws LotLimitError at max level and UnknownKindError for missing/foreign lots', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 10_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    ctx.db.update(schema.lots).set({ level: 4 }).run();   // paddock max level
    expect(() => upgradeLot(ctx, 'u1', lot.id)).toThrow(LotLimitError);
    expect(() => upgradeLot(ctx, 'u1', 9999)).toThrow(UnknownKindError);
  });
  it('throws InsufficientFundsError when broke', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    expect(() => upgradeLot(ctx, 'u1', lot.id)).toThrow(InsufficientFundsError);
  });
});

describe('/upgrade, /decorate, /park rename, /dino unassign, park:collect', () => {
  it('/upgrade execute success and each error reply', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    const cmd = parkModule.commands.find((c) => c.data.name === 'upgrade')!;
    const okI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: lot.id } });
    await cmd.execute(ctx, okI.asChatInput());
    expect(replyText(okI.replies[0])).toContain('level 2');
    const noneI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: 9999 } });
    await cmd.execute(ctx, noneI.asChatInput());
    expect(replyText(noneI.replies[0])).toContain('No such lot');
    ctx.db.update(schema.lots).set({ level: 4 }).run();
    const maxI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: lot.id } });
    await cmd.execute(ctx, maxI.asChatInput());
    expect(replyText(maxI.replies[0])).toContain('max level');
  });
  it('/decorate execute adds decor', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    const item = Object.keys(DECOR)[0];
    const cmd = parkModule.commands.find((c) => c.data.name === 'decorate')!;
    const i = fakeCommand({ name: 'decorate', user: 'u1', options: { lot: lot.id, item } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Decoration added');
    expect(ctx.db.select().from(schema.lots).all()[0].decor).toContain(DECOR[item].kind ?? item);
  });
  it('/park rename updates parkName', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = parkModule.commands.find((c) => c.data.name === 'park')!;
    const i = fakeCommand({ name: 'park', sub: 'rename', user: 'u1', options: { name: 'Raptor Ranch' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Raptor Ranch');
    expect(ctx.db.select().from(schema.users).all()[0].parkName).toBe('Raptor Ranch');
  });
});
