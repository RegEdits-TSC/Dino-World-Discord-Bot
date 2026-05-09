package dev.homeology.dinoworld.modules.staff;

import java.time.Instant;
import java.util.Optional;
import java.util.OptionalLong;

/**
 * Snapshot of a row in {@code staff_member} — one hired employee.
 *
 * <p>{@link #enclosureId} is present for {@link StaffRole.Scope#ENCLOSURE}
 * roles (zookeeper, vet) and empty for {@link StaffRole.Scope#GLOBAL}
 * roles (scientist, marketer). {@link #roleId} keys into the
 * {@link StaffCatalog} for live wages and effects — wages are not
 * snapshotted, so a YAML re-balance applies on the next tick without a
 * migration.
 *
 * @param id           primary key
 * @param ownerUserId  player who hired this staff member (Discord snowflake)
 * @param roleId       matches a {@link StaffRole#id()} in {@link StaffCatalog}
 * @param enclosureId  the assigned enclosure for enclosure-scope roles; empty for global-scope
 * @param customName   optional player-supplied name; empty when unnamed
 * @param hiredAt      when the row was inserted
 * @param lastPaidAt   most recent successful wage debit; empty if never paid yet
 */
public record StaffMember(
	long id,
	long ownerUserId,
	String roleId,
	OptionalLong enclosureId,
	Optional<String> customName,
	Instant hiredAt,
	Optional<Instant> lastPaidAt
) {
}
