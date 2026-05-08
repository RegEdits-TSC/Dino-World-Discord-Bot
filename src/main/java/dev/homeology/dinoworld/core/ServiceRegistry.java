package dev.homeology.dinoworld.core;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Typed cross-module service registry.
 *
 * <p>One module registers a service implementation in {@link Module#onLoad};
 * later modules consume it in {@link Module#onEnable}. This is the only
 * sanctioned way for one feature module to call another's API — modules
 * never import each other's classes directly so the dependency graph stays
 * explicit and breakable.
 *
 * <p>Module load order is the dependency contract.
 * {@link ModuleManager} processes modules alphabetically by
 * {@link Module#name()}: a module that registers a service must therefore
 * sort before any module that consumes it (e.g. {@code notify} before
 * {@code zoo}). If that constraint is awkward, split the consumer into two
 * registrations or rename the producer.
 *
 * <p>Lookups fail fast: {@link #get(Class)} throws
 * {@link IllegalStateException} when the requested service was never
 * registered, surfacing module-ordering bugs at startup rather than as a
 * confusing {@code NullPointerException} the first time a user runs the
 * affected command.
 */
public final class ServiceRegistry {

	private final Map<Class<?>, Object> services = new ConcurrentHashMap<>();

	/**
	 * Publish a service so other modules can consume it.
	 *
	 * @param type interface or class the service is keyed by
	 * @param impl the implementation (must not be {@code null})
	 * @param <T>  service type
	 * @throws IllegalStateException if a service of {@code type} was already registered —
	 *                               two modules competing for the same key is always a bug
	 */
	public <T> void register(Class<T> type, T impl) {
		if (impl == null) {
			throw new IllegalArgumentException(
				"Service impl must not be null for " + type.getName());
		}
		Object prev = services.putIfAbsent(type, impl);
		if (prev != null) {
			throw new IllegalStateException(
				"Service already registered: " + type.getName()
					+ " (existing impl=" + prev.getClass().getName()
					+ ", new impl=" + impl.getClass().getName() + ")");
		}
	}

	/**
	 * Look up a previously registered service.
	 *
	 * @param type the key the service was registered under
	 * @param <T>  service type
	 * @return the registered implementation
	 * @throws IllegalStateException if no service of {@code type} is registered —
	 *                               typically caused by a missing/disabled module
	 *                               or by consuming the service before its
	 *                               producer's {@code onLoad} has run
	 */
	public <T> T get(Class<T> type) {
		Object impl = services.get(type);
		if (impl == null) {
			throw new IllegalStateException(
				"Service not registered: " + type.getName()
					+ ". Either the providing module is disabled, or it was queried "
					+ "before its onLoad() ran. Modules are processed alphabetically by name.");
		}
		return type.cast(impl);
	}

	/**
	 * Soft variant of {@link #get(Class)} for callers that can degrade
	 * gracefully when a service isn't present (e.g. an optional integration).
	 */
	public <T> Optional<T> tryGet(Class<T> type) {
		Object impl = services.get(type);
		return impl == null ? Optional.empty() : Optional.of(type.cast(impl));
	}

	/**
	 * @return {@code true} if a service of {@code type} is registered
	 */
	public boolean has(Class<?> type) {
		return services.containsKey(type);
	}
}
