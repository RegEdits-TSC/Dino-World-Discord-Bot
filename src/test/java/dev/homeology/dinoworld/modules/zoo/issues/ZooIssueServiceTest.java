package dev.homeology.dinoworld.modules.zoo.issues;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
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
import java.util.Optional;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link ZooIssueService} backed by a fresh temp
 * SQLite. Covers the UPSERT semantics on the partial unique index
 * (raise-twice no-ops + bumps last_seen_at), owner-checked resolve,
 * resolveByMatch sweeps, severity-filtered counts, and the resolved-row
 * purge.
 */
class ZooIssueServiceTest {

	private HikariDataSource ds;
	private ZooIssueService issues;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "zoo"));
		issues = new ZooIssueService(ds);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void raiseCreatesOpenRow() {
		long id = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING,
			Optional.of("dino"), OptionalLong.of(7L),
			"Trex unhappy");
		assertTrue(id > 0);

		List<ZooIssue> open = issues.findOpenForOwner(42L);
		assertEquals(1, open.size());
		ZooIssue got = open.get(0);
		assertEquals(ZooIssue.Type.LOW_HAPPINESS, got.type());
		assertEquals(ZooIssue.Severity.WARNING, got.severity());
		assertEquals(Optional.of("dino"), got.targetKind());
		assertEquals(OptionalLong.of(7L), got.targetId());
		assertEquals("Trex unhappy", got.detail());
		assertTrue(got.isOpen());
	}

	@Test
	void raiseTwiceUpdatesInPlace() throws Exception {
		long firstId = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING,
			Optional.of("dino"), OptionalLong.of(7L),
			"first detail");
		Instant firstSeen = issues.findById(firstId).orElseThrow().firstSeenAt();

		// Sleep so last_seen_at advances detectably.
		Thread.sleep(15);

		long secondId = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.CRITICAL,
			Optional.of("dino"), OptionalLong.of(7L),
			"escalated");

		assertEquals(firstId, secondId, "UPSERT returns the same row id");
		ZooIssue updated = issues.findById(firstId).orElseThrow();
		assertEquals(ZooIssue.Severity.CRITICAL, updated.severity(),
			"severity escalated in place");
		assertEquals("escalated", updated.detail(), "detail updated in place");
		assertEquals(firstSeen, updated.firstSeenAt(), "first_seen_at preserved");
		assertTrue(updated.lastSeenAt().isAfter(firstSeen)
			|| updated.lastSeenAt().equals(firstSeen),
			"last_seen_at advanced");

		assertEquals(1, issues.findOpenForOwner(42L).size(),
			"still only one open row");
	}

	@Test
	void resolveSetsResolvedAt() {
		long id = issues.raise(42L, ZooIssue.Type.HOMELESS_DINO,
			ZooIssue.Severity.CRITICAL,
			Optional.of("dino"), OptionalLong.of(9L),
			"homeless");

		assertTrue(issues.resolve(id, 42L));

		assertTrue(issues.findOpenForOwner(42L).isEmpty());
		ZooIssue closed = issues.findById(id).orElseThrow();
		assertFalse(closed.isOpen());
		assertTrue(closed.resolvedAt().isPresent());
	}

	@Test
	void resolveRefusesCrossUser() {
		long id = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING,
			Optional.of("dino"), OptionalLong.of(7L), "x");

		assertFalse(issues.resolve(id, 99L), "wrong owner cannot resolve");

		assertTrue(issues.findById(id).orElseThrow().isOpen(),
			"row is still open after cross-user resolve attempt");
	}

	@Test
	void closedAndOpenRowsCoexistForSameTarget() {
		long firstId = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING,
			Optional.of("dino"), OptionalLong.of(7L), "first");
		assertTrue(issues.resolve(firstId, 42L));

		// Same (owner, type, target) but the previous row is closed — partial
		// unique index lets a fresh open row coexist.
		long secondId = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING,
			Optional.of("dino"), OptionalLong.of(7L), "second");
		assertNotEquals(firstId, secondId);

		assertEquals(2, totalRows(42L), "both historical rows persist");
		assertEquals(1, issues.findOpenForOwner(42L).size(), "only one open");
	}

	@Test
	void resolveByMatchClosesOnlyMatchingOpenRow() {
		long happId = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING, Optional.of("dino"), OptionalLong.of(7L), "h");
		long homId = issues.raise(42L, ZooIssue.Type.HOMELESS_DINO,
			ZooIssue.Severity.CRITICAL, Optional.of("dino"), OptionalLong.of(7L), "x");
		long otherDinoId = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING, Optional.of("dino"), OptionalLong.of(8L), "y");

		int closed = issues.resolveByMatch(42L, ZooIssue.Type.LOW_HAPPINESS,
			Optional.of("dino"), OptionalLong.of(7L));
		assertEquals(1, closed);

		assertFalse(issues.findById(happId).orElseThrow().isOpen());
		assertTrue(issues.findById(homId).orElseThrow().isOpen(),
			"different type stays open");
		assertTrue(issues.findById(otherDinoId).orElseThrow().isOpen(),
			"different target stays open");
	}

	@Test
	void resolveAllForOwnerClosesEverythingOpenForOnePlayer() {
		issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING, Optional.of("dino"), OptionalLong.of(7L), "a");
		issues.raise(42L, ZooIssue.Type.HOMELESS_DINO,
			ZooIssue.Severity.CRITICAL, Optional.of("dino"), OptionalLong.of(8L), "b");
		issues.raise(99L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING, Optional.of("dino"), OptionalLong.of(9L), "c");

		int closed = issues.resolveAllForOwner(42L);
		assertEquals(2, closed);
		assertTrue(issues.findOpenForOwner(42L).isEmpty());
		assertEquals(1, issues.findOpenForOwner(99L).size(), "other player untouched");
	}

	@Test
	void perPlayerWagesIssueIsUniqueViaCoalesce() {
		long firstId = issues.raise(42L, ZooIssue.Type.WAGES_UNDERFUNDED,
			ZooIssue.Severity.WARNING,
			Optional.empty(), OptionalLong.empty(), "24h notice");
		long secondId = issues.raise(42L, ZooIssue.Type.WAGES_UNDERFUNDED,
			ZooIssue.Severity.CRITICAL,
			Optional.empty(), OptionalLong.empty(), "12h notice");

		assertEquals(firstId, secondId, "NULL targets still UPSERT");
		assertEquals(1, issues.findOpenForOwner(42L).size());
		assertEquals(ZooIssue.Severity.CRITICAL,
			issues.findById(firstId).orElseThrow().severity());
	}

	@Test
	void countOpenForOwnerHonorsSeverityFilter() {
		issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING, Optional.of("dino"), OptionalLong.of(1L), "w1");
		issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING, Optional.of("dino"), OptionalLong.of(2L), "w2");
		issues.raise(42L, ZooIssue.Type.HOMELESS_DINO,
			ZooIssue.Severity.CRITICAL, Optional.of("dino"), OptionalLong.of(3L), "c1");

		assertEquals(3, issues.countOpenForOwner(42L));
		assertEquals(1, issues.countOpenForOwner(42L, ZooIssue.Severity.CRITICAL));
		assertEquals(2, issues.countOpenForOwner(42L, ZooIssue.Severity.WARNING));
	}

	@Test
	void purgeRemovesOldResolvedRowsOnly() throws Exception {
		long id = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING, Optional.of("dino"), OptionalLong.of(1L), "x");
		assertTrue(issues.resolve(id, 42L));
		// Force resolved_at into the distant past so the purge picks it up.
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE zoo_issue SET resolved_at = ? WHERE id = ?")) {
			ps.setLong(1, Instant.parse("2020-01-01T00:00:00Z").toEpochMilli());
			ps.setLong(2, id);
			ps.executeUpdate();
		}
		// Plus a still-open row that purge should not touch.
		long openId = issues.raise(42L, ZooIssue.Type.HOMELESS_DINO,
			ZooIssue.Severity.CRITICAL, Optional.of("dino"), OptionalLong.of(2L), "open");

		int removed = issues.purgeResolvedOlderThan(Instant.parse("2025-01-01T00:00:00Z"));
		assertEquals(1, removed);
		assertTrue(issues.findById(id).isEmpty(), "old resolved row purged");
		assertTrue(issues.findById(openId).isPresent(), "open row preserved");
	}

	@Test
	void findOpenSortsCriticalBeforeWarning() {
		long warn = issues.raise(42L, ZooIssue.Type.LOW_HAPPINESS,
			ZooIssue.Severity.WARNING, Optional.of("dino"), OptionalLong.of(1L), "warn");
		long crit = issues.raise(42L, ZooIssue.Type.HOMELESS_DINO,
			ZooIssue.Severity.CRITICAL, Optional.of("dino"), OptionalLong.of(2L), "crit");

		List<ZooIssue> open = issues.findOpenForOwner(42L);
		assertEquals(2, open.size());
		assertEquals(crit, open.get(0).id(), "critical first");
		assertEquals(warn, open.get(1).id(), "warning second");
	}

	private int totalRows(long ownerUserId) {
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM zoo_issue WHERE owner_user_id = ?")) {
			ps.setLong(1, ownerUserId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getInt(1) : 0;
			}
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
	}
}
