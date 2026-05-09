package dev.homeology.dinoworld.scheduler;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Durable named-job scheduler with restart-aware back-fill.
 *
 * <p>Modules register recurring jobs with {@link #register(String, Duration, Runnable)};
 * each call:
 * <ol>
 *   <li>Reads the job's last-fired instant from the {@code tick_state} table
 *       (introduced in core migration V4).</li>
 *   <li>Computes how many ticks were missed during downtime, capped at
 *       {@link #MAX_BACKFILL} (24 h) — long outages don't get to mint
 *       unbounded offline rewards in a tycoon economy.</li>
 *   <li>Fires the handler synchronously that many times in a row, advancing
 *       {@code last_tick_at} after each, so a tycoon-style income job sees
 *       exactly the per-hour fires it would have seen if the bot had stayed
 *       up.</li>
 *   <li>Schedules the recurring tick on the shared
 *       {@link ScheduledExecutorService} from {@code Bootstrap} (daemon
 *       threads — JVM exit isn't blocked).</li>
 * </ol>
 *
 * <p>Job names are global; registering the same name twice is rejected. The
 * handler runs on the scheduler's own thread; any blocking work the handler
 * does will delay other jobs' ticks. If a handler throws, the exception is
 * logged and {@code last_tick_at} is still advanced — better to skip a
 * single bad tick than to back-fill the same broken work forever next time.
 *
 * <p>Internally backed by an injected {@link Clock} for testing; production
 * uses {@link Clock#systemUTC()}.
 */
public final class TickScheduler {

	private static final Logger log = LoggerFactory.getLogger(TickScheduler.class);

	/**
	 * Maximum amount of missed time replayed on registration.
	 */
	public static final Duration MAX_BACKFILL = Duration.ofHours(24);

	private final DataSource dataSource;
	private final ScheduledExecutorService scheduler;
	private final Clock clock;
	private final List<ScheduledFuture<?>> active = new CopyOnWriteArrayList<>();
	private final List<String> registeredJobs = new CopyOnWriteArrayList<>();

	public TickScheduler(DataSource dataSource, ScheduledExecutorService scheduler) {
		this(dataSource, scheduler, Clock.systemUTC());
	}

	/**
	 * Test seam — inject a controllable {@link Clock}.
	 */
	public TickScheduler(DataSource dataSource, ScheduledExecutorService scheduler, Clock clock) {
		this.dataSource = dataSource;
		this.scheduler = scheduler;
		this.clock = clock;
	}

	/**
	 * Register a recurring job, back-filling missed ticks first.
	 *
	 * @param jobName  globally unique job name (also the {@code tick_state.job_name} key)
	 * @param interval how often the handler should run
	 * @param handler  body to execute every tick; thrown exceptions are logged but don't stop the schedule
	 * @return number of back-fill ticks fired before the recurring schedule started
	 * @throws IllegalStateException if {@code jobName} was already registered, or if DB IO fails
	 */
	public int register(String jobName, Duration interval, Runnable handler) {
		if (jobName == null || jobName.isBlank()) {
			throw new IllegalArgumentException("jobName must be non-blank");
		}
		if (interval == null || interval.isZero() || interval.isNegative()) {
			throw new IllegalArgumentException("interval must be positive, got: " + interval);
		}
		if (registeredJobs.contains(jobName)) {
			throw new IllegalStateException("Job already registered: " + jobName);
		}

		Instant now = clock.instant();
		java.util.Optional<Instant> stored = readLastTick(jobName);
		// First-time registration: stamp last_tick_at = now so future restarts
		// have a stable baseline to compute back-fill against, and `/debug`
		// queries see when the job was first registered.
		if (stored.isEmpty()) writeLastTick(jobName, now);
		Instant last = stored.orElse(now);

		// Cap back-fill window so a 30-day outage doesn't replay 720 ticks.
		Instant earliest = now.minus(MAX_BACKFILL);
		if (last.isBefore(earliest)) {
			log.info("Job '{}' last_tick_at {} is older than MAX_BACKFILL ({}); capping",
				jobName, last, formatInterval(MAX_BACKFILL));
			last = earliest;
		}

		long intervalMillis = interval.toMillis();
		long elapsedMillis = now.toEpochMilli() - last.toEpochMilli();
		int catchUp = (int) Math.max(0, elapsedMillis / intervalMillis);

		for (int i = 0; i < catchUp; i++) {
			Instant tickAt = last.plusMillis(intervalMillis * (i + 1L));
			runOnce(jobName, handler, tickAt, /*backfill*/ true);
		}

		// Schedule the regular recurring tick. Initial delay = remainder of
		// the current interval after the most recent (possibly back-filled) tick.
		Instant lastFired = catchUp == 0 ? last : last.plusMillis(intervalMillis * (long) catchUp);
		long sinceLastFiredMillis = now.toEpochMilli() - lastFired.toEpochMilli();
		long initialDelayMillis = Math.max(0, intervalMillis - sinceLastFiredMillis);

		ScheduledFuture<?> f = scheduler.scheduleAtFixedRate(
			() -> runOnce(jobName, handler, clock.instant(), false),
			initialDelayMillis,
			intervalMillis,
			TimeUnit.MILLISECONDS);
		active.add(f);
		registeredJobs.add(jobName);

		log.info("Registered tick job '{}' interval={} (back-filled {} tick(s))",
			jobName, formatInterval(interval), catchUp);
		return catchUp;
	}

	/**
	 * Render a {@link Duration} in compact human form ({@code 30s},
	 * {@code 5m}, {@code 1h}, {@code 1h 30m}, {@code 24h}) for log output.
	 * Avoids the ISO-8601 default ({@code PT30S}, {@code PT1H}) that
	 * shows up when a {@code Duration} is passed through SLF4J's {@code {}}.
	 *
	 * <p>Package-private so {@link TickSchedulerTest} can pin the format.
	 */
	static String formatInterval(Duration d) {
		if (d == null || d.isZero() || d.isNegative()) return "0s";
		long h = d.toHours();
		long m = d.toMinutesPart();
		long s = d.toSecondsPart();
		StringBuilder sb = new StringBuilder();
		if (h > 0) {
			sb.append(h).append('h');
			if (m > 0) sb.append(' ').append(m).append('m');
		} else if (m > 0) {
			sb.append(m).append('m');
			if (s > 0) sb.append(' ').append(s).append('s');
		} else {
			sb.append(s).append('s');
		}
		return sb.toString();
	}

	/**
	 * Cancel every currently scheduled job. Called from
	 * {@link dev.homeology.dinoworld.lifecycle.LifecycleManager} during teardown.
	 */
	public void shutdown() {
		log.info("Cancelling {} tick job(s)", active.size());
		for (ScheduledFuture<?> f : active) {
			f.cancel(false);
		}
		active.clear();
	}

	// ─── internals ───────────────────────────────────────────────────────

	private void runOnce(String jobName, Runnable handler, Instant tickAt, boolean backfill) {
		try {
			handler.run();
		} catch (Exception e) {
			log.warn("Tick handler '{}' threw ({}); advancing anyway",
				jobName, backfill ? "backfill" : "live", e);
		}
		writeLastTick(jobName, tickAt);
	}

	private java.util.Optional<Instant> readLastTick(String jobName) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT last_tick_at FROM tick_state WHERE job_name = ?")) {
			ps.setString(1, jobName);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) return java.util.Optional.empty();
				return java.util.Optional.of(Instant.ofEpochMilli(rs.getLong(1)));
			}
		} catch (SQLException e) {
			throw new IllegalStateException("tick_state read failed for " + jobName, e);
		}
	}

	private void writeLastTick(String jobName, Instant when) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO tick_state(job_name, last_tick_at)
			     VALUES (?, ?)
			     ON CONFLICT(job_name) DO UPDATE SET last_tick_at = excluded.last_tick_at
			     """)) {
			ps.setString(1, jobName);
			ps.setLong(2, when.toEpochMilli());
			ps.executeUpdate();
		} catch (SQLException e) {
			log.warn("tick_state write failed for {}: {}", jobName, e.toString());
		}
	}

	/**
	 * @return registered job names, in registration order. Used for diagnostics.
	 */
	public List<String> registeredJobs() {
		return new ArrayList<>(registeredJobs);
	}
}
