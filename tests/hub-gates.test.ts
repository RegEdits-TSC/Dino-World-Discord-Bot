import { describe, it, expect } from 'vitest';
import { nextRatingGate } from '../src/modules/hub/gates.js';
import { LOT_SLOT_THRESHOLDS, MYTHIC_UNLOCK_RATING } from '../src/data/progression.js';
import { EXPEDITION_SITES } from '../src/data/sites.js';

describe('nextRatingGate', () => {
  it('returns the nearest unpassed threshold, and every label that shares it', () => {
    // Written as a literal table rather than derived from the ladders, on purpose: a loop
    // that recomputes the answer the same way the implementation does would agree with an
    // off-by-one living in both. Each row was read off the live tables by hand.
    expect(nextRatingGate(0)!.threshold).toBe(100);
    expect(nextRatingGate(99)!.threshold).toBe(100);
    expect(nextRatingGate(100)!.threshold).toBe(200);
    // 500 is Frozen Cliffs, nearer than lot slot 7 at 600 and the legendary shop rung at
    // 700 — the case that proves more than one ladder is consulted.
    expect(nextRatingGate(400)!.threshold).toBe(500);
    expect(nextRatingGate(400)!.labels).toContain('Frozen Cliffs');
  });

  it('collects EVERY ladder that lands on the shared threshold, not just the first', () => {
    // The collision case. More than one ladder lands on 800 — the assertions below name
    // each one this gate has to report — so a naive "return the first match" reads as
    // correct on every non-colliding rung and silently drops the rest here.
    const gate = nextRatingGate(799)!;
    expect(gate.threshold).toBe(800);
    expect(gate.labels.length).toBeGreaterThan(1);
    expect(gate.labels.some((l) => l.includes('Volcano'))).toBe(true);
    expect(gate.labels.some((l) => /mythic/i.test(l))).toBe(true);
    expect(gate.labels.some((l) => /slot/i.test(l))).toBe(true);
  });

  it('returns null only once every rating ladder is exhausted', () => {
    const topRung = Math.max(
      ...LOT_SLOT_THRESHOLDS,
      MYTHIC_UNLOCK_RATING,
      ...Object.values(EXPEDITION_SITES).map((s) => s.unlockRating),
    );
    expect(nextRatingGate(topRung)).toBeNull();
    expect(nextRatingGate(topRung + 1)).toBeNull();
    // One below the top rung must still name it — the boundary a `<=` written for `<`
    // gets wrong while every other row above still passes.
    expect(nextRatingGate(topRung - 1)!.threshold).toBe(topRung);
  });

  it('never returns a threshold at or below the high-water it was asked about', () => {
    for (let hw = 0; hw <= 1100; hw += 7) {
      const gate = nextRatingGate(hw);
      if (gate !== null) expect(gate.threshold, `high-water ${hw}`).toBeGreaterThan(hw);
    }
  });
});
