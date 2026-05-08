package dev.homeology.dinoworld.modules.zoo;

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
 * delete eggs, dinos, and enclosures, then reset the player row's
 * coins/xp/level/last_daily back to defaults).
 *
 * <p>FK ordering matters under SQLite's {@code PRAGMA foreign_keys=ON}
 * (set per-connection by {@code Database.java}):
 * <ol>
 *   <li>{@code egg_instance} — references {@code dino_instance.id} via
 *       {@code hatch_dino_id}, so it goes first.</li>
 *   <li>{@code dino_instance} — references {@code enclosure.id}.</li>
 *   <li>{@code enclosure} — references {@code player.user_id}.</li>
 *   <li>{@code coin_ledger} — references {@code player.user_id}.</li>
 *   <li>{@code notification_queue} (no FK).</li>
 *   <li>{@code feedback_log} / {@code feedback_blacklist} (no FK).</li>
 *   <li>{@code player} — last, since everything else points back to it.</li>
 * </ol>
 *
 * <p>Each call runs in a single transaction and rolls back on any error.
 *
 * <p>This service intentionally knows about every table the bot writes
 * — admin tooling necessarily crosses module boundaries.
 */
public final class AdminWipeService {

	private static final Logger log = LoggerFactory.getLogger(AdminWipeService.class);

	private final DataSource ds;

	public AdminWipeService(DataSource ds) {
		this.ds = ds;
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
				int enclosures = deleteWhere(c, "enclosure", "owner_user_id", userId);
				int ledger = deleteWhere(c, "coin_ledger", "user_id", userId);
				int notifs = deleteWhere(c, "notification_queue", "user_id", userId);
				int feedback = deleteWhere(c, "feedback_log", "user_id", userId);
				int blacklist = deleteWhere(c, "feedback_blacklist", "user_id", userId);
				int player = deleteWhere(c, "player", "user_id", userId);
				c.commit();
				WipeStats stats = new WipeStats(eggs, dinos, enclosures, ledger, notifs,
					feedback, blacklist, player);
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
		}
	}

	/**
	 * Delete game state (eggs, dinos, enclosures) and reset the player
	 * row's tycoon-economy columns to defaults. The player row itself
	 * stays — display name, created_at, last_seen are preserved.
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
				int enclosures = deleteWhere(c, "enclosure", "owner_user_id", userId);
				int playerUpdated;
				try (PreparedStatement ps = c.prepareStatement(
					"UPDATE player SET coins = 0, xp = 0, level = 1, last_daily = NULL WHERE user_id = ?")) {
					ps.setLong(1, userId);
					playerUpdated = ps.executeUpdate();
				}
				c.commit();
				TycoonResetStats stats = new TycoonResetStats(
					eggs, dinos, enclosures, playerUpdated > 0);
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
	 * Per-table delete counts produced by {@link #wipePlayer}. Recorded
	 * in the audit log and surfaced in the {@code /admin reset player}
	 * confirmation embed.
	 */
	public record WipeStats(int eggs, int dinos, int enclosures, int ledger,
	                        int notifications, int feedback, int blacklist, int player) {
		public boolean playerExisted() {
			return player > 0;
		}
	}

	/**
	 * Per-table delete counts plus the player-row reset flag for
	 * {@link #resetTycoon}.
	 */
	public record TycoonResetStats(int eggs, int dinos, int enclosures, boolean playerReset) {
	}
}
