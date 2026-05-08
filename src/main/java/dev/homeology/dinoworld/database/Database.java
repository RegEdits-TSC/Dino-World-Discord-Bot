package dev.homeology.dinoworld.database;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Thin wrapper around a Hikari connection pool pointed at a SQLite file.
 *
 * <p>SQLite supports exactly one writer at a time, so the pool is fixed at
 * size 1 — letting Hikari serialize would-be-concurrent writers behind a
 * single connection rather than letting them race and trigger
 * {@code SQLITE_BUSY} errors. WAL mode is enabled on every new connection
 * so reads don't block writes during the brief write windows.
 */
public final class Database implements AutoCloseable {

	private static final Logger log = LoggerFactory.getLogger(Database.class);

	private final HikariDataSource dataSource;
	private final Path filePath;

	/**
	 * Open a connection pool against {@code databasePath}, creating the
	 * file's parent directory if it doesn't exist.
	 *
	 * @param databasePath absolute or working-dir-relative path to the .db file
	 */
	public Database(String databasePath) {
		this.filePath = Paths.get(databasePath).toAbsolutePath();
		ensureParentDir(filePath);

		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + filePath);
		cfg.setMaximumPoolSize(1);                 // SQLite: single-writer
		cfg.setPoolName("dinoworld-sqlite");
		// Apply pragmas every time a fresh connection is created in the pool.
		cfg.setConnectionInitSql("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");

		this.dataSource = new HikariDataSource(cfg);
		log.info("SQLite connected at {}", filePath);
	}

	/**
	 * @return the live {@link DataSource} for callers that want to acquire connections
	 */
	public DataSource dataSource() {
		return dataSource;
	}

	/**
	 * @return absolute path of the SQLite database file (used by /debug system db)
	 */
	public Path filePath() {
		return filePath;
	}

	@Override
	public void close() {
		if (!dataSource.isClosed()) {
			log.info("Closing SQLite pool");
			dataSource.close();
		}
	}

	private static void ensureParentDir(Path p) {
		Path parent = p.getParent();
		if (parent == null) return;
		try {
			Files.createDirectories(parent);
		} catch (IOException e) {
			throw new IllegalStateException("Could not create DB parent dir: " + parent, e);
		}
	}
}
