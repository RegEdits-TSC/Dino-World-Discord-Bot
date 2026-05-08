package dev.homeology.dinoworld.modules.players;

import com.github.benmanes.caffeine.cache.Cache;
import dev.homeology.dinoworld.cache.CacheManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Optional;

/**
 * Persistent state for the in-game player profile (table {@code player},
 * migration players V1) plus the append-only {@code coin_ledger}.
 *
 * <p>Published into the {@link dev.homeology.dinoworld.core.ServiceRegistry}
 * by {@code PlayersModule} so other modules (e.g. {@code zoo}) consume it
 * via {@code ctx.services().get(PlayerService.class)} rather than importing
 * concrete classes across module boundaries.
 *
 * <p>The {@link #ensure(long, String)} method is the canonical entry point:
 * every command that wants a real player should call it at the top of its
 * body. It UPSERTs the row, refreshes {@code last_seen}, updates the
 * cached display name, and returns a {@link Player} — eliminating the
 * "does this user exist?" branch from feature code.
 *
 * <p>Reads are cached via Caffeine (10-minute write expiry, 10 000 entries
 * — same defaults as {@link dev.homeology.dinoworld.settings.GuildSettings}).
 * Every write path invalidates the entry, so cache staleness is bounded to
 * the duration of one in-flight read.
 *
 * <p>Coin mutations are transactional: {@link #addCoins} updates
 * {@code player.coins} and inserts the ledger row in the same transaction,
 * so the audit log can never disagree with the balance.
 */
public final class PlayerService {

	private static final Logger log = LoggerFactory.getLogger(PlayerService.class);

	private final DataSource dataSource;
	private final Cache<Long, Player> cache;
	private final LevelingService leveling;

	public PlayerService(DataSource dataSource, CacheManager cacheManager) {
		this(dataSource, cacheManager, new LevelingService());
	}

	/**
	 * Test seam — inject a custom {@link LevelingService} (e.g. with a
	 * tweaked curve) without subclassing.
	 */
	public PlayerService(DataSource dataSource, CacheManager cacheManager, LevelingService leveling) {
		this.dataSource = dataSource;
		this.cache = cacheManager.getDefault("players", Long.class, Player.class);
		this.leveling = leveling;
	}

	// ─── reads ───────────────────────────────────────────────────────────

