package dev.homeology.dinoworld.modules.zoo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssue;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssueService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Behavior tests for {@link IssueDetector}.
 *
 * <p>Each scenario seeds the underlying tables via real services, runs
 * one detector pass, and asserts the open-issue set in {@code zoo_issue}.
 * The wage-runway cases short-circuit by passing
 * {@code incomePerHour} explicitly via the 4-arg overload, avoiding a
 * dependency on {@code IncomeTickService}.
 */
class IssueDetectorTest {

	private HikariDataSource ds;
	private DinoInstanceService dinos;
	private EnclosureService enclosures;
	private DinoCatalog catalog;
	private ZooIssueService issues;
	private IssueDetector detector;

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
		detector = new IssueDetector(issues, catalog);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	// ─── happiness ───────────────────────────────────────────────────────

	@Test
	void lowHappinessRaisedAtThreshold() {
		Enclosure e = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(e.id()), null);
		dinos.applyHappiness(d.id(), IssueDetector.HAPPINESS_RAISE_AT, Instant.now());

		detector.applyHappinessIssues(dinos.findAll());

		List<ZooIssue> open = issues.findOpenForOwner(42L);
		assertEquals(1, open.stream()
			.filter(i -> i.type() == ZooIssue.Type.LOW_HAPPINESS)
			.count(), "raised at threshold");
	}

	@Test
	void lowHappinessNotRaisedAboveThreshold() {
		Enclosure e = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(e.id()), null);
		dinos.applyHappiness(d.id(), IssueDetector.HAPPINESS_RAISE_AT + 1, Instant.now());

		detector.applyHappinessIssues(dinos.findAll());

		assertEquals(0, issues.findOpenForOwner(42L).stream()
			.filter(i -> i.type() == ZooIssue.Type.LOW_HAPPINESS)
			.count());
	}

	@Test
	void hysteresisStaysRaisedBetweenThresholds() {
		Enclosure e = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(e.id()), null);
		dinos.applyHappiness(d.id(), IssueDetector.HAPPINESS_RAISE_AT, Instant.now());
		detector.applyHappinessIssues(dinos.findAll());

		// Bump happiness into the hysteresis zone — between raise and clear.
		dinos.applyHappiness(d.id(),
			(IssueDetector.HAPPINESS_RAISE_AT + IssueDetector.HAPPINESS_CLEAR_AT) / 2,
			Instant.now());
		detector.applyHappinessIssues(dinos.findAll());

		assertEquals(1, issues.findOpenForOwner(42L).stream()
				.filter(i -> i.type() == ZooIssue.Type.LOW_HAPPINESS).count(),
			"row stays open inside hysteresis band");
	}

	@Test
	void lowHappinessAutoClearsAtClearThreshold() {
		Enclosure e = enclosures.create(42L, "forest", 5, 5, "Home");
		DinoInstance d = dinos.create(42L, "velociraptor",
			OptionalLong.of(e.id()), null);
		dinos.applyHappiness(d.id(), IssueDetector.HAPPINESS_RAISE_AT, Instant.now());
		detector.applyHappinessIssues(dinos.findAll());
		assertEquals(1, issues.findOpenForOwner(42L).stream()
			.filter(i -> i.type() == ZooIssue.Type.LOW_HAPPINESS).count());

		dinos.applyHappiness(d.id(), IssueDetector.HAPPINESS_CLEAR_AT, Instant.now());
		detector.applyHappinessIssues(dinos.findAll());

		assertEquals(0, issues.findOpenForOwner(42L).stream()
				.filter(i -> i.type() == ZooIssue.Type.LOW_HAPPINESS).count(),
			"auto-resolved at clear threshold");
	}

	// ─── homeless ────────────────────────────────────────────────────────

	@Test
	void homelessDetectedAndCleared() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.empty(), null);
		detector.applyHappinessIssues(dinos.findAll());

		assertEquals(1, issues.findOpenForOwner(42L).stream()
			.filter(i -> i.type() == ZooIssue.Type.HOMELESS_DINO).count());

		Enclosure e = enclosures.create(42L, "forest", 5, 5, "Home");
		dinos.assignToEnclosure(d.id(), OptionalLong.of(e.id()));
		detector.applyHappinessIssues(dinos.findAll());

		assertEquals(0, issues.findOpenForOwner(42L).stream()
				.filter(i -> i.type() == ZooIssue.Type.HOMELESS_DINO).count(),
			"cleared once assigned");
	}

	// ─── staff quit snapshot ─────────────────────────────────────────────

	@Test
	void recordStaffQuitSnapshotsRoleAndName() {
		detector.recordStaffQuit(42L, "Vet", Optional.of("Bones"), 99L);

		List<ZooIssue> open = issues.findOpenForOwner(42L);
		assertEquals(1, open.size());
		ZooIssue got = open.get(0);
		assertEquals(ZooIssue.Type.STAFF_UNPAID, got.type());
		assertEquals(ZooIssue.Severity.CRITICAL, got.severity());
		assertEquals(Optional.of("staff"), got.targetKind());
		assertEquals(OptionalLong.of(99L), got.targetId());
		assertTrue(got.detail().contains("Vet"));
		assertTrue(got.detail().contains("Bones"));
	}

	// ─── wages_underfunded runway tiers ──────────────────────────────────

	@Test
	void wageRunway23hRaisesWarning() {
		// netDrainPerHour = 100, balance = 2300 → runway = 23h → warning tier.
		detector.applyWageRunwayIssue(42L, 2300L, 100L, 0L);

		List<ZooIssue> open = issues.findOpenForOwner(42L);
		assertEquals(1, open.size());
		assertEquals(ZooIssue.Type.WAGES_UNDERFUNDED, open.get(0).type());
		assertEquals(ZooIssue.Severity.WARNING, open.get(0).severity());
		assertTrue(open.get(0).detail().contains("24 hours"));
	}

	@Test
	void wageRunwayEscalatesInPlace() throws Exception {
		// Start at 23h.
		detector.applyWageRunwayIssue(42L, 2300L, 100L, 0L);
		long firstId = issues.findOpenForOwner(42L).get(0).id();
		Instant firstSeen = issues.findById(firstId).orElseThrow().firstSeenAt();
		Thread.sleep(15);

		// Drop to 11h → critical, same row updated.
		detector.applyWageRunwayIssue(42L, 1100L, 100L, 0L);
		ZooIssue mid = issues.findById(firstId).orElseThrow();
		assertEquals(ZooIssue.Severity.CRITICAL, mid.severity());
		assertTrue(mid.detail().contains("12 hours"));
		assertEquals(firstSeen, mid.firstSeenAt(), "first_seen_at preserved across escalations");

		// Drop to <1h → critical, same row.
		detector.applyWageRunwayIssue(42L, 50L, 100L, 0L);
		ZooIssue last = issues.findById(firstId).orElseThrow();
		assertEquals(ZooIssue.Severity.CRITICAL, last.severity());
		assertTrue(last.detail().contains("1 hour"));

		assertEquals(1, issues.findOpenForOwner(42L).size(),
			"single row escalates rather than spawning duplicates");
	}

	@Test
	void wageRunwayResolvesWhenAbove24h() {
		detector.applyWageRunwayIssue(42L, 1100L, 100L, 0L); // 11h → critical
		assertEquals(1, issues.findOpenForOwner(42L).size());

		// 30h runway clears the row.
		detector.applyWageRunwayIssue(42L, 3000L, 100L, 0L);
		assertEquals(0, issues.findOpenForOwner(42L).size());
	}

	@Test
	void incomeOffsetSilencesRunwayWarning() {
		// wages = 100/hr, income = 100/hr → balance trends flat-or-up; no warning.
		detector.applyWageRunwayIssue(42L, 0L, 100L, 100L);
		assertEquals(0, issues.findOpenForOwner(42L).size());

		// Income exceeding wages also silences.
		detector.applyWageRunwayIssue(42L, 0L, 100L, 200L);
		assertEquals(0, issues.findOpenForOwner(42L).size());
	}

	@Test
	void incomeOffsetClosesAlreadyOpenRunwayIssue() {
		detector.applyWageRunwayIssue(42L, 50L, 100L, 0L); // critical
		assertEquals(1, issues.findOpenForOwner(42L).size());

		// Now hire a Marketer that pushes income ≥ wages.
		detector.applyWageRunwayIssue(42L, 50L, 100L, 100L);
		assertEquals(0, issues.findOpenForOwner(42L).size(),
			"open row resolved once income covers wages");
	}

	@Test
	void noStaffSilencesAndClearsRunway() {
		detector.applyWageRunwayIssue(42L, 50L, 100L, 0L); // critical
		assertEquals(1, issues.findOpenForOwner(42L).size());

		detector.applyWageRunwayIssue(42L, 50L, 0L, 0L); // no staff
		assertEquals(0, issues.findOpenForOwner(42L).size());
	}
}
