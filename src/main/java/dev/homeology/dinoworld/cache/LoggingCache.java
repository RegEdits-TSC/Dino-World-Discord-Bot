package dev.homeology.dinoworld.cache;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Policy;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import org.jspecify.annotations.NonNull;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentMap;
import java.util.function.Function;

/**
 * Wraps a Caffeine {@link Cache} to emit DEBUG logs on hit and miss.
 *
 * <p>Logs go to a logger named {@code dinoworld.cache.<name>} (e.g.
 * {@code dinoworld.cache.players}) so an operator can enable verbose
 * tracing for one specific cache without firehosing every cache in the
 * process. Per-cache loggers also let a noisy cache stay quiet while
 * an interesting one is turned up.
 *
 * <p>The wrapper is otherwise transparent — every {@link Cache} method
 * delegates verbatim, including {@link #stats()} and
 * {@link #estimatedSize()} so {@code /debug cache stats} keeps working.
 * Reads ({@link #getIfPresent}, {@link #get}) log hit/miss; writes
 * ({@link #put}, {@link #invalidate}, etc.) log too — the latter is
 * how an operator answers "why is this entry already in the cache?"
 * when a service warms the cache from a write path (e.g.
 * {@code PlayerService.ensure} UPSERTs and then {@code cache.put}s).
 */
final class LoggingCache<K, V extends @Nullable Object> implements Cache<K, V> {

	private final Cache<K, V> delegate;
	private final String name;
	private final Logger log;

	LoggingCache(Cache<K, V> delegate, String name) {
		this.delegate = delegate;
		this.name = name;
		this.log = LoggerFactory.getLogger("dinoworld.cache." + name);
	}

	@Override
	public @Nullable V getIfPresent(K key) {
		V v = delegate.getIfPresent(key);
		log.debug("[{}] {} key={}", name, v == null ? "miss" : "hit", key);
		return v;
	}

	@Override
	public V get(K key, Function<? super K, ? extends V> mappingFunction) {
		// Caffeine's load-on-miss path: wrap the loader so we can tell
		// hit from miss without checking afterwards (which would race
		// with concurrent invalidation).
		boolean[] loaded = {false};
		V v = delegate.get(key, k -> {
			loaded[0] = true;
			return mappingFunction.apply(k);
		});
		log.debug("[{}] {} key={}", name, loaded[0] ? "miss→loaded" : "hit", key);
		return v;
	}

	@Override
	public Map<K, @NonNull V> getAllPresent(Iterable<? extends K> keys) {
		Map<K, @NonNull V> out = delegate.getAllPresent(keys);
		log.debug("[{}] getAllPresent → {} matched", name, out.size());
		return out;
	}

	@Override
	public Map<K, @NonNull V> getAll(Iterable<? extends K> keys,
	                                 Function<? super Set<? extends K>, ? extends Map<? extends K, ? extends @NonNull V>> mappingFunction) {
		return delegate.getAll(keys, mappingFunction);
	}

	@Override
	public void put(K key, @NonNull V value) {
		delegate.put(key, value);
		log.debug("[{}] put key={}", name, key);
	}

	@Override
	public void putAll(Map<? extends K, ? extends @NonNull V> map) {
		delegate.putAll(map);
		log.debug("[{}] putAll → {} entries", name, map.size());
	}

	@Override
	public void invalidate(K key) {
		delegate.invalidate(key);
		log.debug("[{}] invalidate key={}", name, key);
	}

	@Override
	public void invalidateAll(Iterable<? extends K> keys) {
		delegate.invalidateAll(keys);
		log.debug("[{}] invalidateAll(keys)", name);
	}

	@Override
	public void invalidateAll() {
		delegate.invalidateAll();
		log.debug("[{}] invalidateAll()", name);
	}

	@Override
	public long estimatedSize() {
		return delegate.estimatedSize();
	}

	@Override
	public CacheStats stats() {
		return delegate.stats();
	}

	@Override
	public ConcurrentMap<K, @NonNull V> asMap() {
		return delegate.asMap();
	}

	@Override
	public void cleanUp() {
		delegate.cleanUp();
	}

	@Override
	public Policy<K, @NonNull V> policy() {
		return delegate.policy();
	}
}
