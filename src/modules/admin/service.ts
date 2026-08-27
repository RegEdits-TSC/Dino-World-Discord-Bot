import { eq, or, and, gt, isNull, isNotNull, sql } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { FOODS, STARTER_FOOD, type FoodId } from '../../data/foods.js';
import { getSpecies } from '../../data/species/index.js';
import { getOrCreateUser } from '../park/service.js';
import { recomputeRating } from '../park/rating.js';
import { settleEscapes } from '../park/escapes.js';
import { ENERGY_CAP, DUEL_START_RATING } from '../../data/battle/constants.js';
import { recordSpeciesSeen } from '../../core/species-seen.js';
import { InsufficientFundsError, ReversalError } from '../../core/economy.js';
import { sideEffectFor } from '../../data/tx-reasons.js';
import { logger } from '../../core/logger.js';

export class AdminError extends Error {}

// The tx_log reason adminReset stamps on the zero-delta boundary marker it writes below.
// Exported so the ledger (src/modules/admin/ledger.ts) derives the reset boundary from the
// same literal rather than a second hand-typed copy that could silently drift from this one.
export const RESET_MARKER_REASON = 'admin:reset';

// The instant a player's ledger was last cut by a reset — the NEWEST marker row's timestamp,
// or 0 when they have never been reset. Shared with the ledger view
// (src/modules/admin/ledger.ts) rather than hand-rolled twice, because the same boundary
// decides what that view MARKS as pre-reset and what adminReverse REFUSES to reverse: two
// copies that drifted would show the operator a row as reversible and then refuse it, or
// worse, quietly pay one the ledger had flagged.
export function resetBoundaryOf(rows: Array<typeof schema.txLog.$inferSelect>): number {
  const marks = rows.filter((r) => r.reason === RESET_MARKER_REASON);
  return marks.length ? Math.max(...marks.map((r) => r.createdAt)) : 0;
}

export interface GiveArgs {
  cash?: number; food?: { foodId: FoodId; qty: number }; shards?: number; eggRarity?: Rarity; dinoSpecies?: string;
}

// Grant resources to a player. Atomic; currency via economy.apply; rating recomputed after.
export function adminGive(ctx: Ctx, targetId: string, displayName: string, args: GiveArgs): void {
  const { cash = 0, food, shards = 0, eggRarity, dinoSpecies } = args;
  if (!cash && !food && !shards && !eggRarity && !dinoSpecies) throw new AdminError('Nothing to give.');
  if (food && !(food.foodId in FOODS)) throw new AdminError(`Unknown food: ${food.foodId}`);
  if (dinoSpecies) {
    try { getSpecies(dinoSpecies); } catch { throw new AdminError(`Unknown species: ${dinoSpecies}`); }
  }
  getOrCreateUser(ctx, targetId, displayName);
  ctx.db.transaction(() => {
    if (cash || food || shards) ctx.economy.apply(targetId,
      { cash, shards, foods: food ? { [food.foodId]: food.qty } : {} }, 'admin:give', ctx.now());
    if (eggRarity) ctx.db.insert(schema.eggs).values({
      userId: targetId, rarity: eggRarity, speciesId: null, source: 'admin', obtainedAt: ctx.now(),
    }).run();
    if (dinoSpecies) {
      ctx.db.insert(schema.dinos).values({
        userId: targetId, lotId: null, speciesId: dinoSpecies, hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(),
      }).run();
      recordSpeciesSeen(ctx, targetId, dinoSpecies);
    }
  });
  recomputeRating(ctx, targetId);
}

