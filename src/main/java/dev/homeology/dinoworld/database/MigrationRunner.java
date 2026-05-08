package dev.homeology.dinoworld.database;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Applies per-module SQL migrations from the classpath.
 *
 * <p>Each module owns a folder under {@code db/migrations/<module>/} and
 * names its files {@code V<n>__<description>.sql}. The runner:
 *
 * <ol>
 *   <li>Bootstraps the {@code schema_version} tracking table if missing.</li>
 *   <li>For each module, lists migration files, sorts by version.</li>
 *   <li>Skips any {@code (module, version)} pair already in
 *       {@code schema_version}; applies the rest, each inside its own
 *       transaction, recording the row on success.</li>
 * </ol>
 *
 * <p>Module names in paths are lowercase. Versions only need to be unique
 * <em>within</em> a module — different modules can both ship a {@code V1}.
 */
public final class MigrationRunner {

	private static final Logger log = LoggerFactory.getLogger(MigrationRunner.class);

	private static final Pattern FILE_NAME = Pattern.compile("V(\\d+)__(.+)\\.sql", Pattern.CASE_INSENSITIVE);

	private final DataSource dataSource;

	public MigrationRunner(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	/**
	 * Run any unapplied migrations for the given modules.
	 *
	 * @param moduleNames module names (matching folder names under {@code db/migrations/})
	 */
	public void run(List<String> moduleNames) {
		try (Connection conn = dataSource.getConnection()) {
			ensureTrackingTable(conn);
			for (String mod : moduleNames) {
				runForModule(conn, mod.toLowerCase(Locale.ROOT));
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Migration run failed", e);
		}
	}

	/**
	 * Information about one migration applied to the database.
	 */
	public record AppliedMigration(String module, int version, String name, String appliedAt) {
	}

	/**
	 * @return the highest-version applied migration for each module, ordered by module name
	 */
	public List<AppliedMigration> latestPerModule() {
		String sql = """
			SELECT module, version, name, applied_at
			FROM schema_version sv
			WHERE version = (
			    SELECT MAX(version) FROM schema_version WHERE module = sv.module
			)
			ORDER BY module
			""";
		List<AppliedMigration> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(sql);
		     ResultSet rs = ps.executeQuery()) {
			while (rs.next()) {
				out.add(new AppliedMigration(
					rs.getString("module"),
					rs.getInt("version"),
					rs.getString("name"),
					rs.getString("applied_at")));
			}
		} catch (SQLException e) {
			throw new IllegalStateException("Could not read schema_version", e);
		}
		return out;
	}

	// ─── internals ───────────────────────────────────────────────────────

	private static void ensureTrackingTable(Connection conn) throws SQLException {
		try (Statement s = conn.createStatement()) {
			s.executeUpdate("""
				CREATE TABLE IF NOT EXISTS schema_version (
				    module     TEXT    NOT NULL,
				    version    INTEGER NOT NULL,
				    name       TEXT    NOT NULL,
				    applied_at TEXT    NOT NULL,
				    PRIMARY KEY (module, version)
				)
				""");
		}
	}

	private void runForModule(Connection conn, String module) throws SQLException {
		List<MigrationFile> files = discover(module);
		if (files.isEmpty()) {
			log.debug("Module '{}' has no migrations", module);
			return;
		}

		Set<Integer> applied = appliedVersions(conn, module);

		for (MigrationFile mf : files) {
			if (applied.contains(mf.version)) continue;

			log.info("Applying migration {}/V{}__{}", module, mf.version, mf.name);
			boolean prevAuto = conn.getAutoCommit();
			conn.setAutoCommit(false);
			try (Statement s = conn.createStatement()) {
				for (String stmt : splitStatements(mf.sql)) {
					s.execute(stmt);
				}
				recordApplied(conn, module, mf);
				conn.commit();
			} catch (SQLException e) {
				conn.rollback();
				throw new SQLException(
					"Migration failed: " + module + "/V" + mf.version + "__" + mf.name, e);
			} finally {
				conn.setAutoCommit(prevAuto);
			}
		}
	}

	private static Set<Integer> appliedVersions(Connection conn, String module) throws SQLException {
		Set<Integer> out = new HashSet<>();
		try (PreparedStatement ps =
			     conn.prepareStatement("SELECT version FROM schema_version WHERE module = ?")) {
			ps.setString(1, module);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(rs.getInt(1));
			}
		}
		return out;
	}

	private static void recordApplied(Connection conn, String module, MigrationFile mf) throws SQLException {
		try (PreparedStatement ps = conn.prepareStatement(
			"INSERT INTO schema_version(module, version, name, applied_at) VALUES (?,?,?,?)")) {
			ps.setString(1, module);
			ps.setInt(2, mf.version);
			ps.setString(3, mf.name);
			ps.setString(4, Instant.now().toString());
			ps.executeUpdate();
		}
	}

	/**
	 * Discover migration files for a single module from the classpath.
	 */
	private static List<MigrationFile> discover(String module) {
		String dir = "db/migrations/" + module + "/";
		ClassLoader cl = Thread.currentThread().getContextClassLoader();
		List<MigrationFile> out = new ArrayList<>();

		try {
			// ResourceFinder: list files inside the directory by enumerating known names
			// SQLite migrations live in a single JAR/dir, so we walk the resources index.
			Enumeration<URL> roots = cl.getResources(dir);
			while (roots.hasMoreElements()) {
				URL root = roots.nextElement();
				out.addAll(listMigrationFiles(root, module));
			}
		} catch (IOException e) {
			throw new IllegalStateException("Could not list migrations for module " + module, e);
		}

		out.sort(Comparator.comparingInt(a -> a.version));
		// Detect duplicate versions early — would otherwise produce confusing PK errors.
		Set<Integer> seen = new HashSet<>();
		for (MigrationFile mf : out) {
			if (!seen.add(mf.version)) {
				throw new IllegalStateException(
					"Duplicate migration version V" + mf.version + " in module " + module);
			}
		}
		return out;
	}

