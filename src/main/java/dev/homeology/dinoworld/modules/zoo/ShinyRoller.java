package dev.homeology.dinoworld.modules.zoo;

import java.util.concurrent.ThreadLocalRandom;
import java.util.random.RandomGenerator;

/**
 * Rolls the rare "shiny" outcome for a freshly-hatched dino. Implemented
 * as a {@code 1 / {@value SHINY_DENOMINATOR}} chance per hatch — Pokémon-
 * classic odds. Shinies grant a permanent +50% income bonus and a ✨
 * prefix on the dino's display name.
 *
 * <p>The {@link RandomGenerator} is injected so tests can pin the outcome;
 * production wires {@link ThreadLocalRandom}.
 */
public final class ShinyRoller {

	/**
	 * Denominator of the shiny-hatch probability. 512 keeps the moment
	 * memorable without making it inaccessible: a player hatching a few
	 * dozen eggs has a meaningful chance of seeing one over a long
	 * playthrough.
	 */
	public static final int SHINY_DENOMINATOR = 512;

	/** Permanent income multiplier applied to shiny dinos. */
	public static final double SHINY_INCOME_MULTIPLIER = 1.50;

	private final RandomGenerator rng;

	/** Production constructor — uses {@link ThreadLocalRandom}. */
	public ShinyRoller() {
		this(ThreadLocalRandom.current());
	}

	/** Test seam — inject a deterministic RNG. */
	public ShinyRoller(RandomGenerator rng) {
		this.rng = rng;
	}

	/**
	 * @return {@code true} on the rare 1/{@value #SHINY_DENOMINATOR} outcome.
	 */
	public boolean roll() {
		return rng.nextInt(SHINY_DENOMINATOR) == 0;
	}
}