// Reset a player to a fresh start: delete their content, restore new-player defaults. One transaction.
export function adminReset(ctx: Ctx, targetId: string): void {
  ctx.db.transaction(() => {
    // A zero-delta boundary marker, not a charge — this is what lets the ledger
    // (src/modules/admin/ledger.ts) tell a pre-reset charge from a post-reset one. It has
    // to be a tx_log row and not, say, users.createdAt (which this function never touches —
    // that column means account CREATION, and stamping it here would corrupt that meaning)
    // because tx_log has no other reader that can see "a reset happened here." It has to be
    // written in THIS transaction, not after it: a rolled-back reset must leave no marker,
    // the same guarantee every other row this function deletes or rewrites already gets.
    ctx.db.insert(schema.txLog).values({
      userId: targetId, cashDelta: 0, shardsDelta: 0, reason: RESET_MARKER_REASON, createdAt: ctx.now(),
    }).run();
    // Deleting the trade rows below IS the unlock, including for the counterparty: escrow is
    // derived from pending trades (src/core/locks.ts), never stored on the dino/egg. When
    // targetId is the recipient (toUser) the offer belongs to a different player, and their
    // items free up the moment the row is gone.
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.userId, targetId)).run();
    ctx.db.delete(schema.eggs).where(eq(schema.eggs.userId, targetId)).run();
    ctx.db.delete(schema.lots).where(eq(schema.lots.userId, targetId)).run();
    ctx.db.delete(schema.expeditions).where(eq(schema.expeditions.userId, targetId)).run();
    ctx.db.delete(schema.timers).where(eq(schema.timers.userId, targetId)).run();
    ctx.db.delete(schema.trades)
      .where(or(eq(schema.trades.fromUser, targetId), eq(schema.trades.toUser, targetId))).run();
    ctx.db.delete(schema.battleProgress).where(eq(schema.battleProgress.userId, targetId)).run();
    // Same reasoning as trades: a pending breeding IS a parent lock (src/core/locks.ts),
    // and the dinos it names were just deleted. Leaving the row behind holds a Gene Lab
    // slot busy forever and leaves a claimable pairing whose parents no longer exist.
    ctx.db.delete(schema.breedings).where(eq(schema.breedings.userId, targetId)).run();
    // Same rule the breedings fix above already learned: reset must delete from every
    // table the daily-loop feature reads, not just the player's own dinos/eggs — a
    // stray daily_quests/user_stats/achievement_claims row would otherwise survive a
    // reset and resurface against a "fresh" account.
    ctx.db.delete(schema.userStats).where(eq(schema.userStats.userId, targetId)).run();
    ctx.db.delete(schema.dailyQuests).where(eq(schema.dailyQuests.userId, targetId)).run();
    ctx.db.delete(schema.achievementClaims).where(eq(schema.achievementClaims.userId, targetId)).run();
    // Same rule again, and it bites harder here: these tables span EVERY season, not just
    // the current one, so a scoped delete would leave a wiped account holding badges. That
    // destroys the badge collection, which is the correct reading of a reset and is worth
    // stating out loud — badgeAt is otherwise the one value in this feature nothing else
    // can ever clear.
    ctx.db.delete(schema.seasonProgress).where(eq(schema.seasonProgress.userId, targetId)).run();
    ctx.db.delete(schema.seasonClaims).where(eq(schema.seasonClaims.userId, targetId)).run();
    // Same rule again: reset must delete from every table the feature reads. A surviving
    // attraction or milestone claim would leave a "fresh" account holding paid-for
    // catalog progress and pre-claimed milestones it never re-earned.
    ctx.db.delete(schema.attractions).where(eq(schema.attractions.userId, targetId)).run();
    ctx.db.delete(schema.attendanceClaims).where(eq(schema.attendanceClaims.userId, targetId)).run();
    // Same rule the breedings and user_stats fixes taught: reset must delete from every
    // table the feature reads. A surviving alerts_sent row would suppress the first
    // alert a "fresh" account earns.
    ctx.db.delete(schema.alertsSent).where(eq(schema.alertsSent.userId, targetId)).run();
    // Same rule again: reset must delete from every table the feature reads. A
    // surviving species_seen row would leave a "fresh" account with a partly complete
    // dex. Unlike alertsEnabled below, this is progress, not communication consent.
    ctx.db.delete(schema.speciesSeen).where(eq(schema.speciesSeen.userId, targetId)).run();
    // Two-sided, like trades: a one-sided delete would leave the opponent's row naming
    // a wiped account and holding a live pair cooldown against a park that no longer
    // exists. The columns below matter as much as the rows: SQLite reuses row ids after
    // a delete, so a surviving duel_squad could silently field dinos this account
    // hatches next — the same argument the featuredDinoId comment makes.
    ctx.db.delete(schema.duels)
      .where(or(eq(schema.duels.challengerId, targetId), eq(schema.duels.defenderId, targetId))).run();
    // alertsEnabled is deliberately NOT reset. Every other column here is progress or a
    // cosmetic default; this one is communication consent. Restoring it would start
    // DMing a player who explicitly opted out.
    // landmarkTier is progress (a prestige cosmetic the player paid for), not communication
    // consent, so it IS reset.
    // motto and featuredDinoId are cosmetic defaults like parkName, so they reset too. The
    // featured id matters more than it looks: featuredFor already resolves a dangling id to
    // null, but SQLite reuses row ids after a delete, so a stale id surviving a reset can be
    // re-hit by the account's next hatch and silently feature a dino nobody chose.
    ctx.db.update(schema.users).set({
      cash: 500, shards: 0, parkRating: 0, ratingHighWater: 0, parkName: 'New Park',
      shardsWindowStart: 0, shardsWindowEarned: 0, lastCollectAt: ctx.now(),
      energy: ENERGY_CAP, energyUpdatedAt: ctx.now(),
      questStreak: 0, questStreakBest: 0, lastQuestClaimAt: 0, landmarkTier: 0,
      motto: '', featuredDinoId: null,
      duelRating: DUEL_START_RATING, duelSquad: [],
      attendanceHighWater: 0,
      // Same rule ratingHighWater already follows: this is the one path that makes the
      // computed legacyPoints total DROP (species_seen, achievement_claims and
      // battle_progress are all deleted above), and legacyRank resolves against
      // max(stored, computed) specifically so a drop can never demote a rank a player
      // actually earned (src/modules/park/ranks.ts). Leaving legacyRankBest un-reset here
      // is the one case where that safety net fires against its own purpose: a wiped
      // account would keep showing its pre-reset rank on /park view and /dex list forever
      // while /top legacy correctly shows it at 0.
      legacyRankBest: 0,
    }).where(eq(schema.users.discordId, targetId)).run();
    ctx.db.delete(schema.foodInventory).where(eq(schema.foodInventory.userId, targetId)).run();
    for (const [foodId, qty] of Object.entries(STARTER_FOOD)) {
      ctx.db.insert(schema.foodInventory).values({ userId: targetId, foodId, qty }).run();
    }
  });
}

