package dev.homeology.dinoworld.modules.achievements;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.LevelingService;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.players.missions.MissionCatalog;
import dev.homeology.dinoworld.modules.players.missions.MissionProgressService;
import dev.homeology.dinoworld.modules.zoo.DinoCatalog;
import dev.homeology.dinoworld.modules.zoo.DinoInstanceService;
import dev.homeology.dinoworld.modules.zoo.DinoTrait;
import dev.homeology.dinoworld.modules.zoo.EnclosureService;
import dev.homeology.dinoworld.modules.zoo.RarityCatalog;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.OptionalLong;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * End-to-end integration tests for {@link AchievementAwarder}. Each
 * scenario builds the minimum state needed to satisfy one trigger,
 * runs detection, and asserts both the progress row and the reward
 * grant landed.
 *
 * <p>{@link dev.homeology.dinoworld.modules.notify.NotificationService}
 * is passed as null — the awarder treats it as optional, and these
 * tests don't exercise the DM path (which needs a live JDA).
 */
class AchievementAwarderTest {

	private HikariDataSource ds;
	private PlayerService players;
	private DinoInstanceService dinos;
	private EnclosureService enclosures;
	private DinoCatalog dinoCatalog;
	private MissionCatalog missionCatalog;
	private MissionProgressService missionProgress;
	private AchievementCatalog catalog;
	private AchievementProgressService progress;
	private AchievementAwarder awarder;

