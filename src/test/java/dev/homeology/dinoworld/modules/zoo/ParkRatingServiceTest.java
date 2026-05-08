package dev.homeology.dinoworld.modules.zoo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link ParkRatingService}.
 *
 * <p>Each scenario builds a small park (enclosures + dinos via the real
 * services) and asserts on each component bonus and the final rating.
 * Uses real {@link DinoCatalog} so popularity values match shipping data.
 */
class ParkRatingServiceTest {

	private HikariDataSource ds;
	private DinoInstanceService dinos;
	private EnclosureService enclosures;
	private DinoCatalog catalog;
	private ParkRatingService rating;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "zoo"));

		PlayerService players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");

		dinos = new DinoInstanceService(ds);
		enclosures = new EnclosureService(ds);
		catalog = new DinoCatalog(new RarityCatalog());
		rating = new ParkRatingService(dinos, enclosures, catalog);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void emptyParkHasZeroRating() {
		ParkRatingService.ParkRating r = rating.compute(42L);
		assertEquals(0L, r.rating());
		assertEquals(0L, r.base());
		assertEquals(0, r.distinctCategories());
		assertEquals(0, r.distinctRarities());
		assertFalse(r.allBiomesMatch());
	}

	@Test
	void singleBiomeMatchedDinoApplies10PercentBonus() {
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Forest");
		dinos.create(42L, "velociraptor", OptionalLong.of(forest.id()), null);

		ParkRatingService.ParkRating r = rating.compute(42L);
		// Velociraptor popularity = 70, happiness = 100 → base = 70
		assertEquals(70L, r.base());
		// 1 category (dinosaur) → +10%; 1 rarity (uncommon) → +5%; biome match → +10%
		// Multiplier = 1 + .10 + .05 + .10 = 1.25
		// Rating = round(70 × 1.25) = 88
		assertEquals(1, r.distinctCategories());
		assertEquals(1, r.distinctRarities());
		assertTrue(r.allBiomesMatch());
		assertEquals(88L, r.rating());
	}

	@Test
	void biomeMismatchDropsBonus() {
		Enclosure desert = enclosures.create(42L, "desert", 5, 5, "Desert");
		dinos.create(42L, "velociraptor", OptionalLong.of(desert.id()), null);

		ParkRatingService.ParkRating r = rating.compute(42L);
		assertFalse(r.allBiomesMatch());
		// Multiplier = 1 + .10 + .05 = 1.15 → 70 × 1.15 = 80.5 → 81
		assertEquals(81L, r.rating());
	}

	@Test
	void homelessDinoFlagsBiomeFalse() {
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		ParkRatingService.ParkRating r = rating.compute(42L);
		assertFalse(r.allBiomesMatch());
	}

	@Test
	void varietyBonusScalesWithCategories() {
		Enclosure forest = enclosures.create(42L, "forest", 10, 5, "Forest");
		Enclosure aerial = enclosures.create(42L, "aerial", 10, 5, "Sky");
		Enclosure marine = enclosures.create(42L, "marine", 10, 5, "Sea");

		dinos.create(42L, "velociraptor", OptionalLong.of(forest.id()), null);
		dinos.create(42L, "pteranodon", OptionalLong.of(aerial.id()), null);
		dinos.create(42L, "mosasaurus", OptionalLong.of(marine.id()), null);

		ParkRatingService.ParkRating r = rating.compute(42L);
		assertEquals(3, r.distinctCategories());
		assertEquals(0.30, r.varietyBonus(), 1e-9);
	}

	@Test
	void tierBalanceBonusScalesWithRarities() {
		Enclosure forest = enclosures.create(42L, "forest", 10, 5, "Big");
		// Common + Uncommon + Rare = 3 rarities → +15%
		dinos.create(42L, "compsognathus", OptionalLong.of(forest.id()), null);
		dinos.create(42L, "velociraptor", OptionalLong.of(forest.id()), null);
		dinos.create(42L, "triceratops", OptionalLong.of(forest.id()), null);

		ParkRatingService.ParkRating r = rating.compute(42L);
		assertEquals(3, r.distinctRarities());
		assertEquals(0.15, r.tierBalanceBonus(), 1e-9);
	}

	@Test
	void unhappyDinoContributesProportionally() {
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Forest");
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.of(forest.id()), null);
		dinos.applyHappiness(d.id(), 50, Instant.now());

		ParkRatingService.ParkRating r = rating.compute(42L);
		// Base = popularity × happiness/100 = 70 × 50/100 = 35
		assertEquals(35L, r.base());
	}

	@Test
	void multipleHappyDinosSum() {
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Forest");
		dinos.create(42L, "velociraptor", OptionalLong.of(forest.id()), null);  // pop 70
		dinos.create(42L, "velociraptor", OptionalLong.of(forest.id()), null);  // pop 70

		ParkRatingService.ParkRating r = rating.compute(42L);
		assertEquals(140L, r.base());
	}
}