const HOUR_MS = 3_600_000;

// Advance a player's clock by shifting their time-bearing columns backward, so the lazy
// income/hunger/escape/incubation/expedition math sees `hours` of elapsed time. Returns the
// number of dinos that escaped as a result.
export function adminFastForward(ctx: Ctx, targetId: string, hours: number): number {
  if (hours < 1 || hours > 720) throw new AdminError('hours must be between 1 and 720.');
  const shift = hours * HOUR_MS;
  ctx.db.transaction(() => {
    ctx.db.update(schema.users).set({
      lastCollectAt: sql`${schema.users.lastCollectAt} - ${shift}`,
      shardsWindowStart: sql`${schema.users.shardsWindowStart} - ${shift}`,
      energyUpdatedAt: sql`${schema.users.energyUpdatedAt} - ${shift}`,
    }).where(eq(schema.users.discordId, targetId)).run();
    // lastQuestClaimAt cannot ride the combined shift above: 0 is its "never claimed"
    // sentinel, and an unguarded shift would drive it negative and invent a claim
    // history for a player who has never claimed a quest.
    // species_seen.first_at_ms is deliberately NOT shifted. It is a historical record with
    // no timer semantics — nothing reads it to decide whether something is due — so
    // shifting it would only misdate a discovery. That test — "does anything read this to
    // decide whether something is due?" — is what separates every column shifted here from
    // every column left alone.
    // users.landmark_tier is deliberately NOT touched: the landmark ladder carries no timer
    // semantics, so there is nothing for a clock shift to move.
    // attractions.built_at_ms and users.attendance_high_water are deliberately NOT touched
    // either: built_at_ms is history (same reasoning as species_seen.first_at_ms above —
    // nothing reads it to decide whether something is due), and attendance_high_water is a
    // balance, not a timer. If a build cooldown is ever added to attractions, THAT column
    // must shift; this one still shouldn't.
    // daily_quests.dayKey is deliberately NOT shifted: fast-forward cannot move the UTC
    // calendar, so today's board stays today's. Shifting the claim anchor is what lets a
    // streak gap or continuation be simulated.
    // season_progress/season_claims are deliberately NOT touched, for the same reason:
    // seasonIndex derives from the UTC calendar, which fast-forward cannot move. There is
    // no season streak, so there is no claim anchor worth shifting either.
    ctx.db.update(schema.users)
      .set({ lastQuestClaimAt: sql`${schema.users.lastQuestClaimAt} - ${shift}` })
      .where(and(eq(schema.users.discordId, targetId), gt(schema.users.lastQuestClaimAt, 0))).run();
    // escapedAt rides along with lastFedAt: accruedIncome clamps a dino's accrual
    // window at its stamped escapedAt, and shifting lastCollectAt/lastFedAt without
    // it pulls that stamped instant back INSIDE the window, letting an already-settled,
    // already-paid escaped dino resume earning. SQL NULL arithmetic keeps a
    // never-escaped dino's NULL exactly NULL, so this is safe to apply unconditionally
    // alongside lastFedAt rather than needing its own escapedAt IS NOT NULL filter.
    ctx.db.update(schema.dinos).set({
      lastFedAt: sql`${schema.dinos.lastFedAt} - ${shift}`,
      escapedAt: sql`${schema.dinos.escapedAt} - ${shift}`,
    }).where(eq(schema.dinos.userId, targetId)).run();
    ctx.db.update(schema.eggs).set({
      incubationStartedAt: sql`${schema.eggs.incubationStartedAt} - ${shift}`,
      hatchesAt: sql`${schema.eggs.hatchesAt} - ${shift}`,
    }).where(and(eq(schema.eggs.userId, targetId), isNotNull(schema.eggs.incubationStartedAt))).run();
    ctx.db.update(schema.expeditions).set({
      departedAt: sql`${schema.expeditions.departedAt} - ${shift}`,
      returnsAt: sql`${schema.expeditions.returnsAt} - ${shift}`,
    }).where(eq(schema.expeditions.userId, targetId)).run();
    ctx.db.update(schema.timers).set({ firesAt: sql`${schema.timers.firesAt} - ${shift}` })
      .where(and(eq(schema.timers.userId, targetId), isNull(schema.timers.handledAt))).run();
    // breedings.readyAt is a live timer — claimBreeding rejects while readyAt > now — and
    // the scheduler row that ANNOUNCES the pairing is shifted just above. Leaving this
    // unshifted therefore delivered the "breeding ready" notification while /breed claim
    // still refused it, which is what made a fast-forwarded pairing look stuck. startedAt
    // rides along so the pairing's own duration stays consistent with its ready time.
    // Claimed rows are history rather than timers and are left alone.
    ctx.db.update(schema.breedings).set({
      startedAt: sql`${schema.breedings.startedAt} - ${shift}`,
      readyAt: sql`${schema.breedings.readyAt} - ${shift}`,
    }).where(and(eq(schema.breedings.userId, targetId), isNull(schema.breedings.claimedAt))).run();
    // trades.createdAt anchors the 24h expiry, and locksFor evaluates that at READ time, so
    // shifting it is what actually releases escrow — nothing sweeps. Pending rows only: a
    // resolved trade is history, and its resolvedAt would have to move in lockstep to stay
    // coherent. One accepted consequence of that scoping: createTrade's daily cap counts
    // rows by createdAt regardless of status, so completed trades still count against the
    // cap after a fast-forward. Expiry and escrow are what this tool is for; adminReset is
    // the way to clear a spent cap.
    // Two-sided like the duel log below — shifting a trade the target is party to also moves
    // it for the counterparty, which is correct: expiry is a property of the trade, not of
    // one side of it.
    ctx.db.update(schema.trades).set({ createdAt: sql`${schema.trades.createdAt} - ${shift}` })
      .where(and(eq(schema.trades.status, 'pending'),
        or(eq(schema.trades.fromUser, targetId), eq(schema.trades.toUser, targetId)))).run();
    // The duel log is history AND the only anchor of the pair cooldown, which is what
    // separates it from species_seen.first_at_ms above: leaving it unshifted would make
    // the one time-gated rule in the duel feature untestable by this tool. Shifting it
    // moves the displayed timestamps in /duel record — accepted, exactly as this tool
    // already moves lastFedAt. A duel row is two-sided, so shifting "this player's" rows
    // also lapses the opponent's cooldown against them, which is correct: the cooldown
    // is a property of the pair.
    ctx.db.update(schema.duels).set({ createdAt: sql`${schema.duels.createdAt} - ${shift}` })
      .where(or(eq(schema.duels.challengerId, targetId), eq(schema.duels.defenderId, targetId))).run();
  });
  return settleEscapes(ctx, targetId).length;
}

