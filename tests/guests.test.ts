import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { InsufficientFundsError } from '../src/core/economy.js';
import { readStat } from '../src/core/stats.js';
import {
  buildAttraction, upgradeAttraction,
  UnknownAttractionError, AttractionLockedError,
  DuplicateAttractionError, AttractionMaxedError,
} from '../src/modules/guests/service.js';
import { ATTRACTIONS } from '../src/data/attractions.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

function rich(highWater = 0) {
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { cash: 200_000_000 }, 'test:seed', 0);
  ctx.db.update(schema.users).set({ attendanceHighWater: highWater })
    .where(eq(schema.users.discordId, 'u1')).run();
}

describe('buildAttraction', () => {
  it('charges cash, inserts the row at level 1 and counts the stat', () => {
    rich();
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const def = buildAttraction(ctx, 'u1', 'picnic_lawn');

    expect(def.kind).toBe('picnic_lawn');
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before - ATTRACTIONS.picnic_lawn.buildCost);
    const rows = ctx.db.select().from(schema.attractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe(1);
    expect(readStat(ctx, 'u1', 'attractions_built')).toBe(1);
  });

  it('refuses an unknown kind', () => {
    rich();
    expect(() => buildAttraction(ctx, 'u1', 'no_such_kind')).toThrow(UnknownAttractionError);
  });

  it('refuses a kind whose unlock threshold the high-water has not reached', () => {
    rich(0);
    expect(() => buildAttraction(ctx, 'u1', 'gift_shop')).toThrow(AttractionLockedError);
  });

  it('refuses a second copy of the same kind', () => {
    rich(150);
    buildAttraction(ctx, 'u1', 'picnic_lawn');
    expect(() => buildAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(DuplicateAttractionError);
  });

  it('leaves no row behind when the charge fails', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');           // 500 starting cash, nowhere near enough
    expect(() => buildAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(InsufficientFundsError);
    expect(ctx.db.select().from(schema.attractions).all()).toHaveLength(0);
    expect(readStat(ctx, 'u1', 'attractions_built')).toBe(0);
  });
});

describe('upgradeAttraction', () => {
  it('charges the rung cost and raises the level', () => {
    rich();
    buildAttraction(ctx, 'u1', 'picnic_lawn');
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const { level } = upgradeAttraction(ctx, 'u1', 'picnic_lawn');

    expect(level).toBe(2);
    expect(ctx.db.select().from(schema.users).all()[0].cash)
      .toBe(before - ATTRACTIONS.picnic_lawn.upgradeCosts[0]);
  });

  it('refuses to upgrade past the top level', () => {
    rich();
    buildAttraction(ctx, 'u1', 'picnic_lawn');
    upgradeAttraction(ctx, 'u1', 'picnic_lawn');
    upgradeAttraction(ctx, 'u1', 'picnic_lawn');
    expect(() => upgradeAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(AttractionMaxedError);
  });

  it('refuses to upgrade something that was never built', () => {
    rich();
    expect(() => upgradeAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(UnknownAttractionError);
  });
});
