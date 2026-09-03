import type { HubSignal } from './types.js';

/**
 * Discord allows five buttons in one action row, and the hub spends exactly one row on
 * ranked actions. Raising this past 5 does not add a row — it overflows the row and fails
 * validateMessagePayload in every suite that renders a full hub.
 */
export const MAX_HUB_BUTTONS = 5;

/**
 * The actionable rows, most urgent first, capped at one action row.
 *
 * Deadline-first is the only ordering that cannot mislead: every row it demotes is
 * recoverable and every row it promotes is not. See HubSignal.lossAtMs.
 *
 * The index is carried through the sort and used as the tiebreak rather than relying on
 * Array.prototype.sort being stable. It is stable in every engine this runs on, but "ties
 * keep caller order" is a PROMISE this function makes to its tests, and resting a promise on
 * an engine guarantee that no test would notice breaking is how it stops being true.
 */
export function rankSignals(signals: HubSignal[]): HubSignal[] {
  return signals
    .filter((s) => s.control !== undefined)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const al = a.s.lossAtMs;
      const bl = b.s.lossAtMs;
      if (al !== bl) {
        // null last, in both directions — never fold null into a sentinel number, because
        // Infinity would sort correctly here and then render as a date somewhere else.
        if (al === null) return 1;
        if (bl === null) return -1;
        return al - bl;
      }
      return a.i - b.i;
    })
    .map((e) => e.s)
    .slice(0, MAX_HUB_BUTTONS);
}
