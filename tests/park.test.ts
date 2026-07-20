import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { getOrCreateUser, buildLot, collectIncome, capHours, facilityBonusPct, LotLimitError, BASE_LOT_SLOTS } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';
import { parkModule } from '../src/modules/park/index.js';

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
    expect(amount).toBe(630);                     // same integral as clock test
    expect(collectIncome(ctx, 'u1').amount).toBe(0);  // idempotent within same instant
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
});
