package dev.homeology.dinoworld.modules.zoo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssue;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssueService;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for the open-critical-issue penalty path on
 * {@link ParkRatingService}. The base park is fixed (one velociraptor in
 * a forest enclosure) so the multiplier delta is the only variable.
 */
class ParkRatingPenaltyTest {

	private HikariDataSource ds;
	private DinoInstanceService dinos;
	private EnclosureService enclosures;
	private DinoCatalog catalog;
	private ZooIssueService issues;
	private ParkRatingService rating;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "zoo"));

		PlayerService players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");

		dinos = new DinoInstanceService(ds);
		enclosures = new EnclosureService(ds);
		catalog = new DinoCatalog(new RarityCatalog());
		issues = new ZooIssueService(ds);
		rating = new ParkRatingService(dinos, enclosures, catalog, issues);

		// Fixed base park.
		Enclosure forest = enclosures.create(42L, "forest", 5, 5, "Forest");
		dinos.create(42L, "velociraptor", OptionalLong.of(forest.id()), null);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void noIssuesNoPenalty() {
		ParkRatingService.ParkRating r = rating.compute(42L);
		assertEquals(0.0, r.issuePenalty(), 1e-9);
	}

	@Test
	void warningIssuesDoNotPenalize() {
		issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING,
			Optional.of("dino"), OptionalLong.of(1L), "warn");
		issues.raise(42L, ZooIssue.Type.WAGES_UNDERFUNDED,
			ZooIssue.Severity.WARNING,
			Optional.empty(), OptionalLong.empty(), "warn");

		ParkRatingService.ParkRating r = rating.compute(42L);
		assertEquals(0.0, r.issuePenalty(), 1e-9,
			"warnings don't reduce rating — only criticals do");
	}

	@Test
	void threeCriticalsApplyFifteenPercentPenalty() {
		for (long i = 0; i < 3; i++) {
			issues.raise(42L, ZooIssue.Type.HOMELESS_DINO,
				ZooIssue.Severity.CRITICAL,
				Optional.of("dino"), OptionalLong.of(i + 100L),
				"crit " + i);
		}

		ParkRatingService.ParkRating r = rating.compute(42L);
		assertEquals(0.15, r.issuePenalty(), 1e-9);
	}

	@Test
	void penaltyCapsAt25Percent() {
		// 7 criticals → would be 35% but capped at 25%.
		for (long i = 0; i < 7; i++) {
			issues.raise(42L, ZooIssue.Type.HOMELESS_DINO,
				ZooIssue.Severity.CRITICAL,
				Optional.of("dino"), OptionalLong.of(i + 100L),
				"crit " + i);
		}

		ParkRatingService.ParkRating r = rating.compute(42L);
		assertEquals(ParkRatingService.ISSUE_PENALTY_CAP, r.issuePenalty(), 1e-9);
	}

	@Test
	void penaltyReducesFinalRating() {
		ParkRatingService.ParkRating before = rating.compute(42L);

		// Raise one critical → −5% to multiplier.
		issues.raise(42L, ZooIssue.Type.HOMELESS_DINO,
			ZooIssue.Severity.CRITICAL,
			Optional.of("dino"), OptionalLong.of(1L), "homeless");

		ParkRatingService.ParkRating after = rating.compute(42L);
		assertTrue(after.rating() < before.rating(),
			"open critical reduces final rating");
		assertEquals(before.multiplier() - 0.05, after.multiplier(), 1e-9);
	}
}
