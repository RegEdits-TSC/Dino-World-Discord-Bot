package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.players.PlayerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;

/**
 * Admin-only utility that wipes a player's data. Used by
 * {@code /admin reset player} (full wipe across every table that holds
 * the user's data) and {@code /admin reset tycoon} (game state only —
 * delete eggs, dinos, enclosures, and staff, then reset the player row's
 * coins/xp/level/last_daily back to defaults).
 *
 * <p>FK ordering matters under SQLite's {@code PRAGMA foreign_keys=ON}
 * (set per-connection by {@code Database.java}):
 * <ol>
 *   <li>{@code egg_instance} — references {@code dino_instance.id} via
 *       {@code hatch_dino_id}, so it goes first.</li>
 *   <li>{@code dino_instance} — references {@code enclosure.id}.</li>
 *   <li>{@code staff_member} — references {@code enclosure.id}
 *       (ON DELETE SET NULL) and {@code player.user_id}; cleared
 *       explicitly so an orphaned roster can't outlive the wipe and
 *       trigger spurious "X quit because wages weren't paid" DMs the
 *       next time the wages tick fires.</li>
 *   <li>{@code enclosure} — references {@code player.user_id}.</li>

 *   <li>{@code coin_ledger} — references {@code player.user_id}.</li>
 *   <li>{@code mission_progress} — references {@code player.user_id};
 *       cleared so /admin reset doesn't leave the tutorial showing as
 *       already-completed for what should look like a fresh account.</li>
 *   <li>{@code command_runs} — references {@code player.user_id};
 *       cleared for the same reason as {@code mission_progress} —
 *       otherwise a reset player would have command-trigger missions
 *       cascade-fire on their next prereq because the awarder still
 *       sees the pre-reset command history.</li>
 *   <li>{@code notification_queue} (no FK).</li>
 *   <li>{@code feedback_log} / {@code feedback_blacklist} (no FK).</li>
 *   <li>{@code player} — last, since everything else points back to it.</li>
 * </ol>
 *
 * <p>Each call runs in a single transaction and rolls back on any error.
 * After the transaction commits, the {@link PlayerService} cache entry
 * for the wiped user is invalidated — {@code AdminWipeService} writes
 * raw SQL that bypasses {@code PlayerService}'s normal write paths, so
 * its in-memory cache would otherwise hold a stale {@code Player} that
 * downstream consumers (the wages tick, the next {@code /zoo income})
 * could act on as if the wipe had never happened.
 *
 * <p>This service intentionally knows about every table the bot writes
 * — admin tooling necessarily crosses module boundaries.
 */
public final class AdminWipeService {

	private static final Logger log = LoggerFactory.getLogger(AdminWipeService.class);

	private final DataSource ds;
	private final PlayerService players;

	public AdminWipeService(DataSource ds, PlayerService players) {
		this.ds = ds;
		this.players = players;
	}

	/**
	 * Delete every row mentioning {@code userId} across every table the bot
	 * owns. After this call, the player is indistinguishable from someone
	 * who has never run a command — their next interaction will lazy-create
	 * a fresh {@code player} row.
	 */
	public WipeStats wipePlayer(long userId) {
		try (Connection c = ds.getConnection()) {
			boolean prevAuto = c.getAutoCommit();
			c.setAutoCommit(false);
			try {
				int eggs = deleteWhere(c, "egg_instance", "owner_user_id", userId);
				int dinos = deleteWhere(c, "dino_instance", "owner_user_id", userId);
				int staff = deleteWhere(c, "staff_member", "owner_user_id", userId);
				int enclosures = deleteWhere(c, "enclosure", "owner_user_id", userId);
				int ledger = deleteWhere(c, "coin_ledger", "user_id", userId);
				int missions = deleteWhere(c, "mission_progress", "user_id", userId);
				int achievements = deleteIfTableExists(c, "achievement_progress", "user_id", userId);
				int commandRuns = deleteWhere(c, "command_runs", "user_id", userId);
				int notifs = deleteWhere(c, "notification_queue", "user_id", userId);
				int feedback = deleteWhere(c, "feedback_log", "user_id", userId);
				int blacklist = deleteWhere(c, "feedback_blacklist", "user_id", userId);
				int player = deleteWhere(c, "player", "user_id", userId);
				c.commit();
				WipeStats stats = new WipeStats(eggs, dinos, enclosures, staff, ledger, missions,
					achievements, commandRuns, notifs, feedback, blacklist, player);
				log.warn("admin wipePlayer({}) completed: {}", userId, stats);
				return stats;
			} catch (SQLException e) {
				c.rollback();
				throw e;
			} finally {
				c.setAutoCommit(prevAuto);
			}
		} catch (SQLException e) {
			throw new IllegalStateException("wipePlayer failed for user=" + userId, e);
		} finally {
			// Drop the cached Player entry so the next read goes to the DB
			// rather than serving a stale snapshot that survives the wipe.
			players.invalidate(userId);
		}
	}

