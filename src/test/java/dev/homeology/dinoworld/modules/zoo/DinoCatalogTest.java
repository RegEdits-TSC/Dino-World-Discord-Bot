package dev.homeology.dinoworld.modules.zoo;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link DinoCatalog}.
 *
 * <p>Loads from the actual classpath {@code data/dinos/} resource directory
 * shipped under {@code src/main/resources/} — so this also serves as a
 * smoke test that the YAML files in the repository parse cleanly and that
 * every species declares a valid rarity.
 */
class DinoCatalogTest {

	private DinoCatalog catalog() {
		return new DinoCatalog(new RarityCatalog());
	}

	@Test
	void loadsVelociraptorFromShippedYaml() {
		DinoCatalog catalog = catalog();
		assertTrue(catalog.size() >= 1);

		DinoSpecies velo = catalog.byId("velociraptor").orElseThrow();
		assertEquals("Velociraptor", velo.displayName());
		assertEquals("dinosaur", velo.category());
		assertEquals("uncommon", velo.rarity());
		assertEquals("Late Cretaceous", velo.era());
		assertEquals(2, velo.tier());
		assertEquals("forest", velo.biome());
		assertNotNull(velo.description());
		assertFalse(velo.description().isBlank());
	}

	@Test
	void allShippedSpeciesParse() {
		DinoCatalog catalog = catalog();
		List<DinoSpecies> all = catalog.all();
		// We ship at least 6 (one per rarity); the actual count is ~30 but
		// keep the lower bound loose so adding/removing species doesn't break tests.
		assertTrue(all.size() >= 6, () -> "expected ≥6 species, got " + all.size());

		// Every species must declare a known rarity.
		RarityCatalog rarities = new RarityCatalog();
		for (DinoSpecies s : all) {
			assertTrue(rarities.byId(s.rarity()).isPresent(),
				() -> "Species " + s.id() + " has unknown rarity '" + s.rarity() + "'");
		}

		// Every rarity is represented at least once.
		for (String r : RarityCatalog.KNOWN_IDS) {
			assertFalse(catalog.byRarity(r).isEmpty(),
				() -> "No species in rarity '" + r + "'");
		}
	}

	@Test
	void byRaritySortsByDisplayName() {
		DinoCatalog catalog = catalog();
		List<DinoSpecies> uncommon = catalog.byRarity("uncommon");
		List<String> names = uncommon.stream().map(DinoSpecies::displayName).toList();
		List<String> sorted = uncommon.stream().map(DinoSpecies::displayName).sorted().toList();
		assertEquals(sorted, names);
	}

	@Test
	void allReturnsSpeciesWithUniqueIds() {
		DinoCatalog catalog = catalog();
		List<DinoSpecies> all = catalog.all();
		List<String> ids = all.stream().map(DinoSpecies::id).toList();
		assertEquals(ids.size(), ids.stream().distinct().count(), "duplicate ids in catalog");
	}
}
