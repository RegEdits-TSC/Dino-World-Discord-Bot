package dev.homeology.dinoworld.scheduler;

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
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link TickScheduler}.
 *
 * <p>Each test runs against a fresh temp SQLite file with the {@code core}
 * migrations applied (so {@code tick_state} exists). A fixed
 * {@link Clock} is injected so back-fill calculations are deterministic.
 *
 * <p>The recurring scheduler itself is exercised only enough to confirm it
 * doesn't immediately fire — actual long-run behavior is out of scope for
 * unit tests; back-fill is the meaningful logic.
 */
class TickSchedulerTest {

	private HikariDataSource ds;
	private ScheduledExecutorService exec;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core"));
		exec = Executors.newSingleThreadScheduledExecutor();
	}

	@AfterEach
	void tearDown() {
		exec.shutdownNow();
		ds.close();
	}

	@Test
	void firstRegistrationFiresNoBackfill() {
		Clock clock = Clock.fixed(Instant.parse("2026-05-07T12:00:00Z"), ZoneOffset.UTC);
		TickScheduler ts = new TickScheduler(ds, exec, clock);

		AtomicInteger fires = new AtomicInteger();
		int catchUp = ts.register("job.first", Duration.ofHours(1), fires::incrementAndGet);

		assertEquals(0, catchUp);
		assertEquals(0, fires.get());
		assertEquals(Instant.parse("2026-05-07T12:00:00Z"), readLastTick("job.first"));
		ts.shutdown();
	}

	@Test
	void registrationBackfillsMissedTicks() {
		// Pretend last_tick_at was 3.5 hours ago for a 1-hour job — expect 3 back-fills.
		Instant now = Instant.parse("2026-05-07T12:00:00Z");
		Instant prior = now.minus(Duration.ofMinutes(210));
		writeLastTick("job.income", prior);

		Clock clock = Clock.fixed(now, ZoneOffset.UTC);
		TickScheduler ts = new TickScheduler(ds, exec, clock);

		AtomicInteger fires = new AtomicInteger();
		int catchUp = ts.register("job.income", Duration.ofHours(1), fires::incrementAndGet);

		assertEquals(3, catchUp);
		assertEquals(3, fires.get());
		// Last tick advanced exactly 3 hours.
		assertEquals(prior.plus(Duration.ofHours(3)), readLastTick("job.income"));
		ts.shutdown();
	}

	@Test
	void backfillIsCappedAt24Hours() {
		// Pretend last tick was 30 days ago — back-fill should cap at 24 ticks (1h interval).
		Instant now = Instant.parse("2026-05-07T12:00:00Z");
		Instant prior = now.minus(Duration.ofDays(30));
		writeLastTick("job.income", prior);

		Clock clock = Clock.fixed(now, ZoneOffset.UTC);
		TickScheduler ts = new TickScheduler(ds, exec, clock);

		AtomicInteger fires = new AtomicInteger();
		int catchUp = ts.register("job.income", Duration.ofHours(1), fires::incrementAndGet);

		assertEquals(24, catchUp);
		assertEquals(24, fires.get());
		ts.shutdown();
	}

	@Test
	void duplicateRegistrationThrows() {
		Clock clock = Clock.fixed(Instant.parse("2026-05-07T12:00:00Z"), ZoneOffset.UTC);
		TickScheduler ts = new TickScheduler(ds, exec, clock);
		ts.register("job.x", Duration.ofMinutes(1), () -> {});
		assertThrows(IllegalStateException.class,
			() -> ts.register("job.x", Duration.ofMinutes(1), () -> {}));
		ts.shutdown();
	}

	@Test
	void handlerExceptionStillAdvancesLastTick() {
		Instant now = Instant.parse("2026-05-07T12:00:00Z");
		Instant prior = now.minus(Duration.ofMinutes(90));
		writeLastTick("job.flaky", prior);

		Clock clock = Clock.fixed(now, ZoneOffset.UTC);
		TickScheduler ts = new TickScheduler(ds, exec, clock);

		// Throws on every fire; back-fill still advances last_tick_at so we don't loop forever.
		int catchUp = ts.register("job.flaky", Duration.ofHours(1), () -> {
			throw new RuntimeException("nope");
		});

		assertEquals(1, catchUp);
		assertEquals(prior.plus(Duration.ofHours(1)), readLastTick("job.flaky"));
		ts.shutdown();
	}

	@Test
	void rejectsZeroOrNegativeInterval() {
		TickScheduler ts = new TickScheduler(ds, exec,
			Clock.fixed(Instant.now(), ZoneOffset.UTC));
		assertThrows(IllegalArgumentException.class,
			() -> ts.register("z", Duration.ZERO, () -> {}));
		assertThrows(IllegalArgumentException.class,
			() -> ts.register("z", Duration.ofSeconds(-1), () -> {}));
		ts.shutdown();
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private void writeLastTick(String name, Instant when) {
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO tick_state(job_name, last_tick_at) VALUES (?, ?)
			     ON CONFLICT(job_name) DO UPDATE SET last_tick_at = excluded.last_tick_at
			     """)) {
			ps.setString(1, name);
			ps.setLong(2, when.toEpochMilli());
			ps.executeUpdate();
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
	}

	private Instant readLastTick(String name) {
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT last_tick_at FROM tick_state WHERE job_name = ?")) {
			ps.setString(1, name);
			try (ResultSet rs = ps.executeQuery()) {
				assertTrue(rs.next(), "no row for " + name);
				return Instant.ofEpochMilli(rs.getLong(1));
			}
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
	}
}
