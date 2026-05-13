package dev.homeology.dinoworld.modules.players.missions;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

/**
 * CRUD for {@code mission_progress}. Two callers in normal flow:
 *
 * <ul>
 *   <li>{@link MissionAwarder} marks a mission complete the first time
 *       its trigger condition is satisfied.</li>
 *   <li>The {@code /missions} command reads the completed set to render
 *       progress.</li>
 * </ul>
 *
 * <p>{@link #markCompleted} uses {@code INSERT … ON CONFLICT DO NOTHING}
 * so a race between the awarder and a concurrent state change can't
 * award the same mission twice — the second insert no-ops and the
 * awarder skips the reward grant.
 */
public final class MissionProgressService {

	private static final Logger log = LoggerFactory.getLogger(MissionProgressService.class);

	private final DataSource dataSource;

	public MissionProgressService(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	/**
	 * Record a mission as completed for {@code userId}.
	 *
	 * @return {@code true} if a row was inserted, {@code false} if the
	 *         mission was already marked complete (caller must NOT
	 *         re-grant the reward)
	 */
	public boolean markCompleted(long userId, String missionId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO mission_progress(user_id, mission_id, completed_at)
			     VALUES (?, ?, ?)
			     ON CONFLICT(user_id, mission_id) DO NOTHING
			     """)) {
			ps.setLong(1, userId);
			ps.setString(2, missionId);
			ps.setLong(3, Instant.now().toEpochMilli());
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException(
				"mission_progress markCompleted(" + userId + ", " + missionId + ") failed", e);
		}
	}

	/** Set of mission ids the user has already completed. */
	public Set<String> completedFor(long userId) {
		Set<String> out = new HashSet<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT mission_id FROM mission_progress WHERE user_id = ?")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(rs.getString(1));
			}
		} catch (SQLException e) {
			log.warn("mission_progress completedFor({}) failed: {}", userId, e.toString());
		}
		log.debug("mission_progress db read user={} → {} completed", userId, out.size());
		return out;
	}
}
