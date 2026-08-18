export interface AttractionDef {
  kind: string; name: string; maxLevel: number;
  /** Draw per level, index 0 = level 1. Read ONLY through levelValue. */
  draw: number[];
  buildCost: number; upgradeCosts: number[];
  /** Attendance high-water at which this kind becomes buildable. */
  unlockAt: number;
}

/**
 * The guest-facing build catalog. Priced in CASH and paying no currency of its own, which
 * is what bounds the feedback loop structurally: attractions raise attendance, attendance
 * unlocks attractions, and attendance produces no cash — so the loop's output is never its
 * own input, and the ceiling is a closed-form expression rather than a tuned constant.
 *
 * Deliberately its own table rather than a third lots.type. lots.type carries no SQL CHECK,
 * so widening that enum would have needed no migration at all — but recomputeRating sums
 * `l.level + l.decor.length` over ALL lots with no type filter, so attractions-as-lots would
 * silently gain rating power on a backwards curve (worth ~8.75 rating to a mid-game park,
 * exactly 0 to a saturated one). A separate table makes the power-freedom structural rather
 * than a filter someone has to remember, the same argument that kept landmarks off DECOR.
 *
 * Six kinds, each gated by its own unlockAt and buildable at most once — there is no separate
 * slot pool, because a slot ladder keyed on the same high-water would be a second table kept
 * in lockstep with these thresholds for no behavioural difference. The top-level draws sum to
 * ATTRACTION_DRAW_TARGET, so a complete catalog saturates the attraction term exactly, and the
 * unlock order is also the power order. Both facts are machine-gated in
 * tests/attractions-content.test.ts.
 *
 * Total cost 93,000,000 — 21.6 days of the reference park's unspent surplus (4,297,440/day),
 * against the landmark ladder's 315,000,000 / 47-73 days and the entire rest of the game's
 * purchasable content at 4,299,000 / ~1 day.
 *
 * No emojiTag anywhere in this file: the emoji map loads after client ready, so a module-level
 * constant would freeze the unicode fallback permanently.
 */
export const ATTRACTIONS: Record<string, AttractionDef> = {
  picnic_lawn: {
    kind: 'picnic_lawn', name: 'Picnic Lawn', maxLevel: 3,
    draw: [6, 12, 20], buildCost: 250_000, upgradeCosts: [750_000, 2_000_000], unlockAt: 0,
  },
  gift_shop: {
    kind: 'gift_shop', name: 'Gift Shop', maxLevel: 3,
    draw: [8, 16, 26], buildCost: 500_000, upgradeCosts: [1_500_000, 4_000_000], unlockAt: 150,
  },
  viewing_platform: {
    kind: 'viewing_platform', name: 'Viewing Platform', maxLevel: 3,
    draw: [10, 20, 32], buildCost: 1_000_000, upgradeCosts: [3_000_000, 8_000_000], unlockAt: 300,
  },
  amber_carousel: {
    kind: 'amber_carousel', name: 'Amber Carousel', maxLevel: 3,
    draw: [12, 24, 38], buildCost: 1_500_000, upgradeCosts: [4_500_000, 12_000_000], unlockAt: 500,
  },
  sky_gondola: {
    kind: 'sky_gondola', name: 'Sky Gondola', maxLevel: 3,
    draw: [14, 28, 44], buildCost: 2_000_000, upgradeCosts: [6_000_000, 16_000_000], unlockAt: 700,
  },
  grand_atrium: {
    kind: 'grand_atrium', name: 'Grand Atrium', maxLevel: 3,
    draw: [16, 32, 50], buildCost: 2_500_000, upgradeCosts: [7_500_000, 20_000_000], unlockAt: 900,
  },
};

export const MAX_ATTRACTION_LEVEL = 3;

/** The def for a kind, or null for an unknown or retired slug — never a throw. */
export function attractionFor(kind: string): AttractionDef | null {
  return ATTRACTIONS[kind] ?? null;
}
