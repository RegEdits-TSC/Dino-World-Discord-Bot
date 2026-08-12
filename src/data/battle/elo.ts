import { DUEL_K } from './constants.js';

/** 1 = win, 0.5 = draw, 0 = loss — always from the scored player's own side. */
export type DuelScore = 1 | 0.5 | 0;

/** Probability the `mine` rating beats the `theirs` rating, on the standard curve. */
export function expectedScore(mine: number, theirs: number): number {
  return 1 / (1 + 10 ** ((theirs - mine) / 400));
}

/**
 * The signed rating change for the player whose rating is `mine`.
 *
 * ZERO-SUM CONTRACT: a caller must compute ONE delta and apply its negation to the
 * opponent. Rounding both sides independently does not conserve points, because
 * Math.round(2.5) is 3 while Math.round(-2.5) is -2 — a half-point pairing would
 * mint or burn a point per duel and the whole pool would drift.
 *
 * Deliberately unfloored: a floor would break the same conservation, and a
 * non-negative CHECK on the column would turn a losing streak into a crash rather
 * than a low number. The curve self-limits — 400 points behind, a loss costs 3.
 */
export function eloDelta(mine: number, theirs: number, score: DuelScore): number {
  return Math.round(DUEL_K * (score - expectedScore(mine, theirs)));
}
