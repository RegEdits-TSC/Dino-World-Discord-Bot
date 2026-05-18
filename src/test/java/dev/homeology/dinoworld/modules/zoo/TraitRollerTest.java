package dev.homeology.dinoworld.modules.zoo;

import org.junit.jupiter.api.Test;

import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;
import java.util.random.RandomGeneratorFactory;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Statistical tests for {@link TraitRoller}. We pin the RNG with a
 * known-good seed so the assertions are deterministic, and use a large
 * sample size (50k) to keep the tolerance windows tight without making
 * the test flaky on a different JDK build.
 */
class TraitRollerTest {

	private static final long SEED = 0xD1_F0_FEEDL;
	private static final int SAMPLES = 50_000;

	/** Wide tolerance: ±2 percentage points on a 50k-sample fraction. */
	private static final double TOLERANCE = 0.02;

	@Test
	void rollProducesPlainAround30Percent() {
		RandomGenerator rng = newRng();
		TraitRoller roller = new TraitRoller(rng);

		int plain = 0;
		for (int i = 0; i < SAMPLES; i++) {
			if (roller.roll().isEmpty()) plain++;
		}
		double fraction = plain / (double) SAMPLES;
		assertEquals(TraitRoller.PLAIN_PROBABILITY, fraction, TOLERANCE,
			"Plain fraction drifted from expected ~30%");
	}

	@Test
	void nonPlainOutcomesAreRoughlyUniformAcrossAllTraits() {
		RandomGenerator rng = newRng();
		TraitRoller roller = new TraitRoller(rng);

		Map<DinoTrait, Integer> counts = new EnumMap<>(DinoTrait.class);
		int nonPlain = 0;
		for (int i = 0; i < SAMPLES; i++) {
			Optional<DinoTrait> t = roller.roll();
			if (t.isPresent()) {
				counts.merge(t.get(), 1, Integer::sum);
				nonPlain++;
			}
		}
		assertTrue(nonPlain > 0, "Sanity: at least some non-plain outcomes");

		double expectedShare = 1.0 / DinoTrait.values().length;
		for (DinoTrait t : DinoTrait.values()) {
			double share = counts.getOrDefault(t, 0) / (double) nonPlain;
			assertEquals(expectedShare, share, TOLERANCE,
				"Trait " + t + " is over-/under-represented (share=" + share + ")");
		}
	}

	@Test
	void zeroProbabilityRngAlwaysReturnsATrait() {
		// nextDouble() == 0.0 stays inside [0, 0.30) so plain branch triggers.
		// We force a non-zero RNG by using one that returns 0.99: well above
		// the plain threshold, so every roll is a real trait.
		RandomGenerator rng = new SequenceRng(new double[]{0.99}, new int[]{0});
		TraitRoller roller = new TraitRoller(rng);
		assertTrue(roller.roll().isPresent(), "0.99 nextDouble must skip plain");
	}

	@Test
	void zeroDoubleAlwaysHitsPlain() {
		RandomGenerator rng = new SequenceRng(new double[]{0.0}, new int[]{0});
		TraitRoller roller = new TraitRoller(rng);
		assertTrue(roller.roll().isEmpty(), "nextDouble == 0 lies inside plain band");
	}

	private static RandomGenerator newRng() {
		return RandomGeneratorFactory.of("L64X128MixRandom").create(SEED);
	}

	/**
	 * Minimal RandomGenerator that replays fixed double/int values. Only
	 * the methods actually used by {@link TraitRoller} are implemented;
	 * everything else throws.
	 */
	private static final class SequenceRng implements RandomGenerator {
		private final double[] doubles;
		private final int[] ints;
		private int di;
		private int ii;

		SequenceRng(double[] doubles, int[] ints) {
			this.doubles = doubles;
			this.ints = ints;
		}

		@Override public double nextDouble() { return doubles[di++ % doubles.length]; }
		@Override public int nextInt(int bound) { return ints[ii++ % ints.length] % bound; }
		@Override public long nextLong() { throw new UnsupportedOperationException(); }
	}
}
