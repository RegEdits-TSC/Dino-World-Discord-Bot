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
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link HappinessTickService}.
 *
 * <p>Verifies the per-tick decrement (base vs mismatched), the floor-at-zero
 * rule, and the {@code last_decay_at} stamp using a fixed {@link Clock}.
 */
class HappinessTickServiceTest {

	private HikariDataSource ds;
	private DinoInstanceService dinos;
	private EnclosureService enclosures;
	private DinoCatalog catalog;

	private static final Instant TICK_AT = Instant.parse("2026-05-07T12:00:00Z");
	private static final Clock CLOCK = Clock.fixed(TICK_AT, ZoneOffset.UTC);

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
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	private HappinessTickService svc() {
		return new HappinessTickService(dinos, enclosures, catalog, CLOCK);
	}

	// ─── biome-aware decay ────────────────────────────────────────────────

	@Test
	void perfectBiomeMatchUsesBaseDecay() {
		// Velociraptor wants forest; build a forest enclosure.
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(forest.id()), null);

		svc().runOnce();
		assertEquals(100 - HappinessTickService.DECAY_BASE,
			dinos.findById(d.id()).orElseThrow().happiness());
	}

	@Test
	void sameDomainMismatchUsesAcceleratedDecay() {
		// Velociraptor (forest) placed in a desert enclosure — same LAND domain.
		Enclosure desert = enclosures.create(42L, "desert", 5, 5, "Sand");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(desert.id()), null);

		svc().runOnce();
		assertEquals(100 - HappinessTickService.DECAY_MISMATCH,
			dinos.findById(d.id()).orElseThrow().happiness());
	}

	@Test
	void homelessDinoUsesAcceleratedDecay() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		svc().runOnce();
		assertEquals(100 - HappinessTickService.DECAY_MISMATCH,
			dinos.findById(d.id()).orElseThrow().happiness());
	}

	// ─── general behavior ─────────────────────────────────────────────────

	@Test
	void successiveTicksAccumulate() {
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(forest.id()), null);
		HappinessTickService s = svc();
		s.runOnce();
		s.runOnce();
		s.runOnce();

		assertEquals(100 - 3 * HappinessTickService.DECAY_BASE,
			dinos.findById(d.id()).orElseThrow().happiness());
	}

	@Test
	void floorsAtZero() {
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(forest.id()), null);
		dinos.applyHappiness(d.id(), 2, Instant.now());
		svc().runOnce();
		assertEquals(0, dinos.findById(d.id()).orElseThrow().happiness());
	}

	@Test
	void stampsLastDecayAt() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		svc().runOnce();
		assertEquals(TICK_AT, dinos.findById(d.id()).orElseThrow().lastDecayAt());
	}

	@Test
	void multiDinoTickAppliesPerDinoRate() {
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Home");
		Enclosure desert = enclosures.create(42L, "desert", 5, 5, "Sand");

		DinoInstance happy = dinos.create(42L, "velociraptor",
			OptionalLong.of(forest.id()), "A");
		DinoInstance unhappy = dinos.create(42L, "velociraptor",
			OptionalLong.of(desert.id()), "B");

		svc().runOnce();
		assertEquals(100 - HappinessTickService.DECAY_BASE,
			dinos.findById(happy.id()).orElseThrow().happiness());
		assertEquals(100 - HappinessTickService.DECAY_MISMATCH,
			dinos.findById(unhappy.id()).orElseThrow().happiness());
	}

	@Test
	void emptyParkIsHarmless() {
		assertDoesNotThrow(() -> svc().runOnce());
	}

	// ─── trait-modified decay ────────────────────────────────────────────

	@Test
	void vigorousTraitSlowsDecayBy20Percent() {
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(forest.id()), null, DinoTrait.VIGOROUS);

		svc().runOnce();
		// base 4 × 0.80 = 3.2 → round = 3
		assertEquals(100 - 3, dinos.findById(d.id()).orElseThrow().happiness());
	}

	@Test
	void gluttonousTraitSpeedsDecayBy25Percent() {
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(forest.id()), null, DinoTrait.GLUTTONOUS);

		svc().runOnce();
		// base 4 × 1.25 = 5
		assertEquals(100 - 5, dinos.findById(d.id()).orElseThrow().happiness());
	}

	@Test
	void traitDecayMultiplierStacksOnMismatch() {
		Enclosure desert = enclosures.create(42L, "desert", 5, 5, "Sand");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(desert.id()), null, DinoTrait.VIGOROUS);

		svc().runOnce();
		// mismatch 8 × 0.80 = 6.4 → round = 6
		assertEquals(100 - 6, dinos.findById(d.id()).orElseThrow().happiness());
	}
}
