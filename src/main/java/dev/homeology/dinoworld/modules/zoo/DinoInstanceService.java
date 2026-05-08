package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;

/**
 * CRUD + tick-friendly queries for {@link DinoInstance}.
 *
 * <p>Operations split into three groups:
 * <ul>
 *   <li><b>Lifecycle</b> — {@link #create} (called on hatch),
 *       {@link #delete} (called on /sell or /trade gift).</li>
 *   <li><b>Care loop</b> — {@link #recordFed} (resets happiness to 100,
 *       stamps {@code last_fed_at}), {@link #applyHappiness} (used by the
 *       hourly decay tick).</li>
 *   <li><b>Reads</b> — {@link #findByOwner} for /zoo and {@link #findById}
 *       for individual dino actions.</li>
 * </ul>
 *
 * <p>All writes are single-statement; no caching layer (data changes
 * frequently, queries are infrequent).
 */
public final class DinoInstanceService {

	private static final Logger log = LoggerFactory.getLogger(DinoInstanceService.class);

	/**
	 * Hatched-dino starting happiness — see plan ("Level 1, full HP, 100% happiness").
	 */
	public static final int STARTING_HAPPINESS = 100;

	/**
	 * Hatched-dino starting HP. /battle (deferred) will lower this.
	 */
	public static final int STARTING_HP = 100;

	/**
	 * Hatched-dino starting level. /battle (deferred) will advance this.
	 */
	public static final int STARTING_LEVEL = 1;

	private final DataSource dataSource;

