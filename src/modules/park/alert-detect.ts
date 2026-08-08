import { escapeAt, type ClockDino } from '../../core/clock.js';
import { ESCAPE_TIERS, type EscapeTier } from './alert-record.js';

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
