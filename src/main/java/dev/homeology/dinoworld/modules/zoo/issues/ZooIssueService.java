package dev.homeology.dinoworld.modules.zoo.issues;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;

/**
 * CRUD for {@link ZooIssue}. Backs {@code /zoo issues} and is written to
 * by tick services (HappinessTickService, StaffWagesTickService) via the
 * IssueDetector glue layer.
 *
 * <p>Open-issue uniqueness is enforced by the partial unique index
 * {@code idx_zoo_issue_open_unique} (see V3 migration). {@link #raise} is
 * an UPSERT against that index — at most one open row exists per
 * {@code (owner, type, target)} at a time. Closed rows do not conflict,
 * so a low_happiness issue cleared and re-raised later produces two
 * historical rows.
 */
public final class ZooIssueService {

	private static final Logger log = LoggerFactory.getLogger(ZooIssueService.class);

	private final DataSource dataSource;

	public ZooIssueService(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	// ─── writes ──────────────────────────────────────────────────────────

	/**
	 * Raise an issue, or update the existing open one if it already exists.
	 *
	 * <p>UPSERT semantics keyed on the partial unique index
	 * {@code (owner_user_id, issue_type, target_kind, target_id) WHERE resolved_at IS NULL}.
	 * On conflict, {@code severity}, {@code detail}, and {@code last_seen_at}
	 * are updated; {@code first_seen_at} is preserved so callers can read
	 * "open since" cleanly. Returns the row id either way.
	 */
	public long raise(long ownerUserId, ZooIssue.Type type, ZooIssue.Severity severity,
	                  Optional<String> targetKind, OptionalLong targetId, String detail) {
		long now = Instant.now().toEpochMilli();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO zoo_issue(
			         owner_user_id, issue_type, severity, target_kind, target_id,
			         detail, first_seen_at, last_seen_at, resolved_at)
			     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
			     ON CONFLICT(owner_user_id, issue_type, COALESCE(target_kind, ''), COALESCE(target_id, -1))
			     WHERE resolved_at IS NULL
			     DO UPDATE SET
			         severity = excluded.severity,
			         detail = excluded.detail,
			         last_seen_at = excluded.last_seen_at
			     RETURNING id
			     """)) {
			ps.setLong(1, ownerUserId);
			ps.setString(2, type.dbValue());
			ps.setString(3, severity.dbValue());
			if (targetKind.isPresent()) ps.setString(4, targetKind.get());
			else ps.setNull(4, java.sql.Types.VARCHAR);
			if (targetId.isPresent()) ps.setLong(5, targetId.getAsLong());
			else ps.setNull(5, java.sql.Types.INTEGER);
			ps.setString(6, detail);
			ps.setLong(7, now);
			ps.setLong(8, now);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) throw new IllegalStateException("UPSERT did not return id");
				return rs.getLong(1);
			}
		} catch (SQLException e) {
			throw new IllegalStateException("zoo_issue raise failed for owner=" + ownerUserId
				+ " type=" + type, e);
		}
	}

	/**
	 * Close one open issue. Owner check is the authorization gate so a
	 * crafted custom_id pointing at someone else's issue id does nothing.
	 *
	 * @return true if a row was updated
	 */
	public boolean resolve(long issueId, long ownerUserId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     UPDATE zoo_issue SET resolved_at = ?
			     WHERE id = ? AND owner_user_id = ? AND resolved_at IS NULL
			     """)) {
			ps.setLong(1, Instant.now().toEpochMilli());
			ps.setLong(2, issueId);
			ps.setLong(3, ownerUserId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("zoo_issue resolve(" + issueId + ") failed", e);
		}
	}

