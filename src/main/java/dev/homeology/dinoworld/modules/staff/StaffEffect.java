package dev.homeology.dinoworld.modules.staff;

/**
 * The mechanical effect a {@link StaffRole} applies. Sealed so
 * {@link StaffEffectsService} and the YAML parser can switch
 * exhaustively over the four cases.
 *
 * <p>Each variant carries the parameters it needs from
 * {@code roles.yaml} — an {@code effect:} block under each role:
 *
 * <pre>{@code
 * effect:
 *   type: auto_feed
 *   capacity: 5
 * }</pre>
 */
public sealed interface StaffEffect {

	/**
	 * Per-enclosure: every tick, auto-feed up to {@link #capacity} of the
	 * lowest-happiness dinos in the enclosure (bypassing the human-only
	 * 6h cooldown). Multiple zookeepers in the same enclosure stack
	 * capacity additively.
	 */
	record AutoFeed(int capacity) implements StaffEffect {
	}

	/**
	 * Per-enclosure: multiply happiness decay by {@link #multiplier}.
	 * Multiple vets in the same enclosure do <em>not</em> compound — the
	 * multiplier is a floor (still 0.5x with two vets).
	 */
	record DecayReduce(double multiplier) implements StaffEffect {
	}

	/**
	 * Global per player: cut egg incubation time at purchase by
	 * {@code perUnitMultiplier^scientistCount}, capped (i.e. never less than)
	 * {@link #floor} of the original duration.
	 */
	record IncubationSpeed(double perUnitMultiplier, double floor) implements StaffEffect {
	}

	/**
	 * Global per player: scale dino hourly income by
	 * {@code 1 + perUnitBonus × marketerCount}, capped at {@link #cap}.
	 */
	record IncomeMultiplier(double perUnitBonus, double cap) implements StaffEffect {
	}
}
