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
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
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
	private CommandRunsService commandRuns;
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
		commandRuns = new CommandRunsService(ds);
		awarder = new MissionAwarder(ds, catalog, progress, players, commandRuns);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	// ─── command-trigger missions ────────────────────────────────────────

	@Test
	void profileCommandAwardsCheckProfileMission() {
		// First mission in the tutorial set — no prerequisites to seed.
		List<Mission> awarded = awarder.detectAndAward(42L, "profile", null);
		assertEquals(1, awarded.size());
		assertEquals("tutorial.check_profile", awarded.get(0).id());

		long expected = catalog.byId("tutorial.check_profile").orElseThrow().rewardCoins();
		assertEquals(expected, players.get(42L).orElseThrow().coins());
	}

	@Test
	void shopCommandAwardsVisitShopMission() {
		seedCompleted("tutorial.check_profile", "tutorial.claim_first_daily");

		List<Mission> awarded = awarder.detectAndAward(42L, "shop", null);
		assertEquals(1, awarded.size());
		assertEquals("tutorial.visit_shop", awarded.get(0).id());

		long expected = catalog.byId("tutorial.visit_shop").orElseThrow().rewardCoins();
		assertEquals(expected, players.get(42L).orElseThrow().coins());
	}

	@Test
	void zooDashboardSubcommandAwardsCheckDashboardMission() {
		seedCompleted("tutorial.check_profile", "tutorial.claim_first_daily",
			"tutorial.visit_shop", "tutorial.buy_first_egg",
			"tutorial.hatch_first_dino", "tutorial.feed_first_dino");

		List<Mission> awarded = awarder.detectAndAward(42L, "zoo", "dashboard");
		assertTrue(awarded.stream().anyMatch(m -> "tutorial.check_park_dashboard".equals(m.id())),
			"command:zoo:dashboard trigger fires only when subcommand matches");
	}

	@Test
	void zooIssuesSubcommandDoesNotAwardCheckDashboardMission() {
		seedCompleted("tutorial.check_profile", "tutorial.claim_first_daily",
			"tutorial.visit_shop", "tutorial.buy_first_egg",
			"tutorial.hatch_first_dino", "tutorial.feed_first_dino");

		// dashboard mission requires the dashboard subcommand specifically.
		List<Mission> awarded = awarder.detectAndAward(42L, "zoo", "issues");
		assertFalse(awarded.stream().anyMatch(m -> "tutorial.check_park_dashboard".equals(m.id())));
	}

	// ─── state-trigger missions ──────────────────────────────────────────

	@Test
	void claimedDailyMissionFiresOnceLastDailySet() {
		seedCompleted("tutorial.check_profile");

		// State trigger — runs even when the triggering command isn't /daily,
		// since the awarder scans state on every command.
		assertFalse(playerHasCompleted("tutorial.claim_first_daily"));
		players.recordDailyClaim(42L, Instant.now());

		List<Mission> awarded = awarder.detectAndAward(42L, "profile", null);
		assertTrue(awarded.stream().anyMatch(m -> "tutorial.claim_first_daily".equals(m.id())));
	}

	@Test
	void ownsDinoMissionFiresAfterHatch() {
		seedCompleted("tutorial.check_profile", "tutorial.claim_first_daily",
			"tutorial.visit_shop", "tutorial.buy_first_egg");
		Enclosure enc = enclosures.create(42L, "forest", 5, 5, "Home");
		dinos.create(42L, "velociraptor", OptionalLong.of(enc.id()), null);

		List<Mission> awarded = awarder.detectAndAward(42L, "eggs", null);
		var ids = awarded.stream().map(Mission::id).toList();
		assertTrue(ids.contains("tutorial.hatch_first_dino"));
	}

	@Test
	void fedDinoMissionFiresAfterFeed() {
		seedCompleted("tutorial.check_profile", "tutorial.claim_first_daily",
			"tutorial.visit_shop", "tutorial.buy_first_egg",
			"tutorial.hatch_first_dino");
		Enclosure enc = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.of(enc.id()), null);
		dinos.recordFed(d.id(), Instant.now());

		List<Mission> awarded = awarder.detectAndAward(42L, "feed", null);
		var ids = awarded.stream().map(Mission::id).toList();
		assertTrue(ids.contains("tutorial.feed_first_dino"));
	}

	// ─── implicit per-set ordering ───────────────────────────────────────

	@Test
	void laterMissionDoesNotFireWhenEarlierMissionPending() {
		// visit_shop's trigger is satisfied (the user ran /shop) but
		// check_profile and claim_first_daily are still pending. The
		// implicit-order rule must withhold visit_shop's award.
		List<Mission> awarded = awarder.detectAndAward(42L, "shop", null);
		assertTrue(awarded.isEmpty(),
			"visit_shop must not fire while earlier missions are pending; got " + awarded);
		assertFalse(playerHasCompleted("tutorial.visit_shop"));
	}

	@Test
	void cascadingStateMissionsFireInOneAwarderPass() {
		// check_profile is incomplete; claim_first_daily's state is already
		// true. Running /profile satisfies check_profile's command trigger;
		// claim_first_daily's state-trigger should fire on the same pass
		// because its only prereq just completed.
		players.recordDailyClaim(42L, Instant.now());

		List<Mission> awarded = awarder.detectAndAward(42L, "profile", null);
		var ids = awarded.stream().map(Mission::id).toList();
		assertTrue(ids.contains("tutorial.check_profile"),
			"check_profile fires first (command trigger)");
		assertTrue(ids.contains("tutorial.claim_first_daily"),
			"claim_first_daily cascades on the same pass once its prereq is done");
	}

	@Test
	void pendingPrereqStopsScanEvenIfLaterMissionSatisfied() {
		// check_profile is pending. /zoo dashboard is run, which would
		// normally satisfy check_park_dashboard. Implicit order requires
		// us to halt the set at check_profile and award nothing.
		List<Mission> awarded = awarder.detectAndAward(42L, "zoo", "dashboard");
		assertTrue(awarded.isEmpty(),
			"no mission should fire while check_profile blocks the set; got " + awarded);
	}

	// ─── persistent command-trigger history ──────────────────────────────

	@Test
	void priorCommandRunSatisfiesGatedMissionOnLaterPass() {
		// The reported UX scenario: /shop and /daily run before /profile.
		// Each early awarder pass is gated by check_profile, so nothing
		// awards — but command_runs preserves the fact that /shop
		// happened. When /profile finally runs and unblocks the set, the
		// awarder finds visit_shop's trigger satisfied retroactively via
		// command_runs and awards it on the same pass without forcing
		// the player to re-run /shop.
		commandRuns.record(42L, "shop", null);
		commandRuns.record(42L, "daily", null);
		players.recordDailyClaim(42L, Instant.now());

		List<Mission> awarded = awarder.detectAndAward(42L, "profile", null);
		var ids = awarded.stream().map(Mission::id).toList();
		assertTrue(ids.contains("tutorial.check_profile"),
			"check_profile fires on the current command");
		assertTrue(ids.contains("tutorial.claim_first_daily"),
			"claim_first_daily cascades on persistent state");
		assertTrue(ids.contains("tutorial.visit_shop"),
			"visit_shop cascades on the command_runs history without /shop being rerun");
	}

	@Test
	void priorCommandRunDoesNotBypassOrderingRule() {
		// /zoo dashboard was run early — command_runs has the row — but
		// the implicit-order rule still requires every earlier mission
		// in the set to complete first. Running /profile alone unlocks
		// check_profile only; check_park_dashboard waits for the rest of
		// the chain.
		commandRuns.record(42L, "zoo", "dashboard");

		List<Mission> awarded = awarder.detectAndAward(42L, "profile", null);
		var ids = awarded.stream().map(Mission::id).toList();
		assertTrue(ids.contains("tutorial.check_profile"));
		assertFalse(ids.contains("tutorial.check_park_dashboard"),
			"command_runs alone does not bypass the order rule");
	}

	@Test
	void subcommandSpecificTriggerOnlyMatchesRecordedSubcommand() {
		// command:zoo:dashboard must NOT fire just because the user ran
		// /zoo income earlier — the subcommand has to match exactly.
		seedCompleted("tutorial.check_profile", "tutorial.claim_first_daily",
			"tutorial.visit_shop", "tutorial.buy_first_egg",
			"tutorial.hatch_first_dino", "tutorial.feed_first_dino");
		commandRuns.record(42L, "zoo", "income");

		List<Mission> awarded = awarder.detectAndAward(42L, "dino", "inspect");
		assertFalse(awarded.stream().anyMatch(m -> "tutorial.check_park_dashboard".equals(m.id())),
			"recording /zoo income must not satisfy a command:zoo:dashboard trigger");
	}

	@Test
	void afterCommandRecordsTheCommandForFutureRuns() {
		// Drive the public surface to make sure CommandRouter's call into
		// afterCommand actually writes the command_runs row that later
		// awarder passes rely on. Without this, the retroactive
		// satisfaction tests above would be vacuous — they'd assert the
		// service works in isolation but miss the integration point.
		assertFalse(commandRuns.hasRun(42L, "shop", null));
		awarder.afterCommand(stubSlashEvent(42L, "Alice"), "shop");
		assertTrue(commandRuns.hasRun(42L, "shop", null),
			"afterCommand must record the command before running the awarder");
	}

	private static SlashCommandInteractionEvent stubSlashEvent(long userId, String name) {
		SlashCommandInteractionEvent event = org.mockito.Mockito.mock(SlashCommandInteractionEvent.class);
		net.dv8tion.jda.api.entities.User user = org.mockito.Mockito.mock(
			net.dv8tion.jda.api.entities.User.class);
		org.mockito.Mockito.when(user.getIdLong()).thenReturn(userId);
		org.mockito.Mockito.when(user.getEffectiveName()).thenReturn(name);
		org.mockito.Mockito.when(event.getUser()).thenReturn(user);
		org.mockito.Mockito.when(event.getSubcommandName()).thenReturn(null);
		return event;
	}

	// ─── idempotency ─────────────────────────────────────────────────────

	@Test
	void rerunningAwarderDoesNotDoublePay() {
		seedCompleted("tutorial.check_profile");
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
		seedCompleted("tutorial.check_profile");
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

	private void seedCompleted(String... missionIds) {
		// Skip the awarder's reward path — we just need the progress rows
		// in place so later missions are eligible under the implicit-order
		// rule. Used by tests that exercise a single mission in isolation.
		for (String id : missionIds) {
			progress.markCompleted(42L, id);
		}
	}
}
