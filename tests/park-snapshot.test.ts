import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { buildParkSnapshot } from '../src/modules/park/snapshot.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'a', 'A'); });

const addLot = (kind: string, type: 'paddock' | 'facility', over: Record<string, unknown> = {}) =>
  ctx.db.insert(schema.lots).values({ userId: 'a', type, kind, name: kind, ...over }).returning().get();
const addDino = (over: Record<string, unknown>) =>
  ctx.db.insert(schema.dinos).values({ userId: 'a', speciesId: 'tyrannosaurus', lastFedAt: 0, hatchedAt: 0, ...over }).returning().get();

describe('buildParkSnapshot', () => {
  it('groups dinos under their lot and reports counts + cap', () => {
    const pen = addLot('carnivore_paddock', 'paddock', { level: 3, decor: ['statue', 'tree'] });
    addDino({ lotId: pen.id });
    addDino({ lotId: pen.id, escapedAt: 5 });   // escaped
    addDino({});                                 // unassigned
    const snap = buildParkSnapshot(ctx, 'a');
    expect(snap.parkName).toBe('New Park');
    expect(snap.dinoCount).toBe(3);
    expect(snap.escapedCount).toBe(1);
    expect(snap.lotCap).toBeGreaterThanOrEqual(3);   // lotSlots(highWater) — base 3
    const lot = snap.lots.find((l) => l.id === pen.id)!;
    expect(lot.decorCount).toBe(2);
    expect(lot.dinos).toHaveLength(2);
    expect(lot.dinos.some((d) => d.escaped)).toBe(true);
    expect(lot.dinos[0].rarity).toBe('legendary');   // tyrannosaurus
  });
  it('settles escapes before snapshotting (a starved dino is stamped escaped)', () => {
    const pen = addLot('carnivore_paddock', 'paddock');
    addDino({ lotId: pen.id, hunger: 0, lastFedAt: 0 });
    ctx.setNow(60 * 24 * 3_600_000);   // 60 days later: comfort 0, well past the 8h grace
    const snap = buildParkSnapshot(ctx, 'a');
    expect(snap.escapedCount).toBe(1);
    expect(snap.lots[0].dinos[0].escaped).toBe(true);
  });
  it('produces a plain, JSON-serializable object', () => {
    addLot('hatchery_lab', 'facility');
    const snap = buildParkSnapshot(ctx, 'a');
    expect(() => structuredClone(snap)).not.toThrow();
    expect(JSON.parse(JSON.stringify(snap)).lots[0].kind).toBe('hatchery_lab');
  });

  // Season comes from ctx.now(), never Date.now() — buildParkSnapshot is the one place with a Ctx
  // to call seasonFor(ctx.now()) from, so this is the one place that has to prove the wiring reaches
  // it. Day 0 -> 'wet' and day 60 -> 'cold' are the same fixtures tests/world.test.ts's own
  // "cycles wet -> dry -> cold every 30 days" test pins for seasonFor directly.
  it('stamps season from ctx.now() via seasonFor', () => {
    addLot('carnivore_paddock', 'paddock');
    expect(buildParkSnapshot(ctx, 'a').season).toBe('wet');       // day 0 (makeCtx default)
    ctx.setNow(60 * 24 * 3_600_000);                              // day 60
    expect(buildParkSnapshot(ctx, 'a').season).toBe('cold');
  });
});
