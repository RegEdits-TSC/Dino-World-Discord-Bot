package dev.homeology.dinoworld.modules.staff;

/**
 * One hireable staff role — a row from {@code data/staff/roles.yaml}.
 *
 * <p>Defines the per-role economy (hire cost, hourly wage, max-owned cap,
 * level unlock) and the {@link StaffEffect} the role applies. Loaded once
 * at module load by {@link StaffCatalog}.
 *
 * @param id            stable identifier (matches the YAML map key, also
 *                      the value stored in {@code staff_member.role_id})
 * @param displayName   user-visible name shown in the hire flow and lists
 * @param hireCost      one-time coin cost to hire this role
 * @param wagePerHour   coins debited every hour the role is employed
 * @param scope         {@link Scope#ENCLOSURE} (one assignment per enclosure)
 *                      or {@link Scope#GLOBAL} (player-wide; no enclosure)
 * @param maxOwned      hard cap on simultaneous hires of this role per player
 * @param unlockLevel   minimum player level required to hire
 * @param effect        what the role actually does each tick — see
 *                      {@link StaffEffectsService} for application
 */
public record StaffRole(
	String id,
	String displayName,
	long hireCost,
	long wagePerHour,
	Scope scope,
	int maxOwned,
	int unlockLevel,
	StaffEffect effect
) {

	/**
	 * Whether the role attaches to a specific enclosure or applies
	 * player-wide. Drives whether the hire flow asks for an enclosure
	 * pick and whether {@code staff_member.enclosure_id} is set.
	 */
	public enum Scope {
		/** Bound to one enclosure (zookeeper, vet). */
		ENCLOSURE,
		/** Player-wide; no enclosure (scientist, marketer). */
		GLOBAL
	}
}
