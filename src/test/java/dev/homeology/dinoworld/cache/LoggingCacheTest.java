package dev.homeology.dinoworld.cache;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Behavior tests for {@link LoggingCache}. The wrapper must be
 * transparent — every method has to behave exactly like the underlying
 * Caffeine cache. Log output isn't asserted here; that's an SLF4J
 * concern best left to manual eyeballing at DEBUG. The job of these
 * tests is to prove the wrapping doesn't break semantics.
 */
class LoggingCacheTest {

	private static <K, V> LoggingCache<K, V> wrap(Cache<K, V> delegate, String name) {
		return new LoggingCache<>(delegate, name);
	}

	@Test
	void getIfPresentDelegates() {
		Cache<String, String> inner = Caffeine.newBuilder().recordStats().build();
		LoggingCache<String, String> c = wrap(inner, "t");
		assertNull(c.getIfPresent("missing"));
		c.put("k", "v");
		assertEquals("v", c.getIfPresent("k"));
	}

	@Test
	void getWithLoaderInvokesLoaderOnMissOnly() {
		Cache<String, String> inner = Caffeine.newBuilder().recordStats().build();
		LoggingCache<String, String> c = wrap(inner, "t");
		int[] loaderCalls = {0};
		String first = c.get("k", k -> { loaderCalls[0]++; return "loaded"; });
		String second = c.get("k", k -> { loaderCalls[0]++; return "should-not-run"; });
		assertEquals("loaded", first);
		assertEquals("loaded", second);
		assertEquals(1, loaderCalls[0]);
	}

	@Test
	void invalidateRemoves() {
		Cache<String, String> inner = Caffeine.newBuilder().recordStats().build();
		LoggingCache<String, String> c = wrap(inner, "t");
		c.put("k", "v");
		c.invalidate("k");
		assertNull(c.getIfPresent("k"));
	}

	@Test
	void statsForwardToUnderlying() {
		Cache<String, String> inner = Caffeine.newBuilder().recordStats().build();
		LoggingCache<String, String> c = wrap(inner, "t");
		c.put("k", "v");
		c.getIfPresent("k");        // hit
		c.getIfPresent("missing");  // miss
		assertEquals(1, c.stats().hitCount());
		assertEquals(1, c.stats().missCount());
	}

	@Test
	void estimatedSizeForwards() {
		Cache<String, String> inner = Caffeine.newBuilder().recordStats().build();
		LoggingCache<String, String> c = wrap(inner, "t");
		c.put("a", "1");
		c.put("b", "2");
		// Caffeine's estimatedSize is best-effort but should be at
		// least the number of recent puts after cleanup.
		c.cleanUp();
		assertTrue(c.estimatedSize() >= 1);
	}

	@Test
	void asMapForwards() {
		Cache<String, String> inner = Caffeine.newBuilder().recordStats().build();
		LoggingCache<String, String> c = wrap(inner, "t");
		c.put("k", "v");
		assertEquals("v", c.asMap().get("k"));
	}
}
