import { describe, it, expect } from 'vitest';
import {
  attendanceFrom, ATTENDANCE_SCALE, ATTENDANCE_SPECIES_TARGET,
  ATTRACTION_DRAW_TARGET, ATTRACTION_MAX_BONUS, VC_ATTENDANCE_MULT,
  ATTENDANCE_MILESTONES, milestonesUpTo,
} from '../src/data/attendance.js';

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
