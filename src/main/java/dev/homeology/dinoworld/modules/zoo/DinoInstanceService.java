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
	 * Convenience: create a freshly-hatched dino with no personality
	 * trait (the "plain" outcome — see {@link TraitRoller}) and no shiny
	 * flag. Kept so test fixtures don't have to thread null/false through
	 * every call site.
	 */
	public DinoInstance create(long ownerUserId, String speciesId,
	                           OptionalLong enclosureId, String customName) {
		return create(ownerUserId, speciesId, enclosureId, customName, null, false);
	}

	/**
	 * Convenience: create a freshly-hatched dino with a trait but no shiny.
	 */
	public DinoInstance create(long ownerUserId, String speciesId,
	                           OptionalLong enclosureId, String customName,
	                           DinoTrait trait) {
		return create(ownerUserId, speciesId, enclosureId, customName, trait, false);
	}

	/**
	 * Create a freshly-hatched dino with default stats, the given
	 * personality trait (or none), and the given shiny flag.
	 *
	 * @param ownerUserId  player who owns it
	 * @param speciesId    matches a {@link DinoSpecies#id()} in {@link DinoCatalog}
	 * @param enclosureId  optional starting enclosure (caller resolves via {@link EnclosureService#findCompatibleForSpecies})
	 * @param customName   optional player-supplied name; null/blank means unnamed
	 * @param trait        rolled by {@link TraitRoller}; null means "plain"
	 * @param shiny        rolled by {@link ShinyRoller}; true on the 1/512 outcome
	 */
	public DinoInstance create(long ownerUserId, String speciesId,
	                           OptionalLong enclosureId, String customName,
	                           DinoTrait trait, boolean shiny) {
		long now = Instant.now().toEpochMilli();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO dino_instance(
			         owner_user_id, species_id, enclosure_id, custom_name, trait, is_shiny,
			         level, xp, current_hp, happiness,
			         last_fed_at, last_decay_at, acquired_at)
			     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)
			     """, Statement.RETURN_GENERATED_KEYS)) {
			ps.setLong(1, ownerUserId);
			ps.setString(2, speciesId);
			if (enclosureId.isPresent()) ps.setLong(3, enclosureId.getAsLong());
			else ps.setNull(3, java.sql.Types.INTEGER);
			ps.setString(4, (customName == null || customName.isBlank()) ? null : customName.trim());
			if (trait == null) ps.setNull(5, java.sql.Types.VARCHAR);
			else ps.setString(5, trait.id());
			ps.setInt(6, shiny ? 1 : 0);
			ps.setInt(7, STARTING_LEVEL);
			ps.setInt(8, STARTING_HP);
			ps.setInt(9, STARTING_HAPPINESS);
			ps.setLong(10, now);
			ps.setLong(11, now);
			ps.executeUpdate();
			try (ResultSet rs = ps.getGeneratedKeys()) {
				if (!rs.next()) throw new IllegalStateException("INSERT did not return a key");
				long id = rs.getLong(1);
				return new DinoInstance(
					id, ownerUserId, speciesId, enclosureId,
					Optional.ofNullable((customName == null || customName.isBlank()) ? null : customName.trim()),
					Optional.ofNullable(trait),
					shiny,
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
	 * Update the cosmetic custom name for one dino. Pass {@code null} or
	 * a blank string to clear it (the row stores NULL, which surfaces as
	 * {@code Optional.empty()} on read). The caller is responsible for
	 * any length / character validation.
	 *
	 * @return {@code true} if a row was updated
	 */
	public boolean rename(long dinoId, String newName) {
		String stored = (newName == null || newName.isBlank()) ? null : newName.trim();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE dino_instance SET custom_name = ? WHERE id = ?")) {
			if (stored == null) ps.setNull(1, java.sql.Types.VARCHAR);
			else ps.setString(1, stored);
			ps.setLong(2, dinoId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("dino_instance rename(" + dinoId + ") failed", e);
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
	 * Grant XP to one dino and recompute its level via {@link DinoLeveling}.
	 * Caller is responsible for ensuring the source is a real player action
	 * (e.g. {@code /feed} that actually reset happiness) — auto-feeds and
	 * idle ticks should not call this, otherwise leveling becomes
	 * AFK-grindable.
	 *
	 * <p>If the dino is already at {@link DinoLeveling#MAX_LEVEL}, XP is
	 * still accumulated (so the column stays meaningful as a lifetime
	 * total) but {@link AwardResult#leveledUp} is always false.
	 *
	 * @param dinoId target dino
	 * @param xpDelta non-negative XP to add
	 * @return the post-write level and whether a level boundary was crossed,
	 *         or {@link Optional#empty()} if the dino doesn't exist
	 * @throws IllegalArgumentException if {@code xpDelta} is negative
	 */
	public Optional<AwardResult> awardXp(long dinoId, int xpDelta) {
		if (xpDelta < 0) {
			throw new IllegalArgumentException("xpDelta must be non-negative, got: " + xpDelta);
		}
		Optional<DinoInstance> before = findById(dinoId);
		if (before.isEmpty()) return Optional.empty();
		DinoInstance d = before.get();
		long newXp = d.xp() + xpDelta;
		int newLevel = DinoLeveling.levelForTotalXp(newXp);
		boolean leveledUp = newLevel > d.level();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE dino_instance SET xp = ?, level = ? WHERE id = ?")) {
			ps.setLong(1, newXp);
			ps.setInt(2, newLevel);
			ps.setLong(3, dinoId);
			ps.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("dino_instance awardXp(" + dinoId + ") failed", e);
		}
		return Optional.of(new AwardResult(newLevel, leveledUp));
	}

	/**
	 * Outcome of {@link #awardXp(long, int)}. {@code leveledUp} lets the
	 * caller emit a celebratory follow-up message without re-querying the
	 * row.
	 */
	public record AwardResult(int newLevel, boolean leveledUp) {
	}

	/**
	 * Apply a new happiness value (typically lower than current) and
	 * advance {@code last_decay_at}. Used by the hourly decay tick.
	 */
	public void applyHappiness(long dinoId, int newHappiness, Instant decayAt) {
		int clamped = Math.clamp(newHappiness, 0, 100);
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
				if (!rs.next()) {
					log.debug("dino_instance db read id={} → no row", dinoId);
					return Optional.empty();
				}
				log.debug("dino_instance db read id={} → loaded", dinoId);
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
		log.debug("dino_instance db read owner={} → {} rows", ownerUserId, out.size());
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
		log.debug("dino_instance db read all → {} rows", out.size());
		return out;
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static final String SELECT_ALL = """
		SELECT id, owner_user_id, species_id, enclosure_id, custom_name, trait, is_shiny,
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

		Optional<DinoTrait> trait = DinoTrait.byId(rs.getString("trait"));

		boolean shiny = rs.getInt("is_shiny") != 0;

		long fedRaw = rs.getLong("last_fed_at");
		Optional<Instant> lastFed = rs.wasNull()
			? Optional.empty() : Optional.of(Instant.ofEpochMilli(fedRaw));

		return new DinoInstance(
			rs.getLong("id"),
			rs.getLong("owner_user_id"),
			rs.getString("species_id"),
			enclosure,
			customName,
			trait,
			shiny,
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