	/**
	 * Delete game state (eggs, dinos, staff, enclosures) and reset the
	 * player row's tycoon-economy columns to defaults. The player row
	 * itself stays — display name, created_at, last_seen are preserved.
	 *
	 * <p>Does NOT touch {@code coin_ledger} (audit trail kept) or feedback
	 * tables. After this, the player can immediately run {@code /zoo} and
	 * a starter enclosure auto-creates as if it were a brand-new account.
	 */
	public TycoonResetStats resetTycoon(long userId) {
		try (Connection c = ds.getConnection()) {
			boolean prevAuto = c.getAutoCommit();
			c.setAutoCommit(false);
			try {
				int eggs = deleteWhere(c, "egg_instance", "owner_user_id", userId);
				int dinos = deleteWhere(c, "dino_instance", "owner_user_id", userId);
				int staff = deleteWhere(c, "staff_member", "owner_user_id", userId);
				int enclosures = deleteWhere(c, "enclosure", "owner_user_id", userId);
				int missions = deleteWhere(c, "mission_progress", "user_id", userId);
				int achievements = deleteIfTableExists(c, "achievement_progress", "user_id", userId);
				int commandRuns = deleteWhere(c, "command_runs", "user_id", userId);
				int playerUpdated;
				try (PreparedStatement ps = c.prepareStatement(
					"UPDATE player SET coins = 0, xp = 0, level = 1, last_daily = NULL, equipped_title = NULL WHERE user_id = ?")) {
					ps.setLong(1, userId);
					playerUpdated = ps.executeUpdate();
				}
				c.commit();
				TycoonResetStats stats = new TycoonResetStats(
					eggs, dinos, enclosures, staff, missions, achievements,
					commandRuns, playerUpdated > 0);
				log.warn("admin resetTycoon({}) completed: {}", userId, stats);
				return stats;
			} catch (SQLException e) {
				c.rollback();
				throw e;
			} finally {
				c.setAutoCommit(prevAuto);
			}
		} catch (SQLException e) {
			throw new IllegalStateException("resetTycoon failed for user=" + userId, e);
		} finally {
			// Same rationale as wipePlayer: the cached coins/xp/level on the
			// Player snapshot would otherwise survive the SQL UPDATE.
			players.invalidate(userId);
		}
	}

	private static int deleteWhere(Connection c, String table, String column, long value) throws SQLException {
		try (PreparedStatement ps = c.prepareStatement(
			"DELETE FROM " + table + " WHERE " + column + " = ?")) {
			ps.setLong(1, value);
			return ps.executeUpdate();
		}
	}

	/**
	 * Same as {@link #deleteWhere} but tolerates a missing table — used for
	 * tables owned by optional modules (achievements is optional), so the
	 * wipe still works when the module is disabled via DISABLED_MODULES
	 * and its migrations haven't been applied.
	 */
	private static int deleteIfTableExists(Connection c, String table, String column, long value)
			throws SQLException {
		try (PreparedStatement ps = c.prepareStatement(
			"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")) {
			ps.setString(1, table);
			try (var rs = ps.executeQuery()) {
				if (!rs.next()) return 0;
			}
		}
		return deleteWhere(c, table, column, value);
	}

	/**
	 * Per-table delete counts produced by {@link #wipePlayer}. Recorded
	 * in the audit log and surfaced in the {@code /admin reset player}
	 * confirmation embed.
	 */
	public record WipeStats(int eggs, int dinos, int enclosures, int staff, int ledger,
	                        int missions, int achievements, int commandRuns,
	                        int notifications, int feedback, int blacklist, int player) {
		public boolean playerExisted() {
			return player > 0;
		}
	}

	/**
	 * Per-table delete counts plus the player-row reset flag for
	 * {@link #resetTycoon}.
	 */
	public record TycoonResetStats(int eggs, int dinos, int enclosures, int staff,
	                               int missions, int achievements, int commandRuns,
	                               boolean playerReset) {
	}
}
