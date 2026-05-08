package dev.homeology.dinoworld.modules.zoo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.EggInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link EggService}.
 *
 * <p>Each test uses a fixed {@link Clock} and a deterministic mystery
 * picker so outcomes are reproducible. Real {@link RarityCatalog} +
 * {@link DinoCatalog} are loaded so price math, incubation defaults, and
 * compatibility checks all use shipping data.
 */
class EggServiceTest {

	private HikariDataSource ds;
	private RarityCatalog rarities;
	private DinoCatalog catalog;
	private PlayerService players;
	private DinoInstanceService dinos;
	private EnclosureService enclosures;
	private EggService eggs;

	private static final Instant NOW = Instant.parse("2026-05-07T12:00:00Z");

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "zoo"));

		players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");

		rarities = new RarityCatalog();
		catalog = new DinoCatalog(rarities);
		dinos = new DinoInstanceService(ds);
		enclosures = new EnclosureService(ds);

		// Deterministic picker — always pick the alphabetically-first species
		// in the rarity bucket — so mystery hatches are reproducible.
		eggs = new EggService(ds, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(0),
			Clock.fixed(NOW, ZoneOffset.UTC));
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	/**
	 * Bring the test player up to level ≥ 100 so every rarity tier is
	 * unlocked. Used by tests that focus on cost/species/hatch logic and
	 * shouldn't be entangled with the level-gate.
	 */
	private void unlockAllRarities() {
		players.addXp(42L, 500_000L);
	}

	// ─── purchase ─────────────────────────────────────────────────────────

	@Test
	void buyMysteryDeductsCoinsAndCreatesPendingRow() {
		players.addCoins(42L, 1000L, "test", null);
		EggInstance egg = eggs.buyMystery(42L, "common");

		assertEquals("common", egg.rarity());
		assertTrue(egg.speciesId().isEmpty(), "mystery egg has no species until hatch");
		assertEquals(NOW, egg.purchasedAt());
		assertEquals(NOW.plus(Duration.ofMinutes(rarities.require("common").incubationMinutes())),
			egg.readyAt());
		assertEquals(800L, players.get(42L).orElseThrow().coins(), "200 coin mystery price");
	}

	@Test
	void buyDeterminedRecordsSpeciesAndCharges25xMultiplier() {
		players.addCoins(42L, 5000L, "test", null);
		unlockAllRarities();
		enclosures.create(42L, "forest", 5, 5, "Big");
		EggInstance egg = eggs.buyDetermined(42L, "velociraptor");

		assertEquals("uncommon", egg.rarity());
		assertEquals("velociraptor", egg.speciesId().orElseThrow());
		// 600 mystery × 2.5 = 1500
		assertEquals(5000L - 1500L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void buyMysteryThrowsWhenInsufficientCoins() {
		// Player has 0 coins; common mystery costs 200.
		assertThrows(EggService.InsufficientCoinsException.class,
			() -> eggs.buyMystery(42L, "common"));
	}

	@Test
	void buyMysteryThrowsOnUnknownRarity() {
		players.addCoins(42L, 100000L, "test", null);
		assertThrows(IllegalArgumentException.class,
			() -> eggs.buyMystery(42L, "godtier"));
	}

	@Test
	void buyDeterminedThrowsOnUnknownSpecies() {
		players.addCoins(42L, 100000L, "test", null);
		assertThrows(IllegalArgumentException.class,
			() -> eggs.buyDetermined(42L, "nonexistent"));
	}

	@Test
	void buyMysteryRejectsOnceLevelDerivedSlotsAreFull() {
		// Level 1 → 2 incubation slots. Third mystery purchase must be refused
		// without charging coins, regardless of how the second was acquired.
		players.addCoins(42L, 100000L, "test", null);
		eggs.buyMystery(42L, "common");
		eggs.buyMystery(42L, "common");
		long balanceBefore = players.get(42L).orElseThrow().coins();

		assertThrows(EggService.EggSlotsFullException.class,
			() -> eggs.buyMystery(42L, "common"));

		assertEquals(balanceBefore, players.get(42L).orElseThrow().coins(),
			"slot-full rejection must not debit coins");
		assertEquals(2, eggs.findPending(42L).size());
	}

	@Test
	void buyDeterminedAlsoEnforcesSlotCap() {
		// Determined-egg path must share the same guard as mystery — otherwise
		// the cap is bypassable via dropdown. Use a common forest species so
		// neither the level-gate nor the habitat-gate triggers first.
		players.addCoins(42L, 100000L, "test", null);
		enclosures.ensureStarter(42L);
		eggs.adminCreate(42L, "common", null, false);
		eggs.adminCreate(42L, "common", null, false);

		assertThrows(EggService.EggSlotsFullException.class,
			() -> eggs.buyDetermined(42L, "compsognathus"));
	}

	@Test
	void buyMysteryRejectsLockedRarity() {
		// Level-1 player tries to buy a Rare mystery (unlocks at 15).
		// Must throw before any debit.
		players.addCoins(42L, 100_000L, "test", null);
		long before = players.get(42L).orElseThrow().coins();

		assertThrows(EggService.RarityLockedException.class,
			() -> eggs.buyMystery(42L, "rare"));

		assertEquals(before, players.get(42L).orElseThrow().coins(),
			"locked-rarity rejection must not debit coins");
	}

	@Test
	void buyMysteryAcceptsRarityAtExactUnlockLevel() {
		// Edge case — unlock is "level >= minLevel", inclusive.
		players.addCoins(42L, 100_000L, "test", null);
		players.addXp(42L, 50L * 5 * 4); // cumulativeXpForLevel(5) → exactly level 5
		assertEquals(5, players.get(42L).orElseThrow().level());

		assertDoesNotThrow(() -> eggs.buyMystery(42L, "uncommon"));
	}

	@Test
	void buyDeterminedRejectsLockedRarityBeforeHabitatCheck() {
		// Even if the player has no habitat at all, the level-gate fires
		// first — keeps the error message focused on the bigger blocker.
		players.addCoins(42L, 100_000L, "test", null);

		assertThrows(EggService.RarityLockedException.class,
			() -> eggs.buyDetermined(42L, "velociraptor"));
	}

	@Test
	void buyDeterminedRejectsWhenNoCompatibleHabitat() {
		// Level-gate cleared but the player owns no enclosure that could
		// house a forest/uncommon species. Charge nothing and reject.
		players.addCoins(42L, 100_000L, "test", null);
		unlockAllRarities();
		// No enclosures at all — not even the starter.
		long before = players.get(42L).orElseThrow().coins();

		assertThrows(EggService.NoHabitatException.class,
			() -> eggs.buyDetermined(42L, "velociraptor"));

		assertEquals(before, players.get(42L).orElseThrow().coins(),
			"no-habitat rejection must not debit coins");
	}

	@Test
	void buyDeterminedAcceptsAerialSpeciesWithLandHabitat() {
		// Aerial species can live in LAND enclosures (with a happiness
		// penalty applied later). Buying should succeed when the player
		// only has a land habitat of sufficient tier.
		players.addCoins(42L, 100_000L, "test", null);
		unlockAllRarities();
		// Tier 1 forest — starter-equivalent. Common aerial species:
		// dimorphodon (aerial, common, tier 1).
		enclosures.create(42L, "forest", 5, 1, "LandOnly");

		assertDoesNotThrow(() -> eggs.buyDetermined(42L, "dimorphodon"));
	}

	@Test
	void buyDeterminedRejectsLandSpeciesWithOnlyAerialHabitat() {
		// The reverse pairing is NOT allowed — land species can't live in
		// aerial enclosures.
		players.addCoins(42L, 100_000L, "test", null);
		unlockAllRarities();
		enclosures.create(42L, "aerial", 5, 5, "Sky");

		assertThrows(EggService.NoHabitatException.class,
			() -> eggs.buyDetermined(42L, "compsognathus"));
	}

	@Test
	void buyDeterminedRejectsMarineSpeciesWithoutMarineHabitat() {
		// Marine species are strict — no land or aerial fallback.
		players.addCoins(42L, 100_000L, "test", null);
		unlockAllRarities();
		enclosures.create(42L, "forest", 5, 5, "Land");
		enclosures.create(42L, "aerial", 5, 5, "Sky");

		assertThrows(EggService.NoHabitatException.class,
			() -> eggs.buyDetermined(42L, "nothosaurus"));
	}

	@Test
	void adminCreateBypassesSlotCap() {
		// Admin path is intentionally exempt — it's how the developer reset
		// flow seeds inventory regardless of player level.
		eggs.adminCreate(42L, "common", null, false);
		eggs.adminCreate(42L, "common", null, false);
		eggs.adminCreate(42L, "common", null, false);  // would fail in buy path

		assertEquals(3, eggs.findPending(42L).size());
	}

	// ─── inventory ─────────────────────────────────────────────────────────

	@Test
	void findPendingExcludesHatched() {
		players.addCoins(42L, 100000L, "test", null);
		unlockAllRarities();
		// One ready-immediately egg (mystery common)
		EggService eggsImmediate = new EggService(ds, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(0),
			Clock.fixed(NOW.minus(Duration.ofHours(2)), ZoneOffset.UTC));
		eggsImmediate.buyMystery(42L, "common");
		// And one still incubating (we use the standard fixture)
		eggs.buyMystery(42L, "rare");

		assertEquals(2, eggs.findPending(42L).size());

		// Hatch the ready one.
		enclosures.create(42L, "forest", 5, 5, "Big");
		eggs.hatchAllReady(42L);

		List<EggInstance> stillPending = eggs.findPending(42L);
		assertEquals(1, stillPending.size());
		assertEquals("rare", stillPending.get(0).rarity());
	}

	// ─── hatch ─────────────────────────────────────────────────────────────

	@Test
	void hatchOfMysteryRollsSpeciesAndCreatesDino() {
		players.addCoins(42L, 1000L, "test", null);
		Enclosure enc = enclosures.create(42L, "forest", 5, 5, "Big");

		// Use a clock that places "now" past the egg's ready_at.
		EggService backdated = new EggService(ds, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(0),
			Clock.fixed(NOW.minus(Duration.ofHours(2)), ZoneOffset.UTC));
		EggInstance egg = backdated.buyMystery(42L, "common");
		EggService.HatchResult result = eggs.hatch(42L, egg.id());

		assertEquals(egg.id(), result.eggId());
		assertNotNull(result.species());
		assertEquals("common", result.species().rarity());
		assertEquals(enc.id(), result.dino().enclosureId().orElseThrow());
		// XP awarded matches rarity hatch_xp.
		assertEquals(rarities.require("common").hatchXp(), result.xpAwarded());
		// Egg is no longer pending.
		assertTrue(eggs.findById(egg.id()).orElseThrow().hatchedAt().isPresent());
	}

	@Test
	void hatchOfDeterminedUsesStoredSpecies() {
		players.addCoins(42L, 5000L, "test", null);
		unlockAllRarities();
		enclosures.create(42L, "forest", 5, 5, "Big");

		EggService backdated = new EggService(ds, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(0),
			Clock.fixed(NOW.minus(Duration.ofHours(3)), ZoneOffset.UTC));
		EggInstance egg = backdated.buyDetermined(42L, "velociraptor");
		EggService.HatchResult result = eggs.hatch(42L, egg.id());

		assertEquals("velociraptor", result.species().id());
	}

	@Test
	void hatchThrowsEggNotReadyBeforeReadyAt() {
		players.addCoins(42L, 1000L, "test", null);
		enclosures.create(42L, "forest", 5, 5, "Big");
		EggInstance egg = eggs.buyMystery(42L, "common");
		// Clock is still NOW; egg is ready_at NOW + 30min.
		EggService.EggNotReadyException ex = assertThrows(EggService.EggNotReadyException.class,
			() -> eggs.hatch(42L, egg.id()));
		assertEquals("Not ready yet", ex.userTitle());
		assertTrue(ex.getMessage().contains("still incubating"));
	}

	@Test
	void hatchThrowsOwnershipExceptionForWrongOwner() {
		players.ensure(99L, "Bob");
		players.addCoins(42L, 1000L, "test", null);
		EggService backdated = new EggService(ds, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(0),
			Clock.fixed(NOW.minus(Duration.ofHours(2)), ZoneOffset.UTC));
		EggInstance egg = backdated.buyMystery(42L, "common");
		EggService.EggOwnershipException ex = assertThrows(EggService.EggOwnershipException.class,
			() -> eggs.hatch(99L, egg.id()));
		assertEquals("Not your egg", ex.userTitle());
	}

	@Test
	void hatchThrowsAlreadyHatchedOnSecondAttempt() {
		players.addCoins(42L, 1000L, "test", null);
		enclosures.create(42L, "forest", 5, 5, "Big");
		EggService backdated = new EggService(ds, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(0),
			Clock.fixed(NOW.minus(Duration.ofHours(2)), ZoneOffset.UTC));
		EggInstance egg = backdated.buyMystery(42L, "common");
		// First hatch succeeds.
		eggs.hatch(42L, egg.id());
		// Second attempt fires the typed exception.
		EggService.EggAlreadyHatchedException ex = assertThrows(EggService.EggAlreadyHatchedException.class,
			() -> eggs.hatch(42L, egg.id()));
		assertEquals("Already hatched", ex.userTitle());
	}

	@Test
	void hatchThrowsNotFoundForUnknownEgg() {
		assertThrows(EggService.EggNotFoundException.class,
			() -> eggs.hatch(42L, 999_999L));
	}

	@Test
	void hatchThrowsWhenNoCompatibleEnclosure() {
		players.addCoins(42L, 100000L, "test", null);
		// No enclosure created — starter would suffice for common but we skipped it.

		EggService backdated = new EggService(ds, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(0),
			Clock.fixed(NOW.minus(Duration.ofHours(2)), ZoneOffset.UTC));
		EggInstance egg = backdated.buyMystery(42L, "common");
		assertThrows(EggService.NoCompatibleEnclosureException.class,
			() -> eggs.hatch(42L, egg.id()));
		// Egg should remain pending (no partial state).
		assertTrue(eggs.findById(egg.id()).orElseThrow().isPending());
	}

	@Test
	void hatchAllReadyHatchesOnlyReady() {
		players.addCoins(42L, 100000L, "test", null);
		enclosures.create(42L, "forest", 10, 5, "Big");

		EggService old = new EggService(ds, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(0),
			Clock.fixed(NOW.minus(Duration.ofHours(2)), ZoneOffset.UTC));
		// Use admin path to seed eggs — buyMystery now enforces the level-derived
		// slot cap (2 at level 1), which would reject the third egg.
		old.adminCreate(42L, "common", null, false);
		old.adminCreate(42L, "common", null, false);
		eggs.adminCreate(42L, "rare", null, false);  // incubating still — won't be ready at NOW

		List<EggService.HatchResult> hatched = eggs.hatchAllReady(42L);
		assertEquals(2, hatched.size());
		assertEquals(1, eggs.findPending(42L).size());
	}

	// ─── admin paths ─────────────────────────────────────────────────────

	@Test
	void adminCreateMysteryDoesNotChargeCoins() {
		assertEquals(0L, players.get(42L).orElseThrow().coins());
		EggInstance e = eggs.adminCreate(42L, "rare", null, false);
		assertEquals(0L, players.get(42L).orElseThrow().coins());
		assertEquals("rare", e.rarity());
		assertTrue(e.speciesId().isEmpty());
		assertEquals(NOW.plus(Duration.ofMinutes(rarities.require("rare").incubationMinutes())),
			e.readyAt());
	}

	@Test
	void adminCreateDeterminedRespectsRarityMatch() {
		EggInstance e = eggs.adminCreate(42L, "uncommon", "velociraptor", false);
		assertEquals("velociraptor", e.speciesId().orElseThrow());
		assertThrows(IllegalArgumentException.class,
			() -> eggs.adminCreate(42L, "common", "velociraptor", false));
	}

	@Test
	void adminCreateReadyNowSkipsIncubation() {
		EggInstance e = eggs.adminCreate(42L, "mythic", null, true);
		assertEquals(NOW, e.readyAt());
		assertTrue(e.isReadyAt(NOW));
	}

	@Test
	void adminForceReadyFlipsExistingEgg() {
		EggInstance e = eggs.adminCreate(42L, "mythic", null, false);
		assertFalse(e.isReadyAt(NOW));
		assertTrue(eggs.adminForceReady(e.id()));
		assertTrue(eggs.findById(e.id()).orElseThrow().isReadyAt(NOW));
	}

	@Test
	void adminForceReadyOnUnknownReturnsFalse() {
		assertFalse(eggs.adminForceReady(999_999L));
	}
}
