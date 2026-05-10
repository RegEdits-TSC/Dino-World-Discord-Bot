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
		assertTrue(ids.contains("tutorial.claim_first_daily"));
		assertTrue(ids.contains("tutorial.buy_first_egg"));
		assertTrue(ids.contains("tutorial.hatch_first_dino"));
		assertTrue(ids.contains("tutorial.feed_first_dino"));
	}

	@Test
	void rewardsSumIsLargeEnoughForAFirstEgg() {
		// The whole reason this feature exists: a new player should be able
		// to clear the first few missions and afford a Common egg (200c).
		long claim = catalog.byId("tutorial.claim_first_daily").orElseThrow().rewardCoins();
		long visit = catalog.byId("tutorial.visit_shop").orElseThrow().rewardCoins();
		long dailyGrant = 100L; // /daily itself gives 100c
		assertTrue(claim + visit + dailyGrant >= 200L,
			"daily + first two missions must cover the 200c Common egg");
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
