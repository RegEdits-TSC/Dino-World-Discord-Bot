package dev.homeology.dinoworld.modules.zoo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link EnclosureService}.
 *
 * <p>Runs against a fresh temp SQLite file with the {@code core},
 * {@code players}, and {@code zoo} migrations applied so the schema
 * matches production. A real {@link DinoCatalog} is loaded so the
 * compatibility check uses realistic species data.
 */
class EnclosureServiceTest {

	private HikariDataSource ds;
	private EnclosureService enclosures;
	private DinoInstanceService dinos;
	private DinoCatalog catalog;
	private PlayerService players;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "zoo"));
		enclosures = new EnclosureService(ds);
		dinos = new DinoInstanceService(ds);
		catalog = new DinoCatalog(new RarityCatalog());
		players = new PlayerService(ds, new CacheManager());
		// Player must exist for FK constraints
		players.ensure(42L, "Alice");
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void ensureStarterCreatesOneAndIsIdempotent() {
		Enclosure first = enclosures.ensureStarter(42L);
		assertEquals(EnclosureService.STARTER_BIOME, first.biome());
		assertEquals(EnclosureService.STARTER_CAPACITY, first.capacity());
		assertEquals(1, first.tier());

		Enclosure second = enclosures.ensureStarter(42L);
		assertEquals(first.id(), second.id(), "starter must be idempotent");
		assertEquals(1, enclosures.findByOwner(42L).size());
	}

	@Test
	void createInsertsCorrectly() {
		Enclosure e = enclosures.create(42L, "marine", 5, 3, "Big Tank");
		assertTrue(e.id() > 0);
		assertEquals("marine", e.biome());
		assertEquals(5, e.capacity());
		assertEquals(3, e.tier());
		assertEquals(Optional.of("Big Tank"), e.name());
	}

	@Test
	void slotsAvailableTracksCount() {
		Enclosure e = enclosures.create(42L, "forest", 3, 2, null);
		assertEquals(3, enclosures.slotsAvailable(e));
		dinos.create(42L, "velociraptor", java.util.OptionalLong.of(e.id()), null);
		assertEquals(2, enclosures.slotsAvailable(e));
		dinos.create(42L, "velociraptor", java.util.OptionalLong.of(e.id()), null);
		dinos.create(42L, "velociraptor", java.util.OptionalLong.of(e.id()), null);
		assertEquals(0, enclosures.slotsAvailable(e));
	}

	@Test
	void findCompatibleForSpeciesPrefersBiomeMatch() {
		// Two enclosures: tier-3 desert, tier-3 forest. Velociraptor wants forest.
		enclosures.create(42L, "desert", 3, 3, "Desert");
		Enclosure forest = enclosures.create(42L, "forest", 3, 3, "Forest");

		DinoSpecies velo = catalog.byId("velociraptor").orElseThrow();
		Optional<Enclosure> picked = enclosures.findCompatibleForSpecies(42L, velo);
		assertTrue(picked.isPresent());
		assertEquals(forest.id(), picked.get().id());
	}

	@Test
	void findCompatibleFallsBackWithinSameDomain() {
		// Only a desert enclosure exists; velociraptor's native biome is forest
		// but desert is also LAND domain — fallback should accept it.
		Enclosure desert = enclosures.create(42L, "desert", 3, 3, "Sand");
		DinoSpecies velo = catalog.byId("velociraptor").orElseThrow();
		Optional<Enclosure> picked = enclosures.findCompatibleForSpecies(42L, velo);
		assertTrue(picked.isPresent());
		assertEquals(desert.id(), picked.get().id());
	}

	@Test
	void findCompatibleRejectsCrossDomainFallback() {
		// Only an aerial enclosure exists. Velociraptor (LAND) cannot live
		// in an AIR enclosure — must refuse rather than fall back.
		enclosures.create(42L, "aerial", 3, 3, "Sky");
		DinoSpecies velo = catalog.byId("velociraptor").orElseThrow();
		assertTrue(enclosures.findCompatibleForSpecies(42L, velo).isEmpty());
	}

	@Test
	void findCompatibleRejectsMarineForLandSpecies() {
		// Marine-only enclosure → forest velociraptor still refused.
		enclosures.create(42L, "marine", 3, 3, "Sea");
		DinoSpecies velo = catalog.byId("velociraptor").orElseThrow();
		assertTrue(enclosures.findCompatibleForSpecies(42L, velo).isEmpty());
	}

	@Test
	void findCompatibleRejectsLandForMarineSpecies() {
		// Forest enclosure → marine species (mosasaurus) refused.
		enclosures.create(42L, "forest", 5, 5, "Big");
		DinoSpecies mosa = catalog.byId("mosasaurus").orElseThrow();
		assertTrue(enclosures.findCompatibleForSpecies(42L, mosa).isEmpty());
	}

	@Test
	void findCompatibleRejectsLowTier() {
		// Only a tier-1 enclosure exists; legendary species needs tier 5.
		enclosures.create(42L, "forest", 3, 1, "Tiny");
		DinoSpecies trex = catalog.byId("tyrannosaurus").orElseThrow();
		assertTrue(enclosures.findCompatibleForSpecies(42L, trex).isEmpty());
	}

	@Test
	void findCompatibleRejectsFullEnclosure() {
		Enclosure e = enclosures.create(42L, "forest", 1, 2, "Tiny");
		dinos.create(42L, "velociraptor", java.util.OptionalLong.of(e.id()), null);
		DinoSpecies velo = catalog.byId("velociraptor").orElseThrow();
		// Capacity 1, already full → no compatible enclosure remains
		assertTrue(enclosures.findCompatibleForSpecies(42L, velo).isEmpty());
	}

	@Test
	void renameUpdatesNameAndAcceptsBlankToClear() {
		Enclosure e = enclosures.create(42L, "forest", 3, 2, "Old Name");
		assertTrue(enclosures.rename(e.id(), "New Name"));
		assertEquals(Optional.of("New Name"), enclosures.findById(e.id()).orElseThrow().name());

		// Blank clears the name back to empty.
		assertTrue(enclosures.rename(e.id(), "   "));
		assertTrue(enclosures.findById(e.id()).orElseThrow().name().isEmpty());
	}

	@Test
	void renameUnknownIdReturnsFalse() {
		assertFalse(enclosures.rename(99999L, "Whatever"));
	}

	@Test
	void deleteRemovesEmptyEnclosure() {
		Enclosure e = enclosures.create(42L, "forest", 3, 2, "Spare");
		assertTrue(enclosures.delete(e.id()));
		assertTrue(enclosures.findById(e.id()).isEmpty());
	}

	@Test
	void deleteRefusesNonEmptyEnclosure() {
		Enclosure e = enclosures.create(42L, "forest", 3, 2, "Occupied");
		dinos.create(42L, "velociraptor", java.util.OptionalLong.of(e.id()), null);
		assertFalse(enclosures.delete(e.id()));
		assertTrue(enclosures.findById(e.id()).isPresent(), "row should still exist");
	}

	@Test
	void findCompatibleAcceptsAerialSpeciesInLandEnclosure() {
		// Aerial species can roost in land habitats per the asymmetric rule.
		Enclosure forest = enclosures.create(42L, "forest", 5, 1, "Land");
		DinoSpecies dimo = catalog.byId("dimorphodon").orElseThrow();
		Optional<Enclosure> picked = enclosures.findCompatibleForSpecies(42L, dimo);
		assertTrue(picked.isPresent());
		assertEquals(forest.id(), picked.get().id());
	}

	@Test
	void findCompatiblePrefersExactBiomeOverAerialFallback() {
		// Aerial enclosure should win for an aerial species even if a land
		// enclosure is also present — biome-exact match still beats fallback.
		Enclosure land = enclosures.create(42L, "forest", 5, 5, "Land");
		Enclosure sky = enclosures.create(42L, "aerial", 5, 5, "Sky");
		DinoSpecies dimo = catalog.byId("dimorphodon").orElseThrow();
		Optional<Enclosure> picked = enclosures.findCompatibleForSpecies(42L, dimo);
		assertTrue(picked.isPresent());
		assertEquals(sky.id(), picked.get().id(),
			"exact aerial match must beat aerial-in-land fallback");
		// Reference unused vars to placate static analysis.
		assertNotNull(land);
	}

	@Test
	void hasHabitatForSpeciesIgnoresCapacity() {
		// Tier and biome-domain match without considering free slots — buy-time
		// check is intentionally permissive; hatch-time still verifies capacity.
		Enclosure full = enclosures.create(42L, "forest", 1, 2, "Tiny");
		dinos.create(42L, "velociraptor", java.util.OptionalLong.of(full.id()), null);
		DinoSpecies velo = catalog.byId("velociraptor").orElseThrow();
		assertTrue(enclosures.hasHabitatForSpecies(42L, velo),
			"buy-time check ignores capacity");
		// Sanity — same setup must still fail the (capacity-aware) hatch check.
		assertTrue(enclosures.findCompatibleForSpecies(42L, velo).isEmpty());
	}

	@Test
	void hasHabitatForSpeciesRejectsLowTier() {
		enclosures.create(42L, "forest", 5, 1, "Tier1");
		DinoSpecies trex = catalog.byId("tyrannosaurus").orElseThrow();
		assertFalse(enclosures.hasHabitatForSpecies(42L, trex),
			"tier 1 cannot house a legendary species even with room to spare");
	}

	@Test
	void hasHabitatForSpeciesAllowsAerialInLand() {
		enclosures.create(42L, "desert", 5, 1, "Sand");
		DinoSpecies dimo = catalog.byId("dimorphodon").orElseThrow();
		assertTrue(enclosures.hasHabitatForSpecies(42L, dimo),
			"aerial species should accept any land habitat for buy-time check");
	}

	@Test
	void hasHabitatForSpeciesRejectsMarineWithoutMarineEnclosure() {
		enclosures.create(42L, "forest", 5, 5, "Land");
		enclosures.create(42L, "aerial", 5, 5, "Sky");
		DinoSpecies notho = catalog.byId("nothosaurus").orElseThrow();
		assertFalse(enclosures.hasHabitatForSpecies(42L, notho),
			"marine species must refuse all non-marine habitats");
	}

	@Test
	void minTierForRarityCoversAllRarities() {
		for (String r : RarityCatalog.KNOWN_IDS) {
			assertNotNull(EnclosureService.MIN_TIER_FOR_RARITY.get(r),
				() -> "rarity " + r + " missing from MIN_TIER_FOR_RARITY");
		}
	}
}
