package dev.homeology.dinoworld.modules.zoo;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pin every public surface of {@link DinoLeveling}. The whole utility is
 * deterministic math, so the assertions can be exact: any future curve
 * change must update these numbers (and intentionally so — these are the
 * shipping balance values).
 */
class DinoLevelingTest {

	// ─── xpToNextLevel ────────────────────────────────────────────────────

	@Test
	void xpToNextLevelAtLevel1MatchesShippingValue() {
		// floor(50 × 1.07^1) = floor(53.5) = 53
		assertEquals(53L, DinoLeveling.xpToNextLevel(1));
	}

	@Test
	void xpToNextLevelGrowsMonotonically() {
		long prev = 0L;
		for (int L = 1; L < DinoLeveling.MAX_LEVEL; L++) {
			long step = DinoLeveling.xpToNextLevel(L);
			assertTrue(step > prev, "step at L=" + L + " (" + step + ") not greater than prev (" + prev + ")");
			prev = step;
		}
	}

	@Test
	void xpToNextLevelReturnsZeroAtMaxLevel() {
		assertEquals(0L, DinoLeveling.xpToNextLevel(DinoLeveling.MAX_LEVEL));
	}

	@Test
	void xpToNextLevelRejectsOutOfRange() {
		assertThrows(IllegalArgumentException.class, () -> DinoLeveling.xpToNextLevel(0));
		assertThrows(IllegalArgumentException.class, () -> DinoLeveling.xpToNextLevel(-1));
		assertThrows(IllegalArgumentException.class,
			() -> DinoLeveling.xpToNextLevel(DinoLeveling.MAX_LEVEL + 1));
	}

	// ─── cumulative + levelForTotalXp inverse ─────────────────────────────

	@Test
	void cumulativeXpForLevel1IsZero() {
		assertEquals(0L, DinoLeveling.cumulativeXpForLevel(1));
	}

	@Test
	void cumulativeXpAtMaxIsSumOfAllSteps() {
		long sum = 0L;
		for (int L = 1; L < DinoLeveling.MAX_LEVEL; L++) {
			sum += DinoLeveling.xpToNextLevel(L);
		}
		assertEquals(sum, DinoLeveling.cumulativeXpForLevel(DinoLeveling.MAX_LEVEL));
	}

	@Test
	void levelForTotalXpInvertsCumulative() {
		for (int L = 1; L <= DinoLeveling.MAX_LEVEL; L++) {
			long onBoundary = DinoLeveling.cumulativeXpForLevel(L);
			assertEquals(L, DinoLeveling.levelForTotalXp(onBoundary),
				"level boundary for L=" + L + " (xp=" + onBoundary + ") didn't round to itself");
		}
	}

	@Test
	void levelForTotalXpClampsBelowOneAndAboveMax() {
		assertEquals(1, DinoLeveling.levelForTotalXp(0L));
		assertEquals(1, DinoLeveling.levelForTotalXp(-100L));
		// One XP past the cap stays at MAX_LEVEL.
		long pastCap = DinoLeveling.cumulativeXpForLevel(DinoLeveling.MAX_LEVEL) + 1;
		assertEquals(DinoLeveling.MAX_LEVEL, DinoLeveling.levelForTotalXp(pastCap));
	}

	@Test
	void levelForTotalXpStaysOnLevelBetweenBoundaries() {
		long start = DinoLeveling.cumulativeXpForLevel(7);
		long nextStart = DinoLeveling.cumulativeXpForLevel(8);
		// Anywhere in [start, nextStart) is still level 7.
		assertEquals(7, DinoLeveling.levelForTotalXp(start));
		assertEquals(7, DinoLeveling.levelForTotalXp(start + 1));
		assertEquals(7, DinoLeveling.levelForTotalXp(nextStart - 1));
		assertEquals(8, DinoLeveling.levelForTotalXp(nextStart));
	}

	// ─── xpProgressInLevel ─────────────────────────────────────────────────

	@Test
	void xpProgressIsZeroAtLevelBoundary() {
		long onBoundary = DinoLeveling.cumulativeXpForLevel(5);
		assertEquals(0L, DinoLeveling.xpProgressInLevel(onBoundary));
	}

	@Test
	void xpProgressIsZeroAtMaxLevel() {
		long cap = DinoLeveling.cumulativeXpForLevel(DinoLeveling.MAX_LEVEL);
		assertEquals(0L, DinoLeveling.xpProgressInLevel(cap));
		assertEquals(0L, DinoLeveling.xpProgressInLevel(cap + 12345L));
	}

	@Test
	void xpProgressIsBetweenZeroAndStep() {
		long boundary = DinoLeveling.cumulativeXpForLevel(10);
		long step = DinoLeveling.xpToNextLevel(10);
		assertEquals(7L, DinoLeveling.xpProgressInLevel(boundary + 7L));
		assertEquals(step - 1, DinoLeveling.xpProgressInLevel(boundary + step - 1));
	}

	// ─── incomeMultiplier ─────────────────────────────────────────────────

	@Test
	void incomeMultiplierAtL1IsIdentity() {
		assertEquals(1.0, DinoLeveling.incomeMultiplier(1), 1e-9);
	}

	@Test
	void incomeMultiplierAtL25Is160Percent() {
		assertEquals(1.6, DinoLeveling.incomeMultiplier(25), 1e-9);
	}

	@Test
	void incomeMultiplierAtMaxIs2225Percent() {
		assertEquals(2.225, DinoLeveling.incomeMultiplier(DinoLeveling.MAX_LEVEL), 1e-9);
	}

	@Test
	void incomeMultiplierClampsBelowOneAndAboveMax() {
		assertEquals(1.0, DinoLeveling.incomeMultiplier(0), 1e-9);
		assertEquals(1.0, DinoLeveling.incomeMultiplier(-5), 1e-9);
		assertEquals(2.225, DinoLeveling.incomeMultiplier(DinoLeveling.MAX_LEVEL + 7), 1e-9);
	}

	// ─── isMaxLevel ────────────────────────────────────────────────────────

	@Test
	void isMaxLevel() {
		assertFalse(DinoLeveling.isMaxLevel(DinoLeveling.MAX_LEVEL - 1));
		assertTrue(DinoLeveling.isMaxLevel(DinoLeveling.MAX_LEVEL));
		assertTrue(DinoLeveling.isMaxLevel(DinoLeveling.MAX_LEVEL + 99));
	}
}
