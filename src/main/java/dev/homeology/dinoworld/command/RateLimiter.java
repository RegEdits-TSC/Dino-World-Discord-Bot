package dev.homeology.dinoworld.command;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Per-user fixed-window rate limiter for slash commands.
 *
 * <p>Each user is granted at most {@code limit} invocations per 10-second
 * window. Counters are kept in a Caffeine cache with an
 * {@code expireAfterWrite(10s)} policy, so abandoned entries fall out
 * automatically and the limiter's memory footprint is bounded.
 *
 * <p>The developer (configured {@code DEVELOPER_ID}) is exempt — abuse from
 * the developer's own account is not the threat model. Pass-through is also
 * the behavior when {@code limit <= 0}, which is how operators disable the
 * limiter via {@code RATE_LIMIT_PER_10S=0}.
 *
 * <p>This is a fixed-window limiter, not a sliding window. The "burstiest"
 * legal pattern is two windows back-to-back: {@code 2*limit} commands in
 * just over 10 seconds. That's acceptable for the use case (preventing
 * accidental spam, not adversarial abuse).
 */
public final class RateLimiter {

	/**
	 * Window length matching the cache's expiry.
	 */
	private static final Duration WINDOW = Duration.ofSeconds(10);

	private final int limit;
	private final long developerId;
	private final Cache<Long, AtomicInteger> windows;

	/**
	 * @param limit       max invocations allowed per user per 10-second window;
	 *                    {@code <= 0} disables the limiter (always allows)
	 * @param developerId user id that bypasses the limiter
	 */
	public RateLimiter(int limit, long developerId) {
		this.limit = limit;
		this.developerId = developerId;
		this.windows = Caffeine.newBuilder()
			.expireAfterWrite(WINDOW)
			.maximumSize(50_000)
			.build();
	}

	/**
	 * Record an invocation by {@code userId} and report whether it should be
	 * allowed. Increments the user's window counter as a side effect.
	 *
	 * @return {@code true} to allow, {@code false} if the user is over the limit
	 */
	public boolean tryAcquire(long userId) {
		if (limit <= 0) return true;
		if (userId == developerId) return true;

		AtomicInteger counter = windows.get(userId, k -> new AtomicInteger(0));
		// Caffeine.get(...) with a function never returns null, but null-check defensively
		// in case the entry was evicted between get() and increment.
		if (counter == null) return true;
		return counter.incrementAndGet() <= limit;
	}

	/**
	 * @return the configured per-window limit (0 means disabled)
	 */
	public int limit() {
		return limit;
	}

	/**
	 * @return seconds in one rate-limit window
	 */
	public long windowSeconds() {
		return WINDOW.toSeconds();
	}
}