	public DinoInstanceService(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	// ─── lifecycle ───────────────────────────────────────────────────────

	/**
	 * Create a freshly-hatched dino with default stats.
	 *
	 * @param ownerUserId  player who owns it
	 * @param speciesId    matches a {@link DinoSpecies#id()} in {@link DinoCatalog}
	 * @param enclosureId  optional starting enclosure (caller resolves via {@link EnclosureService#findCompatibleForSpecies})
	 * @param customName   optional player-supplied name; null/blank means unnamed
	 */
	public DinoInstance create(long ownerUserId, String speciesId,
	                           OptionalLong enclosureId, String customName) {
		long now = Instant.now().toEpochMilli();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO dino_instance(
			         owner_user_id, species_id, enclosure_id, custom_name,
			         level, xp, current_hp, happiness,
			         last_fed_at, last_decay_at, acquired_at)
			     VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)
			     """, Statement.RETURN_GENERATED_KEYS)) {
			ps.setLong(1, ownerUserId);
			ps.setString(2, speciesId);
			if (enclosureId.isPresent()) ps.setLong(3, enclosureId.getAsLong());
			else ps.setNull(3, java.sql.Types.INTEGER);
			ps.setString(4, (customName == null || customName.isBlank()) ? null : customName.trim());
			ps.setInt(5, STARTING_LEVEL);
			ps.setInt(6, STARTING_HP);
			ps.setInt(7, STARTING_HAPPINESS);
			ps.setLong(8, now);
			ps.setLong(9, now);
			ps.executeUpdate();
			try (ResultSet rs = ps.getGeneratedKeys()) {
				if (!rs.next()) throw new IllegalStateException("INSERT did not return a key");
				long id = rs.getLong(1);
				return new DinoInstance(
					id, ownerUserId, speciesId, enclosureId,
					Optional.ofNullable((customName == null || customName.isBlank()) ? null : customName.trim()),
					STARTING_LEVEL, 0L, STARTING_HP, STARTING_HAPPINESS,
					Optional.empty(),
					Instant.ofEpochMilli(now),
					Instant.ofEpochMilli(now));
			}
		} catch (SQLException e) {
			throw new IllegalStateException("dino_instance create failed for owner=" + ownerUserId, e);
		}
	}

	/**
	 * Reassign a dino to a different enclosure (or empty for "homeless").
	 * Pure UPDATE — the command layer is responsible for tier/capacity/biome
	 * rules so this method stays simple.
	 *
	 * @return {@code true} if a row was updated
	 */
	public boolean assignToEnclosure(long dinoId, OptionalLong enclosureId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE dino_instance SET enclosure_id = ? WHERE id = ?")) {
			if (enclosureId.isPresent()) ps.setLong(1, enclosureId.getAsLong());
			else ps.setNull(1, java.sql.Types.INTEGER);
			ps.setLong(2, dinoId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("assignToEnclosure(" + dinoId + ") failed", e);
		}
	}

	/**
	 * Permanently remove a dino (used by /sell). Returns true if a row was deleted.
	 */
	public boolean delete(long dinoId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "DELETE FROM dino_instance WHERE id = ?")) {
			ps.setLong(1, dinoId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("dino_instance delete(" + dinoId + ") failed", e);
		}
	}

	// ─── care loop ───────────────────────────────────────────────────────

	/**
	 * Reset happiness to 100 and stamp {@code last_fed_at}; also resets
	 * {@code last_decay_at} so the next decay window starts from now.
	 */
	public void recordFed(long dinoId, Instant when) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     UPDATE dino_instance
			     SET happiness = 100,
			         last_fed_at = ?,
			         last_decay_at = ?
			     WHERE id = ?
			     """)) {
			long t = when.toEpochMilli();
			ps.setLong(1, t);
			ps.setLong(2, t);
			ps.setLong(3, dinoId);
			ps.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("dino_instance recordFed(" + dinoId + ") failed", e);
		}
	}

	/**
	 * Clear {@code last_fed_at} so the next /feed succeeds regardless of
	 * cooldown. Admin-only path.
	 */
	public void resetFeedCooldown(long dinoId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE dino_instance SET last_fed_at = NULL WHERE id = ?")) {
			ps.setLong(1, dinoId);
			ps.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("resetFeedCooldown(" + dinoId + ") failed", e);
		}
	}

	/**
	 * Apply a new happiness value (typically lower than current) and
	 * advance {@code last_decay_at}. Used by the hourly decay tick.
	 */
	public void applyHappiness(long dinoId, int newHappiness, Instant decayAt) {
		int clamped = Math.max(0, Math.min(100, newHappiness));
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE dino_instance SET happiness = ?, last_decay_at = ? WHERE id = ?")) {
			ps.setInt(1, clamped);
			ps.setLong(2, decayAt.toEpochMilli());
			ps.setLong(3, dinoId);
			ps.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("dino_instance applyHappiness(" + dinoId + ") failed", e);
		}
	}

	// ─── reads ───────────────────────────────────────────────────────────

	public Optional<DinoInstance> findById(long dinoId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(SELECT_ALL + " WHERE id = ?")) {
			ps.setLong(1, dinoId);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) return Optional.empty();
				return Optional.of(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("dino_instance findById({}) failed: {}", dinoId, e.toString());
			return Optional.empty();
		}
	}

	public List<DinoInstance> findByOwner(long ownerUserId) {
		List<DinoInstance> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     SELECT_ALL + " WHERE owner_user_id = ? ORDER BY id")) {
			ps.setLong(1, ownerUserId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("dino_instance findByOwner({}) failed: {}", ownerUserId, e.toString());
		}
		return out;
	}

	public int countByOwner(long ownerUserId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM dino_instance WHERE owner_user_id = ?")) {
			ps.setLong(1, ownerUserId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getInt(1) : 0;
			}
		} catch (SQLException e) {
			log.warn("dino_instance countByOwner({}) failed: {}", ownerUserId, e.toString());
			return 0;
		}
	}

	/**
	 * @return every owned dino in the system. Used by the income +
	 *         happiness-decay tick jobs; small N for v1, can be bounded later.
	 */
	public List<DinoInstance> findAll() {
		List<DinoInstance> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(SELECT_ALL + " ORDER BY id");
		     ResultSet rs = ps.executeQuery()) {
			while (rs.next()) out.add(mapRow(rs));
		} catch (SQLException e) {
			log.warn("dino_instance findAll failed: {}", e.toString());
		}
		return out;
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static final String SELECT_ALL = """
		SELECT id, owner_user_id, species_id, enclosure_id, custom_name,
		       level, xp, current_hp, happiness,
		       last_fed_at, last_decay_at, acquired_at
		FROM dino_instance
		""";

	private static DinoInstance mapRow(ResultSet rs) throws SQLException {
		long encId = rs.getLong("enclosure_id");
		OptionalLong enclosure = rs.wasNull() ? OptionalLong.empty() : OptionalLong.of(encId);

		String name = rs.getString("custom_name");
		Optional<String> customName = (name == null || name.isBlank())
			? Optional.empty() : Optional.of(name);

		long fedRaw = rs.getLong("last_fed_at");
		Optional<Instant> lastFed = rs.wasNull()
			? Optional.empty() : Optional.of(Instant.ofEpochMilli(fedRaw));

		return new DinoInstance(
			rs.getLong("id"),
			rs.getLong("owner_user_id"),
			rs.getString("species_id"),
			enclosure,
			customName,
			rs.getInt("level"),
			rs.getLong("xp"),
			rs.getInt("current_hp"),
			rs.getInt("happiness"),
			lastFed,
			Instant.ofEpochMilli(rs.getLong("last_decay_at")),
			Instant.ofEpochMilli(rs.getLong("acquired_at"))
		);
	}
}
