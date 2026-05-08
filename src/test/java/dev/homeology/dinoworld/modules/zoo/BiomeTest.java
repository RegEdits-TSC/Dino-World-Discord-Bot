package dev.homeology.dinoworld.modules.zoo;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link Biome}. These pin the canonical wire labels and
 * the cross-domain rules that hatch / move / build-enclosure all depend on.
 */
class BiomeTest {

	@Test
	void labelsMatchEnumNamesLowercased() {
		assertEquals("forest", Biome.FOREST.label());
		assertEquals("marine", Biome.MARINE.label());
		assertEquals("aerial", Biome.AERIAL.label());
	}

	@Test
	void fromStringIsCaseInsensitiveAndTrimmed() {
		assertEquals(Biome.FOREST, Biome.fromString("forest").orElseThrow());
		assertEquals(Biome.FOREST, Biome.fromString("FOREST").orElseThrow());
		assertEquals(Biome.FOREST, Biome.fromString(" forest ").orElseThrow());
	}

	@Test
	void fromStringRejectsTypos() {
		assertTrue(Biome.fromString("marineee").isEmpty());
		assertTrue(Biome.fromString("").isEmpty());
		assertTrue(Biome.fromString(null).isEmpty());
		assertTrue(Biome.fromString("   ").isEmpty());
	}

	@Test
	void domainsMatchExpectations() {
		assertEquals(Biome.Domain.LAND, Biome.FOREST.domain());
		assertEquals(Biome.Domain.LAND, Biome.DESERT.domain());
		assertEquals(Biome.Domain.LAND, Biome.GRASSLAND.domain());
		assertEquals(Biome.Domain.LAND, Biome.MOUNTAIN.domain());
		assertEquals(Biome.Domain.AIR, Biome.AERIAL.domain());
		assertEquals(Biome.Domain.WATER, Biome.MARINE.domain());
	}

	@Test
	void sameDomainAcceptsLandPairs() {
		assertTrue(Biome.sameDomain("forest", "desert"));
		assertTrue(Biome.sameDomain("grassland", "mountain"));
		assertTrue(Biome.sameDomain("forest", "FOREST"));
	}

	@Test
	void sameDomainRejectsCrossDomain() {
		assertFalse(Biome.sameDomain("forest", "marine"));
		assertFalse(Biome.sameDomain("aerial", "marine"));
		assertFalse(Biome.sameDomain("aerial", "forest"));
	}

	@Test
	void sameDomainReturnsFalseOnUnknown() {
		assertFalse(Biome.sameDomain("forest", "marineee"));
		assertFalse(Biome.sameDomain("nonsense", "forest"));
	}

	@Test
	void canHouseAllowsExactBiomeMatch() {
		assertTrue(Biome.canHouse("forest", "forest"));
		assertTrue(Biome.canHouse("marine", "marine"));
		assertTrue(Biome.canHouse("aerial", "aerial"));
	}

	@Test
	void canHouseAllowsSameDomainMismatch() {
		// Land biomes are interchangeable for placement; happiness suffers.
		assertTrue(Biome.canHouse("desert", "forest"));
		assertTrue(Biome.canHouse("mountain", "grassland"));
	}

	@Test
	void canHouseAllowsAerialSpeciesInLandEnclosure() {
		// Asymmetric exception — aerial dinos can roost in land habitats.
		assertTrue(Biome.canHouse("forest", "aerial"));
		assertTrue(Biome.canHouse("desert", "aerial"));
		assertTrue(Biome.canHouse("grassland", "aerial"));
		assertTrue(Biome.canHouse("mountain", "aerial"));
	}

	@Test
	void canHouseRejectsLandSpeciesInAerialEnclosure() {
		// The reverse is NOT allowed.
		assertFalse(Biome.canHouse("aerial", "forest"));
		assertFalse(Biome.canHouse("aerial", "grassland"));
	}

	@Test
	void canHouseRejectsCrossDomainWithMarine() {
		// Marine is strict — no land or aerial fallback either way.
		assertFalse(Biome.canHouse("forest", "marine"));
		assertFalse(Biome.canHouse("marine", "forest"));
		assertFalse(Biome.canHouse("aerial", "marine"));
		assertFalse(Biome.canHouse("marine", "aerial"));
	}

	@Test
	void canHouseRejectsUnknownBiomes() {
		assertFalse(Biome.canHouse("forest", "marineee"));
		assertFalse(Biome.canHouse("garbage", "forest"));
	}

	@Test
	void labelsCsvIncludesEverySix() {
		String csv = Biome.labelsCsv();
		for (Biome b : Biome.values()) {
			assertTrue(csv.contains(b.label()), () -> "missing " + b.label() + " in " + csv);
		}
	}
}
