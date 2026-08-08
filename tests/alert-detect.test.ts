import { describe, it, expect } from 'vitest';
import { escapeAlertsFor, type DinoLike } from '../src/modules/park/alert-detect.js';
import { escapeAt, ESCAPE_WARN_MS, GRACE_MS, HUNGER_DRAIN_MS } from '../src/core/clock.js';
import { ESCAPE_LAST_CALL_MS } from '../src/modules/park/alert-record.js';
import { getSpecies } from '../src/data/species/index.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import type { ClockDino } from '../src/core/clock.js';

const trike = getSpecies('triceratops');
const herb = PADDOCKS.herbivore_paddock;

const clock = (over: Partial<ClockDino> = {}): ClockDino => ({
  species: trike, paddock: herb, decor: [],
  hungerAtFed: 100, lastFedAt: 0, escapedAt: null, traits: [], ...over,
});
// DinoLike is the narrow row shape the predicate reads — no cast needed, and no DB.
const row = (over: Partial<DinoLike> = {}): DinoLike =>
  ({ id: 1, nickname: null, escapedAt: null, ...over });

describe('escapeAlertsFor', () => {
  it('fires heads_up exactly at the ESCAPE_WARN_MS boundary and not one ms earlier', () => {
    const c = clock();
    const esc = escapeAt(c)!;
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_WARN_MS)).toHaveLength(1);
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_WARN_MS - 1)).toHaveLength(0);
  });

  it('classifies as last_call once inside the shorter lead', () => {
    const c = clock();
    const esc = escapeAt(c)!;
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_WARN_MS)[0].tier).toBe('heads_up');
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_LAST_CALL_MS)[0].tier).toBe('last_call');
  });

  it('never fires for an already-escaped dino', () => {
    const c = clock({ escapedAt: 5 });
    expect(escapeAlertsFor([c], [row({ escapedAt: 5 })], 10)).toHaveLength(0);
  });

  it('never fires for an already-escaped dino even before the stamped instant', () => {
    // Isolates the `row.escapedAt !== null` conjunct from the downtime guard
    // (`esc <= now`): `now` sits BEFORE the stamped escape instant, so escapeAt(c)
    // resolves to 1_000 (verbatim, since escapedAt is non-null) and 1_000 > now — the
    // downtime guard would let this through on its own. Only the first conjunct can be
    // the reason this returns empty. (The test above, with now=10 > escapedAt=5, cannot
    // tell the two guards apart: either one alone suppresses it.)
    const c = clock({ escapedAt: 1_000 });
    expect(escapeAlertsFor([c], [row({ escapedAt: 1_000 })], 0)).toHaveLength(0);
  });

  it('never fires for an unassigned dino', () => {
    // escapeAt returns null with no paddock: an unassigned dino cannot escape.
    const c = clock({ paddock: null });
    expect(escapeAt(c)).toBeNull();
    expect(escapeAlertsFor([c], [row()], 0)).toHaveLength(0);
  });

  it('suppresses a dino whose escape instant has already passed', () => {
    // The downtime guard. After an outage the sweep must not warn about a dino that
    // already bolted but whose row was never stamped by settleEscapes.
    const c = clock();
    const esc = escapeAt(c)!;
    expect(escapeAlertsFor([c], [row()], esc)).toHaveLength(0);
    expect(escapeAlertsFor([c], [row()], esc + 1_000_000)).toHaveLength(0);
  });

  it('prefers the nickname and falls back to the species name', () => {
    const c = clock();
    const esc = escapeAt(c)!;
    const at = esc - ESCAPE_LAST_CALL_MS;
    expect(escapeAlertsFor([c], [row()], at)[0].name).toBe('Triceratops');
    expect(escapeAlertsFor([c], [row({ nickname: 'Rexy' })], at)[0].name).toBe('Rexy');
  });

  it('returns the soonest escape first', () => {
    const soon = clock();
    const later = clock({ lastFedAt: 6 * 3_600_000 });
    const escSoon = escapeAt(soon)!;
    const out = escapeAlertsFor([later, soon], [row({ id: 2 }), row({ id: 1 })],
                                escSoon - ESCAPE_LAST_CALL_MS);
    expect(out[0].dinoId).toBe(1);
    expect(out[0].escapeAt).toBeLessThan(out[1].escapeAt);
  });

  it('reports the raw escape instant, so the record layer keys on a stable value', () => {
    const c = clock();
    const esc = escapeAt(c)!;
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_LAST_CALL_MS)[0].escapeAt).toBe(esc);
    // Sanity: the fixture's instant is drain*(2/3) + grace, i.e. the clock module's own
    // math. `clock()` sets decor: [] (no decor), so paddockFit's biome check can never
    // match (Array.prototype.some on an empty array is false) even though the paddock's
    // diet agrees with the species' — that combination is fit 0.75, NOT fit 1.0. At
    // fit 0.75 the comfort-threshold hunger is (0.25/0.75)*100 = 33.33%, so the crossing
    // lands at (100-33.33)/100 = 2/3 of the drain window, not 75% of it. Verified against
    // the real escapeAt() with this exact fixture (esc === 144_000_000, i.e. 40h); the
    // fit-1.0 case (a biome-matching decor tile, e.g. tests/clock.test.ts's
    // fedTrike()'s 'palm_tree') is the one that lands at 75% (36h) — see
    // tests/clock.test.ts's `escapeAt(fedTrike())` pin.
    expect(esc).toBe(HUNGER_DRAIN_MS * (2 / 3) + GRACE_MS);
  });
});

