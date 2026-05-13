package dev.homeology.dinoworld.modules.players.missions;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pins the contents of the shipped {@code tutorial.yaml} so a typo or
 * accidental drop of a mission surfaces here rather than as a missing
 * onboarding step in production. Also covers the YAML loader's
 * fail-fast contract via the trigger-parsing helpers.
 */
class MissionCatalogTest {

	private final MissionCatalog catalog = new MissionCatalog();

	@Test
	void shippedTutorialSetLoadsAndIsNonEmpty() {
		assertEquals(1, catalog.sets().size(), "tutorial set ships by default");
		var set = catalog.sets().get(0);
		assertEquals("tutorial", set.setId());
		assertFalse(set.missions().isEmpty(), "tutorial has at least one mission");
	}

	@Test
	void tutorialMissionsAreFullyQualifiedById() {
		// Mission ids in storage are <set_id>.<mission_id> so future seasonal
		// sets can reuse short names without colliding with tutorial.
		for (Mission m : catalog.all()) {
			assertTrue(m.id().startsWith("tutorial."),
				"mission id should be set-qualified, got: " + m.id());
		}
	}

	@Test
	void tutorialIncludesTheCanonicalOnboardingFlow() {
		// Pin the milestones the operator scoped — not an exhaustive check,
		// just the headline ones so a careless YAML edit stands out.
		var ids = catalog.all().stream().map(Mission::id).toList();
		assertTrue(ids.contains("tutorial.check_profile"));
		assertTrue(ids.contains("tutorial.see_rank"));
		assertTrue(ids.contains("tutorial.claim_first_daily"));
		assertTrue(ids.contains("tutorial.buy_first_egg"));
		assertTrue(ids.contains("tutorial.hatch_first_dino"));
		assertTrue(ids.contains("tutorial.feed_first_dino"));
	}

	/**
	 * Cheapest Common egg currently available in the live shop. Pinned
	 * here so the affordability invariants below have a single knob to
	 * update if egg pricing rebalances. If you bump this, also bump
	 * tutorial reward sizing in {@code data/missions/tutorial.yaml} so
	 * the assertions still pass.
	 */
	private static final long CHEAPEST_COMMON_EGG = 500L;

	@Test
	void missionsBeforeShopLeaveComfortableBufferForFirstEgg() {
		// By the time the player reaches the /shop step, the sum of every
		// mission reward ordered before visit_shop in YAML — plus the 100c
		// daily grant — must clear the cheapest Common egg with room to
		// spare. Exact-change sizing reads as "I can't afford this"
		// against the slightly-stale balance the shop UI displays before
		// visit_shop's own reward has credited from a concurrent worker.
		long beforeShop = 0L;
		for (Mission m : catalog.all()) {
			if ("tutorial.visit_shop".equals(m.id())) break;
			beforeShop += m.rewardCoins();
		}
		long dailyGrant = 100L; // /daily itself gives 100c
		long target = CHEAPEST_COMMON_EGG + 100L; // egg cost + 100c buffer
		assertTrue(beforeShop + dailyGrant >= target,
			"missions ordered before visit_shop + daily should sum to ≥" + target
				+ "c (cheapest egg " + CHEAPEST_COMMON_EGG + "c + 100c buffer); got "
				+ (beforeShop + dailyGrant));
	}

	@Test
	void afterEachMissionPlayerCanAffordTheNextRequiredAction() {
		// Walk the tutorial in YAML order, applying coin grants and the
		// one mandatory spend (the first egg), and assert the running
		// balance never goes negative. Catches a future edit that makes a
		// step unaffordable in sequence.
		long balance = 100L; // /daily before mission 1 fires
		for (Mission m : catalog.all()) {
			if ("tutorial.buy_first_egg".equals(m.id())) {
				assertTrue(balance >= CHEAPEST_COMMON_EGG,
					"player must have ≥" + CHEAPEST_COMMON_EGG
						+ "c before the buy_first_egg step (had " + balance + ")");
				balance -= CHEAPEST_COMMON_EGG;
			}
			balance += m.rewardCoins();
		}
		assertTrue(balance > 0, "running balance must stay positive through the tutorial");
	}

	@Test
	void afterFullTutorialPlayerHasHeadroomForFollowUp() {
		// After the full tutorial + buying one Common egg, the player
		// should comfortably afford a follow-up purchase (second egg,
		// Zookeeper hire, or saving toward Uncommon at L5).
		long totalRewards = catalog.all().stream().mapToLong(Mission::rewardCoins).sum();
		long endBalance = 100L /* daily */ + totalRewards - CHEAPEST_COMMON_EGG;
		assertTrue(endBalance >= 500L,
			"end-of-tutorial balance should be ≥500c, got " + endBalance);
	}

	@Test
	void triggerParserAcceptsAllShippedForms() {
		assertInstanceOf(MissionTrigger.StateTrigger.class,
			MissionTrigger.parse("state:claimed_daily"));
		assertInstanceOf(MissionTrigger.StateTrigger.class,
			MissionTrigger.parse("state:owns_egg"));
		var any = (MissionTrigger.RanCommand) MissionTrigger.parse("command:shop");
		assertEquals("shop", any.command());
		assertNull(any.subcommand());
		var sub = (MissionTrigger.RanCommand) MissionTrigger.parse("command:zoo:dashboard");
		assertEquals("zoo", sub.command());
		assertEquals("dashboard", sub.subcommand());
	}

	@Test
	void triggerParserFailsLoudOnGarbage() {
		assertThrows(IllegalArgumentException.class, () -> MissionTrigger.parse(""));
		assertThrows(IllegalArgumentException.class, () -> MissionTrigger.parse(null));
		assertThrows(IllegalArgumentException.class, () -> MissionTrigger.parse("nonsense"));
		assertThrows(IllegalArgumentException.class, () -> MissionTrigger.parse("state:bogus"));
		assertThrows(IllegalArgumentException.class, () -> MissionTrigger.parse("command:"));
	}
}
