package dev.homeology.dinoworld.modules.players.missions;

/**
 * What it takes to satisfy one {@link Mission}. Sealed so
 * {@link MissionAwarder} can dispatch by type with compiler-enforced
 * exhaustiveness — adding a new trigger kind forces every consumer to
 * handle it.
 *
 * <p>YAML representation is a single string in the {@code trigger:}
 * field, parsed by {@link #parse(String)}:
 * <ul>
 *   <li>{@code state:claimed_daily} → {@link State#CLAIMED_DAILY}</li>
 *   <li>{@code state:owns_egg} → {@link State#OWNS_EGG}</li>
 *   <li>{@code state:owns_dino} → {@link State#OWNS_DINO}</li>
 *   <li>{@code state:fed_dino} → {@link State#FED_DINO}</li>
 *   <li>{@code command:shop} → {@link RanCommand}{@code (shop, null)}</li>
 *   <li>{@code command:zoo:dashboard} → {@link RanCommand}{@code (zoo, dashboard)}</li>
 * </ul>
 */
public sealed interface MissionTrigger
	permits MissionTrigger.StateTrigger, MissionTrigger.RanCommand {

	/**
	 * Trigger satisfied by inspecting the player's current state — no
	 * specific command needs to run, just the right state to exist.
	 */
	record StateTrigger(State state) implements MissionTrigger {
	}

	/**
	 * Trigger satisfied when the player runs the named slash command.
	 * {@code subcommand} is null for "any subcommand"; non-null requires
	 * an exact match.
	 */
	record RanCommand(String command, String subcommand) implements MissionTrigger {
	}

	/**
	 * Closed set of state-based predicates the awarder knows how to
	 * check. Adding a new state means adding a new SQL probe in
	 * {@link MissionAwarder} — kept narrow on purpose so the satisfaction
	 * checks stay cheap.
	 */
	enum State {
		/** {@code player.last_daily IS NOT NULL}. */
		CLAIMED_DAILY,
		/** {@code COUNT(egg_instance WHERE owner_user_id = ?) > 0}. */
		OWNS_EGG,
		/** {@code COUNT(dino_instance WHERE owner_user_id = ?) > 0}. */
		OWNS_DINO,
		/** Any owned dino has {@code last_fed_at IS NOT NULL}. */
		FED_DINO
	}

	/**
	 * Parse the YAML string form. Throws on malformed input — this is a
	 * static catalog read at module startup, not user input, so failing
	 * fast surfaces typos in the YAML before the bot connects to Discord.
	 */
	static MissionTrigger parse(String raw) {
		if (raw == null || raw.isBlank()) {
			throw new IllegalArgumentException("mission trigger is required");
		}
		String[] parts = raw.split(":", 3);
		return switch (parts[0]) {
			case "state" -> parseState(parts);
			case "command" -> parseCommand(parts);
			default -> throw new IllegalArgumentException(
				"unknown mission trigger kind '" + parts[0] + "' in '" + raw + "'");
		};
	}

	private static StateTrigger parseState(String[] parts) {
		if (parts.length < 2) {
			throw new IllegalArgumentException("state: trigger needs a name (e.g. state:owns_egg)");
		}
		State s = switch (parts[1]) {
			case "claimed_daily" -> State.CLAIMED_DAILY;
			case "owns_egg" -> State.OWNS_EGG;
			case "owns_dino" -> State.OWNS_DINO;
			case "fed_dino" -> State.FED_DINO;
			default -> throw new IllegalArgumentException(
				"unknown mission state '" + parts[1] + "'");
		};
		return new StateTrigger(s);
	}

	private static RanCommand parseCommand(String[] parts) {
		if (parts.length < 2 || parts[1].isBlank()) {
			throw new IllegalArgumentException(
				"command: trigger needs a command name (e.g. command:shop)");
		}
		String sub = parts.length >= 3 && !parts[2].isBlank() ? parts[2] : null;
		return new RanCommand(parts[1], sub);
	}
}
