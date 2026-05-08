package dev.homeology.dinoworld.command;

import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.config.AppConfig;
import dev.homeology.dinoworld.core.ServiceRegistry;
import dev.homeology.dinoworld.database.Database;
import dev.homeology.dinoworld.lifecycle.LifecycleManager;
import dev.homeology.dinoworld.metrics.MetricsRegistry;
import dev.homeology.dinoworld.settings.GuildSettings;
import net.dv8tion.jda.api.JDA;

import java.util.concurrent.ScheduledExecutorService;

/**
 * Shared facilities every {@link Command#execute(net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent, CommandContext)}
 * call receives.
 *
 * <p>This is a narrow handle into the bot's singletons — commands should
 * <em>only</em> reach for what they need (e.g. {@code ctx.cache()},
 * {@code ctx.database().dataSource()}, {@code ctx.services().get(...)}).
 * Holding a reference to a {@code CommandContext} past the duration of a
 * command invocation is fine; the underlying services live as long as the
 * JVM.
 *
 * <p>{@link #services} exposes the same {@link ServiceRegistry} the modules
 * publish into during load — commands look up cross-module APIs (e.g. a
 * {@code PlayerService}) here at runtime rather than holding constructor
 * references.
 */
public record CommandContext(
	AppConfig config,
	JDA jda,
	Database database,
	CacheManager cache,
	ScheduledExecutorService scheduler,
	LifecycleManager lifecycle,
	GuildSettings settings,
	MetricsRegistry metrics,
	ServiceRegistry services
) {
}
