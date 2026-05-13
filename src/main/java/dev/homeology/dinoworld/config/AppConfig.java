package dev.homeology.dinoworld.config;

import io.github.cdimascio.dotenv.Dotenv;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Typed view of every {@code .env} variable the bot reads.
 *
 * <p>Built once at startup from a {@link Dotenv} instance. Required values
 * (bot token, developer id) cause an {@link IllegalStateException} at
 * construction time so the bot never gets past {@code Bootstrap} with
 * silently-missing config.
 *
 * <p>This class is the only place that knows env var <em>names</em> — the
 * rest of the codebase consumes its typed accessors.
 */
public final class AppConfig {

	/**
	 * Activity types accepted in {@code BOT_ACTIVITY_TYPE}.
	 */
	public enum ActivityType {NONE, PLAYING, WATCHING, LISTENING, COMPETING}

	private final String botToken;
	private final long developerId;
	private final String databasePath;
	private final Long devGuildId; // null when unset
	private final ActivityType activityType;
	private final String activityText;
	private final Set<String> disabledModules;
	private final int rateLimitPer10s;

	/**
	 * Build an {@code AppConfig} from the given dotenv source.
	 *
	 * @throws IllegalStateException if any required value is missing or malformed
	 */
	public AppConfig(Dotenv dotenv) {
		this.botToken = required(dotenv, "BOT_TOKEN");
		this.developerId = parseLong(required(dotenv, "DEVELOPER_ID"), "DEVELOPER_ID");
		this.databasePath = orDefault(dotenv, "DATABASE_PATH", "data/dinoworld.db");

		String devGuild = dotenv.get("DEV_GUILD_ID", "").trim();
		this.devGuildId = devGuild.isEmpty() ? null : parseLong(devGuild, "DEV_GUILD_ID");

		// LOG_LEVEL is bridged to a JVM system property by
		// EarlyLogConfig before any logger initializes, so AppConfig does
		// not store it — Logback consumes it directly via ${LOG_LEVEL} in
		// logback.xml.
		this.activityType = parseActivityType(orDefault(dotenv, "BOT_ACTIVITY_TYPE", "NONE"));
		this.activityText = orDefault(dotenv, "BOT_ACTIVITY_TEXT", "");

		this.rateLimitPer10s = parseNonNegativeInt(
			orDefault(dotenv, "RATE_LIMIT_PER_10S", "5"), "RATE_LIMIT_PER_10S");

		String disabled = orDefault(dotenv, "DISABLED_MODULES", "");
		this.disabledModules = disabled.isBlank()
			? Set.of()
			: Arrays.stream(disabled.split(","))
			  .map(String::trim)
			  .filter(s -> !s.isEmpty())
			  .map(s -> s.toLowerCase(Locale.ROOT))
			  .collect(Collectors.toUnmodifiableSet());
	}

	/**
	 * @return the Discord bot token (sensitive — never log this)
	 */
	public String botToken() {
		return botToken;
	}

	/**
	 * @return the Discord user ID that bypasses every permission check
	 */
	public long developerId() {
		return developerId;
	}

	/**
	 * @return filesystem path for the SQLite database file
	 */
	public String databasePath() {
		return databasePath;
	}

	/**
	 * @return the dev guild id if {@code DEV_GUILD_ID} is set, otherwise null;
	 * when present, slash commands register only to this guild
	 */
	public Long devGuildId() {
		return devGuildId;
	}

	/**
	 * @return configured presence activity type ({@code NONE} = no presence)
	 */
	public ActivityType activityType() {
		return activityType;
	}

	/**
	 * @return text to accompany the presence activity
	 */
	public String activityText() {
		return activityText;
	}

	/**
	 * @return module names (lowercased) that should be skipped at startup
	 */
	public Set<String> disabledModules() {
		return disabledModules;
	}

	/**
	 * @return max slash commands one user may run in any 10-second window
	 * before being rate-limited. {@code 0} disables the limiter.
	 * Default 5.
	 */
	public int rateLimitPer10s() {
		return rateLimitPer10s;
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static String required(Dotenv d, String key) {
		String v = d.get(key);
		if (v == null || v.isBlank() || v.equals("replace-me")) {
			throw new IllegalStateException(
				"Required env var '" + key + "' is missing or unset. "
					+ "Copy .env.example to .env and fill it in.");
		}
		return v.trim();
	}

	private static String orDefault(Dotenv d, String key, String fallback) {
		String v = d.get(key);
		return (v == null || v.isBlank()) ? fallback : v.trim();
	}

	private static int parseNonNegativeInt(String value, String key) {
		try {
			int n = Integer.parseInt(value);
			if (n < 0) {
				throw new IllegalStateException("Env var '" + key + "' must be >= 0, got: " + n);
			}
			return n;
		} catch (NumberFormatException e) {
			throw new IllegalStateException(
				"Env var '" + key + "' must be an integer (use 0 to disable), got: " + value, e);
		}
	}

	private static long parseLong(String value, String key) {
		try {
			return Long.parseLong(value);
		} catch (NumberFormatException e) {
			throw new IllegalStateException(
				"Env var '" + key + "' must be a numeric Discord ID, got: " + value, e);
		}
	}

	private static ActivityType parseActivityType(String raw) {
		try {
			return ActivityType.valueOf(raw.toUpperCase(Locale.ROOT));
		} catch (IllegalArgumentException e) {
			throw new IllegalStateException(
				"BOT_ACTIVITY_TYPE must be one of " + List.of(ActivityType.values())
					+ ", got: " + raw, e);
		}
	}
}
