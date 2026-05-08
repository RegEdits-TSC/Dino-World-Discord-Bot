package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
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
import java.util.Map;
import java.util.Optional;

/**
 * CRUD + capacity rules for {@link Enclosure}s.
 *
 * <p>One starter enclosure is created automatically for any player the
 * first time they touch the zoo (see {@link #ensureStarter}). The starter
 * is intentionally weak (tier 1, biome {@code forest}, capacity 3) — it
 * lets players hatch their first Common eggs but pushes them toward
 * building real enclosures fast.
 *
 * <p>Tier gating: each rarity needs at least the matching enclosure tier.
 * The mapping (Common → tier 1, Uncommon → tier 2, ... Mythic → tier 5)
 * lives in {@link #MIN_TIER_FOR_RARITY} so {@code /shop} can validate
 * before charging coins and {@code /hatch} can refuse to assign a
 * mismatched dino.
 *
 * <p>No caching layer here — enclosures change shape rarely but the data
 * is small and reads are infrequent (only on /zoo and /shop), so a
 * roundtrip per call is fine.
 */
public final class EnclosureService {

	private static final Logger log = LoggerFactory.getLogger(EnclosureService.class);

	/**
	 * Required minimum enclosure tier for housing a dino of each rarity.
	 * The shop refuses to sell an egg of rarity X to a player who has no
	 * enclosure with tier ≥ {@code MIN_TIER_FOR_RARITY[X]} and free space.
	 */
	public static final Map<String, Integer> MIN_TIER_FOR_RARITY = Map.of(
		"common", 1,
		"uncommon", 2,
		"rare", 3,
		"epic", 4,
		"legendary", 5,
		"mythic", 5
	);

	/**
	 * Default biome for the auto-created starter enclosure.
	 */
	public static final String STARTER_BIOME = "forest";

	/**
	 * Default capacity for the auto-created starter enclosure.
	 */
	public static final int STARTER_CAPACITY = 3;

	private final DataSource dataSource;

