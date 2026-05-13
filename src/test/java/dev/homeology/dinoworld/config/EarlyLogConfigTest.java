package dev.homeology.dinoworld.config;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Behavior tests for the {@code .env → LOG_LEVEL} system-property bridge.
 *
 * <p>Tests mutate {@code System.setProperty("LOG_LEVEL", ...)} so each
 * one snapshots and restores the property; that keeps them isolated
 * from each other and from any value the surrounding test runtime
 * might have set.
 */
class EarlyLogConfigTest {

	private String savedLogLevel;

	@BeforeEach
	void snapshot() {
		savedLogLevel = System.getProperty("LOG_LEVEL");
		System.clearProperty("LOG_LEVEL");
	}

	@AfterEach
	void restore() {
		if (savedLogLevel == null) System.clearProperty("LOG_LEVEL");
		else System.setProperty("LOG_LEVEL", savedLogLevel);
	}

	@Test
	void bridgesLogLevelFromDotenv(@TempDir Path tmp) throws IOException {
		Files.writeString(tmp.resolve(".env"), "LOG_LEVEL=DEBUG\n");
		EarlyLogConfig.applyFromDotenv(tmp.toString());
		assertEquals("DEBUG", System.getProperty("LOG_LEVEL"));
	}

	@Test
	void trimsWhitespace(@TempDir Path tmp) throws IOException {
		Files.writeString(tmp.resolve(".env"), "LOG_LEVEL=   TRACE   \n");
		EarlyLogConfig.applyFromDotenv(tmp.toString());
		assertEquals("TRACE", System.getProperty("LOG_LEVEL"));
	}

	@Test
	void doesNotOverrideExistingSystemProperty(@TempDir Path tmp) throws IOException {
		Files.writeString(tmp.resolve(".env"), "LOG_LEVEL=DEBUG\n");
		System.setProperty("LOG_LEVEL", "WARN");
		EarlyLogConfig.applyFromDotenv(tmp.toString());
		assertEquals("WARN", System.getProperty("LOG_LEVEL"));
	}

	@Test
	void noOpWhenDotenvMissing(@TempDir Path tmp) {
		EarlyLogConfig.applyFromDotenv(tmp.toString());
		assertNull(System.getProperty("LOG_LEVEL"));
	}

	@Test
	void noOpWhenKeyAbsent(@TempDir Path tmp) throws IOException {
		Files.writeString(tmp.resolve(".env"), "OTHER_KEY=value\n");
		EarlyLogConfig.applyFromDotenv(tmp.toString());
		assertNull(System.getProperty("LOG_LEVEL"));
	}

	@Test
	void noOpWhenValueBlank(@TempDir Path tmp) throws IOException {
		Files.writeString(tmp.resolve(".env"), "LOG_LEVEL=\n");
		EarlyLogConfig.applyFromDotenv(tmp.toString());
		assertNull(System.getProperty("LOG_LEVEL"));
	}
}
