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

	@Test
	void proudTraitBoostsIncomeBy15Percent() throws Exception {
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null, DinoTrait.PROUD);
		incomeTick.runOnce();
		// 25 × 1.15 = 28.75 → round-half-up = 29
		assertEquals(29L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void lazyTraitReducesIncomeBy5Percent() throws Exception {
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null, DinoTrait.LAZY);
		incomeTick.runOnce();
		// 25 × 0.95 = 23.75 → round-half-up = 24
		assertEquals(24L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void plainTraitFieldYieldsBaseIncome() throws Exception {
		// Explicit null trait — confirms the contribution path handles the
		// "no trait rolled" outcome the same as a missing column.
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null, null);
		incomeTick.runOnce();
		assertEquals(25L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void socialTraitWithEnclosureMatesAdds5Percent() throws Exception {
		EnclosureService enclosures = new EnclosureService(ds);
		var enc = enclosures.create(42L, "forest", 5, 5, "Pack");
		dinos.create(42L, "velociraptor", OptionalLong.of(enc.id()), null, DinoTrait.SOCIAL);
		// A second raptor to satisfy the "≥ 2 dinos in this enclosure" rule.
		dinos.create(42L, "velociraptor", OptionalLong.of(enc.id()), null);

		incomeTick.runOnce();
		// Social raptor: 25 × 1.0 × 1.05 = 26.25 → 26
		// Plain raptor : 25
		// Sum: 51
		assertEquals(51L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void socialTraitAloneInEnclosureGetsNoBonus() throws Exception {
		EnclosureService enclosures = new EnclosureService(ds);
		var enc = enclosures.create(42L, "forest", 5, 5, "Solo");
		dinos.create(42L, "velociraptor", OptionalLong.of(enc.id()), null, DinoTrait.SOCIAL);

		incomeTick.runOnce();
		assertEquals(25L, players.get(42L).orElseThrow().coins());
	}

	// ─── level multiplier ────────────────────────────────────────────────

	@Test
	void l1DinoGetsIdentityMultiplier() throws Exception {
		// Sanity check that nothing about adding the level multiplier
		// regressed the baseline expectation at L1.
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		incomeTick.runOnce();
		assertEquals(25L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void l25DinoEarns60PercentMore() throws Exception {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		int toL25 = (int) DinoLeveling.cumulativeXpForLevel(25);
		dinos.awardXp(d.id(), toL25);

		incomeTick.runOnce();
		// 25 base × happiness 1.0 × 1.6 (L25 mult) = 40
		assertEquals(40L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void l50DinoEarnsCapMultiplier() throws Exception {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		int toCap = (int) DinoLeveling.cumulativeXpForLevel(DinoLeveling.MAX_LEVEL);
		dinos.awardXp(d.id(), toCap);

		incomeTick.runOnce();
		// 25 × 2.225 = 55.625 → round = 56
		assertEquals(56L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void levelStacksMultiplicativelyOnTraitBonus() throws Exception {
		// Proud (×1.15) at L25 (×1.6) → 25 × 1.15 × 1.6 = 46.0 → 46
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null, DinoTrait.PROUD);
		int toL25 = (int) DinoLeveling.cumulativeXpForLevel(25);
		dinos.awardXp(d.id(), toL25);

		incomeTick.runOnce();
		assertEquals(46L, players.get(42L).orElseThrow().coins());
	}

	// ─── shiny multiplier ────────────────────────────────────────────────

	@Test
	void shinyDinoEarns150PercentBaseIncome() throws Exception {
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null, null, true);
		incomeTick.runOnce();
		// 25 × 1.5 = 37.5 → 38
		assertEquals(38L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void shinyStacksOnTraitAndLevel() throws Exception {
		// Proud (×1.15), L25 (×1.6), Shiny (×1.5) → 25 × 1.15 × 1.6 × 1.5
		// = 69.0
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null,
			DinoTrait.PROUD, true);
		int toL25 = (int) DinoLeveling.cumulativeXpForLevel(25);
		dinos.awardXp(d.id(), toL25);

		incomeTick.runOnce();
		assertEquals(69L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void normalDinoIsUnaffectedByShinyMultiplier() throws Exception {
		// Sanity: explicit shiny=false yields plain baseline.
		dinos.create(42L, "velociraptor", OptionalLong.empty(), null, null, false);
		incomeTick.runOnce();
		assertEquals(25L, players.get(42L).orElseThrow().coins());
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
