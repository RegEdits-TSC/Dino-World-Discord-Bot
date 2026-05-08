package dev.homeology.dinoworld.core;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for {@link ServiceRegistry}.
 *
 * <p>The registry is the sole sanctioned channel for cross-module calls, so
 * these tests pin its three invariants: lookups round-trip the registered
 * impl, duplicate registration is rejected (signals two modules competing
 * for the same key), and missing lookups fail fast (so module-ordering bugs
 * surface at startup not at first command).
 */
class ServiceRegistryTest {

	interface Greeter {
		String hello();
	}

	@Test
	void registerThenGetReturnsSameInstance() {
		ServiceRegistry r = new ServiceRegistry();
		Greeter g = () -> "hi";
		r.register(Greeter.class, g);
		assertSame(g, r.get(Greeter.class));
		assertTrue(r.has(Greeter.class));
		assertSame(g, r.tryGet(Greeter.class).orElseThrow());
	}

	@Test
	void duplicateRegistrationThrows() {
		ServiceRegistry r = new ServiceRegistry();
		r.register(Greeter.class, () -> "first");
		IllegalStateException ex = assertThrows(IllegalStateException.class,
			() -> r.register(Greeter.class, () -> "second"));
		assertTrue(ex.getMessage().contains("already registered"));
	}

	@Test
	void getOfMissingThrows() {
		ServiceRegistry r = new ServiceRegistry();
		IllegalStateException ex = assertThrows(IllegalStateException.class,
			() -> r.get(Greeter.class));
		assertTrue(ex.getMessage().contains("not registered"));
		assertFalse(r.has(Greeter.class));
		assertTrue(r.tryGet(Greeter.class).isEmpty());
	}

	@Test
	void registerNullThrows() {
		ServiceRegistry r = new ServiceRegistry();
		assertThrows(IllegalArgumentException.class,
			() -> r.register(Greeter.class, null));
	}
}
