package dev.homeology.dinoworld.modules.players;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pure-math tests for {@link LevelingService}.
 *
 * <p>The XP curve and slot table are user-visible game balance — these
 * tests pin the canonical numbers so a tweak is intentional and visible.
 */
class LevelingServiceTest {

	private final LevelingService leveling = new LevelingService();

	// ─── xp curve (exponential: floor(60 × 1.08^L)) ──────────────────────

	@Test
	void xpToNextLevelMatchesExponentialCurve() {
		// Pin a few canonical points so a rebalance is intentional.
		assertEquals((long) Math.floor(60 * Math.pow(1.08, 1)), leveling.xpToNextLevel(1));
		assertEquals((long) Math.floor(60 * Math.pow(1.08, 5)), leveling.xpToNextLevel(5));
		assertEquals((long) Math.floor(60 * Math.pow(1.08, 50)), leveling.xpToNextLevel(50));
		assertEquals((long) Math.floor(60 * Math.pow(1.08, 99)), leveling.xpToNextLevel(99));
	}

	@Test
	void xpToNextLevelGrowsMonotonically() {
		long prev = leveling.xpToNextLevel(1);
		for (int L = 2; L < LevelingService.LEVEL_CAP; L++) {
			long next = leveling.xpToNextLevel(L);
			assertTrue(next >= prev,
				"curve must be non-decreasing at L=" + L + ": " + prev + " → " + next);
			prev = next;
		}
	}

	@Test
	void xpToNextLevelIsZeroAtCap() {
		assertEquals(0L, leveling.xpToNextLevel(LevelingService.LEVEL_CAP),
			"no further levels exist beyond the cap");
	}

	@Test
	void cumulativeXpStartsAtZero() {
		assertEquals(0L, leveling.cumulativeXpForLevel(1));
	}

	@Test
	void cumulativeXpIsSumOfPreviousSteps() {
		long expected = 0L;
		for (int L = 1; L < LevelingService.LEVEL_CAP; L++) {
			expected += leveling.xpToNextLevel(L);
			assertEquals(expected, leveling.cumulativeXpForLevel(L + 1),
				"cumulative at L=" + (L + 1) + " must equal sum of xpToNext(1..L)");
		}
	}

	@Test
	void totalXpToReachCapIsApproximately1Point65Million() {
		// The whole point of the rework: level 100 is a long-term grind.
		// Geometric series sum from i=1 to 99 of 60 × 1.08^i ≈ 1,649,012 ;
		// floor() in xpStep introduces small per-step rounding, so use a
		// generous tolerance band rather than chasing the exact figure.
		long total = leveling.cumulativeXpForLevel(LevelingService.LEVEL_CAP);
		assertTrue(total > 1_500_000L && total < 1_800_000L,
			"total XP to reach cap should sit around 1.65M, got " + total);
	}

	// ─── level lookup ────────────────────────────────────────────────────

	@Test
	void levelForXpHandlesBoundaries() {
		assertEquals(1, leveling.levelForXp(0));
		assertEquals(1, leveling.levelForXp(leveling.xpToNextLevel(1) - 1));
		assertEquals(2, leveling.levelForXp(leveling.xpToNextLevel(1)));
		// One step above the level-3 boundary still reads as level 3.
		assertEquals(3, leveling.levelForXp(leveling.cumulativeXpForLevel(3)));
		assertEquals(3, leveling.levelForXp(leveling.cumulativeXpForLevel(3) + 5));
	}

	@Test
	void levelForXpClampsAtCap() {
		long capXp = leveling.cumulativeXpForLevel(LevelingService.LEVEL_CAP);
		assertEquals(LevelingService.LEVEL_CAP, leveling.levelForXp(capXp));
		assertEquals(LevelingService.LEVEL_CAP, leveling.levelForXp(capXp + 1_000_000L),
			"XP beyond the cap doesn't push past it");
		assertEquals(LevelingService.LEVEL_CAP, leveling.levelForXp(Long.MAX_VALUE / 2));
	}

	@Test
	void levelForXpAcceptsNegativeAsLevel1() {
		// Defensive — should never happen but shouldn't NPE either.
		assertEquals(1, leveling.levelForXp(-1));
	}

	// ─── progress within a level ─────────────────────────────────────────

	@Test
	void xpProgressInLevelStartsAtZeroAtLevelBoundary() {
		assertEquals(0L, leveling.xpProgressInLevel(0));
		assertEquals(0L, leveling.xpProgressInLevel(leveling.cumulativeXpForLevel(2)));
		assertEquals(0L, leveling.xpProgressInLevel(leveling.cumulativeXpForLevel(3)));
	}

	@Test
	void xpProgressInLevelIsTotalMinusFloor() {
		long base = leveling.cumulativeXpForLevel(5);
		assertEquals(7L, leveling.xpProgressInLevel(base + 7L));
	}

	@Test
	void xpProgressInLevelIsZeroAtCap() {
		long capXp = leveling.cumulativeXpForLevel(LevelingService.LEVEL_CAP);
		assertEquals(0L, leveling.xpProgressInLevel(capXp));
		assertEquals(0L, leveling.xpProgressInLevel(capXp + 999_999L),
			"overflow past the cap doesn't show fake in-level progress");
	}

	// ─── cap helper ──────────────────────────────────────────────────────

	@Test
	void isMaxLevelOnlyTrueAtCap() {
		assertFalse(leveling.isMaxLevel(1));
		assertFalse(leveling.isMaxLevel(LevelingService.LEVEL_CAP - 1));
		assertTrue(leveling.isMaxLevel(LevelingService.LEVEL_CAP));
		assertTrue(leveling.isMaxLevel(LevelingService.LEVEL_CAP + 5),
			"defensive — should report max for any input ≥ cap");
	}

	// ─── slot curve ──────────────────────────────────────────────────────

	@Test
	void slotsForLevelMatchesPlan() {
		// Curve: start 2, +1 every LEVELS_PER_SLOT levels (currently 10),
		// cap at SLOTS_CAP (8). Boundaries pinned here so a balance tweak
		// is intentional and visible.
		assertEquals(2, leveling.slotsForLevel(1));
		assertEquals(2, leveling.slotsForLevel(9));
		assertEquals(3, leveling.slotsForLevel(10));
		assertEquals(3, leveling.slotsForLevel(19));
		assertEquals(4, leveling.slotsForLevel(20));
		assertEquals(5, leveling.slotsForLevel(30));
		assertEquals(6, leveling.slotsForLevel(40));
		assertEquals(7, leveling.slotsForLevel(50));
		assertEquals(8, leveling.slotsForLevel(60));
		assertEquals(8, leveling.slotsForLevel(70));
		assertEquals(8, leveling.slotsForLevel(LevelingService.LEVEL_CAP));
	}

	@Test
	void slotsForLevelHandlesEdgeBelowOne() {
		assertEquals(2, leveling.slotsForLevel(0));
	}

	// ─── input validation ───────────────────────────────────────────────

	@Test
	void rejectsInvalidLevelInputs() {
		assertThrows(IllegalArgumentException.class, () -> leveling.xpToNextLevel(0));
		assertThrows(IllegalArgumentException.class,
			() -> leveling.xpToNextLevel(LevelingService.LEVEL_CAP + 1));
		assertThrows(IllegalArgumentException.class, () -> leveling.cumulativeXpForLevel(0));
		assertThrows(IllegalArgumentException.class,
			() -> leveling.cumulativeXpForLevel(LevelingService.LEVEL_CAP + 1));
	}
}
