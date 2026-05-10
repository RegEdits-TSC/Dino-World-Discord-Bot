package dev.homeology.dinoworld.modules.zoo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.LevelingService;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssueService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Sanity checks on {@link ZooCommand}'s structural surface — that the
 * slash data declares both subcommands and that
 * {@link ZooCommand#deferEphemeral(String)} honors the public-vs-private
 * split required by the plan.
 *
 * <p>Stops short of executing the command body (that needs a JDA event
 * mock) — the integration of the command with subcommand routing is
 * already covered transitively by manual /zoo runs.
 */
class ZooCommandTest {

	private HikariDataSource ds;
	private ZooCommand cmd;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "zoo"));

		PlayerService players = new PlayerService(ds, new CacheManager());
		DinoCatalog catalog = new DinoCatalog(new RarityCatalog());
		DinoInstanceService dinos = new DinoInstanceService(ds);
		EnclosureService enclosures = new EnclosureService(ds);
		ZooIssueService issues = new ZooIssueService(ds);
		ParkRatingService rating = new ParkRatingService(dinos, enclosures, catalog, issues);
		IncomeTickService incomeTick = new IncomeTickService(dinos, catalog, players);

		// staffEffects is null here — staff module migrations aren't loaded
		// in this fixture, so /zoo income would treat staff count + wages
		// as zero. ZooCommand handles the null cleanly (matches production
		// behavior when the staff module is disabled).
		cmd = new ZooCommand(players, catalog, dinos, enclosures, rating,
			new LevelingService(), issues, incomeTick, null);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void slashDataDeclaresAllThreeSubcommands() {
		var data = cmd.slashData();
		assertEquals("zoo", data.getName());
		List<String> subNames = data.getSubcommands().stream()
			.map(s -> s.getName())
			.toList();
		assertTrue(subNames.contains(ZooCommand.SUB_DASHBOARD), "dashboard subcommand registered");
		assertTrue(subNames.contains(ZooCommand.SUB_ISSUES), "issues subcommand registered");
		assertTrue(subNames.contains(ZooCommand.SUB_INCOME), "income subcommand registered");
	}

	@Test
	void deferEphemeralIsPrivateForIssuesAndIncomeButNotDashboard() {
		assertTrue(cmd.deferEphemeral(ZooCommand.SUB_ISSUES),
			"/zoo issues should reply privately");
		assertTrue(cmd.deferEphemeral(ZooCommand.SUB_INCOME),
			"/zoo income should reply privately");
		assertFalse(cmd.deferEphemeral(ZooCommand.SUB_DASHBOARD),
			"/zoo dashboard should remain public");
		// Defensive: null subcommand falls through to the no-arg default,
		// which is false on ZooCommand (no override).
		assertFalse(cmd.deferEphemeral(null));
	}
}
