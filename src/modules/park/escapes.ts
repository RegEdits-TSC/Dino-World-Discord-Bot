import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { escapeMoment } from '../../core/clock.js';
import { toClockDinos } from './service.js';

export function settleEscapes(ctx: Ctx, userId: string): number[] {
  const { clockDinos, dinos } = toClockDinos(ctx, userId);
  const stamped: number[] = [];
  for (let i = 0; i < dinos.length; i++) {
    if (dinos[i].escapedAt !== null) continue;
    const esc = escapeMoment(clockDinos[i], ctx.now());
    if (esc !== null) {
      // Stamp the actual escape instant, NOT ctx.now(): accruedIncome trusts a set escapedAt
      // directly, so stamping a later settlement time would let income accrue past the real escape.
      ctx.db.update(schema.dinos).set({ escapedAt: esc })
        .where(eq(schema.dinos.id, dinos[i].id)).run();
      stamped.push(dinos[i].id);
    }
  }
  return stamped;
}
