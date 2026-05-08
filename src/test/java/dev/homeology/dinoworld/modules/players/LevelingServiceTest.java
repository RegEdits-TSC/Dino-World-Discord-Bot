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

	// ─── xp curve ─────────────────────────────────────────────────────────

	@Test
	void xpToNextLevelMatchesCurve() {
		assertEquals(100L, leveling.xpToNextLevel(1));
		assertEquals(200L, leveling.xpToNextLevel(2));
		assertEquals(500L, leveling.xpToNextLevel(5));
	}

	@Test
	void cumulativeXpForLevelMatchesCurve() {
		assertEquals(0L, leveling.cumulativeXpForLevel(1));
		assertEquals(100L, leveling.cumulativeXpForLevel(2));
		assertEquals(300L, leveling.cumulativeXpForLevel(3));
		assertEquals(600L, leveling.cumulativeXpForLevel(4));
		assertEquals(50L * 10 * 9, leveling.cumulativeXpForLevel(10));
	}

	@Test
	void levelForXpMatchesBoundaries() {
		assertEquals(1, leveling.levelForXp(0));
		assertEquals(1, leveling.levelForXp(99));
		assertEquals(2, leveling.levelForXp(100));
		assertEquals(2, leveling.levelForXp(299));
		assertEquals(3, leveling.levelForXp(300));
		assertEquals(4, leveling.levelForXp(600));
		assertEquals(10, leveling.levelForXp(50L * 10 * 9));
	}

	@Test
	void levelForXpAcceptsNegativeAsLevel1() {
		// Defensive — should never happen but shouldn't NPE either.
		assertEquals(1, leveling.levelForXp(-1));
	}

	@Test
	void xpProgressInLevelStartsAtZero() {
		assertEquals(0L, leveling.xpProgressInLevel(0));
		assertEquals(0L, leveling.xpProgressInLevel(100));   // start of level 2
		assertEquals(0L, leveling.xpProgressInLevel(300));   // start of level 3
		assertEquals(50L, leveling.xpProgressInLevel(150));  // halfway through level 2
	}

	// ─── slot curve ───────────────────────────────────────────────────────

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
		assertEquals(8, leveling.slotsForLevel(1000), "should cap at SLOTS_CAP");
	}

	@Test
	void slotsForLevelHandlesEdgeBelowOne() {
		assertEquals(2, leveling.slotsForLevel(0));
	}

	@Test
	void rejectsInvalidLevelInputs() {
		assertThrows(IllegalArgumentException.class, () -> leveling.xpToNextLevel(0));
		assertThrows(IllegalArgumentException.class, () -> leveling.cumulativeXpForLevel(0));
	}
}
