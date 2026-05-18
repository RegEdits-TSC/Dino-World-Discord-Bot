package dev.homeology.dinoworld.modules.achievements;

/**
 * What it takes to unlock one {@link Achievement}. Sealed so
 * {@link AchievementAwarder} can dispatch by type with compiler-enforced
 * exhaustiveness — adding a new trigger kind forces every consumer to
 * handle it.
 *
 * <p>YAML representation is a single string in the {@code trigger:} field,
 * parsed by {@link #parse(String)}. See {@code data/achievements/v1.yaml}
 * for the full grammar.
 */
public sealed interface AchievementTrigger
	permits AchievementTrigger.Event,
	AchievementTrigger.PlayerLevel,
	AchievementTrigger.DinoLevel,
	AchievementTrigger.FeedsTotal,
	AchievementTrigger.HatchesTotal,
	AchievementTrigger.KeepDinos,
	AchievementTrigger.OwnEnclosures,
	AchievementTrigger.CoinsEarned,
	AchievementTrigger.CoinsHeld,
	AchievementTrigger.WagesPaid,
	AchievementTrigger.HatchedRarity,
	AchievementTrigger.TraitDiversity,
	AchievementTrigger.TutorialComplete {

	/**
	 * One-shot lifecycle event ({@code event:first_hatch} etc.). The
	 * awarder probes the relevant table to check whether the event has
	 * ever happened.
	 */
	enum EventKind {
		FIRST_HATCH, FIRST_SHINY, FIRST_FEED, FIRST_STAFF_HIRE, FIRST_ENCLOSURE
	}

	record Event(EventKind kind) implements AchievementTrigger {}
	record PlayerLevel(int threshold) implements AchievementTrigger {}
	record DinoLevel(int threshold) implements AchievementTrigger {}
	record FeedsTotal(long threshold) implements AchievementTrigger {}
	record HatchesTotal(long threshold) implements AchievementTrigger {}
	record KeepDinos(long threshold) implements AchievementTrigger {}
	record OwnEnclosures(long threshold) implements AchievementTrigger {}
	record CoinsEarned(long threshold) implements AchievementTrigger {}
	record CoinsHeld(long threshold) implements AchievementTrigger {}
	record WagesPaid(long threshold) implements AchievementTrigger {}
	record HatchedRarity(String rarityId) implements AchievementTrigger {}
	record TraitDiversity(int threshold) implements AchievementTrigger {}
	record TutorialComplete() implements AchievementTrigger {}

	/**
	 * Parse the YAML string form. Throws on malformed input — this is a
	 * static catalog read at startup, not user input, so failing fast
	 * surfaces typos in the YAML before the bot connects to Discord.
	 */
	static AchievementTrigger parse(String raw) {
		if (raw == null || raw.isBlank()) {
			throw new IllegalArgumentException("achievement trigger is required");
		}
		String[] parts = raw.split(":", 2);
		return switch (parts[0]) {
			case "event" -> parseEvent(parts);
			case "level" -> new PlayerLevel(parseInt(parts, raw));
			case "dino_level" -> new DinoLevel(parseInt(parts, raw));
			case "feeds_total" -> new FeedsTotal(parseLong(parts, raw));
			case "hatches_total" -> new HatchesTotal(parseLong(parts, raw));
			case "keep_dinos" -> new KeepDinos(parseLong(parts, raw));
			case "own_enclosures" -> new OwnEnclosures(parseLong(parts, raw));
			case "coins_earned" -> new CoinsEarned(parseLong(parts, raw));
			case "coins_held" -> new CoinsHeld(parseLong(parts, raw));
			case "wages_paid" -> new WagesPaid(parseLong(parts, raw));
			case "hatched_rarity" -> {
				if (parts.length < 2 || parts[1].isBlank()) {
					throw new IllegalArgumentException("hatched_rarity needs a rarity id: " + raw);
				}
				yield new HatchedRarity(parts[1]);
			}
			case "trait_diversity" -> new TraitDiversity(parseInt(parts, raw));
			case "tutorial_complete" -> new TutorialComplete();
			default -> throw new IllegalArgumentException(
				"unknown achievement trigger kind '" + parts[0] + "' in '" + raw + "'");
		};
	}

	private static Event parseEvent(String[] parts) {
		if (parts.length < 2 || parts[1].isBlank()) {
			throw new IllegalArgumentException("event: trigger needs a name (e.g. event:first_hatch)");
		}
		EventKind k = switch (parts[1]) {
			case "first_hatch" -> EventKind.FIRST_HATCH;
			case "first_shiny" -> EventKind.FIRST_SHINY;
			case "first_feed" -> EventKind.FIRST_FEED;
			case "first_staff_hire" -> EventKind.FIRST_STAFF_HIRE;
			case "first_enclosure" -> EventKind.FIRST_ENCLOSURE;
			default -> throw new IllegalArgumentException(
				"unknown event trigger '" + parts[1] + "'");
		};
		return new Event(k);
	}

	private static int parseInt(String[] parts, String raw) {
		if (parts.length < 2) {
			throw new IllegalArgumentException("trigger needs a number: " + raw);
		}
		try {
			return Integer.parseInt(parts[1].trim());
		} catch (NumberFormatException e) {
			throw new IllegalArgumentException("trigger needs an integer: " + raw, e);
		}
	}

	private static long parseLong(String[] parts, String raw) {
		if (parts.length < 2) {
			throw new IllegalArgumentException("trigger needs a number: " + raw);
		}
		try {
			return Long.parseLong(parts[1].trim());
		} catch (NumberFormatException e) {
			throw new IllegalArgumentException("trigger needs a long: " + raw, e);
		}
	}
}