	/**
	 * List migration files at a single resource root (handles both
	 * {@code file:} URLs from a built classpath dir and {@code jar:} URLs
	 * from a packaged jar).
	 */
	private static List<MigrationFile> listMigrationFiles(URL root, String module) throws IOException {
		List<MigrationFile> out = new ArrayList<>();
		String protocol = root.getProtocol();

		if ("file".equals(protocol)) {
			java.io.File dir = new java.io.File(java.net.URI.create(root.toString()));
			java.io.File[] children = dir.listFiles((d, name) -> FILE_NAME.matcher(name).matches());
			if (children == null) return out;
			for (java.io.File f : children) {
				Matcher m = FILE_NAME.matcher(f.getName());
				if (!m.matches()) continue;
				out.add(new MigrationFile(
					parseVersion(m.group(1), f.getName()),
					m.group(2),
					readFile(f.toPath())));
			}
		} else if ("jar".equals(protocol)) {
			// jar:file:/.../app.jar!/db/migrations/<module>/
			String spec = root.getFile();
			int bang = spec.indexOf('!');
			String jarUrl = spec.substring(0, bang);
			String inside = spec.substring(bang + 2); // skip "!/"
			try (java.util.jar.JarFile jar = new java.util.jar.JarFile(
				new java.io.File(java.net.URI.create(jarUrl)))) {
				Enumeration<java.util.jar.JarEntry> entries = jar.entries();
				while (entries.hasMoreElements()) {
					java.util.jar.JarEntry e = entries.nextElement();
					if (e.isDirectory() || !e.getName().startsWith(inside)) continue;
					String tail = e.getName().substring(inside.length());
					if (tail.contains("/")) continue;     // not direct child
					Matcher m = FILE_NAME.matcher(tail);
					if (!m.matches()) continue;
					try (InputStream in = jar.getInputStream(e)) {
						out.add(new MigrationFile(
							parseVersion(m.group(1), e.getName()),
							m.group(2),
							readStream(in)));
					}
				}
			}
		} else {
			log.warn("Unsupported migration root protocol '{}' for module '{}'", protocol, module);
		}
		return out;
	}

	private static String readFile(java.nio.file.Path p) throws IOException {
		return java.nio.file.Files.readString(p, StandardCharsets.UTF_8);
	}

	/**
	 * Parse the version segment of a migration filename. The regex constrains
	 * input to digits, but a 10+ digit value still overflows int; surface a
	 * clear error tied to the filename rather than a bare NumberFormatException.
	 */
	private static int parseVersion(String digits, String filename) {
		try {
			return Integer.parseInt(digits);
		} catch (NumberFormatException nfe) {
			throw new IllegalStateException(
				"Migration version in '" + filename + "' is not a valid 32-bit integer: " + digits, nfe);
		}
	}

	private static String readStream(InputStream in) throws IOException {
		try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
			return r.lines().collect(Collectors.joining("\n"));
		}
	}

	/**
	 * Split a migration script into individual statements on semicolons that
	 * sit outside any of: single-quoted strings, double-quoted identifiers,
	 * line comments ({@code --}), or block comments ({@code /* ... *}{@code /}).
	 * Comments are stripped from output; trailing whitespace is trimmed.
	 *
	 * <p>Limitations: nested block comments aren't recognized (SQLite doesn't
	 * support them either); SQL trigger bodies wrapping multiple statements
	 * inside {@code BEGIN ... END;} will be split at internal semicolons.
	 * Ship triggers as a single statement per file or use the explicit
	 * BEGIN-END handling pattern documented in the migration README.
	 */
	static List<String> splitStatements(String sql) {
		List<String> out = new ArrayList<>();
		StringBuilder cur = new StringBuilder();
		boolean inSingle = false;
		boolean inDouble = false;
		boolean inLineComment = false;
		boolean inBlockComment = false;

		for (int i = 0; i < sql.length(); i++) {
			char c = sql.charAt(i);
			char next = i + 1 < sql.length() ? sql.charAt(i + 1) : '\0';

			if (inLineComment) {
				if (c == '\n') inLineComment = false;
				continue;
			}
			if (inBlockComment) {
				if (c == '*' && next == '/') {
					inBlockComment = false;
					i++;
				}
				continue;
			}
			if (!inSingle && !inDouble && c == '-' && next == '-') {
				inLineComment = true;
				i++;
				continue;
			}
			if (!inSingle && !inDouble && c == '/' && next == '*') {
				inBlockComment = true;
				i++;
				continue;
			}
			if (!inDouble && c == '\'') inSingle = !inSingle;
			else if (!inSingle && c == '"') inDouble = !inDouble;

			if (c == ';' && !inSingle && !inDouble) {
				String stmt = cur.toString().trim();
				if (!stmt.isEmpty()) out.add(stmt);
				cur.setLength(0);
			} else {
				cur.append(c);
			}
		}
		String tail = cur.toString().trim();
		if (!tail.isEmpty()) out.add(tail);
		return Collections.unmodifiableList(out);
	}

	private record MigrationFile(int version, String name, String sql) {
	}
}