	private static final long USER = 42L;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "notify", "staff", "zoo", "achievements"));

		players = new PlayerService(ds, new CacheManager(), new LevelingService());
		players.ensure(USER, "Alice");

		dinos = new DinoInstanceService(ds);
		enclosures = new EnclosureService(ds);
		dinoCatalog = new DinoCatalog(new RarityCatalog());
		missionCatalog = new MissionCatalog();
		missionProgress = new MissionProgressService(ds);

		catalog = new AchievementCatalog();
		progress = new AchievementProgressService(ds);
		awarder = new AchievementAwarder(ds, catalog, progress, players,
			dinoCatalog, missionCatalog, missionProgress, null);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void firstHatchUnlocksAndAutoEquipsTitle() {
		dinos.create(USER, "velociraptor", OptionalLong.empty(), null);

		var unlocked = awarder.detectAndAward(USER);

		assertTrue(unlocked.stream().anyMatch(a -> a.id().equals("v1.first_hatch")));
		Set<String> done = progress.unlockedFor(USER);
		assertTrue(done.contains("v1.first_hatch"));
		// Auto-equip on first unlock since player had no title.
		Player p = players.get(USER).orElseThrow();
		assertEquals("Hatcher", p.equippedTitle().orElse(null));
	}

	@Test
	void rewardCoinsAndXpAreGranted() {
		dinos.create(USER, "velociraptor", OptionalLong.empty(), null);
		long coinsBefore = players.get(USER).orElseThrow().coins();
		long xpBefore = players.get(USER).orElseThrow().xp();

		var unlocked = awarder.detectAndAward(USER);
		assertFalse(unlocked.isEmpty(), "creating a dino should unlock at least first_hatch");

		long expectedCoins = unlocked.stream().mapToLong(Achievement::rewardCoins).sum();
		long expectedXp = unlocked.stream().mapToLong(Achievement::rewardXp).sum();

		Player after = players.get(USER).orElseThrow();
		assertEquals(coinsBefore + expectedCoins, after.coins(),
			"every unlocked achievement's coin reward must land on the balance");
		assertEquals(xpBefore + expectedXp, after.xp(),
			"every unlocked achievement's XP reward must land on the totals");
	}

	@Test
	void doubleRunDoesNotDoublePay() {
		dinos.create(USER, "velociraptor", OptionalLong.empty(), null);
		awarder.detectAndAward(USER);
		long coinsAfterFirst = players.get(USER).orElseThrow().coins();

		var second = awarder.detectAndAward(USER);
		long coinsAfterSecond = players.get(USER).orElseThrow().coins();

		assertEquals(coinsAfterFirst, coinsAfterSecond, "rerun must not re-award");
		assertFalse(second.stream().anyMatch(a -> a.id().equals("v1.first_hatch")));
	}

	@Test
	void firstShinyUnlocksOnlyWhenAShinyExists() {
		dinos.create(USER, "velociraptor", OptionalLong.empty(), null, null, false);
		awarder.detectAndAward(USER);
		assertFalse(progress.unlockedFor(USER).contains("v1.hatch_shiny"));

		dinos.create(USER, "velociraptor", OptionalLong.empty(), null, null, true);
		awarder.detectAndAward(USER);
		assertTrue(progress.unlockedFor(USER).contains("v1.hatch_shiny"));
	}

	@Test
	void firstEnclosureRequiresMoreThanStarter() {
		// The starter is auto-created by EnclosureService.ensureStarter so a
		// player with zero user-built enclosures still has count >= 1. The
		// achievement requires >= 2.
		enclosures.create(USER, "forest", 5, 1, "Starter");
		awarder.detectAndAward(USER);
		assertFalse(progress.unlockedFor(USER).contains("v1.first_enclosure"));

		enclosures.create(USER, "forest", 5, 2, "Second");
		awarder.detectAndAward(USER);
		assertTrue(progress.unlockedFor(USER).contains("v1.first_enclosure"));
	}

	@Test
	void playerLevelTriggerFiresAtThreshold() {
		players.addXp(USER, players.leveling().cumulativeXpForLevel(5));
		awarder.detectAndAward(USER);
		assertTrue(progress.unlockedFor(USER).contains("v1.reach_level_5"));
	}

	@Test
	void dinoLevelTriggerNeedsAtLeastOneCapDino() {
		DinoInstance d = dinos.create(USER, "velociraptor", OptionalLong.empty(), null);
		long toCap = dev.homeology.dinoworld.modules.zoo.DinoLeveling.cumulativeXpForLevel(
			dev.homeology.dinoworld.modules.zoo.DinoLeveling.MAX_LEVEL);
		dinos.awardXp(d.id(), (int) toCap);

		awarder.detectAndAward(USER);
		assertTrue(progress.unlockedFor(USER).contains("v1.dino_to_level_50"));
	}

	@Test
	void feedsTotalDerivesFromDinoXp() {
		// 100 feeds × 12 XP/feed = 1200 XP across all owned dinos.
		DinoInstance d = dinos.create(USER, "velociraptor", OptionalLong.empty(), null);
		dinos.awardXp(d.id(), 100 * DinoInstanceService.FEED_XP_AWARD);

		awarder.detectAndAward(USER);
		assertTrue(progress.unlockedFor(USER).contains("v1.feed_100_times"));
	}

	@Test
	void coinsHeldThresholdReadsCurrentBalance() {
		players.addCoins(USER, 600_000L, "test", null);
		awarder.detectAndAward(USER);
		assertTrue(progress.unlockedFor(USER).contains("v1.hold_500k_coins"));
	}

	@Test
	void coinsEarnedSumsPositiveLedgerOnly() {
		// 600k earned + 200k spent → balance 400k (below hold threshold), but
		// lifetime-earned 600k crosses the 100k milestone.
		players.addCoins(USER, 600_000L, "test", null);
		players.addCoins(USER, -200_000L, "test-spend", null);

		awarder.detectAndAward(USER);
		assertTrue(progress.unlockedFor(USER).contains("v1.earn_100k_coins"));
		assertFalse(progress.unlockedFor(USER).contains("v1.hold_500k_coins"));
	}

	@Test
	void traitDiversityCountsDistinctNonNullTraits() {
		// Drop a dino of every trait — should hit the 7-trait threshold.
		for (DinoTrait t : DinoTrait.values()) {
			dinos.create(USER, "velociraptor", OptionalLong.empty(), null, t);
		}
		awarder.detectAndAward(USER);
		assertTrue(progress.unlockedFor(USER).contains("v1.own_one_of_each_trait"));
	}

	@Test
	void titleNotAutoEquippedIfPlayerAlreadyHasOne() {
		players.setEquippedTitle(USER, "Existing");
		dinos.create(USER, "velociraptor", OptionalLong.empty(), null);

		awarder.detectAndAward(USER);

		// Achievement still unlocks, but the existing title is preserved.
		assertTrue(progress.unlockedFor(USER).contains("v1.first_hatch"));
		assertEquals("Existing", players.get(USER).orElseThrow().equippedTitle().orElseThrow());
	}
}
