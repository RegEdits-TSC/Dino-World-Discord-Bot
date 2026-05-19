package dev.homeology.dinoworld.modules.zoo;

import org.junit.jupiter.api.Test;

import java.util.random.RandomGenerator;
import java.util.random.RandomGeneratorFactory;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Tests for {@link ShinyRoller}. The hit rate is a {@code 1 /
 * SHINY_DENOMINATOR} Bernoulli trial; we pin behavior at the boundary
 * values and verify the long-run hit fraction with a fixed seed.
 */
class ShinyRollerTest {

	private static final long SEED = 0xFEEDFACECAFEBEEFL;
	private static final int SAMPLES = 200_000;

	@Test
	void rollIsTrueOnlyWhenNextIntReturnsZero() {
		// Replays exactly one zero then non-zeros forever; first roll must be
		// shiny, every subsequent roll must be normal.
		StubRng rng = new StubRng(new int[]{0, 1, 17, 511});
		ShinyRoller roller = new ShinyRoller(rng);
		assertTrue(roller.roll(), "nextInt == 0 → shiny");
		assertFalse(roller.roll(), "nextInt == 1 → normal");
		assertFalse(roller.roll(), "nextInt == 17 → normal");
		assertFalse(roller.roll(), "nextInt == 511 → normal");
	}

	@Test
	void rollUsesShinyDenominatorAsBound() {
		// Capture the bound passed into nextInt — must be SHINY_DENOMINATOR
		// or the math no longer matches the documented rate.
		BoundCapturingRng rng = new BoundCapturingRng();
		new ShinyRoller(rng).roll();
		assertEquals(ShinyRoller.SHINY_DENOMINATOR, rng.lastBound);
	}

	@Test
	void shinyHitRateMatchesDocumentedProbability() {
		RandomGenerator rng = RandomGeneratorFactory.of("L64X128MixRandom").create(SEED);
		ShinyRoller roller = new ShinyRoller(rng);
		int hits = 0;
		for (int i = 0; i < SAMPLES; i++) {
			if (roller.roll()) hits++;
		}
		double observed = hits / (double) SAMPLES;
		double expected = 1.0 / ShinyRoller.SHINY_DENOMINATOR;
		// At N=200k the standard deviation is ≈ sqrt(p(1-p)/N) ≈ 0.0001
		// → ±0.0005 is well over 3σ, so this is stable across JDK builds.
		assertEquals(expected, observed, 0.0005,
			"observed hit fraction (" + observed + ") strayed from " + expected);
	}

	@Test
	void shinyIncomeMultiplierIsExposedForDownstreamConsumers() {
		// Sanity check the constant — IncomeTickService and HatchCommand
		// both read it, so a drift here would silently shift balance.
		assertEquals(1.50, ShinyRoller.SHINY_INCOME_MULTIPLIER, 1e-9);
	}

	/** Replays a fixed sequence of int values for nextInt. */
	private static final class StubRng implements RandomGenerator {
		private final int[] values;
		private int idx;
		StubRng(int[] values) { this.values = values; }
		@Override public int nextInt(int bound) { return values[idx++ % values.length]; }
		@Override public long nextLong() { throw new UnsupportedOperationException(); }
	}

	/** Records the bound passed to nextInt so the test can assert on it. */
	private static final class BoundCapturingRng implements RandomGenerator {
		int lastBound = -1;
		@Override public int nextInt(int bound) {
			lastBound = bound;
			return 1; // any non-zero — value doesn't matter for this test
		}
		@Override public long nextLong() { throw new UnsupportedOperationException(); }
	}
}
