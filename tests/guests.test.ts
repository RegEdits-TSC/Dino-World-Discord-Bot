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
  claimableMilestones, claimMilestone, MilestoneUnavailableError,
} from '../src/modules/guests/service.js';
import { ATTRACTIONS } from '../src/data/attractions.js';
import { ATTENDANCE_MILESTONES } from '../src/data/attendance.js';

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

describe('milestones', () => {
  const first = ATTENDANCE_MILESTONES[0];

  it('offers nothing below the first threshold', () => {
    rich(0);
    expect(claimableMilestones(ctx, 'u1')).toEqual([]);
  });

  it('offers every crossed milestone and pays its reward', () => {
    rich(first.at);
    expect(claimableMilestones(ctx, 'u1').map((m) => m.at)).toEqual([first.at]);
    const before = ctx.db.select().from(schema.users).all()[0].cash;

    claimMilestone(ctx, 'u1', first.at);

    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before + (first.reward.cash ?? 0));
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(1);
    expect(claimableMilestones(ctx, 'u1')).toEqual([]);
  });

  it('is idempotent — a second claim of the same milestone pays nothing', () => {
    rich(first.at);
    claimMilestone(ctx, 'u1', first.at);
    const after = ctx.db.select().from(schema.users).all()[0].cash;
    expect(() => claimMilestone(ctx, 'u1', first.at)).toThrow(MilestoneUnavailableError);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(after);
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(1);
  });

  it('refuses a milestone the high-water has not reached', () => {
    rich(first.at - 1);
    expect(() => claimMilestone(ctx, 'u1', first.at)).toThrow(MilestoneUnavailableError);
  });

  it('refuses a threshold that is not a milestone at all', () => {
    rich(999_999);
    expect(() => claimMilestone(ctx, 'u1', 12_345)).toThrow(MilestoneUnavailableError);
  });

  it('grants an egg when the milestone carries one', () => {
    const withEgg = ATTENDANCE_MILESTONES.find((m) => m.reward.egg)!;
    rich(withEgg.at);
    claimMilestone(ctx, 'u1', withEgg.at);
    const eggs = ctx.db.select().from(schema.eggs).all();
    expect(eggs).toHaveLength(1);
    expect(eggs[0].rarity).toBe(withEgg.reward.egg);
    expect(eggs[0].source).toBe('guests');
  });
});
