package dev.homeology.dinoworld.modules.achievements;

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
 * CRUD for {@code achievement_progress}. Mirrors
 * {@link dev.homeology.dinoworld.modules.players.missions.MissionProgressService}.
 *
 * <p>{@link #markUnlocked} uses {@code INSERT … ON CONFLICT DO NOTHING}
 * so a race between the awarder and a concurrent state change can't
 * unlock the same achievement twice — the second insert no-ops and the
 * awarder skips the reward grant.
 */
public final class AchievementProgressService {

	private static final Logger log = LoggerFactory.getLogger(AchievementProgressService.class);

	private final DataSource dataSource;

	public AchievementProgressService(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	/**
	 * Record an achievement as unlocked for {@code userId}.
	 *
	 * @return {@code true} if a row was inserted, {@code false} if the
	 *         achievement was already unlocked (caller must NOT re-grant
	 *         the reward).
	 */
	public boolean markUnlocked(long userId, String achievementId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO achievement_progress(user_id, achievement_id, unlocked_at)
			     VALUES (?, ?, ?)
			     ON CONFLICT(user_id, achievement_id) DO NOTHING
			     """)) {
			ps.setLong(1, userId);
			ps.setString(2, achievementId);
			ps.setLong(3, Instant.now().toEpochMilli());
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException(
				"achievement_progress markUnlocked(" + userId + ", " + achievementId + ") failed", e);
		}
	}

	/** Set of achievement ids the user has already unlocked. */
	public Set<String> unlockedFor(long userId) {
		Set<String> out = new HashSet<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT achievement_id FROM achievement_progress WHERE user_id = ?")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(rs.getString(1));
			}
		} catch (SQLException e) {
			log.warn("achievement_progress unlockedFor({}) failed: {}", userId, e.toString());
		}
		log.debug("achievement_progress db read user={} → {} unlocked", userId, out.size());
		return out;
	}
}
