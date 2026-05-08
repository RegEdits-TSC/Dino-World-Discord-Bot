package dev.homeology.dinoworld.cache;

import com.github.benmanes.caffeine.cache.Cache;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Smoke tests for {@link CacheManager}'s naming, type tracking, and stats
 * snapshotting.
 */
class CacheManagerTest {

	@Test
	void sameNameSameTypesReturnsSameInstance() {
		CacheManager mgr = new CacheManager();
		Cache<String, Long> a = mgr.get("foo", String.class, Long.class, b -> b.maximumSize(10));
		Cache<String, Long> b = mgr.get("foo", String.class, Long.class, x -> x.maximumSize(10));
		assertSame(a, b);
	}

	@Test
	void sameNameDifferentTypesThrows() {
		CacheManager mgr = new CacheManager();
		mgr.get("foo", String.class, Long.class, b -> b);
		IllegalStateException ex = assertThrows(IllegalStateException.class,
			() -> mgr.get("foo", String.class, Integer.class, b -> b));
		assertTrue(ex.getMessage().contains("foo"), () -> "Got: " + ex.getMessage());
		assertTrue(ex.getMessage().contains("Long"));
		assertTrue(ex.getMessage().contains("Integer"));
	}

	@Test
	void getDefaultUsesSharedDefaults() {
		CacheManager mgr = new CacheManager();
		Cache<String, String> c = mgr.getDefault("d", String.class, String.class);
		c.put("k", "v");
		assertEquals("v", c.getIfPresent("k"));
	}

	@Test
	void snapshotIsAlphabeticallyOrdered() {
		CacheManager mgr = new CacheManager();
		mgr.getDefault("zeta", String.class, String.class);
		mgr.getDefault("alpha", String.class, String.class);
		mgr.getDefault("mu", String.class, String.class);
		var keys = mgr.snapshot().keySet().stream().toList();
		assertEquals(java.util.List.of("alpha", "mu", "zeta"), keys);
	}

	@Test
	void recordStatsAlwaysOnRegardlessOfSpec() {
		CacheManager mgr = new CacheManager();
		Cache<String, String> c = mgr.get("plain", String.class, String.class, b -> b.maximumSize(10));
		c.put("k", "v");
		c.getIfPresent("k");        // hit
		c.getIfPresent("missing");  // miss
		var stats = mgr.snapshot().get("plain");
		assertEquals(1, stats.hitCount());
		assertEquals(1, stats.missCount());
	}
}
