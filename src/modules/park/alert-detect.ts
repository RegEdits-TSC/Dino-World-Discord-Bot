import { escapeAt, type ClockDino } from '../../core/clock.js';
import { SEASON_DAYS } from '../../core/world.js';
import { ESCAPE_TIERS, SEASON_END_WARN_MS, type EscapeTier } from './alert-record.js';
import type { SeasonView } from '../daily/season.js';

export interface EscapeAlert { dinoId: number; name: string; escapeAt: number; tier: EscapeTier }

/** Rows this predicate reads. Deliberately narrower than the full dinos row so the
 *  function stays pure and its tests need no DB. Exported for those tests. */
export interface DinoLike { id: number; nickname: string | null; escapedAt: number | null }

/**
 * Dinos that are inside an escape-warning lead as of `now`.
 *
 * `clockDinos` and `dinos` are INDEX-ALIGNED, the same contract park/escapes.ts and
 * park/dinos.ts already rely on — never zip them by id.
 *
 * Three conjuncts, each load-bearing:
 *   - `escapedAt === null`  — the row has already been stamped; nothing to warn about.
 *   - `esc !== null`        — escapeAt returns null without a paddock; unassigned dinos
 *                             never escape.
 *   - `esc > now`           — the downtime guard. After an outage an unstamped dino can
 *                             still yield an instant in the past; warning about it would
 *                             be a lie.
 */
export function escapeAlertsFor(clockDinos: ClockDino[], dinos: DinoLike[], now: number): EscapeAlert[] {
  const out: EscapeAlert[] = [];
  for (let idx = 0; idx < dinos.length; idx++) {
    const row = dinos[idx];
    if (row.escapedAt !== null) continue;
    const esc = escapeAt(clockDinos[idx]);
    if (esc === null || esc <= now) continue;
    const remaining = esc - now;
    // ESCAPE_TIERS is most-urgent-first, so the first match is the most urgent tier
    // this dino qualifies for. recordEscapeSent then collapses the less urgent ones.
    const tier = ESCAPE_TIERS.find((t) => remaining <= t.leadMs);
    if (!tier) continue;
    out.push({
      dinoId: row.id,
      name: row.nickname ?? clockDinos[idx].species.name,
      escapeAt: esc,
      tier: tier.tier,
    });
  }
  return out.sort((a, b) => a.escapeAt - b.escapeAt);
}

import { accruedIncome } from '../../core/clock.js';
import { capHours, facilityBonusPct, type Lot } from './service.js';

export interface IncomeCapAlert { capAt: number; pending: number; capHours: number }

/**
 * The park has stopped earning and has money waiting.
 *
 * `capAt` is an UPPER BOUND, not the instant earning stopped: accruedIncome clamps each
 * dino independently at its own escapeAt and hungerZero (clock.ts:96-99), so a starving
 * park stops earlier. The embed must therefore never quote a precise instant — only that
 * the cap has been reached.
 *
 * `pending > 0` is NOT monotone: accruedIncome recomputes the whole window from CURRENT
 * hunger, so a starved park reading 0 jumps to a full capped payout the moment its owner
 * feeds. That is exactly why this is level-triggered — the alert fires on the sweep where
 * the condition first becomes true, rather than being missed forever by an edge test.
 */
export function incomeCapAlertFor(
  clockDinos: ClockDino[], lots: Lot[], lastCollectAt: number, now: number,
): IncomeCapAlert | null {
  const hours = capHours(lots);
  const capAt = lastCollectAt + hours * 3_600_000;
  if (now < capAt) return null;
  const pending = accruedIncome(clockDinos, facilityBonusPct(lots), hours, lastCollectAt, now);
  if (pending <= 0) return null;
  return { capAt, pending, capHours: hours };
}

export interface SeasonEndAlert { endsAt: number; unclaimed: number }

/**
 * A nudge is owed iff the season ends within SEASON_END_WARN_MS and at least one unlocked
 * rung is still unclaimed. Cash forfeits at rollover; this is the warning.
 *
 * `endsAt` is the TRUE season boundary — a fixed instant for the whole season — never
 * `now + daysLeft * DAY`. That anchoring matters more than it looks: firedForMs is
 * compared with a 2-hour tolerance (ALERT_INSTANT_EPSILON_MS), so a now-anchored value
 * drifts with time of day and two sweeps three hours apart would each read as a NEW
 * instant. At SWEEP_MS the result is a DM roughly every two hours for three days instead
 * of exactly one per season.
 */
export function seasonEndAlertFor(
  view: SeasonView | null, now: number,
): SeasonEndAlert | null {
  if (!view) return null;
  const endsAt = (view.index + 1) * SEASON_DAYS * 86_400_000;
  if (endsAt - now > SEASON_END_WARN_MS) return null;
  const unclaimed = view.rungs.filter((r) => r.unlocked && !r.claimed).length;
  return unclaimed > 0 ? { endsAt, unclaimed } : null;
}
