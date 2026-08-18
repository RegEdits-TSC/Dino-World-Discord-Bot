import { describe, it, expect } from 'vitest';
import {
  attendanceFrom, ATTENDANCE_SCALE, ATTENDANCE_SPECIES_TARGET,
  ATTRACTION_DRAW_TARGET, ATTRACTION_MAX_BONUS, VC_ATTENDANCE_MULT,
  ATTENDANCE_MILESTONES, milestonesUpTo, ATTENDANCE_MAX,
} from '../src/data/attendance.js';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { recomputeRating } from '../src/modules/park/rating.js';
import { attendanceOf } from '../src/modules/park/attendance.js';

describe('attendanceFrom', () => {
  it('is zero with no species, whatever else is built', () => {
    expect(attendanceFrom(0, ATTRACTION_DRAW_TARGET, 5)).toBe(0);
  });

  it('clamps the species term so extra species past the target add nothing', () => {
    const at = attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, 0);
    expect(attendanceFrom(ATTENDANCE_SPECIES_TARGET + 12, 0, 0)).toBe(at);
    expect(at).toBe(ATTENDANCE_SCALE);
  });

  it('clamps the attraction term at the frozen draw target', () => {
    const capped = attendanceFrom(ATTENDANCE_SPECIES_TARGET, ATTRACTION_DRAW_TARGET, 0);
    expect(attendanceFrom(ATTENDANCE_SPECIES_TARGET, ATTRACTION_DRAW_TARGET * 3, 0)).toBe(capped);
    expect(capped).toBe(Math.round(ATTENDANCE_SCALE * (1 + ATTRACTION_MAX_BONUS)));
  });

  it('clamps a Visitor Center level above the array instead of reading undefined', () => {
    const top = attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, VC_ATTENDANCE_MULT.length);
    expect(attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, 99)).toBe(top);
    expect(Number.isFinite(attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, 99))).toBe(true);
  });

  it('treats a park with no Visitor Center as the neutral multiplier', () => {
    expect(attendanceFrom(ATTENDANCE_SPECIES_TARGET, 0, 0)).toBe(ATTENDANCE_SCALE);
  });
});

describe('ATTENDANCE_MAX', () => {
  it('is the closed-form ceiling, 92% above the base scale', () => {
    expect(ATTENDANCE_MAX).toBe(1920);
  });

  it('equals attendanceFrom at every term fully saturated — catches the constants and the formula drifting apart', () => {
    expect(ATTENDANCE_MAX).toBe(
      attendanceFrom(ATTENDANCE_SPECIES_TARGET, ATTRACTION_DRAW_TARGET, VC_ATTENDANCE_MULT.length));
  });
});

describe('ATTENDANCE_MILESTONES', () => {
  it('is strictly ascending', () => {
    const at = ATTENDANCE_MILESTONES.map((m) => m.at);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(new Set(at).size).toBe(at.length);
  });

  it('pays shards well under the season track ceiling of 110', () => {
    const shards = ATTENDANCE_MILESTONES.reduce((s, m) => s + (m.reward.shards ?? 0), 0);
    expect(shards).toBeLessThan(110);
  });

  it('milestonesUpTo returns every milestone at or below the high-water', () => {
    expect(milestonesUpTo(0)).toEqual([]);
    expect(milestonesUpTo(ATTENDANCE_MILESTONES[0].at)).toEqual([ATTENDANCE_MILESTONES[0]]);
    expect(milestonesUpTo(999_999)).toHaveLength(ATTENDANCE_MILESTONES.length);
  });
});

function seedPark(ctx: ReturnType<typeof makeCtx>) {
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { cash: 500_000 }, 'test:seed', 0);
  return buildLot(ctx, 'u1', 'herbivore_paddock');
}

describe('attendanceOf', () => {
  it('counts distinct assigned species and ignores unassigned and escaped ones', () => {
    const ctx = makeCtx();
    const lot = seedPark(ctx);
    const add = (speciesId: string, over: Record<string, unknown> = {}) =>
      ctx.db.insert(schema.dinos).values({
        userId: 'u1', lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over,
      }).run();
    add('triceratops');
    add('triceratops');                       // duplicate species — counts once
    add('gallimimus');
    add('stegosaurus', { lotId: null });      // unassigned — never counts
    add('parasaurolophus', { escapedAt: 1 }); // escaped — never counts

    expect(attendanceOf(ctx, 'u1').distinctSpecies).toBe(2);
  });

  it('is a pure read — it writes nothing', () => {
    const ctx = makeCtx();
    seedPark(ctx);
    const before = ctx.db.select().from(schema.users).all()[0];
    attendanceOf(ctx, 'u1');
    expect(ctx.db.select().from(schema.users).all()[0]).toEqual(before);
  });

  it('adds attraction draw resolved through levelValue, clamping an over-range level', () => {
    const ctx = makeCtx();
    const lot = seedPark(ctx);
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const bare = attendanceOf(ctx, 'u1').attendance;
    ctx.db.insert(schema.attractions).values({ userId: 'u1', kind: 'gift_shop', level: 3, builtAt: 0 }).run();
    const built = attendanceOf(ctx, 'u1');
    expect(built.drawTotal).toBe(26);
    expect(built.attendance).toBeGreaterThan(bare);

    ctx.db.update(schema.attractions).set({ level: 99 }).run();
    expect(attendanceOf(ctx, 'u1').drawTotal).toBe(26);   // clamped, never NaN
    expect(Number.isFinite(attendanceOf(ctx, 'u1').attendance)).toBe(true);
  });

  it('ignores a retired or unknown attraction kind rather than throwing', () => {
    const ctx = makeCtx();
    seedPark(ctx);
    ctx.db.insert(schema.attractions).values({ userId: 'u1', kind: 'retired_kind', level: 2, builtAt: 0 }).run();
    expect(attendanceOf(ctx, 'u1').drawTotal).toBe(0);
  });

  it('recomputeRating stamps a monotone attendance high-water', () => {
    const ctx = makeCtx();
    const lot = seedPark(ctx);
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    recomputeRating(ctx, 'u1');
    const high = ctx.db.select().from(schema.users).all()[0].attendanceHighWater;
    expect(high).toBe(attendanceOf(ctx, 'u1').attendance);
    expect(high).toBeGreaterThan(0);

    // Tearing the park down must not lower the high-water.
    ctx.db.delete(schema.dinos).run();
    recomputeRating(ctx, 'u1');
    expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(high);
    expect(attendanceOf(ctx, 'u1').attendance).toBe(0);
  });
});