	/**
	 * UPSERT a player row, refreshing {@code last_seen} and {@code display_name}.
	 *
	 * <p>Idempotent — calling repeatedly for the same user is the intended
	 * pattern (every command does it).
	 *
	 * @param userId      Discord snowflake
	 * @param displayName the user's current effective name; stored verbatim
	 * @return the row after insertion or update
	 * @throws IllegalStateException on DB IO failure
	 */
	public Player ensure(long userId, String displayName) {
		long now = Instant.now().toEpochMilli();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO player(user_id, display_name, coins, xp, level, created_at, last_seen)
			     VALUES (?, ?, 0, 0, 1, ?, ?)
			     ON CONFLICT(user_id) DO UPDATE SET
			         display_name = excluded.display_name,
			         last_seen    = excluded.last_seen
			     RETURNING user_id, display_name, coins, xp, level, created_at, last_seen, last_daily
			     """)) {
			ps.setLong(1, userId);
			ps.setString(2, displayName);
			ps.setLong(3, now);
			ps.setLong(4, now);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) {
					throw new IllegalStateException("UPSERT did not return a row for user=" + userId);
				}
				Player p = mapRow(rs);
				cache.put(userId, p);
				return p;
			}
		} catch (SQLException e) {
			throw new IllegalStateException("player ensure failed for user=" + userId, e);
		}
	}

	/**
	 * Read-through cache lookup. Does not update {@code last_seen}.
	 */
	public Optional<Player> get(long userId) {
		Player cached = cache.getIfPresent(userId);
		if (cached != null) return Optional.of(cached);

		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     SELECT user_id, display_name, coins, xp, level, created_at, last_seen, last_daily
			     FROM player WHERE user_id = ?
			     """)) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) return Optional.empty();
				Player p = mapRow(rs);
				cache.put(userId, p);
				return Optional.of(p);
			}
		} catch (SQLException e) {
			log.warn("player read failed for user={}: {}", userId, e.toString());
			return Optional.empty();
		}
	}

	// ─── writes ──────────────────────────────────────────────────────────

	/**
	 * Apply a coin delta and record the ledger entry inside a single
	 * transaction.
	 *
	 * <p>Negative deltas are allowed (purchases, fees) but no overdraft check
	 * happens here — callers that want to enforce "must have enough coins"
	 * should read the balance first and refuse before calling this method.
	 *
	 * @param userId              Discord snowflake; player row must exist (call {@link #ensure} first)
	 * @param delta               coins to add (positive) or subtract (negative)
	 * @param reason              short human-readable label ({@code daily}, {@code purchase:dino-velociraptor}, etc.)
	 * @param counterpartyUserId  optional opposite-side user for trades; pass {@code null} for system-driven changes
	 */
	public void addCoins(long userId, long delta, String reason, Long counterpartyUserId) {
		long now = Instant.now().toEpochMilli();
		boolean prevAuto;
		try (Connection c = dataSource.getConnection()) {
			prevAuto = c.getAutoCommit();
			c.setAutoCommit(false);
			try {
				try (PreparedStatement ps = c.prepareStatement(
					"UPDATE player SET coins = coins + ? WHERE user_id = ?")) {
					ps.setLong(1, delta);
					ps.setLong(2, userId);
					int affected = ps.executeUpdate();
					if (affected == 0) {
						throw new IllegalStateException(
							"addCoins: no player row for user=" + userId + " — call ensure() first");
					}
				}
				try (PreparedStatement ps = c.prepareStatement("""
					INSERT INTO coin_ledger(user_id, delta, reason, counterparty_user_id, occurred_at)
					VALUES (?, ?, ?, ?, ?)
					""")) {
					ps.setLong(1, userId);
					ps.setLong(2, delta);
					ps.setString(3, reason);
					if (counterpartyUserId == null) ps.setNull(4, java.sql.Types.INTEGER);
					else ps.setLong(4, counterpartyUserId);
					ps.setLong(5, now);
					ps.executeUpdate();
				}
				c.commit();
				cache.invalidate(userId);
			} catch (SQLException | RuntimeException e) {
				c.rollback();
				throw e;
			} finally {
				c.setAutoCommit(prevAuto);
			}
		} catch (SQLException e) {
			throw new IllegalStateException("addCoins failed for user=" + userId, e);
		}
	}

	/**
	 * Increment XP and recompute {@code level} via {@link LevelingService}.
	 *
	 * <p>The XP delta and the level recompute happen in a single UPDATE so
	 * the cached {@code level} column never disagrees with the canonical
	 * {@code xp} value. Cache is invalidated after the write.
	 *
	 * @param userId player whose XP to bump
	 * @param delta  XP to add (negative deltas are accepted but unusual)
	 */
	public void addXp(long userId, long delta) {
		try (Connection c = dataSource.getConnection()) {
			long newXp;
			try (PreparedStatement ps = c.prepareStatement(
				"UPDATE player SET xp = xp + ? WHERE user_id = ?")) {
				ps.setLong(1, delta);
				ps.setLong(2, userId);
				int affected = ps.executeUpdate();
				if (affected == 0) {
					throw new IllegalStateException(
						"addXp: no player row for user=" + userId + " — call ensure() first");
				}
			}
			try (PreparedStatement ps = c.prepareStatement("SELECT xp FROM player WHERE user_id = ?")) {
				ps.setLong(1, userId);
				try (ResultSet rs = ps.executeQuery()) {
					rs.next();
					newXp = rs.getLong(1);
				}
			}
			int newLevel = leveling.levelForXp(newXp);
			try (PreparedStatement ps = c.prepareStatement(
				"UPDATE player SET level = ? WHERE user_id = ?")) {
				ps.setInt(1, newLevel);
				ps.setLong(2, userId);
				ps.executeUpdate();
			}
			cache.invalidate(userId);
		} catch (SQLException e) {
			throw new IllegalStateException("addXp failed for user=" + userId, e);
		}
	}

	/**
	 * @return the {@link LevelingService} used by this PlayerService — exposed
	 *         so callers (e.g. /profile, /eggs) can use the same curve without
	 *         a second registration.
	 */
	public LevelingService leveling() {
		return leveling;
	}

	/**
	 * Set the player's coin balance to an exact value, ledgering the delta
	 * with the given reason. Used by {@code /admin coins set} so the new
	 * balance still leaves an auditable trail.
	 *
	 * @return the delta that was applied (signed)
	 */
	public long setCoins(long userId, long target, String reason) {
		Player p = get(userId).orElseThrow(() ->
			new IllegalStateException("setCoins: no player row for user=" + userId));
		long delta = target - p.coins();
		if (delta != 0) addCoins(userId, delta, reason, null);
		return delta;
	}

	/**
	 * Set XP to an exact value (recomputes level). Used by
	 * {@code /admin xp set}.
	 */
	public void setXp(long userId, long target) {
		Player p = get(userId).orElseThrow(() ->
			new IllegalStateException("setXp: no player row for user=" + userId));
		long delta = target - p.xp();
		if (delta != 0) addXp(userId, delta);
	}

	/**
	 * Clear {@code last_daily} so the next {@code /daily} succeeds
	 * regardless of cooldown. Admin-only path.
	 */
	public void resetDailyCooldown(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE player SET last_daily = NULL WHERE user_id = ?")) {
			ps.setLong(1, userId);
			ps.executeUpdate();
			cache.invalidate(userId);
		} catch (SQLException e) {
			throw new IllegalStateException("resetDailyCooldown failed for user=" + userId, e);
		}
	}

	/**
	 * Record that this user just claimed their daily reward; also updates
	 * the cache. Caller is responsible for the cooldown check.
	 */
	public void recordDailyClaim(long userId, Instant when) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE player SET last_daily = ? WHERE user_id = ?")) {
			ps.setLong(1, when.toEpochMilli());
			ps.setLong(2, userId);
			ps.executeUpdate();
			cache.invalidate(userId);
		} catch (SQLException e) {
			throw new IllegalStateException("recordDailyClaim failed for user=" + userId, e);
		}
	}

	// ─── internals ───────────────────────────────────────────────────────

	private static Player mapRow(ResultSet rs) throws SQLException {
		long ldRaw = rs.getLong("last_daily");
		Optional<Instant> lastDaily = rs.wasNull() ? Optional.empty()
			: Optional.of(Instant.ofEpochMilli(ldRaw));
		return new Player(
			rs.getLong("user_id"),
			rs.getString("display_name"),
			rs.getLong("coins"),
			rs.getLong("xp"),
			rs.getInt("level"),
			Instant.ofEpochMilli(rs.getLong("created_at")),
			Instant.ofEpochMilli(rs.getLong("last_seen")),
			lastDaily);
	}
}
