package dev.homeology.dinoworld.modules.players.missions;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.DinoCatalog;
import dev.homeology.dinoworld.modules.zoo.DinoInstanceService;
import dev.homeology.dinoworld.modules.zoo.EnclosureService;
import dev.homeology.dinoworld.modules.zoo.RarityCatalog;
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
 * Behavior tests for {@link MissionAwarder#detectAndAward}. Each scenario
 * seeds the relevant state, runs the awarder once, and asserts:
 *
 * <ol>
 *   <li>which missions came back as awarded,</li>
 *   <li>that the player's coins/xp moved by exactly the reward amount,</li>
 *   <li>that re-running the awarder doesn't double-pay.</li>
 * </ol>
 */
class MissionAwarderTest {

	private HikariDataSource ds;
	private PlayerService players;
	private DinoInstanceService dinos;
	private EnclosureService enclosures;
	private MissionCatalog catalog;
	private MissionProgressService progress;
	private MissionAwarder awarder;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "zoo"));

		players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");
		dinos = new DinoInstanceService(ds);
		enclosures = new EnclosureService(ds);

		catalog = new MissionCatalog();
		progress = new MissionProgressService(ds);
		awarder = new MissionAwarder(ds, catalog, progress, players);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	// ─── command-trigger missions ────────────────────────────────────────

	@Test
	void shopCommandAwardsVisitShopMission() {
		List<Mission> awarded = awarder.detectAndAward(42L, "shop", null);
		assertEquals(1, awarded.size());
		assertEquals("tutorial.visit_shop", awarded.get(0).id());

		long expected = catalog.byId("tutorial.visit_shop").orElseThrow().rewardCoins();
		assertEquals(expected, players.get(42L).orElseThrow().coins());
	}

	@Test
	void zooDashboardSubcommandAwardsCheckDashboardMission() {
		List<Mission> awarded = awarder.detectAndAward(42L, "zoo", "dashboard");
		assertTrue(awarded.stream().anyMatch(m -> "tutorial.check_park_dashboard".equals(m.id())),
			"command:zoo:dashboard trigger fires only when subcommand matches");
	}

	@Test
	void zooIssuesSubcommandDoesNotAwardCheckDashboardMission() {
		// dashboard mission requires the dashboard subcommand specifically.
		List<Mission> awarded = awarder.detectAndAward(42L, "zoo", "issues");
		assertFalse(awarded.stream().anyMatch(m -> "tutorial.check_park_dashboard".equals(m.id())));
	}

	// ─── state-trigger missions ──────────────────────────────────────────

	@Test
	void claimedDailyMissionFiresOnceLastDailySet() {
		// State trigger — runs even when the triggering command isn't /daily,
		// since the awarder scans state on every command.
		assertFalse(playerHasCompleted("tutorial.claim_first_daily"));
		players.recordDailyClaim(42L, Instant.now());

		List<Mission> awarded = awarder.detectAndAward(42L, "profile", null);
		assertTrue(awarded.stream().anyMatch(m -> "tutorial.claim_first_daily".equals(m.id())));
	}

	@Test
	void ownsDinoMissionFiresAfterHatch() {
		Enclosure enc = enclosures.create(42L, "forest", 5, 5, "Home");
		dinos.create(42L, "velociraptor", OptionalLong.of(enc.id()), null);

		List<Mission> awarded = awarder.detectAndAward(42L, "eggs", null);
		var ids = awarded.stream().map(Mission::id).toList();
		assertTrue(ids.contains("tutorial.hatch_first_dino"));
	}

	@Test
	void fedDinoMissionFiresAfterFeed() {
		Enclosure enc = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.of(enc.id()), null);
		dinos.recordFed(d.id(), Instant.now());

		List<Mission> awarded = awarder.detectAndAward(42L, "feed", null);
		var ids = awarded.stream().map(Mission::id).toList();
		assertTrue(ids.contains("tutorial.feed_first_dino"));
	}

	// ─── idempotency ─────────────────────────────────────────────────────

	@Test
	void rerunningAwarderDoesNotDoublePay() {
		players.recordDailyClaim(42L, Instant.now());
		List<Mission> first = awarder.detectAndAward(42L, "daily", null);
		long after = players.get(42L).orElseThrow().coins();

		List<Mission> second = awarder.detectAndAward(42L, "daily", null);
		assertEquals(after, players.get(42L).orElseThrow().coins(),
			"second pass must not credit anything — markCompleted no-ops the second insert");
		assertTrue(second.stream().noneMatch(m -> first.stream().anyMatch(f -> f.id().equals(m.id()))),
			"awarded list on the second pass excludes already-completed missions");
	}

	@Test
	void rewardLedgersUseMissionScopedReason() throws Exception {
		players.recordDailyClaim(42L, Instant.now());
		awarder.detectAndAward(42L, "daily", null);

		try (var c = ds.getConnection();
		     var ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM coin_ledger WHERE user_id = ? AND reason LIKE 'mission:%'")) {
			ps.setLong(1, 42L);
			try (var rs = ps.executeQuery()) {
				assertTrue(rs.next());
				assertTrue(rs.getInt(1) >= 1, "mission rewards leave a recognisable ledger trail");
			}
		}
	}

	private boolean playerHasCompleted(String missionId) {
		return progress.completedFor(42L).contains(missionId);
	}
}
