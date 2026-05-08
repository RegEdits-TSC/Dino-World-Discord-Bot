package dev.homeology.dinoworld;

import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.command.CommandRegistry;
import dev.homeology.dinoworld.command.CommandRouter;
import dev.homeology.dinoworld.command.ComponentRouter;
import dev.homeology.dinoworld.command.PermissionGate;
import dev.homeology.dinoworld.command.RateLimiter;
import dev.homeology.dinoworld.config.AppConfig;
import dev.homeology.dinoworld.core.Module;
import dev.homeology.dinoworld.core.ModuleContext;
import dev.homeology.dinoworld.core.ModuleManager;
import dev.homeology.dinoworld.core.ServiceRegistry;
import dev.homeology.dinoworld.database.Database;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.lifecycle.LifecycleManager;
import dev.homeology.dinoworld.metrics.MetricsRegistry;
import dev.homeology.dinoworld.scheduler.TickScheduler;
import dev.homeology.dinoworld.settings.GuildSettings;
import io.github.cdimascio.dotenv.Dotenv;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.JDABuilder;
import net.dv8tion.jda.api.exceptions.InvalidTokenException;
import net.dv8tion.jda.api.requests.GatewayIntent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Process entry point.
 *
 * <p>Wires every subsystem together in a fixed order, hands control to JDA,
 * and installs the JVM shutdown hook that drives clean teardown.
 *
 * <p>This is intentionally a procedural script rather than a DI-framework
 * bootstrap — the dependency graph is small and explicit ordering matters
 * (the database must exist before the migration runner runs against it,
 * the scheduler must exist before the router uses it for auto-defer, etc.).
 * The body of {@link #run()} is split into {@link #wireConfigAndRuntime},
 * {@link #wireDatabaseAndModules}, {@link #wireJda}, and
 * {@link #wireListeners} so each stage is small enough to read in one
 * scroll; the order between them is still load-bearing.
 */
public final class Bootstrap {

	private static final Logger log = LoggerFactory.getLogger(Bootstrap.class);

	/**
	 * Bounded pool size for slash-command bodies. Tunable via metrics from #7.
	 */
	private static final int COMMAND_EXECUTOR_THREADS = 8;

	public static void main(String[] args) {
		// JVM-wide uncaught exception handler — catches anything that
		// escapes JDA listeners or background threads.
		Thread.setDefaultUncaughtExceptionHandler((t, e) ->
			log.error("Uncaught exception in thread '{}'", t.getName(), e));

		try {
			run();
		} catch (Exception e) {
			log.error("Bootstrap failed", e);
			System.exit(1);
		}
	}

	private static void run() throws Exception {
		// 1. Ensure runtime directories exist.
		ensureDir(Paths.get("data"));
		ensureDir(Paths.get("logs"));
		ensureDir(Paths.get("backups"));

		Instant startedAt = Instant.now();
		Stage1 s1 = wireConfigAndRuntime();
		Stage2 s2 = wireDatabaseAndModules(s1.config);
		JDA jda = wireJda(s1.config);

		// Cross-module service registry — modules publish here in onLoad,
		// consume in onEnable. Created before LifecycleManager so the registry
		// instance can be shared with components built right after.
		ServiceRegistry services = new ServiceRegistry();

		// Durable named-job scheduler — registers tick_state-backed jobs for
		// modules that need restart-aware periodic work (e.g. notify dispatcher,
		// future zoo income tick).
		TickScheduler tickScheduler = new TickScheduler(s2.database.dataSource(), s1.scheduler);

		LifecycleManager lifecycle = new LifecycleManager(
			s2.moduleManager, s1.scheduler, s1.commandExecutor, s2.database, s1.metrics,
			tickScheduler);
		lifecycle.attachJda(jda);

		GuildSettings settings = new GuildSettings(s2.database.dataSource(), s1.cache);

		// Single CommandContext used by both routers. Built before ModuleContext
		// so ComponentRouter (which is itself stored on ModuleContext) can hold it.
		CommandContext baseContext = new CommandContext(
			s1.config, jda, s2.database, s1.cache, s1.scheduler, lifecycle,
			settings, s1.metrics, services);

		ComponentRouter componentRouter = new ComponentRouter(
			baseContext, s1.scheduler, s1.commandExecutor, s1.metrics, s1.config);

		ModuleContext modCtx = new ModuleContext(
			s1.config, jda, s2.database, s1.cache, s1.scheduler, lifecycle,
			s2.moduleManager, s2.migrations, s1.metrics, settings,
			services, componentRouter, tickScheduler, startedAt);
		s2.moduleManager.loadAll(s2.activeModules, modCtx);
		s2.moduleManager.enableAll();

		wireListeners(jda, s1, s2, baseContext, componentRouter);

		// JVM shutdown hook. Note: System.exit() won't run on this path —
		// the JVM is already on its way out. The /debug system shutdown
		// path goes through LifecycleManager.shutdown() instead.
		Runtime.getRuntime().addShutdownHook(new Thread(lifecycle::teardown, "dinoworld-jvm-hook"));

		// Block until the gateway is fully connected before syncing commands.
		// awaitReady() returns immediately if JDA already reached CONNECTED
		// during enableAll (which is the common case when back-fills run
		// long), and otherwise waits for the gateway to come online — keeping
		// command sync deterministic regardless of how slow enableAll was.
		log.info("Awaiting JDA ready...");
		jda.awaitReady();
		new CommandRegistry(s2.moduleManager.aggregateCommands(), s1.config).sync(jda);

		log.info("Bootstrap complete.");
	}

	// ─── stages ──────────────────────────────────────────────────────────

	private static Stage1 wireConfigAndRuntime() {
		// Load .env. Default behavior throws when the file is missing —
		// we want that, so we don't call ignoreIfMissing().
		Dotenv dotenv = Dotenv.configure().load();
		warnIfEnvWorldReadable(Paths.get(".env"));

		AppConfig config = new AppConfig(dotenv);
		log.info("Config loaded. Developer ID: {}, dev guild: {}",
			config.developerId(), config.devGuildId() == null ? "<global>" : config.devGuildId());

		// Shared scheduler (daemon threads so they don't block JVM exit).
		ScheduledExecutorService scheduler =
			Executors.newScheduledThreadPool(2, daemonNamed("dinoworld-sched"));

		// Bounded pool for command bodies — keeps slow handlers off the JDA
		// event-pool thread.
		ExecutorService commandExecutor =
			Executors.newFixedThreadPool(COMMAND_EXECUTOR_THREADS, daemonNamed("dinoworld-cmd"));

		CacheManager cache = new CacheManager();
		MetricsRegistry metrics = new MetricsRegistry();
		return new Stage1(config, scheduler, commandExecutor, cache, metrics);
	}

	private static Stage2 wireDatabaseAndModules(AppConfig config) {
		Database database = new Database(config.databasePath());

		// Discover (but don't load yet) modules so we know which migration
		// folders to apply before any module touches the DB.
		ModuleManager moduleManager = new ModuleManager();
		List<Module> activeModules = moduleManager.discover(config.disabledModules());
		List<String> moduleNames = activeModules.stream().map(Module::name).toList();

		MigrationRunner migrations = new MigrationRunner(database.dataSource());
		migrations.run(moduleNames);

		return new Stage2(database, moduleManager, activeModules, migrations);
	}

	private static JDA wireJda(AppConfig config) {
		try {
			// createDefault(token) selects all non-privileged intents.
			// MESSAGE_CONTENT is privileged → enable it explicitly so the
			// bot can read message content (required for any future
			// message-based features).
			return JDABuilder.createDefault(config.botToken())
				.enableIntents(GatewayIntent.GUILD_MESSAGES, GatewayIntent.MESSAGE_CONTENT)
				.build();
		} catch (InvalidTokenException e) {
			log.error("BOT_TOKEN appears invalid. Re-check the token in your .env.", e);
			throw e;
		} catch (Exception e) {
			// JDA wraps "intent not enabled" errors at connect-time, not at
			// build-time, so this catch is mostly defensive. We add a
			// clearer hint either way.
			log.error("JDA failed to start. If this is a privileged-intent error, "
				+ "enable MESSAGE CONTENT INTENT in https://discord.com/developers/applications "
				+ "→ your app → Bot.", e);
			throw e;
		}
	}

	private static void wireListeners(JDA jda, Stage1 s1, Stage2 s2,
	                                  CommandContext baseContext,
	                                  ComponentRouter componentRouter) {
		PermissionGate gate = new PermissionGate(s1.config);
		RateLimiter rateLimiter = new RateLimiter(s1.config.rateLimitPer10s(), s1.config.developerId());

		CommandRouter router = new CommandRouter(
			s2.moduleManager.aggregateCommands(),
			gate,
			rateLimiter,
			baseContext,
			s1.scheduler,
			s1.commandExecutor,
			s1.metrics,
			s1.config);
		jda.addEventListener(router);
		jda.addEventListener(componentRouter);
		for (Object listener : s2.moduleManager.aggregateListeners()) {
			jda.addEventListener(listener);
		}
		// Command sync used to live here as a ReadyEvent listener but races
		// with slow enableAll back-fills; it now runs explicitly in run()
		// after jda.awaitReady().
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static void ensureDir(Path p) {
		if (Files.isDirectory(p)) return;
		try {
			Files.createDirectories(p);
			log.info("Created directory {}", p.toAbsolutePath());
		} catch (IOException e) {
			throw new IllegalStateException("Could not create directory: " + p, e);
		}
	}

	/**
	 * On POSIX filesystems, warn if {@code .env} is readable by group or
	 * world. Silently skips on Windows (no POSIX perms) — the file's NTFS
	 * ACL is the user's responsibility there.
	 */
	private static void warnIfEnvWorldReadable(Path env) {
		if (!Files.exists(env)) return;
		try {
			Set<PosixFilePermission> perms = Files.getPosixFilePermissions(env);
			if (perms.contains(PosixFilePermission.GROUP_READ)
				|| perms.contains(PosixFilePermission.OTHERS_READ)) {
				log.warn(".env is readable by group/others. Run `chmod 600 .env` to restrict it.");
			}
		} catch (UnsupportedOperationException ignored) {
			// non-POSIX filesystem (e.g. Windows) — skip
		} catch (IOException e) {
			log.debug("Could not stat .env perms: {}", e.toString());
		}
	}

	private static ThreadFactory daemonNamed(String prefix) {
		AtomicInteger n = new AtomicInteger();
		return r -> {
			Thread t = new Thread(r, prefix + "-" + n.incrementAndGet());
			t.setDaemon(true);
			return t;
		};
	}

	private record Stage1(AppConfig config,
	                      ScheduledExecutorService scheduler,
	                      ExecutorService commandExecutor,
	                      CacheManager cache,
	                      MetricsRegistry metrics) {
	}

	private record Stage2(Database database,
	                      ModuleManager moduleManager,
	                      List<Module> activeModules,
	                      MigrationRunner migrations) {
	}
}
