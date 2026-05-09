package dev.homeology.dinoworld.modules.zoo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Structural checks on {@link DinoCommand} — slash data shape and the
 * subcommand options' autocomplete flag. The command body needs a JDA
 * event mock to exercise, and is covered transitively by manual /dino
 * runs against a live Discord guild.
 */
class DinoCommandTest {

	private HikariDataSource ds;
	private DinoCommand cmd;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "zoo"));

		PlayerService players = new PlayerService(ds, new CacheManager());
		DinoInstanceService dinos = new DinoInstanceService(ds);
		EnclosureService enclosures = new EnclosureService(ds);
		DinoCatalog catalog = new DinoCatalog(new RarityCatalog());

		// staffEffects optional — keeping it null exercises the no-vet path.
		cmd = new DinoCommand(players, dinos, enclosures, catalog, null);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void slashDataDeclaresInspectAndRenameSubcommands() {
		var data = cmd.slashData();
		assertEquals("dino", data.getName());
		List<String> subNames = data.getSubcommands().stream()
			.map(s -> s.getName())
			.toList();
		assertTrue(subNames.contains(DinoCommand.SUB_INSPECT), "inspect subcommand registered");
		assertTrue(subNames.contains(DinoCommand.SUB_RENAME), "rename subcommand registered");
	}

	@Test
	void inspectRequiresAutocompletingDinoIdOption() {
		var data = cmd.slashData();
		var inspect = data.getSubcommands().stream()
			.filter(s -> DinoCommand.SUB_INSPECT.equals(s.getName()))
			.findFirst()
			.orElseThrow();
		var dinoIdOpt = inspect.getOptions().stream()
			.filter(o -> "dino_id".equals(o.getName()))
			.findFirst()
			.orElseThrow();
		assertTrue(dinoIdOpt.isRequired(), "dino_id is required");
		assertTrue(dinoIdOpt.isAutoComplete(), "dino_id autocompletes from owned dinos");
	}

	@Test
	void renameDeclaresOptionalNameOption() {
		var rename = cmd.slashData().getSubcommands().stream()
			.filter(s -> DinoCommand.SUB_RENAME.equals(s.getName()))
			.findFirst()
			.orElseThrow();
		var nameOpt = rename.getOptions().stream()
			.filter(o -> "name".equals(o.getName()))
			.findFirst()
			.orElseThrow();
		assertFalse(nameOpt.isRequired(), "name is optional (blank clears it)");
	}

	@Test
	void replyIsEphemeral() {
		assertTrue(cmd.deferEphemeral(),
			"per-dino stats are private — should reply ephemerally");
	}
}
