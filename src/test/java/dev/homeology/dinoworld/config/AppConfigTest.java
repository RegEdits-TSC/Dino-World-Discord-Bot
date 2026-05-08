package dev.homeology.dinoworld.config;

import io.github.cdimascio.dotenv.Dotenv;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Smoke tests for {@link AppConfig} env-var validation and parsing.
 *
 * <p>Each test writes a small temp {@code .env} and constructs an
 * {@link AppConfig} from it, asserting on the resulting accessors or the
 * thrown {@link IllegalStateException}.
 */
class AppConfigTest {

	@Test
	void rejectsMissingBotToken(@TempDir Path tmp) throws IOException {
		Dotenv dotenv = writeDotenv(tmp, """
			DEVELOPER_ID=12345
			""");
		IllegalStateException ex = assertThrows(IllegalStateException.class, () -> new AppConfig(dotenv));
		assertTrue(ex.getMessage().contains("BOT_TOKEN"), () -> "Got: " + ex.getMessage());
	}

	@Test
	void rejectsPlaceholderBotToken(@TempDir Path tmp) throws IOException {
		Dotenv dotenv = writeDotenv(tmp, """
			BOT_TOKEN=replace-me
			DEVELOPER_ID=12345
			""");
		assertThrows(IllegalStateException.class, () -> new AppConfig(dotenv));
	}

	@Test
	void rejectsMissingDeveloperId(@TempDir Path tmp) throws IOException {
		Dotenv dotenv = writeDotenv(tmp, """
			BOT_TOKEN=abc
			""");
		IllegalStateException ex = assertThrows(IllegalStateException.class, () -> new AppConfig(dotenv));
		assertTrue(ex.getMessage().contains("DEVELOPER_ID"));
	}

	@Test
	void rejectsNonNumericDeveloperId(@TempDir Path tmp) throws IOException {
		Dotenv dotenv = writeDotenv(tmp, """
			BOT_TOKEN=abc
			DEVELOPER_ID=not-a-number
			""");
		assertThrows(IllegalStateException.class, () -> new AppConfig(dotenv));
	}

	@Test
	void defaultsApplyWhenOptionalsMissing(@TempDir Path tmp) throws IOException {
		Dotenv dotenv = writeDotenv(tmp, """
			BOT_TOKEN=abc
			DEVELOPER_ID=42
			""");
		AppConfig cfg = new AppConfig(dotenv);
		assertEquals("abc", cfg.botToken());
		assertEquals(42L, cfg.developerId());
		assertEquals("data/dinoworld.db", cfg.databasePath());
		assertNull(cfg.devGuildId());
		assertEquals("INFO", cfg.logLevel());
		assertEquals(AppConfig.ActivityType.NONE, cfg.activityType());
		assertTrue(cfg.disabledModules().isEmpty());
	}

	@Test
	void parsesAllOptionals(@TempDir Path tmp) throws IOException {
		Dotenv dotenv = writeDotenv(tmp, """
			BOT_TOKEN=abc
			DEVELOPER_ID=42
			DATABASE_PATH=/tmp/foo.db
			DEV_GUILD_ID=999
			LOG_LEVEL=DEBUG
			BOT_ACTIVITY_TYPE=watching
			BOT_ACTIVITY_TEXT=stuff
			DISABLED_MODULES=Foo, Bar ,baz
			""");
		AppConfig cfg = new AppConfig(dotenv);
		assertEquals("/tmp/foo.db", cfg.databasePath());
		assertEquals(999L, cfg.devGuildId());
		assertEquals("DEBUG", cfg.logLevel());
		assertEquals(AppConfig.ActivityType.WATCHING, cfg.activityType());
		assertEquals("stuff", cfg.activityText());
		assertEquals(java.util.Set.of("foo", "bar", "baz"), cfg.disabledModules());
	}

	@Test
	void rejectsBadActivityType(@TempDir Path tmp) throws IOException {
		Dotenv dotenv = writeDotenv(tmp, """
			BOT_TOKEN=abc
			DEVELOPER_ID=42
			BOT_ACTIVITY_TYPE=jiggling
			""");
		assertThrows(IllegalStateException.class, () -> new AppConfig(dotenv));
	}

	private static Dotenv writeDotenv(Path tmp, String content) throws IOException {
		Files.writeString(tmp.resolve(".env"), content);
		return Dotenv.configure().directory(tmp.toString()).load();
	}
}
