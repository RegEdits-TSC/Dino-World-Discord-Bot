package dev.homeology.dinoworld.modules.zoo;

import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;
import java.util.random.RandomGenerator;

/**
 * Rolls a personality trait for a freshly-hatched dino.
 *
 * <p>~30% of hatches return {@link Optional#empty()} ("plain" — no trait,
 * no modifier). The remaining 70% are split uniformly across the seven
 * entries of {@link DinoTrait}.
 *
 * <p>The {@link RandomGenerator} is injected so tests can pin the outcome
 * with a seeded RNG; production wires {@link ThreadLocalRandom}.
 */
public final class TraitRoller {

	/**
	 * Probability that a hatch produces no trait at all. Tuned so the
	 * majority of dinos still feel "normal" — traits should be a flavor
	 * touch, not the default state.
	 */
	public static final double PLAIN_PROBABILITY = 0.30;

	private final RandomGenerator rng;

	/** Production constructor — uses {@link ThreadLocalRandom}. */
	public TraitRoller() {
		this(ThreadLocalRandom.current());
	}

	/** Test seam — inject a deterministic RNG. */
	public TraitRoller(RandomGenerator rng) {
		this.rng = rng;
	}

	/**
	 * @return a uniformly-picked {@link DinoTrait}, or empty for the
	 *         "plain" outcome.
	 */
	public Optional<DinoTrait> roll() {
		if (rng.nextDouble() < PLAIN_PROBABILITY) return Optional.empty();
		DinoTrait[] all = DinoTrait.values();
		return Optional.of(all[rng.nextInt(all.length)]);
	}
}
