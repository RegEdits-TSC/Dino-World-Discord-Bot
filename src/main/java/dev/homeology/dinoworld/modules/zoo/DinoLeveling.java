package dev.homeology.dinoworld.modules.zoo;

/**
 * Pure XP/level math for individual dinos. The curve is exponential, the
 * cap is fifty, and the only source of dino XP is the player feeding the
 * dino — idle ticks and staff auto-feeds don't grant XP, otherwise
 * leveling would be AFK-grindable.
 *
 * <p>Shipping curve:
 * <pre>{@code
 *   xp_to_next(L)              = floor(50 × 1.07^L)        (XP from L → L+1)
 *   cumulative_xp_for_level(L) = sum_{i=1}^{L-1} xp_to_next(i)
 *   income_multiplier(L)       = 1.0 + 0.025 × (L - 1)
 * }</pre>
 *
 * <p>Picked numbers:
 * <ul>
 *   <li>L 1 → 2: 53 XP (≈ 4 feeds)</li>
 *   <li>L 25 → 26: 271 XP (≈ 23 feeds)</li>
 *   <li>L 49 → 50: 1,414 XP (≈ 118 feeds)</li>
 *   <li>Total to {@link #MAX_LEVEL}: ~25k XP (long but reachable)</li>
 *   <li>L 50 income multiplier: 2.225× the base species income</li>
 * </ul>
 *
 * <p>The class mirrors {@link dev.homeology.dinoworld.modules.players.LevelingService}
 * in shape so the two systems are immediately recognizable side by side.
 * Stateless utility; cumulative table precomputed once at class init.
 */
public final class DinoLeveling {

	/**
	 * Hard ceiling on dino level. Reached when total XP &ge;
	 * {@link #cumulativeXpForLevel(int) cumulativeXpForLevel(MAX_LEVEL)}.
	 */
	public static final int MAX_LEVEL = 50;

	/** Base coefficient of the exponential curve. */
	private static final double XP_BASE = 50.0;

	/** Growth multiplier per level — 1.07 yields a longer climb than the player 1.08 curve. */
	private static final double XP_MULTIPLIER = 1.07;

	/** Per-level flat income bonus: L50 caps at +122.5% over base. */
	private static final double INCOME_PER_LEVEL = 0.025;

	/**
	 * Precomputed cumulative XP at the start of each level.
	 * Index 0 unused (levels start at 1); 1..MAX_LEVEL+1 populated so the
	 * lookups for both {@code level} and {@code level+1} are O(1).
	 */
	private static final long[] CUMULATIVE = computeCumulative();

	private static long[] computeCumulative() {
		var table = new long[MAX_LEVEL + 2];
		long running = 0L;
		for (int L = 1; L <= MAX_LEVEL; L++) {
			running += xpStep(L);
			table[L + 1] = running;
		}
		return table;
	}

	private static long xpStep(int level) {
		return (long) Math.floor(XP_BASE * Math.pow(XP_MULTIPLIER, level));
	}

	private DinoLeveling() {
		// utility
	}

	/**
	 * XP required to advance from {@code level} to {@code level + 1}, or
	 * {@code 0} when already at {@link #MAX_LEVEL}.
	 *
	 * @throws IllegalArgumentException if {@code level} is outside {@code [1, MAX_LEVEL]}
	 */
	public static long xpToNextLevel(int level) {
		if (level < 1 || level > MAX_LEVEL) {
			throw new IllegalArgumentException(
				"level must be in [1, " + MAX_LEVEL + "], got: " + level);
		}
		if (level == MAX_LEVEL) return 0L;
		return xpStep(level);
	}

	/**
	 * Cumulative XP at which {@code level} begins. Level 1 = 0 XP; the
	 * value at {@link #MAX_LEVEL} is the total XP to reach the cap.
	 */
	public static long cumulativeXpForLevel(int level) {
		if (level < 1 || level > MAX_LEVEL) {
			throw new IllegalArgumentException(
				"level must be in [1, " + MAX_LEVEL + "], got: " + level);
		}
		return CUMULATIVE[level];
	}

	/**
	 * @return the level matching {@code totalXp}, clamped to {@code [1, MAX_LEVEL]}.
	 */
	public static int levelForTotalXp(long totalXp) {
		if (totalXp <= 0L) return 1;
		int level = 1;
		for (int L = 2; L <= MAX_LEVEL; L++) {
			if (CUMULATIVE[L] <= totalXp) level = L;
			else break;
		}
		return level;
	}

	/**
	 * @return XP earned within the current level (0 ≤ result &lt;
	 *         {@link #xpToNextLevel(int) xpToNextLevel(level)}). Returns 0
	 *         at {@link #MAX_LEVEL} — there's no "next level" to be partway
	 *         through.
	 */
	public static long xpProgressInLevel(long totalXp) {
		int level = levelForTotalXp(totalXp);
		if (level == MAX_LEVEL) return 0L;
		return totalXp - CUMULATIVE[level];
	}

	/**
	 * Flat multiplier applied to per-hour income for dinos at {@code level}.
	 * Caller is responsible for already having validated/clamped {@code level};
	 * out-of-range values are clamped here defensively.
	 */
	public static double incomeMultiplier(int level) {
		int clamped = Math.clamp(level, 1, MAX_LEVEL);
		return 1.0 + INCOME_PER_LEVEL * (clamped - 1);
	}

	/** @return whether {@code level} is at the hard cap. */
	public static boolean isMaxLevel(int level) {
		return level >= MAX_LEVEL;
	}
}
