package dev.homeology.dinoworld.modules.achievements;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Catalog-shape checks for the shipped achievement YAML. These tests pin
 * the invariants the awarder + /achievements command rely on so a typo
 * surfaces at build time rather than mid-runtime.
 */
class AchievementCatalogTest {

	@Test
	void shippedCatalogLoadsAndIsNonEmpty() {
		AchievementCatalog catalog = new AchievementCatalog();
		assertFalse(catalog.all().isEmpty(), "v1 catalog should load achievements");
		assertEquals(catalog.size(), catalog.all().size());
	}

	@Test
	void everyAchievementIdAndTitleIsUnique() {
		AchievementCatalog catalog = new AchievementCatalog();
		Set<String> ids = new HashSet<>();
		Set<String> titles = new HashSet<>();
		for (Achievement a : catalog.all()) {
			assertTrue(ids.add(a.id()), "duplicate id: " + a.id());
			assertTrue(titles.add(a.title().toLowerCase()), "duplicate title: " + a.title());
		}
	}

	@Test
	void rewardsAreNonNegative() {
		AchievementCatalog catalog = new AchievementCatalog();
		for (Achievement a : catalog.all()) {
			assertTrue(a.rewardCoins() >= 0, a.id() + " coins reward < 0");
			assertTrue(a.rewardXp() >= 0, a.id() + " xp reward < 0");
		}
	}

	@Test
	void everyTriggerParses() {
		// Loading the catalog itself triggers parse() on every entry —
		// a malformed trigger string would throw during construction, so
		// this test serves as a defense-in-depth assertion.
		assertDoesNotThrow(() -> new AchievementCatalog());
	}

	@Test
	void byIdRoundTripsByFullyQualifiedName() {
		AchievementCatalog catalog = new AchievementCatalog();
		Achievement first = catalog.all().get(0);
		assertEquals(first, catalog.byId(first.id()).orElseThrow());
		assertTrue(catalog.byId("does-not-exist").isEmpty());
	}

	@Test
	void byTitleIsCaseInsensitive() {
		AchievementCatalog catalog = new AchievementCatalog();
		Achievement first = catalog.all().get(0);
		assertEquals(first, catalog.byTitle(first.title().toUpperCase()).orElseThrow());
		assertEquals(first, catalog.byTitle(first.title().toLowerCase()).orElseThrow());
		assertTrue(catalog.byTitle("not-a-title").isEmpty());
	}
}
