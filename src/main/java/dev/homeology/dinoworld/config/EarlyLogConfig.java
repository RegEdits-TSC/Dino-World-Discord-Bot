package dev.homeology.dinoworld.config;

import io.github.cdimascio.dotenv.Dotenv;

/**
 * Bridges {@code LOG_LEVEL} from {@code .env} into JVM system properties
 * <em>before</em> SLF4J/Logback initializes.
 *
 * <p>Logback's {@code ${LOG_LEVEL}} substitution in {@code logback.xml}
 * resolves against JVM system properties and OS environment variables
 * — not against {@code .env}. Calling {@link #applyFromDotenv()} from a
 * static initializer of the entry-point class, <em>before</em> any
 * {@code Logger} field is constructed, lets the operator toggle the
 * root level from {@code .env} alone.
 *
 * <p>Precedence (first match wins):
 * <ol>
 *   <li>{@code -DLOG_LEVEL=...} JVM flag</li>
 *   <li>{@code LOG_LEVEL} OS environment variable</li>
 *   <li>{@code LOG_LEVEL} entry in {@code .env}</li>
 *   <li>Logback default in {@code logback.xml} ({@code INFO})</li>
 * </ol>
 *
 * <p>This class is deliberately small and free of SLF4J usage —
 * loading it must not trigger Logback initialization, or the bridge
 * would race against the very thing it's trying to feed.
 */
public final class EarlyLogConfig {

	private EarlyLogConfig() {
	}

	/**
	 * Read {@code .env} from the current working directory and copy
	 * {@code LOG_LEVEL} into the JVM system properties when neither
	 * {@code -DLOG_LEVEL} nor the {@code LOG_LEVEL} env var is already
	 * set. Best-effort: any failure is swallowed silently — the worst
	 * outcome is that the root logger falls back to {@code INFO}, and
	 * {@link AppConfig} will surface real {@code .env} errors later
	 * with a clear exception.
	 */
	public static void applyFromDotenv() {
		applyFromDotenv(".");
	}

	// Package-private so tests can point at a temp .env.
	static void applyFromDotenv(String directory) {
		if (System.getProperty("LOG_LEVEL") != null) return;
		if (System.getenv("LOG_LEVEL") != null) return;
		try {
			Dotenv dotenv = Dotenv.configure()
				.directory(directory)
				.ignoreIfMissing()
				.load();
			String v = dotenv.get("LOG_LEVEL");
			if (v != null && !v.isBlank()) {
				System.setProperty("LOG_LEVEL", v.trim());
			}
		} catch (Exception ignored) {
			// Best-effort — see Javadoc.
		}
	}
}
