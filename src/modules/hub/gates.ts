import { EXPEDITION_SITES } from '../../data/sites.js';
import {
  SHOP_CEILING, MYTHIC_UNLOCK_RATING, nextLotSlot,
} from '../../data/progression.js';

/**
 * The nearest rating rung the player has not reached, and everything that opens at it.
 *
 * `labels` is a LIST because the ladders collide: more than one rung shares a threshold, and
 * naming only the first would silently hide the others on exactly the rungs a player cares
 * most about. Every consumer renders the whole list.
 *
 * Battle chapters are deliberately absent: a chapter can be gated on a star total or on the
 * previous chapter's boss rather than on a rating, so it has no single threshold to compare.
 */
export interface RatingGate { threshold: number; labels: string[] }

export function nextRatingGate(highWater: number): RatingGate | null {
  const gates: Array<{ threshold: number; label: string }> = [];

  // Lot slots come through nextLotSlot rather than by filtering LOT_SLOT_THRESHOLDS here,
  // so the slot NUMBER stays the one nextLotSlot computes. Recomputing it would put a
  // second copy of the BASE_LOT_SLOTS_FALLBACK offset in the repo, free to drift.
  const slot = nextLotSlot(highWater);
  if (slot !== null) gates.push({ threshold: slot.threshold, label: `lot slot ${slot.slot}` });

  for (const site of Object.values(EXPEDITION_SITES)) {
    if (site.unlockRating > highWater) {
      gates.push({ threshold: site.unlockRating, label: site.name });
    }
  }

  // SHOP_CEILING is stored DESCENDING by `atLeast`; this filter does not care about order,
  // and must not be rewritten into a `find` that does.
  for (const rung of SHOP_CEILING) {
    if (rung.atLeast > highWater) {
      gates.push({ threshold: rung.atLeast, label: `${rung.ceiling} eggs in the shop` });
    }
  }

  if (MYTHIC_UNLOCK_RATING > highWater) {
    gates.push({ threshold: MYTHIC_UNLOCK_RATING, label: 'mythic shard purchases' });
  }

  if (gates.length === 0) return null;
  const threshold = Math.min(...gates.map((g) => g.threshold));
  return { threshold, labels: gates.filter((g) => g.threshold === threshold).map((g) => g.label) };
}
