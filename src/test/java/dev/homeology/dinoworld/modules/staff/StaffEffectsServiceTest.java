package dev.homeology.dinoworld.modules.staff;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.EnclosureService;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link StaffEffectsService} — verifies multipliers
 * honor caps/floors and that defaults stay at the {@link
 * StaffEffectsService#IDENTITY identity} when no relevant staff are hired.
 */
class StaffEffectsServiceTest {

	private HikariDataSource ds;
	private StaffMemberService memberService;
	private StaffCatalog catalog;
	private StaffEffectsService effects;
	private long encId;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "staff", "zoo"));

		PlayerService players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");
		EnclosureService enclosures = new EnclosureService(ds);
		Enclosure e = enclosures.create(42L, "forest", 5, 1, "Home");
		encId = e.id();
		memberService = new StaffMemberService(ds);
		catalog = new StaffCatalog();
		effects = new StaffEffectsService(memberService, catalog);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	// ─── decay multiplier ────────────────────────────────────────────────

	@Test
	void decayMultiplierIdentityWithoutVet() {
		assertEquals(1.0, effects.happinessDecayMultiplier(encId), 1e-9);
	}

	@Test
	void decayMultiplierAppliesWithVet() {
		memberService.create(42L, "vet", OptionalLong.of(encId));
		assertEquals(0.5, effects.happinessDecayMultiplier(encId), 1e-9);
	}

	@Test
	void multipleVetsDoNotCompound() {
		memberService.create(42L, "vet", OptionalLong.of(encId));
		memberService.create(42L, "vet", OptionalLong.of(encId));
		// Single vet already drops to 0.5; second vet doesn't compound.
		assertEquals(0.5, effects.happinessDecayMultiplier(encId), 1e-9);
	}

	// ─── auto-feed capacity ──────────────────────────────────────────────

	@Test
	void autoFeedCapacityZeroWithoutZookeeper() {
		assertEquals(0, effects.autoFeedCapacity(encId));
	}

	@Test
	void autoFeedCapacityStacksAcrossZookeepers() {
		memberService.create(42L, "zookeeper", OptionalLong.of(encId));
		memberService.create(42L, "zookeeper", OptionalLong.of(encId));
		// 5 + 5 = 10
		assertEquals(10, effects.autoFeedCapacity(encId));
	}

	// ─── incubation multiplier ───────────────────────────────────────────

	@Test
	void incubationMultiplierIdentityWithoutScientist() {
		assertEquals(1.0, effects.incubationMultiplier(42L), 1e-9);
	}

	@Test
	void incubationMultiplierStacksMultiplicatively() {
		memberService.create(42L, "scientist", OptionalLong.empty());
		assertEquals(0.75, effects.incubationMultiplier(42L), 1e-9);

		memberService.create(42L, "scientist", OptionalLong.empty());
		// 0.75 × 0.75 = 0.5625, above 0.5 floor
		assertEquals(0.5625, effects.incubationMultiplier(42L), 1e-9);
	}

	@Test
	void incubationMultiplierHonorsFloor() {
		memberService.create(42L, "scientist", OptionalLong.empty());
		memberService.create(42L, "scientist", OptionalLong.empty());
		memberService.create(42L, "scientist", OptionalLong.empty());
		// 0.75^3 = 0.421875, floored at 0.5
		assertEquals(0.5, effects.incubationMultiplier(42L), 1e-9);
	}

	// ─── income multiplier ──────────────────────────────────────────────

	@Test
	void incomeMultiplierIdentityWithoutMarketer() {
		assertEquals(1.0, effects.incomeMultiplier(42L), 1e-9);
	}

	@Test
	void incomeMultiplierStacksAdditively() {
		memberService.create(42L, "marketer", OptionalLong.empty());
		assertEquals(1.15, effects.incomeMultiplier(42L), 1e-9);

		memberService.create(42L, "marketer", OptionalLong.empty());
		assertEquals(1.30, effects.incomeMultiplier(42L), 1e-9);
	}

	@Test
	void incomeMultiplierHonorsCap() {
		memberService.create(42L, "marketer", OptionalLong.empty());
		memberService.create(42L, "marketer", OptionalLong.empty());
		memberService.create(42L, "marketer", OptionalLong.empty());
		// 1 + 0.15*3 = 1.45, exactly at cap
		assertEquals(1.45, effects.incomeMultiplier(42L), 1e-9);
		// (Cap is 1.45 in the shipped catalog, so we can't easily test "above"
		// without rewriting the catalog — three marketers is the live max.)
	}

	// ─── total wages + staff count ──────────────────────────────────────

	@Test
	void totalWagesIsZeroWithoutStaff() {
		assertEquals(0L, effects.totalWagesPerHour(42L));
	}

	@Test
	void totalWagesSumsAcrossRoster() {
		// Per the shipped catalog: zookeeper=40/hr, vet=70/hr, marketer=50/hr.
		long zookeeperWage = catalog.byId("zookeeper").orElseThrow().wagePerHour();
		long vetWage = catalog.byId("vet").orElseThrow().wagePerHour();
		long marketerWage = catalog.byId("marketer").orElseThrow().wagePerHour();

		memberService.create(42L, "zookeeper", OptionalLong.of(encId));
		memberService.create(42L, "vet", OptionalLong.of(encId));
		memberService.create(42L, "marketer", OptionalLong.empty());

		assertEquals(zookeeperWage + vetWage + marketerWage,
			effects.totalWagesPerHour(42L));
	}

	@Test
	void totalWagesIsolatedPerOwner() {
		PlayerService players = new PlayerService(ds, new CacheManager());
		players.ensure(99L, "Bob");
		memberService.create(42L, "vet", OptionalLong.of(encId));
		assertEquals(0L, effects.totalWagesPerHour(99L),
			"another player's roster doesn't bleed into this one");
	}

	@Test
	void staffCountForOwnerCountsRoster() {
		assertEquals(0, effects.staffCountForOwner(42L));
		memberService.create(42L, "vet", OptionalLong.of(encId));
		memberService.create(42L, "marketer", OptionalLong.empty());
		assertEquals(2, effects.staffCountForOwner(42L));
	}
}
