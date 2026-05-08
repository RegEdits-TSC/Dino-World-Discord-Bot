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
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.List;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link IncomeTickService}.
 *
 * <p>Each scenario seeds a small fleet of dinos, runs one tick, and
 * asserts both the player's coin balance and the {@code coin_ledger} row.
 * The shipped {@code velociraptor.yaml} (base_income_per_hour 25) anchors
 * the math.
 */
class IncomeTickServiceTest {

	private HikariDataSource ds;
	private DinoInstanceService dinos;
	private PlayerService players;
	private IncomeTickService incomeTick;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "zoo"));

		players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");
		players.ensure(99L, "Bob");

		dinos = new DinoInstanceService(ds);
		DinoCatalog catalog = new DinoCatalog(new RarityCatalog());
		incomeTick = new IncomeTickService(dinos, catalog, players);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void emptyParkProducesNoLedgerRow() throws Exception {
		incomeTick.runOnce();
		assertEquals(0, ledgerCount(42L));
		assertEquals(0L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void singleHappyDinoCredits100PercentBaseIncome() throws Exception {
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		incomeTick.runOnce();
		// Velociraptor: base_income_per_hour = 25, happiness = 100
		assertEquals(25L, players.get(42L).orElseThrow().coins());
		assertEquals(1, ledgerCount(42L));
	}

	@Test
	void unhappyDinoContributesProportionally() throws Exception {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		dinos.applyHappiness(d.id(), 50, Instant.now());
		incomeTick.runOnce();
		// 25 × 0.5 = 12 (integer truncation)
		assertEquals(12L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void zeroHappinessProducesNoLedgerRow() throws Exception {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		dinos.applyHappiness(d.id(), 0, Instant.now());
		incomeTick.runOnce();
		assertEquals(0L, players.get(42L).orElseThrow().coins());
		assertEquals(0, ledgerCount(42L));
	}

	@Test
	void multipleDinosAggregatePerPlayer() throws Exception {
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		incomeTick.runOnce();
		// 3 × 25 = 75, but only one ledger row
		assertEquals(75L, players.get(42L).orElseThrow().coins());
		assertEquals(1, ledgerCount(42L));
	}

	@Test
	void multiplePlayersIsolated() throws Exception {
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		dinos.create(99L, "velociraptor", OptionalLong.empty(), null);
		dinos.create(99L, "velociraptor", OptionalLong.empty(), null);
		incomeTick.runOnce();
		assertEquals(25L, players.get(42L).orElseThrow().coins());
		assertEquals(50L, players.get(99L).orElseThrow().coins());
	}

	@Test
	void backToBackTicksAccumulate() throws Exception {
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		incomeTick.runOnce();
		incomeTick.runOnce();
		incomeTick.runOnce();
		assertEquals(75L, players.get(42L).orElseThrow().coins());
		assertEquals(3, ledgerCount(42L), "one ledger row per tick");
	}

	private int ledgerCount(long userId) throws Exception {
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM coin_ledger WHERE user_id = ? AND reason = 'income.tick'")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getInt(1) : 0;
			}
		}
	}
}
