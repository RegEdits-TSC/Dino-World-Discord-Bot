package dev.homeology.dinoworld.command;

import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.config.AppConfig;
import dev.homeology.dinoworld.core.ServiceRegistry;
import dev.homeology.dinoworld.metrics.MetricsRegistry;
import io.github.cdimascio.dotenv.Dotenv;
import net.dv8tion.jda.api.JDA;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/**
 * Unit tests for {@link ComponentRouter}.
 *
 * <p>The full dispatch path involves JDA event objects that are awkward to
 * fake; those are exercised by manual end-to-end verification against a
 * real Discord test guild. These tests pin the pure pieces:
 * {@code custom_id} parsing and registration semantics.
 */
class ComponentRouterTest {

	private ComponentRouter router;
	private ScheduledExecutorService scheduler;
	private ExecutorService commandExec;

	@BeforeEach
	void setUp(@TempDir Path tmp) throws IOException {
		Files.writeString(tmp.resolve(".env"), """
			BOT_TOKEN=abc
			DEVELOPER_ID=1
			""");
		Dotenv dotenv = Dotenv.configure().directory(tmp.toString()).load();
		AppConfig config = new AppConfig(dotenv);

		scheduler = Executors.newSingleThreadScheduledExecutor();
		commandExec = Executors.newSingleThreadExecutor();
		MetricsRegistry metrics = new MetricsRegistry();

		CommandContext ctx = new CommandContext(
			config, mock(JDA.class), null, new CacheManager(),
			scheduler, null, null, metrics, new ServiceRegistry());

		router = new ComponentRouter(ctx, scheduler, commandExec, metrics, config);
	}

	@AfterEach
	void tearDown() {
		scheduler.shutdownNow();
		commandExec.shutdownNow();
	}

	// ─── parsing ─────────────────────────────────────────────────────────

	@Test
	void parseRouteKeySplitsNamespaceAndArgs() {
		ComponentRouter.RouteKey k = ComponentRouter.parseRouteKey("zoo:feed:dino-42");
		assertEquals("zoo", k.namespace());
		assertArrayEquals(new String[]{"feed", "dino-42"}, k.args());
	}

	@Test
	void parseRouteKeyHandlesSingleSegment() {
		ComponentRouter.RouteKey k = ComponentRouter.parseRouteKey("zoo");
		assertEquals("zoo", k.namespace());
		assertEquals(0, k.args().length);
	}

	@Test
	void parseRouteKeyHandlesTrailingColon() {
		ComponentRouter.RouteKey k = ComponentRouter.parseRouteKey("zoo:");
		assertEquals("zoo", k.namespace());
		assertEquals(0, k.args().length);
	}

	@Test
	void parseRouteKeyKeepsEmptyArgs() {
		ComponentRouter.RouteKey k = ComponentRouter.parseRouteKey("zoo:a::b");
		assertEquals("zoo", k.namespace());
		assertArrayEquals(new String[]{"a", "", "b"}, k.args());
	}

	// ─── registration ────────────────────────────────────────────────────

	@Test
	void registerThenDuplicateThrows() {
		ComponentHandler h = (e, args, ctx) -> {};
		router.register("zoo", h);
		IllegalStateException ex = assertThrows(IllegalStateException.class,
			() -> router.register("zoo", h));
		assertTrue(ex.getMessage().contains("already registered"));
	}

	@Test
	void registerRejectsNullNamespace() {
		assertThrows(IllegalArgumentException.class,
			() -> router.register(null, (e, args, ctx) -> {}));
	}

	@Test
	void registerRejectsBlankNamespace() {
		assertThrows(IllegalArgumentException.class,
			() -> router.register("  ", (e, args, ctx) -> {}));
	}

	@Test
	void registerRejectsNamespaceWithColon() {
		assertThrows(IllegalArgumentException.class,
			() -> router.register("zoo:bad", (e, args, ctx) -> {}));
	}
}
