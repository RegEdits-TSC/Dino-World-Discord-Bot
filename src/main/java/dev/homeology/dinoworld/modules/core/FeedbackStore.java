package dev.homeology.dinoworld.modules.core;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Persistent backing for {@code /feedback}'s cooldown + blacklist features
 * (core migration V3).
 *
 * <p>The cooldown is a rolling 24h window per user keyed by their Discord
 * snowflake; persistence means a JVM restart can't be used to bypass it.
 * The blacklist is manually managed via {@code /debug feedback block}; once
 * a user is on it, {@code /feedback} short-circuits before any DM is sent.
 *
 * <p>All read paths return defensively (logged warning + empty/false on
 * SQLException) so a transient DB hiccup never crashes the command. Write
 * paths surface failures as {@link IllegalStateException} so the command
 * handler can convert them to a user-facing error embed.
 */
public final class FeedbackStore {

	private static final Logger log = LoggerFactory.getLogger(FeedbackStore.class);

	private final DataSource dataSource;

	public FeedbackStore(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	// ─── cooldown ────────────────────────────────────────────────────────

	/**
	 * @return last submission timestamp for this user, or empty if they
	 *         have never sent feedback (or the read failed)
	 */
	public Optional<Instant> lastSentAt(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT last_sent_at FROM feedback_log WHERE user_id = ?")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) {
					log.debug("feedback_log db read user={} → no row", userId);
					return Optional.empty();
				}
				log.debug("feedback_log db read user={} → loaded", userId);
				return Optional.of(Instant.parse(rs.getString(1)));
			}
		} catch (SQLException e) {
			log.warn("feedback_log read failed for user={}: {}", userId, e.toString());
			return Optional.empty();
		}
	}

	/**
	 * Record a successful feedback submission. Upserts so repeated sends
	 * by the same user keep one row, not many.
	 */
	public void recordSent(long userId, Instant when) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO feedback_log(user_id, last_sent_at)
			     VALUES (?, ?)
			     ON CONFLICT(user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at
			     """)) {
			ps.setLong(1, userId);
			ps.setString(2, when.toString());
			ps.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("feedback_log write failed for user=" + userId, e);
		}
	}

	// ─── blacklist ───────────────────────────────────────────────────────

	/**
	 * @return true if {@code userId} is on the blacklist; false on read
	 *         failure (fail-open — an outage shouldn't lock out genuine users)
	 */
	public boolean isBlocked(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT 1 FROM feedback_blacklist WHERE user_id = ?")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				boolean blocked = rs.next();
				log.debug("feedback_blacklist db read user={} → {}",
					userId, blocked ? "blocked" : "no row");
				return blocked;
			}
		} catch (SQLException e) {
			log.warn("feedback_blacklist read failed for user={}: {}", userId, e.toString());
			return false;
		}
	}

	/**
	 * Add (or refresh) a user on the blacklist. {@code reason} is optional
	 * — pass null or blank if no note. Idempotent: re-blocking an
	 * already-blocked user updates the timestamp and reason.
	 */
	public void block(long userId, String reason, Instant when) {
		String trimmedReason = (reason == null || reason.isBlank()) ? null : reason.trim();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO feedback_blacklist(user_id, blocked_at, reason)
			     VALUES (?, ?, ?)
			     ON CONFLICT(user_id) DO UPDATE SET
			         blocked_at = excluded.blocked_at,
			         reason     = excluded.reason
			     """)) {
			ps.setLong(1, userId);
			ps.setString(2, when.toString());
			ps.setString(3, trimmedReason);
			ps.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("feedback_blacklist write failed for user=" + userId, e);
		}
	}

	/**
	 * @return true if {@code userId} was on the blacklist and is now removed,
	 *         false if they weren't on it
	 */
	public boolean unblock(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "DELETE FROM feedback_blacklist WHERE user_id = ?")) {
			ps.setLong(1, userId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("feedback_blacklist delete failed for user=" + userId, e);
		}
	}

	/**
	 * @return every blacklisted user, ordered oldest → newest by block time.
	 *         Empty list on read failure (logged).
	 */
	public List<BlockedEntry> listBlocked() {
		List<BlockedEntry> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT user_id, blocked_at, reason FROM feedback_blacklist ORDER BY blocked_at");
		     ResultSet rs = ps.executeQuery()) {
			while (rs.next()) {
				out.add(new BlockedEntry(
					rs.getLong(1),
					Instant.parse(rs.getString(2)),
					rs.getString(3)));
			}
		} catch (SQLException e) {
			log.warn("feedback_blacklist list failed: {}", e.toString());
		}
		log.debug("feedback_blacklist db read all → {} rows", out.size());
		return out;
	}

	/** Row from {@code feedback_blacklist} for {@code /debug feedback list}. */
	public record BlockedEntry(long userId, Instant blockedAt, String reason) {}
}
