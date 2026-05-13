package dev.homeology.dinoworld.cache;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.stats.CacheStats;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Function;

/**
 * Hands out named, in-process Caffeine caches.
 *
 * <p>Modules retrieve caches via {@link #get(String, Class, Class, Function)} —
 * the first caller for a given name builds it; later callers receive the same
 * instance. Stats recording is always enabled so {@code /debug cache stats}
 * can show hit-rate, evictions, and size for every cache without per-cache
 * opt-in.
 *
 * <p>Each cache records the {@code (keyType, valueType)} it was first created
 * with. A subsequent {@link #get} for the same name with mismatched types
 * fails fast with a clear {@link IllegalStateException} — the alternative
 * (an unchecked cast) would surface as a {@link ClassCastException} deep
 * inside Caffeine the next time the cache is read or written.
 */
public final class CacheManager {

	private final Map<String, Entry> caches = new ConcurrentHashMap<>();

	/**
	 * Retrieve (or lazily create) a named cache, asserting key and value
	 * types match what the cache was first created with.
	 *
	 * @param name      unique cache name; reused across calls returns the same instance
	 * @param keyType   expected key class — must match on every call
	 * @param valueType expected value class — must match on every call
	 * @param spec      applied to a fresh {@code Caffeine} builder; {@code recordStats()}
	 *                  is forced on regardless of what the caller does
	 * @param <K>       key type
	 * @param <V>       value type
	 * @return the cache instance bound to {@code name}
	 * @throws IllegalStateException if {@code name} was previously created with
	 *                               different {@code keyType} or {@code valueType}
	 */
	@SuppressWarnings("unchecked")
	public <K, V> Cache<K, V> get(String name,
	                              Class<K> keyType,
	                              Class<V> valueType,
	                              Function<Caffeine<Object, Object>, Caffeine<Object, Object>> spec) {
		Entry e = caches.computeIfAbsent(name, n -> {
			Caffeine<Object, Object> builder = Caffeine.newBuilder();
			Caffeine<Object, Object> tuned = spec == null ? builder : spec.apply(builder);
			// Wrap in LoggingCache so DEBUG-level access logging is
			// available per-cache via logger "dinoworld.cache.<name>".
			// Wrapper is transparent — stats(), estimatedSize() and the
			// rest forward to the underlying Caffeine instance.
			Cache<Object, Object> wrapped = new LoggingCache<>(tuned.recordStats().build(), n);
			return new Entry(wrapped, keyType, valueType);
		});
		if (!e.keyType.equals(keyType) || !e.valueType.equals(valueType)) {
			throw new IllegalStateException(
				"Cache '" + name + "' already exists as <"
					+ e.keyType.getSimpleName() + ", " + e.valueType.getSimpleName()
					+ ">, but caller asked for <"
					+ keyType.getSimpleName() + ", " + valueType.getSimpleName() + ">");
		}
		return (Cache<K, V>) e.cache;
	}

	/**
	 * Retrieve (or lazily create) a cache with sensible defaults
	 * (10 000 entries, 10-minute write expiry).
	 */
	public <K, V> Cache<K, V> getDefault(String name, Class<K> keyType, Class<V> valueType) {
		return get(name, keyType, valueType,
			b -> b.maximumSize(10_000).expireAfterWrite(Duration.ofMinutes(10)));
	}

	/**
	 * Snapshot of every cache's current stats. Used by {@code /debug cache stats}.
	 *
	 * @return immutable map: cache name → its {@link CacheStats}
	 */
	public Map<String, CacheStats> snapshot() {
		Map<String, CacheStats> out = new java.util.LinkedHashMap<>();
		// Sort by name for deterministic output in /debug cache stats.
		caches.entrySet().stream()
			.sorted(Map.Entry.comparingByKey())
			.forEach(e -> out.put(e.getKey(), e.getValue().cache.stats()));
		return java.util.Collections.unmodifiableMap(out);
	}

	/**
	 * Snapshot of every cache's current size.
	 */
	public Map<String, Long> sizes() {
		Map<String, Long> out = new java.util.LinkedHashMap<>();
		caches.entrySet().stream()
			.sorted(Map.Entry.comparingByKey())
			.forEach(e -> out.put(e.getKey(), e.getValue().cache.estimatedSize()));
		return java.util.Collections.unmodifiableMap(out);
	}

	private record Entry(Cache<?, ?> cache, Class<?> keyType, Class<?> valueType) {
	}
}
