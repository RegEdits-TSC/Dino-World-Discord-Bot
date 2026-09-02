import { eq } from 'drizzle-orm';
import { ButtonStyle } from 'discord.js';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { locksFor } from '../../core/locks.js';
import { activeExpedition } from '../expeditions/service.js';
import { activeBreedings } from '../genelab/service.js';
import { escapeAt, ESCAPE_WARN_MS, accruedIncome } from '../../core/clock.js';
import { toClockDinos, needsAttentionCount, capHours, facilityBonusPct } from '../park/service.js';
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

  const { clockDinos, lots, user, dinos } = toClockDinos(ctx, userId);

  // ATTENTION. The three dino predicates below are the SPLIT of what needsAttentionCount
  // unions; the roll-up row uses that function directly rather than summing these, because
  // a dino can be both at risk and off-diet and summing double-counts it.
  const escaped = dinos.filter((d) => d.escapedAt !== null);
  if (escaped.length > 0) {
    out.push({
      id: 'dinos-escaped',
      section: 'attention',
      // No control: rescueDino is reachable only from /rescue, and adding a button would be
      // new spend surface in the care module. Recorded in spec §5.5, not an oversight.
      text: `🏃 ${escaped.length} escaped — bring them back with \`/rescue\``,
      lossAtMs: null,
    });
  }

  const unassigned = dinos.filter((d) => d.lotId === null && d.escapedAt === null);
  if (unassigned.length > 0) {
    out.push({
      id: 'dinos-unassigned',
      section: 'attention',
      text: `🦕 ${unassigned.length} ${unassigned.length === 1 ? 'dino has' : 'dinos have'} no paddock — they earn nothing`,
      lossAtMs: null,
    });
  }

  const atRisk = clockDinos
    .map((c, idx) => ({ c, d: dinos[idx] }))
    .filter(({ c }) => c.escapedAt === null)
    // escapeAt, never escapeMoment: escapeMoment returns null until the instant has already
    // PASSED, which would make this row permanently empty and nothing would fail.
    .map(({ c, d }) => ({ d, at: escapeAt(c) }))
    .filter((e): e is { d: typeof e.d; at: number } =>
      e.at !== null && e.at - now <= ESCAPE_WARN_MS);

  // getFoodInventory OMITS zero quantities, so emptiness is a test on the entries, never a
  // sum with `?? 0` — a larder holding {ferns: 0} would read as stocked either way round if
  // you got this backwards.
  const larder = ctx.economy.getFoodInventory(userId);
  const hasFood = Object.values(larder).some((q) => (q ?? 0) > 0);

  if (atRisk.length > 0) {
    const soonest = atRisk.reduce((a, b) => (a.at <= b.at ? a : b)).at;
    out.push({
      id: 'dinos-at-risk',
      section: 'attention',
      text: `⚠️ ${atRisk.length} at risk of escaping — the first goes <t:${Math.floor(soonest / 1000)}:R>`,
      // An absolute instant, never a duration: rankSignals compares it against other
      // absolute instants, and a duration here sorts as though the dino escaped in 1970.
      lossAtMs: soonest,
      // No control with an empty larder: Feed all with nothing to feed with is a button that
      // can only fail. The food-empty row below says what to do instead.
      ...(hasFood
        ? { control: { customId: `hub:feedall:${userId}`, label: '🍖 Feed all', style: ButtonStyle.Primary } }
        : {}),
    });
  }

  const mismatch = clockDinos.filter((c) =>
    c.paddock !== null && c.escapedAt === null && c.paddock.diet !== c.species.diet);
  if (mismatch.length > 0) {
    out.push({
      id: 'dinos-wrong-habitat',
      section: 'attention',
      // No control, and this one is structural rather than an omission: assignRefusal blocks
      // a dino that already has a lot, and eligiblePaddocks never offers an off-diet
      // paddock, so there is no one-click move to offer.
      text: `🏝️ ${mismatch.length} in the wrong habitat — comfort halved`,
      lossAtMs: null,
    });
  }

  const attention = needsAttentionCount(clockDinos, now);
  if (attention > 0) {
    out.push({
      id: 'needs-attention',
      section: 'attention',
      // needsAttentionCount, never atRisk.length + mismatch.length: a dino can trip both
      // predicates and the sum double-counts it. Its doc comment forbids a second copy, and
      // this is the row that keeps the hub agreeing with the park card's marker.
      text: `⚠️ ${attention} need attention`,
      lossAtMs: null,
    });
  }

  if (!hasFood && dinos.length > 0) {
    out.push({
      id: 'food-empty',
      section: 'attention',
      text: '🥩 No food in stock — `/shop food`',
      lossAtMs: null,
    });
  }

  // accruedIncome directly, not pendingIncome: pendingIncome opens with its own
  // toClockDinos, and this function has already paid for one.
  const capMs = capHours(lots) * 3_600_000;
  const pending = accruedIncome(
    clockDinos, facilityBonusPct(lots), capHours(lots), user.lastCollectAt, now);
  if (pending > 0 && now - user.lastCollectAt >= capMs) {
    out.push({
      id: 'income-capped',
      section: 'attention',
      text: '⛔ Idle earnings hit the Visitor Center cap — collect to restart them',
      // Deliberately in the PAST: the park stopped earning at this instant and has been
      // losing ever since, which is what ranks it above a row that merely expires later.
      lossAtMs: user.lastCollectAt + capMs,
    });
  }

  return out;
}