// The operator's free-text reason, capped before it is stored. /admin ledger renders the note
// into an embed DESCRIPTION, and Discord caps a description at 4096 characters — ten notes at
// full length on one page would overflow that budget and turn the whole ledger reply into a
// rejected request. The command option carries the same cap so the operator is stopped while
// typing rather than silently truncated afterwards.
export const NOTE_MAX = 200;

// Names the gap rather than reporting a bare failure. Reversing a CREDIT takes the money back
// — the only way a balance falls outside normal play — so a player who has already spent it
// cannot pay, and "insufficient cash" alone leaves the operator unable to tell whether they
// are 5 short or 5,000,000 short. Read AFTER the reversal transaction rolled back, so these
// balances are the untouched ones.
function shortfallOf(ctx: Ctx, row: typeof schema.txLog.$inferSelect, e: InsufficientFundsError): string {
  if (e.foodId) {
    const held = ctx.economy.getFoodInventory(row.userId)[e.foodId] ?? 0;
    return `the player holds ${held} ${FOODS[e.foodId].name} and the reversal needs `
      + `${row.foodDelta} — ${row.foodDelta - held} short.`;
  }
  const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, row.userId)).get();
  const needed = e.wallet === 'cash' ? row.cashDelta : row.shardsDelta;
  const held = (e.wallet === 'cash' ? u?.cash : u?.shards) ?? 0;
  return `the player holds ${held} ${e.wallet} and the reversal needs ${needed} — ${needed - held} short.`;
}

