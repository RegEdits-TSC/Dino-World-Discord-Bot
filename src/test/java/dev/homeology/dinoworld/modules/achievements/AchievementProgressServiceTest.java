package dev.homeology.dinoworld.modules.achievements;

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
 * Pins the INSERT-or-NO-OP semantics of
 * {@link AchievementProgressService} — the awarder relies on the
 * second-write returning false to avoid double-paying rewards.
 */
class AchievementProgressServiceTest {

	private HikariDataSource ds;
	private AchievementProgressService progress;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "achievements"));

		// Need a player row to satisfy the FK on achievement_progress.user_id.
		PlayerService players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");

		progress = new AchievementProgressService(ds);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void firstWriteReturnsTrue() {
		assertTrue(progress.markUnlocked(42L, "v1.first_hatch"));
	}

	@Test
	void duplicateWriteReturnsFalseAndDoesNotThrow() {
		assertTrue(progress.markUnlocked(42L, "v1.first_hatch"));
		assertFalse(progress.markUnlocked(42L, "v1.first_hatch"),
			"second call must no-op so the awarder won't double-pay");
	}

	@Test
	void unlockedForReturnsAllRecordedIds() {
		progress.markUnlocked(42L, "v1.first_hatch");
		progress.markUnlocked(42L, "v1.first_feed");
		var set = progress.unlockedFor(42L);
		assertEquals(2, set.size());
		assertTrue(set.contains("v1.first_hatch"));
		assertTrue(set.contains("v1.first_feed"));
	}

	@Test
	void unlockedForEmptyUserReturnsEmptySet() {
		assertTrue(progress.unlockedFor(42L).isEmpty());
	}
}
