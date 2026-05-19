package dev.homeology.dinoworld.modules.zoo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
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
 * Integration tests for {@link DinoInstanceService}.
 *
 * <p>Each test runs against a fresh temp SQLite file with the full set of
 * production migrations applied. {@link PlayerService#ensure} is called
 * to satisfy the {@code dino_instance.owner_user_id} FK.
 */
class DinoInstanceServiceTest {

	private HikariDataSource ds;
	private DinoInstanceService dinos;

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
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void createSetsDefaults() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		assertTrue(d.id() > 0);
		assertEquals("velociraptor", d.speciesId());
		assertTrue(d.enclosureId().isEmpty());
		assertTrue(d.customName().isEmpty());
		assertEquals(DinoInstanceService.STARTING_LEVEL, d.level());
		assertEquals(0L, d.xp());
		assertEquals(DinoInstanceService.STARTING_HP, d.currentHp());
		assertEquals(DinoInstanceService.STARTING_HAPPINESS, d.happiness());
		assertTrue(d.lastFedAt().isEmpty());
	}

	@Test
	void createWithEnclosureAndName() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.of(7L), "Rex");
		assertEquals(OptionalLong.of(7L), d.enclosureId());
		assertEquals("Rex", d.customName().orElseThrow());
	}

	@Test
	void blankNameStoredAsEmpty() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), "   ");
		assertTrue(d.customName().isEmpty());
	}

	@Test
	void recordFedRestoresHappinessAndStampsTime() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		dinos.applyHappiness(d.id(), 30, Instant.parse("2026-05-07T12:00:00Z"));
		dinos.recordFed(d.id(), Instant.parse("2026-05-07T18:00:00Z"));

		DinoInstance after = dinos.findById(d.id()).orElseThrow();
		assertEquals(100, after.happiness());
		assertEquals(Instant.parse("2026-05-07T18:00:00Z"), after.lastFedAt().orElseThrow());
		assertEquals(Instant.parse("2026-05-07T18:00:00Z"), after.lastDecayAt());
	}

	@Test
	void applyHappinessClampsToZeroToHundred() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		dinos.applyHappiness(d.id(), -10, Instant.parse("2026-05-07T12:00:00Z"));
		assertEquals(0, dinos.findById(d.id()).orElseThrow().happiness());

		dinos.applyHappiness(d.id(), 250, Instant.parse("2026-05-07T13:00:00Z"));
		assertEquals(100, dinos.findById(d.id()).orElseThrow().happiness());
	}

	@Test
	void deleteRemovesRow() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		assertTrue(dinos.delete(d.id()));
		assertTrue(dinos.findById(d.id()).isEmpty());
		// Second delete is a no-op false (idempotent)
		assertFalse(dinos.delete(d.id()));
	}

	@Test
	void countAndFindByOwner() {
		assertEquals(0, dinos.countByOwner(42L));
		dinos.create(42L, "velociraptor", OptionalLong.empty(), "a");
		dinos.create(42L, "velociraptor", OptionalLong.empty(), "b");
		dinos.create(42L, "velociraptor", OptionalLong.empty(), "c");
		assertEquals(3, dinos.countByOwner(42L));
		assertEquals(3, dinos.findByOwner(42L).size());
	}

	@Test
	void assignToEnclosureUpdatesAndAcceptsHomeless() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.of(7L), null);
		assertEquals(OptionalLong.of(7L), dinos.findById(d.id()).orElseThrow().enclosureId());

		assertTrue(dinos.assignToEnclosure(d.id(), OptionalLong.of(99L)));
		assertEquals(OptionalLong.of(99L), dinos.findById(d.id()).orElseThrow().enclosureId());

		// Empty = homeless (NULL)
		assertTrue(dinos.assignToEnclosure(d.id(), OptionalLong.empty()));
		assertTrue(dinos.findById(d.id()).orElseThrow().enclosureId().isEmpty());
	}

	@Test
	void assignToEnclosureUnknownReturnsFalse() {
		assertFalse(dinos.assignToEnclosure(99999L, OptionalLong.of(1L)));
	}

	@Test
	void renameUpdatesCustomName() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		assertTrue(dinos.rename(d.id(), "Sharptooth"));
		assertEquals("Sharptooth",
			dinos.findById(d.id()).orElseThrow().customName().orElseThrow());
	}

	@Test
	void renameTrimsAndAcceptsClearViaBlank() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), "Original");
		assertTrue(dinos.rename(d.id(), "  Trimmed  "));
		assertEquals("Trimmed",
			dinos.findById(d.id()).orElseThrow().customName().orElseThrow());
		assertTrue(dinos.rename(d.id(), "   "), "blank input should clear");
		assertTrue(dinos.findById(d.id()).orElseThrow().customName().isEmpty());
	}

	@Test
	void renameUnknownReturnsFalse() {
		assertFalse(dinos.rename(99999L, "nope"));
	}

	@Test
	void resetFeedCooldownClearsTimestamp() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		dinos.recordFed(d.id(), Instant.parse("2026-05-07T18:00:00Z"));
		assertTrue(dinos.findById(d.id()).orElseThrow().lastFedAt().isPresent());
		dinos.resetFeedCooldown(d.id());
		assertTrue(dinos.findById(d.id()).orElseThrow().lastFedAt().isEmpty());
	}

	@Test
	void findAllAcrossOwners() {
		PlayerService players = new PlayerService(ds, new CacheManager());
		players.ensure(43L, "Bob");
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		dinos.create(43L, "velociraptor", OptionalLong.empty(), null);
		assertEquals(2, dinos.findAll().size());
	}

	// ─── awardXp ──────────────────────────────────────────────────────────

	@Test
	void awardXpAccumulatesWithoutLevelUpBelowFirstThreshold() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		DinoInstanceService.AwardResult r = dinos.awardXp(d.id(), 10).orElseThrow();

		assertEquals(1, r.newLevel());
		assertFalse(r.leveledUp(), "10 XP < first level threshold (53)");
		DinoInstance after = dinos.findById(d.id()).orElseThrow();
		assertEquals(10L, after.xp());
		assertEquals(1, after.level());
	}

	@Test
	void awardXpCrossingThresholdSetsLeveledUp() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		// Award exactly enough to hit L2 boundary.
		long step = DinoLeveling.xpToNextLevel(1);
		DinoInstanceService.AwardResult r = dinos.awardXp(d.id(), (int) step).orElseThrow();

		assertEquals(2, r.newLevel());
		assertTrue(r.leveledUp());
		assertEquals(2, dinos.findById(d.id()).orElseThrow().level());
	}

	@Test
	void awardXpCanCrossMultipleLevelsInOneCall() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		// Enough total XP to reach L5.
		int target = (int) DinoLeveling.cumulativeXpForLevel(5);
		DinoInstanceService.AwardResult r = dinos.awardXp(d.id(), target).orElseThrow();

		assertEquals(5, r.newLevel());
		assertTrue(r.leveledUp());
	}

	@Test
	void awardXpAtCapDoesNotLevelUpButAccumulates() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		int toCap = (int) DinoLeveling.cumulativeXpForLevel(DinoLeveling.MAX_LEVEL);
		dinos.awardXp(d.id(), toCap);
		// Already at MAX_LEVEL; further awards must report leveledUp=false.
		DinoInstanceService.AwardResult r = dinos.awardXp(d.id(), 100).orElseThrow();

		assertEquals(DinoLeveling.MAX_LEVEL, r.newLevel());
		assertFalse(r.leveledUp());
		// XP still ticks up so the column stays a lifetime total.
		assertEquals(toCap + 100L, dinos.findById(d.id()).orElseThrow().xp());
	}

	@Test
	void awardXpRejectsNegativeDelta() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		assertThrows(IllegalArgumentException.class, () -> dinos.awardXp(d.id(), -1));
	}

	@Test
	void awardXpReturnsEmptyForMissingDino() {
		assertTrue(dinos.awardXp(999_999L, 10).isEmpty());
	}
}
