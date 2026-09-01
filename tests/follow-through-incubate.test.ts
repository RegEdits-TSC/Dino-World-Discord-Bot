import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { startExpedition, claimExpedition } from '../src/modules/expeditions/service.js';

// Day 0 is `clear_skies` — every eventMods multiplier is 1 — so coastal_dig costs exactly
// 200 cash and takes exactly its 15-minute durationMs. Re-derive with:
//   npx tsx -e "import {worldEventFor,eventMods} from './src/core/world.ts'; console.log(worldEventFor(0).id, eventMods(0))"
const MIN = 60_000;

describe('claimExpedition returns the egg it minted', () => {
  it('hands back the newly inserted expedition egg, not a pre-existing one', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'One');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    // A shop egg the player already owned. A "read the newest row back" implementation
    // would be indistinguishable from a correct one without this row present.
    const older = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 })
      .returning().get();

    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(16 * MIN);
    const { egg } = claimExpedition(ctx, 'u1');

    const fromExpedition = ctx.db.select().from(schema.eggs).all()
      .filter((e) => e.source === 'expedition');
    expect(fromExpedition).toHaveLength(1);
    expect(egg.id).toBe(fromExpedition[0].id);
    expect(egg.id).not.toBe(older.id);
    expect(egg.userId).toBe('u1');
    expect(egg.source).toBe('expedition');
    // The returned row is the stored row, not a hand-built copy.
    expect(egg).toEqual(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, egg.id)).get());
  });
});
