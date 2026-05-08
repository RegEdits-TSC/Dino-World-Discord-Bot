package dev.homeology.dinoworld.settings;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Integration tests for {@link GuildSettings}.
 *
 * <p>Runs against a real SQLite file with the {@code core} module's
 * V2 migration applied, so the {@code guild_settings} table exists.
 */
class GuildSettingsTest {

	private HikariDataSource ds;
	private GuildSettings settings;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);

		// Apply the real core migrations so the schema matches production.
		new MigrationRunner(ds).run(List.of("core"));

		settings = new GuildSettings(ds, new CacheManager());
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void missingKeyReturnsEmpty() {
		assertTrue(settings.get(123L, "absent.key").isEmpty());
	}

	@Test
	void roundtripSetGet() {
		settings.set(123L, "game.spawnRate", "0.5");
		assertEquals("0.5", settings.get(123L, "game.spawnRate").orElseThrow());
	}

	@Test
	void overwriteKeepsLatestValue() {
		settings.set(123L, "k", "v1");
		settings.set(123L, "k", "v2");
		assertEquals("v2", settings.get(123L, "k").orElseThrow());
	}

	@Test
	void removeMakesKeyMissing() {
		settings.set(123L, "k", "v");
		settings.remove(123L, "k");
		assertTrue(settings.get(123L, "k").isEmpty());
	}

	@Test
	void getOrDefaultReturnsFallback() {
		assertEquals("fallback", settings.getOrDefault(123L, "absent", "fallback"));
		settings.set(123L, "absent", "real");
		assertEquals("real", settings.getOrDefault(123L, "absent", "fallback"));
	}

	@Test
	void allOrdersByKey() {
		settings.set(123L, "z.last", "1");
		settings.set(123L, "a.first", "2");
		settings.set(123L, "m.middle", "3");
		var all = settings.all(123L);
		assertEquals(java.util.List.of("a.first", "m.middle", "z.last"),
			java.util.List.copyOf(all.keySet()));
	}

	@Test
	void differentGuildsAreIsolated() {
		settings.set(1L, "k", "for-1");
		settings.set(2L, "k", "for-2");
		assertEquals("for-1", settings.get(1L, "k").orElseThrow());
		assertEquals("for-2", settings.get(2L, "k").orElseThrow());
	}
}