	/**
	 * Close every open issue for one player. Used by the "Clear all" button.
	 *
	 * @return number of rows closed
	 */
	public int resolveAllForOwner(long ownerUserId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     UPDATE zoo_issue SET resolved_at = ?
			     WHERE owner_user_id = ? AND resolved_at IS NULL
			     """)) {
			ps.setLong(1, Instant.now().toEpochMilli());
			ps.setLong(2, ownerUserId);
			return ps.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("zoo_issue resolveAllForOwner(" + ownerUserId + ") failed", e);
		}
	}

	/**
	 * Close any open issue matching the (owner, type, target) tuple. Used
	 * by auto-resolve sweeps in {@code IssueDetector} when the underlying
	 * condition has cleared.
	 *
	 * @return number of rows closed (0 or 1 in practice — uniqueness)
	 */
	public int resolveByMatch(long ownerUserId, ZooIssue.Type type,
	                          Optional<String> targetKind, OptionalLong targetId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     UPDATE zoo_issue SET resolved_at = ?
			     WHERE owner_user_id = ?
			       AND issue_type = ?
			       AND COALESCE(target_kind, '') = COALESCE(?, '')
			       AND COALESCE(target_id, -1) = COALESCE(?, -1)
			       AND resolved_at IS NULL
			     """)) {
			ps.setLong(1, Instant.now().toEpochMilli());
			ps.setLong(2, ownerUserId);
			ps.setString(3, type.dbValue());
			if (targetKind.isPresent()) ps.setString(4, targetKind.get());
			else ps.setNull(4, java.sql.Types.VARCHAR);
			if (targetId.isPresent()) ps.setLong(5, targetId.getAsLong());
			else ps.setNull(5, java.sql.Types.INTEGER);
			return ps.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("zoo_issue resolveByMatch failed", e);
		}
	}

	// ─── reads ───────────────────────────────────────────────────────────

	/**
	 * Open issues for one owner, sorted critical-first then oldest-first.
	 * Capped at 50; the renderer truncates further to fit Discord's embed
	 * field limit.
	 */
	public List<ZooIssue> findOpenForOwner(long ownerUserId) {
		List<ZooIssue> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(SELECT_ALL + """
			      WHERE owner_user_id = ? AND resolved_at IS NULL
			      ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, first_seen_at
			      LIMIT 50
			     """)) {
			ps.setLong(1, ownerUserId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("zoo_issue findOpenForOwner({}) failed: {}", ownerUserId, e.toString());
		}
		log.debug("zoo_issue db read open owner={} → {} rows", ownerUserId, out.size());
		return out;
	}

	public Optional<ZooIssue> findById(long id) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(SELECT_ALL + " WHERE id = ?")) {
			ps.setLong(1, id);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) {
					log.debug("zoo_issue db read id={} → no row", id);
					return Optional.empty();
				}
				log.debug("zoo_issue db read id={} → loaded", id);
				return Optional.of(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("zoo_issue findById({}) failed: {}", id, e.toString());
			return Optional.empty();
		}
	}

	public int countOpenForOwner(long ownerUserId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM zoo_issue WHERE owner_user_id = ? AND resolved_at IS NULL")) {
			ps.setLong(1, ownerUserId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getInt(1) : 0;
			}
		} catch (SQLException e) {
			log.warn("zoo_issue countOpenForOwner({}) failed: {}", ownerUserId, e.toString());
			return 0;
		}
	}

	public int countOpenForOwner(long ownerUserId, ZooIssue.Severity severity) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM zoo_issue WHERE owner_user_id = ? AND severity = ? AND resolved_at IS NULL")) {
			ps.setLong(1, ownerUserId);
			ps.setString(2, severity.dbValue());
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getInt(1) : 0;
			}
		} catch (SQLException e) {
			log.warn("zoo_issue countOpenForOwner({}, {}) failed: {}", ownerUserId, severity, e.toString());
			return 0;
		}
	}

	// ─── maintenance ─────────────────────────────────────────────────────

	/**
	 * Permanently remove resolved issues older than {@code cutoff}. Called
	 * once at module startup (see {@code ZooModule.onEnable}) so the table
	 * doesn't grow unbounded — open rows are never touched.
	 *
	 * @return number of rows deleted
	 */
	public int purgeResolvedOlderThan(Instant cutoff) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "DELETE FROM zoo_issue WHERE resolved_at IS NOT NULL AND resolved_at < ?")) {
			ps.setLong(1, cutoff.toEpochMilli());
			int rows = ps.executeUpdate();
			if (rows > 0) {
				log.info("zoo_issue purge: removed {} resolved row(s) older than {}", rows, cutoff);
			}
			return rows;
		} catch (SQLException e) {
			log.warn("zoo_issue purgeResolvedOlderThan({}) failed: {}", cutoff, e.toString());
			return 0;
		}
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static final String SELECT_ALL = """
		SELECT id, owner_user_id, issue_type, severity, target_kind, target_id,
		       detail, first_seen_at, last_seen_at, resolved_at
		  FROM zoo_issue
		""";

	private static ZooIssue mapRow(ResultSet rs) throws SQLException {
		String tk = rs.getString("target_kind");
		Optional<String> targetKind = (tk == null || tk.isBlank()) ? Optional.empty() : Optional.of(tk);

		long tid = rs.getLong("target_id");
		OptionalLong targetId = rs.wasNull() ? OptionalLong.empty() : OptionalLong.of(tid);

		long resolved = rs.getLong("resolved_at");
		Optional<Instant> resolvedAt = rs.wasNull()
			? Optional.empty() : Optional.of(Instant.ofEpochMilli(resolved));

		return new ZooIssue(
			rs.getLong("id"),
			rs.getLong("owner_user_id"),
			ZooIssue.Type.fromDb(rs.getString("issue_type")),
			ZooIssue.Severity.fromDb(rs.getString("severity")),
			targetKind,
			targetId,
			rs.getString("detail"),
			Instant.ofEpochMilli(rs.getLong("first_seen_at")),
			Instant.ofEpochMilli(rs.getLong("last_seen_at")),
			resolvedAt
		);
	}
}
