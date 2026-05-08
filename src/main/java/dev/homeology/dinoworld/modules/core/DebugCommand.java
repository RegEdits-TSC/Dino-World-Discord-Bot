package dev.homeology.dinoworld.modules.core;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.joran.JoranConfigurator;
import ch.qos.logback.core.joran.spi.JoranException;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.core.Module;
import dev.homeology.dinoworld.core.ModuleManager;
import dev.homeology.dinoworld.database.Database;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.lifecycle.LifecycleManager;
import dev.homeology.dinoworld.metrics.MetricsRegistry;
import dev.homeology.dinoworld.util.Embeds;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Meter;
import io.micrometer.core.instrument.Timer;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.Activity;
import net.dv8tion.jda.api.events.interaction.command.CommandAutoCompleteInteractionEvent;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.Command.Choice;
import net.dv8tion.jda.api.interactions.commands.DefaultMemberPermissions;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.*;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * {@code /debug} — the developer's runtime control surface.
 *
 * <p>Subcommand groups: {@code log}, {@code cache}, {@code system},
 * {@code metrics}. Hidden from non-admins via
 * {@link DefaultMemberPermissions#DISABLED}; the
 * {@link dev.homeology.dinoworld.command.PermissionGate} provides the
 * authoritative dev-only check at execution.
 *
 * <p>Implements {@link Command} for the slash-side, and extends
 * {@link ListenerAdapter} so the autocomplete handler for the
 * {@code <logger>} option can live alongside the slash logic. All replies
 * route through {@link Embeds} so colors stay consistent with the rest of
 * the bot's output.
 */
public final class DebugCommand extends ListenerAdapter implements Command {

	private static final List<String> LEVELS =
		List.of("TRACE", "DEBUG", "INFO", "WARN", "ERROR", "OFF");

	private static final List<String> ACTIVITY_TYPES =
		List.of("NONE", "PLAYING", "WATCHING", "LISTENING", "COMPETING");

	private final ModuleManager modules;
	private final MigrationRunner migrations;
	private final Database database;
	private final CacheManager cache;
	private final LifecycleManager lifecycle;
	private final MetricsRegistry metrics;
	private final FeedbackStore feedbackStore;
	/**
	 * Where backup .gz files live; used by {@code /debug system db}.
	 */
	private final Path backupDir;

	public DebugCommand(ModuleManager modules,
	                    MigrationRunner migrations,
	                    Database database,
	                    CacheManager cache,
	                    LifecycleManager lifecycle,
	                    MetricsRegistry metrics,
	                    FeedbackStore feedbackStore,
	                    Path backupDir) {
		this.modules = modules;
		this.migrations = migrations;
		this.database = database;
		this.cache = cache;
		this.lifecycle = lifecycle;
		this.metrics = metrics;
		this.feedbackStore = feedbackStore;
		this.backupDir = backupDir;
	}

	@Override
	public boolean devOnly() {
		return true;
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.DEVELOPER;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("debug", "Developer-only diagnostics and control.")
			.setDefaultPermissions(DefaultMemberPermissions.DISABLED)
			.addSubcommandGroups(
				new SubcommandGroupData("log", "Runtime logging control.")
					.addSubcommands(
						new SubcommandData("set", "Set a logger's level.")
							.addOptions(loggerOption(true), levelOption()),
						new SubcommandData("get", "Show a logger's effective level.")
							.addOptions(loggerOption(true)),
						new SubcommandData("list", "List loggers with explicit levels."),
						new SubcommandData("reset", "Reload logback.xml from classpath.")),
				new SubcommandGroupData("cache", "Cache diagnostics.")
					.addSubcommands(
						new SubcommandData("stats", "Per-cache size, hit rate, evictions.")),
				new SubcommandGroupData("system", "Bot lifecycle and introspection.")
					.addSubcommands(
						new SubcommandData("modules", "List discovered modules."),
						new SubcommandData("db", "DB size + migrations + last backup."),
						new SubcommandData("activity", "Set the bot's presence activity.")
							.addOptions(activityTypeOption(), activityNameOption()),
						new SubcommandData("restart", "Cleanly restart the bot (exit 64)."),
						new SubcommandData("shutdown", "Cleanly shut down the bot (exit 0).")),
				new SubcommandGroupData("metrics", "Runtime metrics from Micrometer.")
					.addSubcommands(
						new SubcommandData("show", "Show command timers and counters.")),
				new SubcommandGroupData("feedback", "Manage the /feedback blacklist.")
					.addSubcommands(
						new SubcommandData("block", "Block a user ID from using /feedback.")
							.addOptions(
								new OptionData(OptionType.STRING, "user_id", "Discord user ID to block", true),
								new OptionData(OptionType.STRING, "reason", "Optional note for your records", false)),
						new SubcommandData("unblock", "Remove a user ID from the blacklist.")
							.addOptions(
								new OptionData(OptionType.STRING, "user_id", "Discord user ID to unblock", true)),
						new SubcommandData("list", "Show every blacklisted user ID.")));
	}

	private static OptionData loggerOption(boolean required) {
		return new OptionData(OptionType.STRING, "logger", "Logger name (use ROOT for the root logger)", required, true);
	}

	private static OptionData levelOption() {
		OptionData od = new OptionData(OptionType.STRING, "level", "New level", true);
		for (String l : LEVELS) od.addChoice(l, l);
		return od;
	}

	private static OptionData activityTypeOption() {
		OptionData od = new OptionData(OptionType.STRING, "type", "Activity type (NONE clears the activity)", true);
		for (String t : ACTIVITY_TYPES) od.addChoice(t, t);
		return od;
	}

	private static OptionData activityNameOption() {
		return new OptionData(OptionType.STRING, "name",
			"Activity text (ignored when type=NONE)", false);
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		String group = event.getSubcommandGroup();
		String sub = event.getSubcommandName();
		if (group == null || sub == null) {
			replyEmbed(event, Embeds.error("Usage", "Use `/debug <group> <subcommand>`."));
			return;
		}
		switch (group) {
			case "log" -> handleLog(event, sub);
			case "cache" -> handleCache(event, sub);
			case "system" -> handleSystem(event, sub);
			case "metrics" -> handleMetrics(event, sub);
			case "feedback" -> handleFeedback(event, sub);
			default -> replyEmbed(event, Embeds.error("Unknown group", "Unknown debug group: " + group));
		}
	}

	// ─── /debug log ──────────────────────────────────────────────────────

	private void handleLog(SlashCommandInteractionEvent event, String sub) {
		switch (sub) {
			case "set" -> doLogSet(event);
			case "get" -> doLogGet(event);
			case "list" -> doLogList(event);
			case "reset" -> doLogReset(event);
			default -> replyEmbed(event, Embeds.error("Unknown subcommand", "log " + sub));
		}
	}

	private void doLogSet(SlashCommandInteractionEvent event) {
		String loggerName = Objects.requireNonNull(event.getOption("logger")).getAsString();
		String levelName = Objects.requireNonNull(event.getOption("level")).getAsString();
		Level level = Level.toLevel(levelName, null);
		if (level == null) {
			replyEmbed(event, Embeds.error("Unknown level", levelName));
			return;
		}
		ch.qos.logback.classic.Logger lg = resolveLogger(loggerName);
		Level prev = lg.getEffectiveLevel();
		lg.setLevel(level);
		replyEmbed(event, Embeds.success("Log level updated",
			"Logger `" + lg.getName() + "`: **" + prev + " → " + level + "**"));
	}

	private void doLogGet(SlashCommandInteractionEvent event) {
		String loggerName = Objects.requireNonNull(event.getOption("logger")).getAsString();
		ch.qos.logback.classic.Logger lg = resolveLogger(loggerName);
		replyEmbed(event, Embeds.info("Log level",
			"Logger `" + lg.getName() + "`: effective **" + lg.getEffectiveLevel()
				+ "** (explicit: " + (lg.getLevel() == null ? "inherited" : lg.getLevel()) + ")"));
	}

	private void doLogList(SlashCommandInteractionEvent event) {
		LoggerContext lc = (LoggerContext) LoggerFactory.getILoggerFactory();
		List<ch.qos.logback.classic.Logger> withLevel = lc.getLoggerList().stream()
			.filter(l -> l.getLevel() != null)
			.sorted(Comparator.comparing(ch.qos.logback.classic.Logger::getName))
			.toList();
		if (withLevel.isEmpty()) {
			replyEmbed(event, Embeds.info("Loggers", "No loggers have an explicit level set."));
			return;
		}
		StringBuilder sb = new StringBuilder("```\n");
		for (var l : withLevel) sb.append(l.getName()).append(" = ").append(l.getLevel()).append('\n');
		sb.append("```");
		replyEmbed(event, Embeds.info("Loggers with explicit levels", sb.toString()));
	}

	private void doLogReset(SlashCommandInteractionEvent event) {
		LoggerContext lc = (LoggerContext) LoggerFactory.getILoggerFactory();
		try (InputStream in = Thread.currentThread().getContextClassLoader()
			.getResourceAsStream("logback.xml")) {
			if (in == null) {
				replyEmbed(event, Embeds.error("Reload failed",
					"logback.xml not on classpath — nothing to reset to."));
				return;
			}
			JoranConfigurator jc = new JoranConfigurator();
			jc.setContext(lc);
			lc.reset();
			jc.doConfigure(in);
			replyEmbed(event, Embeds.success("Logback reloaded", "Configuration reloaded from logback.xml."));
		} catch (JoranException | IOException e) {
			replyEmbed(event, Embeds.error("Reload failed", e.getMessage()));
		}
	}

	private static ch.qos.logback.classic.Logger resolveLogger(String name) {
		String resolved = "ROOT".equalsIgnoreCase(name) ? org.slf4j.Logger.ROOT_LOGGER_NAME : name;
		return (ch.qos.logback.classic.Logger) LoggerFactory.getLogger(resolved);
	}

	// ─── /debug cache ────────────────────────────────────────────────────

	private void handleCache(SlashCommandInteractionEvent event, String sub) {
		if ("stats".equals(sub)) {
			Map<String, CacheStats> stats = cache.snapshot();
			Map<String, Long> sizes = cache.sizes();
			if (stats.isEmpty()) {
				replyEmbed(event, Embeds.warning("No caches", "No caches in use yet."));
				return;
			}
			StringBuilder sb = new StringBuilder("```\n");
			for (var e : stats.entrySet()) {
				CacheStats s = e.getValue();
				sb.append(String.format(
					"%-20s size=%-6d hits=%-6d misses=%-6d hit_rate=%.2f%% evictions=%d%n",
					e.getKey(), sizes.getOrDefault(e.getKey(), 0L),
					s.hitCount(), s.missCount(),
					s.hitRate() * 100.0, s.evictionCount()));
			}
			sb.append("```");
			replyEmbed(event, Embeds.info("Cache stats", sb.toString()));
		} else {
			replyEmbed(event, Embeds.error("Unknown subcommand", "cache " + sub));
		}
	}

	// ─── /debug system ───────────────────────────────────────────────────

	private void handleSystem(SlashCommandInteractionEvent event, String sub) {
		switch (sub) {
			case "modules" -> doSystemModules(event);
			case "db" -> doSystemDb(event);
			case "activity" -> doSystemActivity(event);
			case "restart" -> doSystemRestart(event);
			case "shutdown" -> doSystemShutdown(event);
			default -> replyEmbed(event, Embeds.error("Unknown subcommand", "system " + sub));
		}
	}

	private void doSystemModules(SlashCommandInteractionEvent event) {
		StringBuilder sb = new StringBuilder("```\n");
		for (Module m : modules.active()) {
			sb.append(String.format("%-20s commands=%d listeners=%d%n",
				m.name(), m.commands().size(), m.listeners().size()));
		}
		sb.append("```");
		replyEmbed(event, Embeds.info("Modules", sb.toString()));
	}

	private void doSystemDb(SlashCommandInteractionEvent event) {
		StringBuilder sb = new StringBuilder("```\n");
		try {
			Path db = database.filePath();
			long size = Files.exists(db) ? Files.size(db) : 0;
			sb.append("file = ").append(db).append('\n');
			sb.append(String.format("size = %.2f MiB%n", size / (1024.0 * 1024.0)));
		} catch (IOException e) {
			sb.append("(could not stat db file: ").append(e.getMessage()).append(")\n");
		}
		sb.append("\nLast applied migration per module:\n");
		for (var am : migrations.latestPerModule()) {
			sb.append(String.format("  %-12s V%d  %s  %s%n",
				am.module(), am.version(), am.name(), am.appliedAt()));
		}
		sb.append("\nNewest backup: ").append(describeNewestBackup()).append("\n```");
		replyEmbed(event, Embeds.info("Database", sb.toString()));
	}

	private void doSystemActivity(SlashCommandInteractionEvent event) {
		String type = Objects.requireNonNull(event.getOption("type")).getAsString().toUpperCase(Locale.ROOT);
		String name = event.getOption("name") == null ? "" : Objects.requireNonNull(event.getOption("name")).getAsString();

		if ("NONE".equals(type)) {
			event.getJDA().getPresence().setActivity(null);
			replyEmbed(event, Embeds.success("Activity cleared",
				"Presence activity has been cleared. (Resets to `BOT_ACTIVITY_*` on next restart.)"));
			return;
		}

		if (name.isBlank()) {
			replyEmbed(event, Embeds.error("Missing name", "`name` is required unless `type=NONE`."));
			return;
		}

		Activity activity = switch (type) {
			case "PLAYING" -> Activity.playing(name);
			case "WATCHING" -> Activity.watching(name);
			case "LISTENING" -> Activity.listening(name);
			case "COMPETING" -> Activity.competing(name);
			default -> null;
		};
		if (activity == null) {
			replyEmbed(event, Embeds.error("Unknown type", type));
			return;
		}
		event.getJDA().getPresence().setActivity(activity);
		replyEmbed(event, Embeds.success("Activity updated",
			"Now **" + type + "** `" + name + "`. (Resets to `BOT_ACTIVITY_*` on next restart.)"));
	}

	private String describeNewestBackup() {
		try (Stream<Path> s = Files.list(backupDir)) {
			return s.filter(p -> p.getFileName().toString().endsWith(".db.gz"))
				.map(p -> {
					try {
						Instant mtime = Files.getLastModifiedTime(p).toInstant();
						Duration age = Duration.between(mtime, Instant.now());
						return p.getFileName() + " (" + humanDuration(age) + " ago)";
					} catch (IOException e) {
						return p.getFileName().toString();
					}
				}).min(Comparator.reverseOrder())
				.orElse("none yet");
		} catch (IOException e) {
			return "(backup dir not readable: " + e.getMessage() + ")";
		}
	}

	private static String humanDuration(Duration d) {
		long s = d.getSeconds();
		if (s < 60) return s + "s";
		if (s < 3600) return (s / 60) + "m";
		if (s < 86400) return (s / 3600) + "h";
		return (s / 86400) + "d";
	}

	private void doSystemRestart(SlashCommandInteractionEvent event) {
		EmbedBuilder embed = Embeds.warning("Restarting", "The bot will be back shortly.");
		Embeds.brand(embed, event.getJDA());
		event.replyEmbeds(embed.build()).setEphemeral(true).queue(
			ok -> lifecycle.restart(),
			err -> lifecycle.restart());
	}

	private void doSystemShutdown(SlashCommandInteractionEvent event) {
		EmbedBuilder embed = Embeds.warning("Shutting down", "Goodbye.");
		Embeds.brand(embed, event.getJDA());
		event.replyEmbeds(embed.build()).setEphemeral(true).queue(
			ok -> lifecycle.shutdown(dev.homeology.dinoworld.lifecycle.ExitCodes.OK),
			err -> lifecycle.shutdown(dev.homeology.dinoworld.lifecycle.ExitCodes.OK));
	}

	// ─── /debug metrics ──────────────────────────────────────────────────

	private void handleMetrics(SlashCommandInteractionEvent event, String sub) {
		if (!"show".equals(sub)) {
			replyEmbed(event, Embeds.error("Unknown subcommand", "metrics " + sub));
			return;
		}

		StringBuilder sb = new StringBuilder("```\n");
		// Group by meter name for readable output; sort by name within group.
		Map<String, List<Meter>> byName = new TreeMap<>();
		metrics.registry().getMeters().forEach(m ->
			byName.computeIfAbsent(m.getId().getName(), k -> new ArrayList<>()).add(m));

		for (var entry : byName.entrySet()) {
			sb.append(entry.getKey()).append('\n');
			for (Meter m : entry.getValue()) {
				String tags = m.getId().getTags().stream()
					.map(t -> t.getKey() + "=" + t.getValue())
					.collect(Collectors.joining(",", "{", "}"));
				if (m instanceof Timer t) {
					sb.append(String.format("  %s count=%d mean=%.2fms max=%.2fms%n",
						tags, t.count(),
						t.mean(TimeUnit.MILLISECONDS), t.max(TimeUnit.MILLISECONDS)));
				} else if (m instanceof Counter c) {
					sb.append(String.format("  %s count=%.0f%n", tags, c.count()));
				} else {
					// Gauges and other meter types — show first measurement.
					m.measure().forEach(meas ->
						sb.append(String.format("  %s %s=%.4f%n", tags,
							meas.getStatistic().toString().toLowerCase(), meas.getValue())));
				}
			}
		}
		sb.append("```");
		replyEmbed(event, Embeds.info("Metrics", sb.length() > 4090 ? sb.substring(0, 4090) + "…" : sb.toString()));
	}

	// ─── /debug feedback ─────────────────────────────────────────────────

	private void handleFeedback(SlashCommandInteractionEvent event, String sub) {
		switch (sub) {
			case "block" -> doFeedbackBlock(event);
			case "unblock" -> doFeedbackUnblock(event);
			case "list" -> doFeedbackList(event);
			default -> replyEmbed(event, Embeds.error("Unknown subcommand", "feedback " + sub));
		}
	}

	private void doFeedbackBlock(SlashCommandInteractionEvent event) {
		String raw = Objects.requireNonNull(event.getOption("user_id")).getAsString();
		Long userId = parseUserId(raw);
		if (userId == null) {
			replyEmbed(event, Embeds.error("Bad user ID",
				"`" + raw + "` isn't a valid Discord user ID (numeric snowflake)."));
			return;
		}
		var reasonOpt = event.getOption("reason");
		String reason = reasonOpt == null ? null : reasonOpt.getAsString();

		try {
			feedbackStore.block(userId, reason, Instant.now());
		} catch (RuntimeException e) {
			replyEmbed(event, Embeds.error("Block failed", e.getMessage()));
			return;
		}
		String body = "User `" + userId + "` is now blocked from `/feedback`.";
		if (reason != null && !reason.isBlank()) body += "\nReason: " + reason.trim();
		replyEmbed(event, Embeds.success("Blocked", body));
	}

	private void doFeedbackUnblock(SlashCommandInteractionEvent event) {
		String raw = Objects.requireNonNull(event.getOption("user_id")).getAsString();
		Long userId = parseUserId(raw);
		if (userId == null) {
			replyEmbed(event, Embeds.error("Bad user ID",
				"`" + raw + "` isn't a valid Discord user ID (numeric snowflake)."));
			return;
		}
		boolean removed;
		try {
			removed = feedbackStore.unblock(userId);
		} catch (RuntimeException e) {
			replyEmbed(event, Embeds.error("Unblock failed", e.getMessage()));
			return;
		}
		if (removed) {
			replyEmbed(event, Embeds.success("Unblocked",
				"User `" + userId + "` is no longer blocked from `/feedback`."));
		} else {
			replyEmbed(event, Embeds.warning("Not on the list",
				"User `" + userId + "` wasn't blocked — nothing to do."));
		}
	}

	private void doFeedbackList(SlashCommandInteractionEvent event) {
		List<FeedbackStore.BlockedEntry> entries = feedbackStore.listBlocked();
		if (entries.isEmpty()) {
			replyEmbed(event, Embeds.info("Blacklist empty", "No users are blocked from `/feedback`."));
			return;
		}
		StringBuilder sb = new StringBuilder("```\n");
		for (var e : entries) {
			sb.append(e.userId()).append("  ").append(e.blockedAt());
			if (e.reason() != null && !e.reason().isBlank()) {
				sb.append("  — ").append(e.reason());
			}
			sb.append('\n');
		}
		sb.append("```");
		String body = sb.length() > 4090 ? sb.substring(0, 4090) + "…" : sb.toString();
		replyEmbed(event, Embeds.info("Blocked from /feedback (" + entries.size() + ")", body));
	}

	/** Parse a Discord snowflake from user input; null if not a positive long. */
	private static Long parseUserId(String raw) {
		try {
			long n = Long.parseLong(raw.trim());
			return n > 0 ? n : null;
		} catch (NumberFormatException e) {
			return null;
		}
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private void replyEmbed(SlashCommandInteractionEvent event, EmbedBuilder embed) {
		Embeds.brand(embed, event.getJDA());
		if (event.isAcknowledged()) {
			event.getHook().sendMessageEmbeds(embed.build()).setEphemeral(true).queue();
		} else {
			event.replyEmbeds(embed.build()).setEphemeral(true).queue();
		}
	}

	// ─── autocomplete for <logger> ───────────────────────────────────────

	@Override
	public void onCommandAutoCompleteInteraction(CommandAutoCompleteInteractionEvent event) {
		if (!"debug".equals(event.getName())) return;
		if (!"logger".equals(event.getFocusedOption().getName())) return;

		String prefix = event.getFocusedOption().getValue().toLowerCase(Locale.ROOT);
		LoggerContext lc = (LoggerContext) LoggerFactory.getILoggerFactory();
		List<Choice> choices = lc.getLoggerList().stream()
			.map(ch.qos.logback.classic.Logger::getName)
			.filter(n -> n.toLowerCase(Locale.ROOT).contains(prefix))
			.sorted()
			.limit(25)
			.map(n -> new Choice(n.length() > 100 ? n.substring(0, 100) : n, n))
			.collect(Collectors.toList());

		// Always include ROOT so the user can target it without remembering the literal name.
		if ("root".startsWith(prefix)) {
			choices.addFirst(new Choice("ROOT", "ROOT"));
			if (choices.size() > 25) choices = choices.subList(0, 25);
		}
		event.replyChoices(choices).queue();
	}
}
