package dev.homeology.dinoworld.modules.players;

/**
 * Pure XP/level math, isolated from persistence so the curve can be
 * retuned without DB migrations or service refactors.
 *
 * <p>The shipping curve is intentionally simple:
 * <pre>{@code
 *   xp_to_next(L)               = 100 × L           (XP required to go from L → L+1)
 *   cumulative_xp_for_level(L)  = 50 × L × (L-1)    (XP at which level L starts)
 * }</pre>
 *
 * <p>So level 2 starts at 100 XP, level 3 at 300, level 4 at 600. Fast
 * early progression, slower late — appropriate for v1 since the only XP
 * sources are hatch (10–200), /daily (25), and /sell (proportional).
 *
 * <p>Incubation slot count is also derived here so {@code /eggs} and the
 * shop have a single source of truth: start at 2, gain +1 every 5 levels,
 * cap at 8.
 *
 * <p>This is a stateless utility; instances are interchangeable, but it's
 * a class (not a static helper) so it can be published into the
 * {@link dev.homeology.dinoworld.core.ServiceRegistry} and injected into
 * commands that want a single seam to mock.
 */
public final class LevelingService {

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
	 * XP needed to advance from {@code level} to {@code level + 1}.
	 *
	 * @param level current level (≥ 1)
	 * @return strictly positive XP delta
	 */
	public long xpToNextLevel(int level) {
		if (level < 1) throw new IllegalArgumentException("level must be ≥ 1, got: " + level);
		return 100L * level;
	}

	/**
	 * Cumulative XP at which {@code level} begins. Level 1 is 0 XP.
	 */
	public long cumulativeXpForLevel(int level) {
		if (level < 1) throw new IllegalArgumentException("level must be ≥ 1, got: " + level);
		return 50L * level * (level - 1);
	}

	/**
	 * @return the level corresponding to {@code totalXp} (always ≥ 1)
	 */
	public int levelForXp(long totalXp) {
		if (totalXp < 0) return 1;
		// xp ≥ 50·L·(L-1) → solve L² - L - xp/50 ≤ 0
		// L ≤ (1 + √(1 + xp/12.5)) / 2
		double approx = (1 + Math.sqrt(1 + totalXp / 12.5)) / 2.0;
		int level = Math.max(1, (int) Math.floor(approx));
		// Tighten ±1 to be safe against floating-point drift.
		while (cumulativeXpForLevel(level + 1) <= totalXp) level++;
		while (level > 1 && cumulativeXpForLevel(level) > totalXp) level--;
		return level;
	}

	/**
	 * @return XP earned within the current level (0 ≤ result &lt; xpToNextLevel)
	 */
	public long xpProgressInLevel(long totalXp) {
		int level = levelForXp(totalXp);
		return totalXp - cumulativeXpForLevel(level);
	}

	/**
	 * @param level the player's level
	 * @return number of incubation slots available; in [SLOTS_BASE, SLOTS_CAP]
	 */
	public int slotsForLevel(int level) {
		if (level < 1) return SLOTS_BASE;
		return Math.min(SLOTS_CAP, SLOTS_BASE + level / LEVELS_PER_SLOT);
	}
}
