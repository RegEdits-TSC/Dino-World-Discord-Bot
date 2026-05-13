package dev.homeology.dinoworld.settings;

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
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Per-guild key/value setting store backed by the {@code guild_settings}
 * table introduced in core migration V2.
 *
 * <p>Modules use this to persist guild-specific configuration (game knobs,
 * channel restrictions, locale, etc.) without inventing a table per
 * setting. Keys are namespaced by convention — pick a stable prefix per
 * module (e.g. {@code game.spawnRate}) and document the allowed values.
 *
 * <p>Reads are cached via {@link CacheManager} (10-minute write expiry,
 * 10 000 entries) keyed by {@code guildId|key}. Writes invalidate the cache
 * entry and persist immediately. Across processes, cache staleness up to
 * the expiry window is acceptable; the bot is single-process so this is
 * effectively a same-JVM consistent store.
 */
public final class GuildSettings {

	private static final Logger log = LoggerFactory.getLogger(GuildSettings.class);

	private final DataSource dataSource;
	private final Cache<String, String> cache;

	public GuildSettings(DataSource dataSource, CacheManager cacheManager) {
		this.dataSource = dataSource;
		this.cache = cacheManager.getDefault("guild_settings", String.class, String.class);
	}

	/**
	 * @return value for {@code (guildId, key)} or empty if no row exists
	 */
	public Optional<String> get(long guildId, String key) {
		String cacheKey = cacheKey(guildId, key);
		String cached = cache.getIfPresent(cacheKey);
		if (cached != null) return Optional.of(cached);

		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT value FROM guild_settings WHERE guild_id = ? AND key = ?")) {
			ps.setLong(1, guildId);
			ps.setString(2, key);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) {
					log.debug("guild_settings db read guild={} key={} → no row", guildId, key);
					return Optional.empty();
				}
				String value = rs.getString(1);
				log.debug("guild_settings db read guild={} key={} → loaded", guildId, key);
				if (value != null) cache.put(cacheKey, value);
				return Optional.ofNullable(value);
			}
		} catch (SQLException e) {
			log.warn("guild_settings read failed for guild={} key={}: {}", guildId, key, e.toString());
			return Optional.empty();
		}
	}

	/**
	 * @return value for {@code (guildId, key)}, or {@code fallback} if no row exists
	 */
	public String getOrDefault(long guildId, String key, String fallback) {
		return get(guildId, key).orElse(fallback);
	}

	/**
	 * Upsert a single setting; invalidates the cache entry afterward.
	 */
	public void set(long guildId, String key, String value) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO guild_settings(guild_id, key, value, updated_at)
			     VALUES (?, ?, ?, ?)
			     ON CONFLICT(guild_id, key) DO UPDATE SET
			         value      = excluded.value,
			         updated_at = excluded.updated_at
			     """)) {
			ps.setLong(1, guildId);
			ps.setString(2, key);
			ps.setString(3, value);
			ps.setString(4, Instant.now().toString());
			ps.executeUpdate();
			cache.put(cacheKey(guildId, key), value);
		} catch (SQLException e) {
			throw new IllegalStateException(
				"guild_settings write failed for guild=" + guildId + " key=" + key, e);
		}
	}

	/**
	 * Delete a single setting; invalidates the cache entry.
	 */
	public void remove(long guildId, String key) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "DELETE FROM guild_settings WHERE guild_id = ? AND key = ?")) {
			ps.setLong(1, guildId);
			ps.setString(2, key);
			ps.executeUpdate();
			cache.invalidate(cacheKey(guildId, key));
		} catch (SQLException e) {
			throw new IllegalStateException(
				"guild_settings delete failed for guild=" + guildId + " key=" + key, e);
		}
	}

	/**
	 * @return every {@code (key, value)} pair for one guild, ordered by key.
	 * Used for admin-style dumps; not cached.
	 */
	public Map<String, String> all(long guildId) {
		Map<String, String> out = new LinkedHashMap<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT key, value FROM guild_settings WHERE guild_id = ? ORDER BY key")) {
			ps.setLong(1, guildId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) {
					out.put(rs.getString(1), rs.getString(2));
				}
			}
		} catch (SQLException e) {
			log.warn("guild_settings list failed for guild={}: {}", guildId, e.toString());
		}
		return out;
	}

	private static String cacheKey(long guildId, String key) {
		return guildId + "|" + key;
	}
}
