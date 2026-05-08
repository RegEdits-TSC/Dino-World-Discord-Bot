package dev.homeology.dinoworld.core;

import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.command.ComponentRouter;
import dev.homeology.dinoworld.config.AppConfig;
import dev.homeology.dinoworld.database.Database;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.lifecycle.LifecycleManager;
import dev.homeology.dinoworld.metrics.MetricsRegistry;
import dev.homeology.dinoworld.scheduler.TickScheduler;
import dev.homeology.dinoworld.settings.GuildSettings;
import net.dv8tion.jda.api.JDA;

import java.time.Instant;
import java.util.concurrent.ScheduledExecutorService;

/**
 * Bundle of shared services handed to every module at load time and used
 * throughout its lifetime.
 *
 * <p>This is the only thing modules should pull from the framework — keeping
 * the surface narrow makes it easy to mock for tests and to evolve the
 * underlying implementations without touching modules.
 *
 * <p>{@link #services} is the cross-module API channel: a module publishes
 * its service in {@link Module#onLoad} via {@link ServiceRegistry#register},
 * and other modules consume it in {@link Module#onEnable} via
 * {@link ServiceRegistry#get}. Module load order is alphabetical by name,
 * which is the de facto dependency contract.
 *
 * <p>{@link #components} routes button, select-menu, and modal interactions;
 * modules that surface interactive UIs register namespaced handlers there.
 *
 * <p>{@link #tickScheduler} is the durable named-job scheduler with restart
 * back-fill — modules use it for "every hour", "every 30 seconds" jobs that
 * need to survive bot outages.
 *
 * <p>The {@link #modules} and {@link #migrationRunner} accessors are
 * present primarily for the built-in {@code /debug} command tree.
 *
 * <p>{@link #toCommandContext()} produces the matching record handed to
 * commands at execution time; the command-side context stays narrow on
 * purpose.
 */
public record ModuleContext(
	AppConfig config,
	JDA jda,
	Database database,
	CacheManager cache,
	ScheduledExecutorService scheduler,
	LifecycleManager lifecycle,
	ModuleManager modules,
	MigrationRunner migrationRunner,
	MetricsRegistry metrics,
	GuildSettings settings,
	ServiceRegistry services,
	ComponentRouter components,
	TickScheduler tickScheduler,
	Instant startedAt
) {

	/**
	 * @return a {@link CommandContext} built from this module context's services
	 */
	public CommandContext toCommandContext() {
		return new CommandContext(
			config, jda, database, cache, scheduler, lifecycle, settings, metrics, services);
	}
}
