package dev.homeology.dinoworld.database;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Smoke tests for {@link MigrationRunner}.
 *
 * <p>Runs against a temp SQLite file (HikariCP can't pool a true in-memory
 * SQLite across multiple connections without {@code shared cache} URL
 * tricks; a temp file is simpler and equivalent). Test fixtures live under
 * {@code src/test/resources/db/migrations/testmod/}.
 */
class MigrationRunnerTest {

	private HikariDataSource ds;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void appliesAllPendingMigrations() throws Exception {
		new MigrationRunner(ds).run(List.of("testmod"));

		try (Connection c = ds.getConnection(); Statement s = c.createStatement()) {
			try (ResultSet rs = s.executeQuery("SELECT COUNT(*) FROM widgets")) {
				assertTrue(rs.next());
				assertEquals(2, rs.getInt(1));
			}
			try (ResultSet rs = s.executeQuery(
				"SELECT version FROM schema_version WHERE module='testmod' ORDER BY version")) {
				assertTrue(rs.next());
				assertEquals(1, rs.getInt(1));
				assertTrue(rs.next());
				assertEquals(2, rs.getInt(1));
				assertFalse(rs.next());
			}
		}
	}

	@Test
	void secondRunIsIdempotent() throws Exception {
		MigrationRunner runner = new MigrationRunner(ds);
		runner.run(List.of("testmod"));
		runner.run(List.of("testmod")); // should no-op without throwing duplicate-PK errors

		try (Connection c = ds.getConnection(); Statement s = c.createStatement();
		     ResultSet rs = s.executeQuery("SELECT COUNT(*) FROM widgets")) {
			assertTrue(rs.next());
			assertEquals(2, rs.getInt(1)); // not 4 — V2 didn't run twice
		}
	}

	@Test
	void unknownModuleIsHarmlessNoOp() {
		// No migrations folder for "ghostmod" exists — should not throw.
		assertDoesNotThrow(() ->
			new MigrationRunner(ds).run(List.of("ghostmod")));
	}

	@Test
	void latestPerModuleReportsAppliedVersion() throws Exception {
		MigrationRunner runner = new MigrationRunner(ds);
		runner.run(List.of("testmod"));

		List<MigrationRunner.AppliedMigration> latest = runner.latestPerModule();
		assertEquals(1, latest.size());
		MigrationRunner.AppliedMigration am = latest.get(0);
		assertEquals("testmod", am.module());
		assertEquals(2, am.version());
		assertEquals("insert_seed", am.name());
	}

	@Test
	void splitStatementsHandlesCommentsAndStringSemicolons() {
		String sql = """
			-- top comment
			CREATE TABLE foo (s TEXT);
			INSERT INTO foo VALUES ('semi;in;string'); -- inline
			""";
		List<String> stmts = MigrationRunner.splitStatements(sql);
		assertEquals(2, stmts.size());
		assertTrue(stmts.get(0).startsWith("CREATE TABLE foo"));
		assertTrue(stmts.get(1).contains("'semi;in;string'"));
	}

	@Test
	void splitStatementsStripsBlockComments() {
		String sql = "/* leading; block; comment */ SELECT 1; /* trailing */";
		List<String> stmts = MigrationRunner.splitStatements(sql);
		assertEquals(1, stmts.size());
		assertEquals("SELECT 1", stmts.get(0));
	}

	@Test
	void splitStatementsHonoursDoubleQuotedIdentifiers() {
		String sql = "CREATE TABLE \"weird;name\" (id INTEGER);";
		List<String> stmts = MigrationRunner.splitStatements(sql);
		assertEquals(1, stmts.size());
		assertTrue(stmts.get(0).contains("\"weird;name\""));
	}

	@Test
	void splitStatementsMixedCommentsAndQuotes() {
		String sql = """
			-- line
			/* block ; with ; semis */
			CREATE TABLE "id;x" (s TEXT);
			INSERT INTO "id;x" VALUES ('lit;');
			""";
		List<String> stmts = MigrationRunner.splitStatements(sql);
		assertEquals(2, stmts.size());
		assertTrue(stmts.get(0).contains("\"id;x\""));
		assertTrue(stmts.get(1).contains("'lit;'"));
	}
}
