import type { BattleResult } from './resolve.js';

/** Always from the challenger's side, matching the `duels.result` column. */
export type DuelResult = 'win' | 'loss' | 'draw';
export type DuelMode = 'ghost' | 'live';

/**
 * Read a duel outcome off a BattleResult.
 *
 * BattleResult has no `draw` field and `won: false` covers two different endings —
 * side 0 wiped, and both sides still standing when MAX_ROUNDS ran out. The only
 * correct draw inference is "side 0 did not win but still has survivors", because
 * `won` already requires every side-1 combatant to be dead. `rounds === MAX_ROUNDS`
 * is NOT equivalent (a fight can be decided on the final round) and neither is any
 * squadKos comparison.
 *
 * Note also that `won`, `squadKos` and `squadSurvivors` are all side-0 only, which
 * is why this takes which side the challenger held rather than reading it off the
 * result.
 */
export function outcomeFor(result: BattleResult, side0IsChallenger: boolean): DuelResult {
  const side0: DuelResult = result.won ? 'win' : result.squadSurvivors.length > 0 ? 'draw' : 'loss';
  if (side0 === 'draw' || side0IsChallenger) return side0;
  return side0 === 'win' ? 'loss' : 'win';
}
