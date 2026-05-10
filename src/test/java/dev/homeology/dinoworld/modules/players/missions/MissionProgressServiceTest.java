package dev.homeology.dinoworld.modules.players.missions;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * DAO tests for {@link MissionProgressService}. The headline contract
 * is that {@code markCompleted} returns {@code false} on a duplicate
 * insert — the awarder relies on this to avoid double-granting rewards
 * if two threads race the same trigger satisfaction.
 */
class MissionProgressServiceTest {

	private HikariDataSource ds;
	private MissionProgressService progress;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players"));

		PlayerService players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");
		progress = new MissionProgressService(ds);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void markCompletedInsertsAndReportsTrue() {
		assertTrue(progress.markCompleted(42L, "tutorial.claim_first_daily"));
		assertTrue(progress.completedFor(42L).contains("tutorial.claim_first_daily"));
	}

	@Test
	void markCompletedTwiceReportsFalseSecondTime() {
		assertTrue(progress.markCompleted(42L, "tutorial.claim_first_daily"));
		assertFalse(progress.markCompleted(42L, "tutorial.claim_first_daily"),
			"awarder relies on this to avoid double-granting the reward");
	}

	@Test
	void completedForIsolatedPerUser() throws Exception {
		PlayerService players = new PlayerService(ds, new CacheManager());
		players.ensure(99L, "Bob");

		progress.markCompleted(42L, "tutorial.visit_shop");
		assertTrue(progress.completedFor(99L).isEmpty(),
			"another player's progress doesn't leak");
		assertEquals(1, progress.completedFor(42L).size());
	}
}