	public EnclosureService(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	// ─── creation ────────────────────────────────────────────────────────

	/**
	 * Insert an enclosure row.
	 *
	 * @param ownerUserId player who owns it
	 * @param biome       habitat tag (e.g. forest, marine, aerial, grassland, mountain, desert)
	 * @param capacity    max dinos that can live here
	 * @param tier        1–5; gates the rarity that may live here
	 * @param name        optional user label, may be null/blank
	 * @return the newly inserted enclosure
	 */
	public Enclosure create(long ownerUserId, String biome, int capacity, int tier, String name) {
		long now = Instant.now().toEpochMilli();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO enclosure(owner_user_id, biome, capacity, tier, name, created_at)
			     VALUES (?, ?, ?, ?, ?, ?)
			     """, Statement.RETURN_GENERATED_KEYS)) {
			ps.setLong(1, ownerUserId);
			ps.setString(2, biome);
			ps.setInt(3, capacity);
			ps.setInt(4, tier);
			ps.setString(5, (name == null || name.isBlank()) ? null : name.trim());
			ps.setLong(6, now);
			ps.executeUpdate();
			try (ResultSet rs = ps.getGeneratedKeys()) {
				if (!rs.next()) throw new IllegalStateException("INSERT did not return a key");
				long id = rs.getLong(1);
				return new Enclosure(id, ownerUserId, biome, capacity, tier,
					Optional.ofNullable((name == null || name.isBlank()) ? null : name.trim()),
					Instant.ofEpochMilli(now));
			}
		} catch (SQLException e) {
			throw new IllegalStateException("enclosure create failed for owner=" + ownerUserId, e);
		}
	}

	/**
	 * Auto-create the starter enclosure if the player has none.
	 *
	 * @return the starter enclosure (newly created or already existing)
	 */
	public Enclosure ensureStarter(long ownerUserId) {
		List<Enclosure> existing = findByOwner(ownerUserId);
		if (!existing.isEmpty()) {
			return existing.get(0);
		}
		log.info("Creating starter enclosure for user={}", ownerUserId);
		return create(ownerUserId, STARTER_BIOME, STARTER_CAPACITY, 1, "Starter Habitat");
	}

	// ─── reads ───────────────────────────────────────────────────────────

	public Optional<Enclosure> findById(long id) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT id, owner_user_id, biome, capacity, tier, name, created_at " +
				     "FROM enclosure WHERE id = ?")) {
			ps.setLong(1, id);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) return Optional.empty();
				return Optional.of(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("enclosure findById({}) failed: {}", id, e.toString());
			return Optional.empty();
		}
	}

	public List<Enclosure> findByOwner(long ownerUserId) {
		List<Enclosure> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT id, owner_user_id, biome, capacity, tier, name, created_at " +
				     "FROM enclosure WHERE owner_user_id = ? ORDER BY id")) {
			ps.setLong(1, ownerUserId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("enclosure findByOwner({}) failed: {}", ownerUserId, e.toString());
		}
		return out;
	}

	/**
	 * @return number of dinos currently assigned to {@code enclosureId}
	 */
	public int countDinosIn(long enclosureId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM dino_instance WHERE enclosure_id = ?")) {
			ps.setLong(1, enclosureId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getInt(1) : 0;
			}
		} catch (SQLException e) {
			log.warn("enclosure countDinos({}) failed: {}", enclosureId, e.toString());
			return 0;
		}
	}

	/**
	 * @return free space in this enclosure (capacity − current occupants);
	 *         never negative
	 */
	public int slotsAvailable(Enclosure e) {
		return Math.max(0, e.capacity() - countDinosIn(e.id()));
	}

	// ─── mutations ───────────────────────────────────────────────────────

	/**
	 * Update {@code enclosure.name}. {@code newName} is trimmed; null or
	 * blank stores SQL NULL (i.e. clears the name).
	 *
	 * @return {@code true} if a row was updated
	 */
	public boolean rename(long enclosureId, String newName) {
		String stored = (newName == null || newName.isBlank()) ? null : newName.trim();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE enclosure SET name = ? WHERE id = ?")) {
			if (stored == null) ps.setNull(1, java.sql.Types.VARCHAR);
			else ps.setString(1, stored);
			ps.setLong(2, enclosureId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("enclosure rename(" + enclosureId + ") failed", e);
		}
	}

	/**
	 * Permanently remove an enclosure. Refuses to remove the row if any
	 * dinos still live there; returns {@code false} in that case so the
	 * command layer can show a useful error instead of orphaning dinos.
	 *
	 * @return {@code true} if a row was deleted
	 */
	public boolean delete(long enclosureId) {
		if (countDinosIn(enclosureId) > 0) {
			return false;
		}
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("DELETE FROM enclosure WHERE id = ?")) {
			ps.setLong(1, enclosureId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("enclosure delete(" + enclosureId + ") failed", e);
		}
	}

	/**
	 * Find an enclosure that can house a dino of the given species. Rules:
	 * <ul>
	 *   <li>Tier must be ≥ {@link #MIN_TIER_FOR_RARITY rarity requirement}.</li>
	 *   <li>Capacity must have at least one free slot.</li>
	 *   <li>Placement must be legal per {@link Biome#canHouse}: same-domain
	 *       always, plus aerial species are also accepted in LAND enclosures
	 *       (with a happiness penalty via {@link HappinessTickService}). No
	 *       other cross-domain placement is allowed.</li>
	 *   <li>Within the legal set, prefer exact biome match (full happiness);
	 *       fall back to any other legal fit (same-domain mismatch, or
	 *       aerial-in-land — both decay faster).</li>
	 * </ul>
	 *
	 * @return the chosen enclosure, or empty if none fits
	 */
	public Optional<Enclosure> findCompatibleForSpecies(long ownerUserId, DinoSpecies species) {
		int requiredTier = MIN_TIER_FOR_RARITY.getOrDefault(species.rarity(), 1);
		Enclosure exactBiomeMatch = null;
		Enclosure fallbackFit = null;
		for (Enclosure e : findByOwner(ownerUserId)) {
			if (e.tier() < requiredTier) continue;
			if (slotsAvailable(e) <= 0) continue;
			if (!Biome.canHouse(e.biome(), species.biome())) continue;
			if (e.biome().equalsIgnoreCase(species.biome())) {
				exactBiomeMatch = e;
				break;
			} else if (fallbackFit == null) {
				fallbackFit = e;
			}
		}
		return Optional.ofNullable(exactBiomeMatch != null ? exactBiomeMatch : fallbackFit);
	}

	/**
	 * Buy-time habitat check: does the player own at least one enclosure
	 * where {@code species} could legally live (matching tier + a placement
	 * legal per {@link Biome#canHouse})? Capacity is intentionally <em>not</em>
	 * checked here — the player can buy now and free up space before the
	 * incubation timer expires; the live capacity check still runs at hatch.
	 *
	 * @return {@code true} if at least one enclosure owned by the player has
	 *         tier ≥ rarity requirement and an allowed biome for the species
	 */
	public boolean hasHabitatForSpecies(long ownerUserId, DinoSpecies species) {
		int requiredTier = MIN_TIER_FOR_RARITY.getOrDefault(species.rarity(), 1);
		for (Enclosure e : findByOwner(ownerUserId)) {
			if (e.tier() < requiredTier) continue;
			if (!Biome.canHouse(e.biome(), species.biome())) continue;
			return true;
		}
		return false;
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static Enclosure mapRow(ResultSet rs) throws SQLException {
		String name = rs.getString("name");
		return new Enclosure(
			rs.getLong("id"),
			rs.getLong("owner_user_id"),
			rs.getString("biome"),
			rs.getInt("capacity"),
			rs.getInt("tier"),
			Optional.ofNullable(name),
			Instant.ofEpochMilli(rs.getLong("created_at"))
		);
	}
}
