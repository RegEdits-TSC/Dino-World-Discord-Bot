import { eq } from 'drizzle-orm';
import { ButtonStyle } from 'discord.js';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { locksFor } from '../../core/locks.js';
import { activeExpedition } from '../expeditions/service.js';
import { activeBreedings } from '../genelab/service.js';
import type { HubSignal } from './types.js';

/**
 * Every live signal for one player, in section order, ready to rank and render.
 *
 * A READ. It never calls getOrCreateUser or settleEscapes — the handler owns both, runs them
 * once per interaction before this, and running them here would make every caller pay a
 * write. The full forbidden list is in the plan's Global Constraints and in spec §3.1; the
 * short version is that nothing here may roll a board, stamp a hint, latch a high-water,
 * expire a trade, record an alert, or claim anything.
 *
 * toClockDinos is called ONCE and its four returns are threaded through every derived row.
 * Later sections in this function must reuse them rather than calling it again.
 */
export function hubView(ctx: Ctx, userId: string): HubSignal[] {
  const now = ctx.now();
  const locks = locksFor(ctx, userId);
  const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, userId)).all();

  const out: HubSignal[] = [];

  // READY — things finished and waiting on one click. None of them carries a deadline:
  // an egg, a returned dig and a finished pairing all keep indefinitely, which is exactly
  // what lossAtMs: null means and why they rank below anything that expires.
  const ready = eggs.filter((e) =>
    e.hatchesAt !== null && e.hatchesAt <= now && !locks.eggs.has(e.id));
  if (ready.length > 0) {
    out.push({
      id: 'eggs-ready',
      section: 'ready',
      text: `🥚 ${ready.length === 1 ? 'An egg is' : `${ready.length} eggs are`} ready to hatch`,
      lossAtMs: null,
      // hatch:crack carries no owner segment. That is safe HERE and only here, because the
      // hub is ephemeral and therefore owner-only; it is not a property of the id.
      control: { customId: `hatch:crack:${ready[0].id}`, label: '🔨 Crack it open!', style: ButtonStyle.Success },
    });
  }

  // The row nothing in the product has ever shown: an egg bought or won and then forgotten.
  // It earns nothing and finishes nothing while it sits there.
  const idle = eggs.filter((e) => e.incubationStartedAt === null && !locks.eggs.has(e.id));
  if (idle.length > 0) {
    out.push({
      id: 'eggs-idle',
      section: 'ready',
      text: `🥚 ${idle.length === 1 ? 'An egg is' : `${idle.length} eggs are`} sitting in your inventory, not incubating`,
      lossAtMs: null,
      control: { customId: `hatch:inc:${userId}:${idle[0].id}`, label: '🥚 Incubate', style: ButtonStyle.Primary },
    });
  }

  const dig = activeExpedition(ctx, userId);
  if (dig !== undefined && dig.returnsAt <= now) {
    out.push({
      id: 'expedition-ready',
      section: 'ready',
      text: '🧭 Your dig crew is back with a haul',
      lossAtMs: null,
      // exp:claim takes no expedition id: claimExpedition resolves the CALLER's current dig
      // and takes no id, so the uid segment is the whole address.
      control: { customId: `exp:claim:${userId}`, label: '🧭 Claim', style: ButtonStyle.Success },
    });
  }

  // Hoisted rather than filtered inline: Task 9's WAITING section reuses this same list for
  // the pairings still cooking, and calling activeBreedings twice would pay for two reads of
  // the same rows.
  const breedings = activeBreedings(ctx, userId);
  const pairings = breedings.filter((b) => b.readyAt <= now);
  if (pairings.length > 0) {
    // Oldest-ready-first, matching how /breed claim picks when several are done, so the hub
    // and that command never disagree about which one a single click takes.
    const first = pairings.reduce((a, b) => (a.readyAt <= b.readyAt ? a : b));
    out.push({
      id: 'breeding-ready',
      section: 'ready',
      text: `🧬 ${pairings.length === 1 ? 'A pairing has' : `${pairings.length} pairings have`} produced an egg`,
      lossAtMs: null,
      control: { customId: `breed:claim:${first.id}`, label: '🧬 Claim', style: ButtonStyle.Success },
    });
  }

  return out;
}
