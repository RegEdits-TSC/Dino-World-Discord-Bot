package dev.homeology.dinoworld.modules.players;

/**
 * Pure XP/level math, isolated from persistence so the curve can be
 * retuned without DB migrations or service refactors.
 *
 * <p>The shipping curve is exponential and capped:
 * <pre>{@code
 *   xp_to_next(L)               = floor(60 × 1.08^L)        (XP required to go from L → L+1)
 *   cumulative_xp_for_level(L)  = sum_{i=1}^{L-1} xp_to_next(i)
 * }</pre>
 *
 * <p>Picked numbers (current curve):
 * <ul>
 *   <li>L 1 → 2: 64 XP (start fast)</li>
 *   <li>L 10 → 11: 129 XP</li>
 *   <li>L 50 → 51: 2,814 XP</li>
 *   <li>L 99 → 100: ~110K XP</li>
 *   <li>Total to reach {@link #LEVEL_CAP}: ~1.65M XP</li>
 * </ul>
 *
 * <p>Levels are hard-capped at {@link #LEVEL_CAP}. Once a player reaches
 * the cap, {@link #xpToNextLevel(int)} returns {@code 0} and
 * {@link #xpProgressInLevel(long)} returns {@code 0} regardless of
 * accumulated XP — callers should check {@link #isMaxLevel(int)} when
 * rendering "Level X / Y XP" displays.
 *
 * <p>Incubation slot count is also derived here so {@code /eggs} and the
 * shop have a single source of truth: start at 2, gain +1 every
 * {@link #LEVELS_PER_SLOT} levels, cap at {@link #SLOTS_CAP}.
 *
 * <p>This is a stateless utility; the cumulative table is precomputed
 * once at class init since the curve is bounded by {@link #LEVEL_CAP}.
 * Instances are interchangeable, but it's a class (not a static helper)
 * so it can be published into the
 * {@link dev.homeology.dinoworld.core.ServiceRegistry} and injected into
 * commands that want a single seam to mock.
 */
public final class LevelingService {

	/**
	 * Hard ceiling on player level. Reached when total XP &ge;
	 * {@link #cumulativeXpForLevel(int) cumulativeXpForLevel(LEVEL_CAP)}.
	 */
	public static final int LEVEL_CAP = 100;

	/** Base coefficient of the exponential curve. */
	private static final double XP_BASE = 60.0;

	/** Growth multiplier per level — 1.08 ≈ MMO-standard "8% steeper each level". */
	private static final double XP_MULTIPLIER = 1.08;

	/**
	 * Starting incubation slot count for a new player.
	 */
	public static final int SLOTS_BASE = 2;

	/**
	 * Maximum incubation slots a player can ever reach.
	 */
	public static final int SLOTS_CAP = 8;

	/**
	 * Levels per slot increment.
	 */
	public static final int LEVELS_PER_SLOT = 10;

	/**
	 * Precomputed cumulative XP at the start of each level.
	 * {@code CUMULATIVE[L]} = total XP needed to reach level {@code L}.
	 * Index 0 is unused (levels start at 1); indices 1..LEVEL_CAP+1 are
	 * populated so {@link #cumulativeXpForLevel(int)} can serve both
	 * {@code level} and {@code level + 1} lookups.
	 */
	private static final long[] CUMULATIVE = computeCumulative();

	private static long[] computeCumulative() {
		var table = new long[LEVEL_CAP + 2];
		// table[1] = 0 by default (level 1 starts at 0 XP).
		long running = 0L;
		for (int L = 1; L <= LEVEL_CAP; L++) {
			running += xpStep(L);
			table[L + 1] = running;
		}
		return table;
	}

	/** Per-level XP delta, derived directly from the curve formula. */
	private static long xpStep(int level) {
		return (long) Math.floor(XP_BASE * Math.pow(XP_MULTIPLIER, level));
	}

	/**
	 * XP needed to advance from {@code level} to {@code level + 1}, or
	 * {@code 0} when {@code level} is at {@link #LEVEL_CAP} (no further
	 * levels exist).
	 *
	 * @param level current level, in {@code [1, LEVEL_CAP]}
	 * @return non-negative XP delta; {@code 0} only at the level cap
	 * @throws IllegalArgumentException if {@code level < 1} or
	 *                                  {@code level > LEVEL_CAP}
	 */
	public long xpToNextLevel(int level) {
		if (level < 1 || level > LEVEL_CAP) {
			throw new IllegalArgumentException(
				"level must be in [1, " + LEVEL_CAP + "], got: " + level);
		}
		if (level == LEVEL_CAP) return 0L;
		return xpStep(level);
	}

	/**
	 * Cumulative XP at which {@code level} begins. Level 1 is 0 XP; the
	 * value at {@link #LEVEL_CAP} is the total XP required to reach the
	 * cap.
	 *
	 * @throws IllegalArgumentException if {@code level < 1} or
	 *                                  {@code level > LEVEL_CAP}
	 */
	public long cumulativeXpForLevel(int level) {
		if (level < 1 || level > LEVEL_CAP) {
			throw new IllegalArgumentException(
				"level must be in [1, " + LEVEL_CAP + "], got: " + level);
		}
		return CUMULATIVE[level];
	}

	/**
	 * @return the level corresponding to {@code totalXp}, clamped to
	 *         {@code [1, LEVEL_CAP]}.
	 */
	public int levelForXp(long totalXp) {
		if (totalXp <= 0) return 1;
		// Linear scan over the precomputed table; LEVEL_CAP=100 makes this
		// trivially cheap. Find the largest L where CUMULATIVE[L] <= totalXp.
		int level = 1;
		for (int L = 2; L <= LEVEL_CAP; L++) {
			if (CUMULATIVE[L] <= totalXp) level = L;
			else break;
		}
		return level;
	}

	/**
	 * @return XP earned within the current level (0 ≤ result &lt;
	 *         {@link #xpToNextLevel(int)}). Returns {@code 0} when at
	 *         {@link #LEVEL_CAP} — there's no "next level" to be partway
	 *         through.
	 */
	public long xpProgressInLevel(long totalXp) {
		int level = levelForXp(totalXp);
		if (level == LEVEL_CAP) return 0L;
		return totalXp - cumulativeXpForLevel(level);
	}

	/**
	 * @return {@code true} iff {@code level} is at the hard cap and no
	 *         further leveling is possible.
	 */
	public boolean isMaxLevel(int level) {
		return level >= LEVEL_CAP;
	}

	/**
	 * @param level the player's level
	 * @return number of incubation slots available; in
	 *         {@code [SLOTS_BASE, SLOTS_CAP]}
	 */
	public int slotsForLevel(int level) {
		if (level < 1) return SLOTS_BASE;
		return Math.min(SLOTS_CAP, SLOTS_BASE + level / LEVELS_PER_SLOT);
	}
}
