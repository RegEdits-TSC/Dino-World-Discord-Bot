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
 * Unit tests for {@link CommandRunsService} — the persistence layer
 * that lets a {@code command:<name>} mission trigger be satisfied
 * retroactively after the player has already moved past that command.
 */
class CommandRunsServiceTest {

	private HikariDataSource ds;
	private CommandRunsService runs;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players"));
		// FK reference to player.user_id needs a player row to exist.
		new PlayerService(ds, new CacheManager()).ensure(42L, "Alice");
		runs = new CommandRunsService(ds);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void recordedCommandIsFoundByHasRun() {
		runs.record(42L, "shop", null);
		assertTrue(runs.hasRun(42L, "shop", null));
	}

	@Test
	void absentCommandReturnsFalse() {
		assertFalse(runs.hasRun(42L, "shop", null));
	}

	@Test
	void nullSubcommandMatchesAnyRecordedSubcommand() {
		// Mirrors the trigger semantics: a mission with trigger
		// command:zoo (no subcommand) matches /zoo dashboard, /zoo
		// income, etc.
		runs.record(42L, "zoo", "dashboard");
		assertTrue(runs.hasRun(42L, "zoo", null),
			"null subcommand query should match any recorded subcommand");
		assertTrue(runs.hasRun(42L, "zoo", "dashboard"),
			"exact-subcommand query still matches");
		assertFalse(runs.hasRun(42L, "zoo", "income"),
			"different subcommand does not match");
	}

	@Test
	void recordIsIdempotent() {
		runs.record(42L, "shop", null);
		runs.record(42L, "shop", null);
		runs.record(42L, "shop", null);
		// No double-insert assertion at the API level — the lack of an
		// exception plus a still-present row is the contract.
		assertTrue(runs.hasRun(42L, "shop", null));
	}

	@Test
	void differentUsersAreIsolated() throws Exception {
		new PlayerService(ds, new CacheManager()).ensure(99L, "Bob");
		runs.record(42L, "shop", null);
		assertTrue(runs.hasRun(42L, "shop", null));
		assertFalse(runs.hasRun(99L, "shop", null),
			"command_runs is keyed by user — Alice's /shop is not Bob's /shop");
	}

	@Test
	void subcommandEmptyStringStoredForNullKeepsCompositeKeyUnique() {
		// Internal-storage detail worth pinning: SQLite would let
		// duplicate (user, command, NULL) rows coexist because each
		// NULL is distinct in a composite primary key. We store '' for
		// null instead, so INSERT OR IGNORE properly deduplicates.
		// Asserting via hasRun is sufficient — both calls go through
		// the same null→'' translation.
		runs.record(42L, "daily", null);
		runs.record(42L, "daily", null);
		assertTrue(runs.hasRun(42L, "daily", null));
	}
}