// Reverses one ledger row for a named player. The user id is required and checked against the
// row on purpose: it is the confirmation step, so a mistyped transaction id becomes a refusal
// rather than a refund to the wrong person.
//
// Reversal is SYMMETRIC and deliberately unguarded in that direction: reversing a credit takes
// cash back, which is the only path by which a balance decreases outside normal play. Money is
// all it moves — whatever the charge bought is still there, which is what the returned
// side-effect note exists to say out loud.
export function adminReverse(
  ctx: Ctx, targetId: string, txId: number, note?: string,
): { sideEffect: string; notified: boolean } {
  const row = ctx.db.select().from(schema.txLog).where(eq(schema.txLog.id, txId)).get();
  if (!row) throw new AdminError(`No transaction #${txId}.`);
  if (row.userId !== targetId) throw new AdminError(`#${txId} belongs to a different player.`);
  // A marker moved no money, so reversing it is economically inert — but it would mint a
  // nonsense "reverses #<marker>" row into the very ledger this feature exists to make
  // readable, and EconomyService.reverse would accept it: its guards know nothing about
  // markers. The refusal lives HERE rather than in core because a reset marker is an admin
  // concept, and core has no business knowing the reason string this module stamps.
  if (row.reason === RESET_MARKER_REASON) {
    throw new AdminError(`#${txId} marks an account reset, not a charge — there is nothing to reverse.`);
  }
  const resetAt = resetBoundaryOf(ctx.db.select().from(schema.txLog)
    .where(and(eq(schema.txLog.userId, targetId), eq(schema.txLog.reason, RESET_MARKER_REASON))).all());
  // adminReset clears every per-player table except this one and restores new-player defaults,
  // so a charge from before that line names money this account has nothing left to show for.
  // Crediting it back would pay a fresh start for a park that was already erased.
  if (row.createdAt < resetAt) {
    throw new AdminError(`#${txId} predates this player’s reset and cannot be reversed.`);
  }
  const trimmed = note?.trim().slice(0, NOTE_MAX) || undefined;

  try {
    ctx.economy.reverse(txId, ctx.now(), trimmed);
  } catch (e) {
    if (e instanceof ReversalError) throw new AdminError(e.message);
    if (e instanceof InsufficientFundsError) {
      throw new AdminError(`Cannot reverse #${txId}: ${shortfallOf(ctx, row, e)}`);
    }
    throw e;
  }

  // AFTER the commit, never inside it: an unreachable player must not roll back a completed
  // reversal, which is why the send is fired rather than awaited. The rejection is LOGGED and
  // not discarded — the operator has already been told the note was queued, and a delivery
  // that fails leaving no trace anywhere is a claim nobody can go back and check.
  let notified = false;
  if (trimmed) {
    notified = true;
    void ctx.notify(targetId, null, `🧾 A transaction was reversed by an operator: ${trimmed}`)
      .catch((err: unknown) => logger.warn({ err, targetId, txId }, 'reversal note could not be delivered'));
  }
  return { sideEffect: sideEffectFor(row.reason), notified };
}
