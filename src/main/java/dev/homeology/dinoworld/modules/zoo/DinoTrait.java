package dev.homeology.dinoworld.modules.zoo;

import java.util.Optional;

/**
 * Personality trait rolled once at hatch and pinned for the dino's
 * lifetime. Each trait shifts the income/decay math by a small,
 * fixed amount; together with shiny variants and dino leveling, the
 * three multiplicative factors layer on top of the species base income.
 *
 * <p>Rolled by {@link TraitRoller}. Persisted in {@code dino_instance.trait}
 * as the lowercase {@link #id()} string. A {@code NULL} column maps to
 * "plain" — no trait, no modifier — and is the expected outcome for
 * roughly 30% of hatches.
 *
 * <p>Multipliers are kept conservative deliberately: traits should add
 * flavor, not break the income curve. The economy still revolves around
 * base species income × happiness × staff.
 */
public enum DinoTrait {

	/** +10% income, +25% decay — eats fast, grumpy fast. */
	GLUTTONOUS("gluttonous", "Gluttonous", "🍖", 1.10, 1.25),

	/** −15% decay, −5% income — slow but stable. */
	LAZY("lazy", "Lazy", "😴", 0.95, 0.85),

	/** −20% decay — handles the rough days. */
	VIGOROUS("vigorous", "Vigorous", "💪", 1.00, 0.80),

	/** −10% decay, −2% income — average all around, hardly complains. */
	HARDY("hardy", "Hardy", "🛡️", 0.98, 0.90),

	/** +15% income, +20% decay — visitor magnet, high maintenance. */
	PROUD("proud", "Proud", "👑", 1.15, 1.20),

	/** +8% income, +10% decay — energetic and a little exhausting. */
	PLAYFUL("playful", "Playful", "🎉", 1.08, 1.10),

	/**
	 * +5% income when housed with at least one other dino; otherwise
	 * neutral. Implemented by {@link IncomeTickService}, not as a flat
	 * multiplier here.
	 */
	SOCIAL("social", "Social", "🤝", 1.00, 1.00);

	private final String id;
	private final String displayName;
	private final String emoji;
	private final double incomeMult;
	private final double decayMult;

	DinoTrait(String id, String displayName, String emoji, double incomeMult, double decayMult) {
		this.id = id;
		this.displayName = displayName;
		this.emoji = emoji;
		this.incomeMult = incomeMult;
		this.decayMult = decayMult;
	}

	/** Stable lowercase id used as the {@code dino_instance.trait} column value. */
	public String id() {
		return id;
	}

	public String displayName() {
		return displayName;
	}

	public String emoji() {
		return emoji;
	}

	/**
	 * Flat income multiplier applied per dino in {@link IncomeTickService}.
	 * {@link #SOCIAL} returns 1.0 here — its bonus is computed against the
	 * enclosure roster at tick time.
	 */
	public double incomeMult() {
		return incomeMult;
	}

	/** Multiplier applied to the hourly happiness decay rate. */
	public double decayMult() {
		return decayMult;
	}

	/**
	 * Bonus income multiplier for {@link #SOCIAL} dinos when housed with
	 * other dinos in the same enclosure. Returns 1.0 for every other trait
	 * so callers can apply it unconditionally.
	 */
	public double socialBonus(int dinosInSameEnclosure) {
		return this == SOCIAL && dinosInSameEnclosure >= 2 ? 1.05 : 1.0;
	}

	/**
	 * Resolve a stored id back to its enum value. Unknown ids return
	 * {@link Optional#empty()} — the tick code treats them as "plain" so
	 * a future trait being added on a newer build doesn't break older
	 * deployments mid-roll-out.
	 */
	public static Optional<DinoTrait> byId(String id) {
		if (id == null) return Optional.empty();
		for (DinoTrait t : values()) {
			if (t.id.equals(id)) return Optional.of(t);
		}
		return Optional.empty();
	}
}
