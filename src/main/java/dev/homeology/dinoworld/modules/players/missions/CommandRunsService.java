package dev.homeology.dinoworld.modules.players.missions;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;

/**
 * Persists which slash commands each player has ever run. Backs the
 * missions module's ordered-tutorial flow: a {@code command:<name>}
 * trigger can be satisfied retroactively when an earlier mission
 * later unblocks the set, so a player who ran {@code /shop} before
 * {@code /profile} doesn't have to run {@code /shop} again to clear
 * the {@code visit_shop} mission.
 *
 * <p>{@link #record} is called from {@link MissionAwarder#afterCommand}
 * on every awarder pass, so the table is the union of "every command
 * any player has run since this feature shipped." Bounded by
 * users × distinct {@code (command, subcommand)} pairs — small.
 *
 * <p>Failures are logged and swallowed: missing a record means a
 * later mission may need to be re-triggered, but the command's own
 * reply must never fail because of bookkeeping.
 */
public final class CommandRunsService {

	private static final Logger log = LoggerFactory.getLogger(CommandRunsService.class);

	private final DataSource dataSource;

	public CommandRunsService(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	/**
	 * Record that {@code userId} ran {@code /command [subcommand]}.
	 * Idempotent — repeat calls leave the existing row in place
	 * (preserving the original {@code first_run_at}) thanks to
	 * INSERT … ON CONFLICT DO NOTHING.
	 *
	 * @param subcommand the slash subcommand, or {@code null} for a
	 *                   command without one ({@code /shop}, {@code /daily})
	 */
	public void record(long userId, String command, String subcommand) {
		String sub = subcommand == null ? "" : subcommand;
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO command_runs(user_id, command, subcommand, first_run_at)
			     VALUES (?, ?, ?, ?)
			     ON CONFLICT(user_id, command, subcommand) DO NOTHING
			     """)) {
			ps.setLong(1, userId);
			ps.setString(2, command);
			ps.setString(3, sub);
			ps.setLong(4, Instant.now().toEpochMilli());
			ps.executeUpdate();
		} catch (SQLException e) {
			log.warn("command_runs record({}, {}, {}) failed: {}",
				userId, command, sub, e.toString());
		}
	}

	/**
	 * @param subcommand the required subcommand, or {@code null} to
	 *                   match "any subcommand of {@code command}" —
	 *                   mirrors the semantics of
	 *                   {@link MissionTrigger.RanCommand} where a null
	 *                   subcommand means "any."
	 * @return {@code true} if a matching row exists
	 */
	public boolean hasRun(long userId, String command, String subcommand) {
		String sql = subcommand == null
			? "SELECT 1 FROM command_runs WHERE user_id = ? AND command = ? LIMIT 1"
			: "SELECT 1 FROM command_runs WHERE user_id = ? AND command = ? AND subcommand = ? LIMIT 1";
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(sql)) {
			ps.setLong(1, userId);
			ps.setString(2, command);
			if (subcommand != null) ps.setString(3, subcommand);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next();
			}
		} catch (SQLException e) {
			log.warn("command_runs hasRun({}, {}, {}) failed: {}",
				userId, command, subcommand, e.toString());
			return false;
		}
	}
}
