package dev.homeology.dinoworld.command;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Smoke tests for {@link RateLimiter}'s window arithmetic and bypass logic.
 *
 * <p>Window expiry isn't exercised here (would require sleeping or a clock
 * abstraction); that path is exercised manually via the live bot.
 */
class RateLimiterTest {

	private static final long DEV = 1L;
	private static final long USER = 2L;

	@Test
	void allowsUpToLimit() {
		RateLimiter rl = new RateLimiter(3, DEV);
		assertTrue(rl.tryAcquire(USER));
		assertTrue(rl.tryAcquire(USER));
		assertTrue(rl.tryAcquire(USER));
	}

	@Test
	void rejectsAfterLimit() {
		RateLimiter rl = new RateLimiter(3, DEV);
		rl.tryAcquire(USER);
		rl.tryAcquire(USER);
		rl.tryAcquire(USER);
		assertFalse(rl.tryAcquire(USER));
		assertFalse(rl.tryAcquire(USER));
	}

	@Test
	void developerBypassesLimit() {
		RateLimiter rl = new RateLimiter(1, DEV);
		for (int i = 0; i < 100; i++) {
			assertTrue(rl.tryAcquire(DEV), "developer must always be allowed (call " + i + ")");
		}
	}

	@Test
	void zeroLimitDisablesEnforcement() {
		RateLimiter rl = new RateLimiter(0, DEV);
		for (int i = 0; i < 100; i++) {
			assertTrue(rl.tryAcquire(USER));
		}
	}

	@Test
	void usersAreIsolated() {
		RateLimiter rl = new RateLimiter(1, DEV);
		assertTrue(rl.tryAcquire(USER));
		assertFalse(rl.tryAcquire(USER));
		// A different user has its own counter.
		assertTrue(rl.tryAcquire(USER + 1));
	}
}
