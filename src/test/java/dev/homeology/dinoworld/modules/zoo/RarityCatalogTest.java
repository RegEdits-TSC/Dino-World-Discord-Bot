package dev.homeology.dinoworld.modules.zoo;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link RarityCatalog}.
 *
 * <p>Loads from the shipped {@code data/rarities.yaml} so this doubles as
 * a parse-smoke for the resource. Every rarity in
 * {@link RarityCatalog#KNOWN_IDS} must be present and well-formed.
 */
class RarityCatalogTest {

	@Test
	void shippedYamlLoadsAllSixRarities() {
		RarityCatalog c = new RarityCatalog();
		assertEquals(6, c.size());
		for (String id : RarityCatalog.KNOWN_IDS) {
			Rarity r = c.require(id);
			assertEquals(id, r.id());
			assertNotNull(r.displayName());
			assertFalse(r.displayName().isBlank());
			assertTrue(r.mysteryEggCost() >= 0);
			assertTrue(r.determinedEggMultiplier() >= 1.0);
			assertTrue(r.incubationMinutes() > 0);
			assertTrue(r.hatchXp() >= 0);
		}
	}

	@Test
	void costsScaleAcrossRarities() {
		RarityCatalog c = new RarityCatalog();
		// Each rarity should cost at least as much as the one below; the
		// canonical balance shipping today is strictly increasing.
		long prev = -1L;
		for (String id : RarityCatalog.KNOWN_IDS) {
			long cost = c.require(id).mysteryEggCost();
			assertTrue(cost > prev, () -> id + " cost should exceed previous rarity");
			prev = cost;
		}
	}

	@Test
	void incubationScalesAcrossRarities() {
		RarityCatalog c = new RarityCatalog();
		int prev = -1;
		for (String id : RarityCatalog.KNOWN_IDS) {
			int min = c.require(id).incubationMinutes();
			assertTrue(min >= prev, () -> id + " incubation should not decrease");
			prev = min;
		}
	}

	@Test
	void byIdLowercasesInput() {
		RarityCatalog c = new RarityCatalog();
		assertTrue(c.byId("MYTHIC").isPresent());
		assertTrue(c.byId("Common").isPresent());
	}

	@Test
	void unknownRarityReturnsEmpty() {
		RarityCatalog c = new RarityCatalog();
		assertTrue(c.byId("godtier").isEmpty());
		assertThrows(IllegalStateException.class, () -> c.require("godtier"));
	}

	@Test
	void defaultDeterminedCostMatchesMultiplier() {
		Rarity r = new Rarity("common", "Common", 0x9D9D9D, 200, 2.5, 30, 10, 1);
		assertEquals(500L, r.defaultDeterminedEggCost());
	}
}
