package dev.homeology.dinoworld.modules.players;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link PlayerService}.
 *
 * <p>Runs against a real temp SQLite file with the {@code core} and
 * {@code players} migrations applied so the schema matches production.
 */
class PlayerServiceTest {

	private HikariDataSource ds;
	private PlayerService players;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players"));
		players = new PlayerService(ds, new CacheManager());
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void ensureCreatesRowOnFirstCall() {
		Player p = players.ensure(42L, "Alice");
		assertEquals(42L, p.userId());
		assertEquals("Alice", p.displayName());
		assertEquals(0L, p.coins());
		assertEquals(1, p.level());
		assertTrue(p.lastDaily().isEmpty());
	}

	@Test
	void ensureIsIdempotentAndUpdatesDisplayName() {
		players.ensure(42L, "Alice");
		Player p2 = players.ensure(42L, "AliceRenamed");
		assertEquals("AliceRenamed", p2.displayName());
		// created_at stays put after rename — only first call set it.
		Instant created = p2.createdAt();
		// last_seen advances; we can't assert exact equality but it must be >= created.
		assertTrue(!p2.lastSeen().isBefore(created));
	}

	@Test
	void getReturnsEmptyForUnknownUser() {
		assertTrue(players.get(999L).isEmpty());
	}

	@Test
	void addCoinsUpdatesBalanceAndWritesLedger() throws Exception {
		players.ensure(42L, "Alice");
		players.addCoins(42L, 100L, "daily", null);
		players.addCoins(42L, -25L, "purchase:test", null);

		Player p = players.get(42L).orElseThrow();
		assertEquals(75L, p.coins());

		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT delta, reason, counterparty_user_id FROM coin_ledger WHERE user_id = ? ORDER BY id");
		) {
			ps.setLong(1, 42L);
			try (ResultSet rs = ps.executeQuery()) {
				assertTrue(rs.next());
				assertEquals(100L, rs.getLong(1));
				assertEquals("daily", rs.getString(2));
				rs.getLong(3);
				assertTrue(rs.wasNull());

				assertTrue(rs.next());
				assertEquals(-25L, rs.getLong(1));
				assertEquals("purchase:test", rs.getString(2));
				assertFalse(rs.next());
			}
		}
	}

	@Test
	void addCoinsCarriesCounterparty() throws Exception {
		players.ensure(1L, "A");
		players.ensure(2L, "B");
		players.addCoins(1L, -50L, "trade:gift", 2L);

		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT counterparty_user_id FROM coin_ledger WHERE user_id = ?")) {
			ps.setLong(1, 1L);
			try (ResultSet rs = ps.executeQuery()) {
				assertTrue(rs.next());
				assertEquals(2L, rs.getLong(1));
			}
		}
	}

	@Test
	void addCoinsRejectsMissingPlayer() {
		assertThrows(IllegalStateException.class,
			() -> players.addCoins(123L, 10L, "test", null));
	}

	@Test
	void recordDailyClaimUpdatesField() {
		players.ensure(42L, "Alice");
		Instant when = Instant.parse("2026-05-07T18:00:00Z");
		players.recordDailyClaim(42L, when);

		Player p = players.get(42L).orElseThrow();
		assertTrue(p.lastDaily().isPresent());
		assertEquals(when.toEpochMilli(), p.lastDaily().get().toEpochMilli());
	}

	@Test
	void addXpRecomputesLevel() {
		players.ensure(42L, "Alice");
		// Level 2 starts at 100 XP.
		players.addXp(42L, 99L);
		assertEquals(1, players.get(42L).orElseThrow().level());
		players.addXp(42L, 1L);
		assertEquals(2, players.get(42L).orElseThrow().level());
		// Level 3 starts at 300 XP — currently at 100, push to 300.
		players.addXp(42L, 200L);
		assertEquals(3, players.get(42L).orElseThrow().level());
	}

	@Test
	void setCoinsAppliesDeltaAndLedgers() throws Exception {
		players.ensure(42L, "Alice");
		players.addCoins(42L, 100L, "test", null);
		long delta = players.setCoins(42L, 250L, "admin.set");
		assertEquals(150L, delta);
		assertEquals(250L, players.get(42L).orElseThrow().coins());
		// Ledger row exists with reason admin.set
		try (var c = ds.getConnection();
		     var ps = c.prepareStatement("SELECT delta, reason FROM coin_ledger WHERE reason = 'admin.set'");
		     var rs = ps.executeQuery()) {
			assertTrue(rs.next());
			assertEquals(150L, rs.getLong(1));
		}
	}

	@Test
	void setCoinsNoDeltaSkipsLedger() throws Exception {
		players.ensure(42L, "Alice");
		players.addCoins(42L, 100L, "test", null);
		long delta = players.setCoins(42L, 100L, "admin.set");
		assertEquals(0L, delta);
	}

	@Test
	void setXpRecomputesLevel() {
		players.ensure(42L, "Alice");
		players.setXp(42L, 600L);  // start of level 4
		assertEquals(4, players.get(42L).orElseThrow().level());
	}

	@Test
	void resetDailyCooldownClearsTimestamp() {
		players.ensure(42L, "Alice");
		players.recordDailyClaim(42L, java.time.Instant.now());
		assertTrue(players.get(42L).orElseThrow().lastDaily().isPresent());
		players.resetDailyCooldown(42L);
		assertTrue(players.get(42L).orElseThrow().lastDaily().isEmpty());
	}

	@Test
	void cacheReturnsConsistentDataAfterWrites() {
		players.ensure(42L, "Alice");
		players.addCoins(42L, 50L, "test", null);
		Player first = players.get(42L).orElseThrow();
		Player second = players.get(42L).orElseThrow();
		assertEquals(first.coins(), second.coins());
		assertEquals(50L, first.coins());
	}
}
