package dev.homeology.dinoworld.modules.staff;

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
 * CRUD + tick-friendly queries for {@link StaffMember}.
 *
 * <p>Mirrors {@link dev.homeology.dinoworld.modules.zoo.DinoInstanceService}:
 * plain JDBC, single-statement writes, no caching, ResultSet → record
 * mapping done inline.
 *
 * <p>Counting helpers ({@link #countByOwnerAndRole}, {@link #findByEnclosure},
 * {@link #findGlobalByOwner}) exist so {@link StaffEffectsService} and the
 * tick services can ask the questions they actually need without hauling
 * full lists around.
 */
public final class StaffMemberService {

	private static final Logger log = LoggerFactory.getLogger(StaffMemberService.class);

	private final DataSource dataSource;

	public StaffMemberService(DataSource dataSource) {
		this.dataSource = dataSource;
	}

	// ─── lifecycle ───────────────────────────────────────────────────────

	/**
	 * Insert a hire row. Caller is responsible for level/cap/balance checks
	 * and for debiting the hire cost in the same logical operation.
	 *
	 * @param ownerUserId  the player who hired
	 * @param roleId       a {@link StaffRole#id()} known to the catalog
	 * @param enclosureId  required for enclosure-scope roles, must be empty for global
	 * @return the newly inserted staff member
	 */
	public StaffMember create(long ownerUserId, String roleId, OptionalLong enclosureId) {
		long now = Instant.now().toEpochMilli();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO staff_member(
			         owner_user_id, role_id, enclosure_id, custom_name,
			         hired_at, last_paid_at)
			     VALUES (?, ?, ?, NULL, ?, NULL)
			     """, Statement.RETURN_GENERATED_KEYS)) {
			ps.setLong(1, ownerUserId);
			ps.setString(2, roleId);
			if (enclosureId.isPresent()) ps.setLong(3, enclosureId.getAsLong());
			else ps.setNull(3, java.sql.Types.INTEGER);
			ps.setLong(4, now);
			ps.executeUpdate();
			try (ResultSet rs = ps.getGeneratedKeys()) {
				if (!rs.next()) throw new IllegalStateException("INSERT did not return a key");
				long id = rs.getLong(1);
				return new StaffMember(id, ownerUserId, roleId, enclosureId,
					Optional.empty(), Instant.ofEpochMilli(now), Optional.empty());
			}
		} catch (SQLException e) {
			throw new IllegalStateException(
				"staff_member create failed for owner=" + ownerUserId + " role=" + roleId, e);
		}
	}

	/**
	 * Permanently remove a staff member (used by /staff fire and the
	 * wages tick when a player can't pay).
	 *
	 * @return {@code true} if a row was deleted
	 */
	public boolean delete(long staffId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "DELETE FROM staff_member WHERE id = ?")) {
			ps.setLong(1, staffId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("staff_member delete(" + staffId + ") failed", e);
		}
	}

	/**
	 * Reassign an enclosure-scope staff member to a different enclosure.
	 * No checks here — the command layer enforces ownership and fee debit.
	 *
	 * @return {@code true} if a row was updated
	 */
	public boolean reassign(long staffId, long newEnclosureId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE staff_member SET enclosure_id = ? WHERE id = ?")) {
			ps.setLong(1, newEnclosureId);
			ps.setLong(2, staffId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("staff_member reassign(" + staffId + ") failed", e);
		}
	}

	/**
	 * Update {@code custom_name}. Trimmed; null/blank stores SQL NULL.
	 *
	 * @return {@code true} if a row was updated
	 */
	public boolean rename(long staffId, String newName) {
		String stored = (newName == null || newName.isBlank()) ? null : newName.trim();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE staff_member SET custom_name = ? WHERE id = ?")) {
			if (stored == null) ps.setNull(1, java.sql.Types.VARCHAR);
			else ps.setString(1, stored);
			ps.setLong(2, staffId);
			return ps.executeUpdate() > 0;
		} catch (SQLException e) {
			throw new IllegalStateException("staff_member rename(" + staffId + ") failed", e);
		}
	}

	/**
	 * Stamp {@code last_paid_at} after a successful wage debit. Best-effort:
	 * a write failure here doesn't roll back the debit (the ledger is the
	 * authoritative record).
	 */
	public void markPaid(long staffId, Instant when) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE staff_member SET last_paid_at = ? WHERE id = ?")) {
			ps.setLong(1, when.toEpochMilli());
			ps.setLong(2, staffId);
			ps.executeUpdate();
		} catch (SQLException e) {
			log.warn("staff_member markPaid({}) failed: {}", staffId, e.toString());
		}
	}

	// ─── reads ───────────────────────────────────────────────────────────

	public Optional<StaffMember> findById(long staffId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(SELECT_ALL + " WHERE id = ?")) {
			ps.setLong(1, staffId);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) return Optional.empty();
				return Optional.of(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("staff_member findById({}) failed: {}", staffId, e.toString());
			return Optional.empty();
		}
	}

	public List<StaffMember> findByOwner(long ownerUserId) {
		List<StaffMember> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     SELECT_ALL + " WHERE owner_user_id = ? ORDER BY id")) {
			ps.setLong(1, ownerUserId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("staff_member findByOwner({}) failed: {}", ownerUserId, e.toString());
		}
		return out;
	}

	/**
	 * @return staff in a specific enclosure (any role). Used by
	 *         {@link StaffEffectsService} for per-enclosure lookups.
	 */
	public List<StaffMember> findByEnclosure(long enclosureId) {
		List<StaffMember> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     SELECT_ALL + " WHERE enclosure_id = ? ORDER BY id")) {
			ps.setLong(1, enclosureId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("staff_member findByEnclosure({}) failed: {}", enclosureId, e.toString());
		}
		return out;
	}

	/**
	 * @return global-scope staff (no enclosure assigned) for one player.
	 *         Used by {@link StaffEffectsService} for incubation and
	 *         income multiplier lookups.
	 */
	public List<StaffMember> findGlobalByOwner(long ownerUserId) {
		List<StaffMember> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     SELECT_ALL + " WHERE owner_user_id = ? AND enclosure_id IS NULL ORDER BY id")) {
			ps.setLong(1, ownerUserId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("staff_member findGlobalByOwner({}) failed: {}", ownerUserId, e.toString());
		}
		return out;
	}

	/**
	 * @return how many of {@code roleId} the player already owns —
	 *         enforced against {@link StaffRole#maxOwned()} at hire time.
	 */
	public int countByOwnerAndRole(long ownerUserId, String roleId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM staff_member WHERE owner_user_id = ? AND role_id = ?")) {
			ps.setLong(1, ownerUserId);
			ps.setString(2, roleId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getInt(1) : 0;
			}
		} catch (SQLException e) {
			log.warn("staff_member countByOwnerAndRole failed: {}", e.toString());
			return 0;
		}
	}

	/**
	 * @return every owned staff member system-wide. Used by the wages and
	 *         auto-feed ticks. Small N for v1; can be bounded later.
	 */
	public List<StaffMember> findAll() {
		List<StaffMember> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(SELECT_ALL + " ORDER BY id");
		     ResultSet rs = ps.executeQuery()) {
			while (rs.next()) out.add(mapRow(rs));
		} catch (SQLException e) {
			log.warn("staff_member findAll failed: {}", e.toString());
		}
		return out;
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static final String SELECT_ALL = """
		SELECT id, owner_user_id, role_id, enclosure_id, custom_name,
		       hired_at, last_paid_at
		FROM staff_member
		""";

	private static StaffMember mapRow(ResultSet rs) throws SQLException {
		long encId = rs.getLong("enclosure_id");
		OptionalLong enclosure = rs.wasNull() ? OptionalLong.empty() : OptionalLong.of(encId);

		String name = rs.getString("custom_name");
		Optional<String> customName = (name == null || name.isBlank())
			? Optional.empty() : Optional.of(name);

		long lastPaid = rs.getLong("last_paid_at");
		Optional<Instant> lastPaidAt = rs.wasNull()
			? Optional.empty() : Optional.of(Instant.ofEpochMilli(lastPaid));

		return new StaffMember(
			rs.getLong("id"),
			rs.getLong("owner_user_id"),
			rs.getString("role_id"),
			enclosure,
			customName,
			Instant.ofEpochMilli(rs.getLong("hired_at")),
			lastPaidAt
		);
	}
}