import { incomeCapAlertFor } from '../src/modules/park/alert-detect.js';
import type { Lot } from '../src/modules/park/service.js';

// capHours and facilityBonusPct read only `kind` and `level`, so a partial row cast to
// Lot is honest here — building real rows would drag a DB into a pure-function test.
const lot = (over: Partial<Lot> = {}) =>
  ({ id: 1, userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'p',
     level: 1, decor: [], ...over }) as unknown as Lot;

describe('incomeCapAlertFor', () => {
  it('is null before the cap instant and non-null at or after it', () => {
    const c = clock();
    const CAP = 8 * 3_600_000;                       // no visitor center → capHours 8
    expect(incomeCapAlertFor([c], [lot()], 0, CAP - 1)).toBeNull();
    const hit = incomeCapAlertFor([c], [lot()], 0, CAP);
    expect(hit).not.toBeNull();
    expect(hit!.capAt).toBe(CAP);
    expect(hit!.capHours).toBe(8);
    expect(hit!.pending).toBeGreaterThan(0);
  });

  it('is null when nothing is pending, even past the cap', () => {
    // An empty park, or one whose dinos are all unassigned, must not be nagged.
    expect(incomeCapAlertFor([], [lot()], 0, 100 * 3_600_000)).toBeNull();
    const unassigned = clock({ paddock: null });
    expect(incomeCapAlertFor([unassigned], [lot()], 0, 100 * 3_600_000)).toBeNull();
  });

  it('uses the Visitor Center cap when one is built above level 1', () => {
    // Level 1 is capHours[0] = 8, identical to no facility at all — only L2+ widens it.
    const c = clock();
    const vc1 = [lot(), lot({ id: 2, type: 'facility', kind: 'visitor_center', level: 1 })];
    const vc2 = [lot(), lot({ id: 2, type: 'facility', kind: 'visitor_center', level: 2 })];
    expect(incomeCapAlertFor([c], vc1, 0, 8 * 3_600_000)!.capHours).toBe(8);
    expect(incomeCapAlertFor([c], vc2, 0, 8 * 3_600_000)).toBeNull();
    expect(incomeCapAlertFor([c], vc2, 0, 12 * 3_600_000)!.capHours).toBe(12);
  });
});
