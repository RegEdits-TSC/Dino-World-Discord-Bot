package dev.homeology.dinoworld.modules.players;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Structural checks on {@link RankCommand} — slash data shape, defer
 * mode, optional user option. The execute path needs a JDA event mock
 * (avatar download, file attachment send) and is covered transitively
 * by manual /rank runs against a live guild.
 */
class RankCommandTest {

	private HikariDataSource ds;
	private RankCommand cmd;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players"));

		PlayerService players = new PlayerService(ds, new CacheManager());
		cmd = new RankCommand(players);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void slashDataNamedRank() {
		assertEquals("rank", cmd.slashData().getName());
	}

	@Test
	void declaresOptionalUserOption() {
		var userOpt = cmd.slashData().getOptions().stream()
			.filter(o -> "user".equals(o.getName()))
			.findFirst()
			.orElseThrow();
		assertFalse(userOpt.isRequired(), "user option defaults to invoker");
	}

	@Test
	void replyIsPublic() {
		assertFalse(cmd.deferEphemeral(),
			"rank cards are meant to be shown off in-channel");
	}
}
