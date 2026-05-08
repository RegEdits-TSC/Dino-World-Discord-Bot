package dev.homeology.dinoworld.command;

import dev.homeology.dinoworld.config.AppConfig;
import dev.homeology.dinoworld.metrics.MetricsRegistry;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.entities.User;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Single JDA listener that dispatches every slash command interaction.
 *
 * <p>Responsibilities, in order:
 * <ol>
 *   <li>Resolve the event to a {@link Command} by top-level name.</li>
 *   <li>Run {@link PermissionGate}; deny ephemerally if denied.</li>
 *   <li>Apply the per-user {@link RateLimiter}; reject ephemerally if over limit.</li>
 *   <li>Set MDC tags (command, guild_id, user_id) so any log line emitted
 *       during the command run is greppable.</li>
 *   <li>Schedule an auto-defer task at 2.0 s; if the handler hasn't replied
 *       by then, defer the reply so Discord doesn't time the interaction
 *       out at 3 s.</li>
 *   <li>Submit the command body to a bounded executor so JDA's event-pool
 *       thread is never blocked by handler work. MDC context propagates
 *       across the thread boundary.</li>
 *   <li>Record duration + outcome metrics; turn any uncaught exception
 *       into a generic ephemeral embed plus a DM to {@code DEVELOPER_ID}
 *       containing an error ID, the command path, the invoker, and the
 *       stacktrace.</li>
 * </ol>
 */
public final class CommandRouter extends ListenerAdapter {

	private static final Logger log = LoggerFactory.getLogger(CommandRouter.class);

	/**
	 * Time after dispatch at which an unanswered command is auto-deferred.
	 */
	private static final long AUTO_DEFER_AFTER_MS = 2000L;

	private final Map<String, Command> byName = new HashMap<>();
	private final PermissionGate gate;
	private final RateLimiter rateLimiter;
	private final CommandContext baseContext;
	private final ScheduledExecutorService scheduler;
	private final ExecutorService commandExecutor;
	private final MetricsRegistry metrics;
	private final AppConfig config;

	public CommandRouter(List<Command> commands,
	                     PermissionGate gate,
	                     RateLimiter rateLimiter,
	                     CommandContext baseContext,
	                     ScheduledExecutorService scheduler,
	                     ExecutorService commandExecutor,
	                     MetricsRegistry metrics,
	                     AppConfig config) {
		for (Command c : commands) {
			String name = c.slashData().getName();
			Command prev = byName.put(name, c);
			if (prev != null) {
				throw new IllegalStateException(
					"Duplicate command name '" + name + "' from "
						+ prev.getClass().getName() + " and " + c.getClass().getName());
			}
		}
		this.gate = gate;
		this.rateLimiter = rateLimiter;
		this.baseContext = baseContext;
		this.scheduler = scheduler;
		this.commandExecutor = commandExecutor;
		this.metrics = metrics;
		this.config = config;
	}

	@Override
	public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
		String name = event.getName();
		long userId = event.getUser().getIdLong();
		String fullName = event.getFullCommandName();
		String guildIdStr = event.getGuild() == null ? "-" : String.valueOf(event.getGuild().getIdLong());
		String invokerName = event.getUser().getEffectiveName();

		// Set MDC up front so every log line in this handler — unknown
		// command, permission denial, dispatch, completion, error — is
		// greppable by command/user/guild.
		MDC.put("command", fullName);
		MDC.put("user_id", String.valueOf(userId));
		MDC.put("guild_id", guildIdStr);
		MDC.put("tags", " [" + fullName + " g=" + guildIdStr + " u=" + userId + "]");

		try {
			Command cmd = byName.get(name);
			if (cmd == null) {
				log.warn("No handler registered for /{}", fullName);
				metrics.recordDenied("unknown");
				replyEphemeralEmbed(event, Embeds.error("Unknown command",
					"That command isn't registered. Try `/help` for the current list."));
				return;
			}

			PermissionGate.Decision decision = gate.check(userId, event.getMember(), cmd);
			if (decision != PermissionGate.Decision.ALLOW) {
				log.info("Permission denied for {}: {}", invokerName, decision);
				metrics.recordDenied(decision.name().toLowerCase());
				replyEphemeralEmbed(event, Embeds.error("Access denied",
					PermissionGate.denialMessage(decision)));
				return;
			}

			if (!rateLimiter.tryAcquire(userId)) {
				log.info("Rate-limited /{} for {}", fullName, invokerName);
				metrics.recordRateLimited();
				replyEphemeralEmbed(event, Embeds.warning("Slow down",
					"You're sending commands too quickly. Try again in a few seconds."));
				return;
			}

			log.debug("Dispatching /{} for {}", fullName, invokerName);

			// Schedule auto-defer. AtomicBoolean lets the scheduled task no-op
			// if the handler already replied (or threw — we cancel either way).
			AtomicBoolean acked = new AtomicBoolean(false);
			ScheduledFuture<?> deferTask = scheduler.schedule(() -> {
				if (acked.get()) return;
				if (!event.isAcknowledged()) {
					try {
						event.deferReply(cmd.deferEphemeral()).queue(
							ok -> {
							},
							err -> log.debug("Auto-defer failed for /{}: {}", name, err.toString()));
					} catch (IllegalStateException ignored) {
						// raced — handler acked between check and call
					}
				}
			}, AUTO_DEFER_AFTER_MS, TimeUnit.MILLISECONDS);

			// Capture MDC across the thread boundary so the worker logs the
			// same context. Final-effective for the lambda.
			Map<String, String> mdcSnapshot = MDC.getCopyOfContextMap();

			try {
				commandExecutor.submit(() -> runOnWorker(event, cmd, fullName, name, mdcSnapshot, acked, deferTask));
			} catch (RejectedExecutionException e) {
				acked.set(true);
				deferTask.cancel(false);
				log.warn("Command executor rejected /{}: queue full", fullName);
				metrics.recordDenied("overload");
				replyEphemeralEmbed(event, Embeds.warning("Bot is busy",
					"The bot is overloaded right now. Please try again in a moment."));
			}
		} finally {
			MDC.remove("command");
			MDC.remove("user_id");
			MDC.remove("guild_id");
			MDC.remove("tags");
		}
	}

	private void runOnWorker(SlashCommandInteractionEvent event,
	                         Command cmd,
	                         String fullName,
	                         String topName,
	                         Map<String, String> mdcSnapshot,
	                         AtomicBoolean acked,
	                         ScheduledFuture<?> deferTask) {
		if (mdcSnapshot != null) MDC.setContextMap(mdcSnapshot);
		long startNs = System.nanoTime();
		try {
			cmd.execute(event, baseContext);
			long elapsedNs = System.nanoTime() - startNs;
			metrics.recordDuration(topName, elapsedNs);
			metrics.recordInvocation(topName, "ok");
			log.debug("Completed /{} in {} ms", fullName, elapsedNs / 1_000_000L);
		} catch (Exception e) {
			metrics.recordInvocation(topName, "error");
			handleUncaught(event, topName, e);
		} finally {
			acked.set(true);
			deferTask.cancel(false);
			MDC.clear();
		}
	}

	private void replyEphemeralEmbed(SlashCommandInteractionEvent event, EmbedBuilder embed) {
		Embeds.brand(embed, event.getJDA());
		event.replyEmbeds(embed.build()).setEphemeral(true).queue(
			ok -> {
			},
			err -> log.warn("Could not send ephemeral embed reply: {}", err.toString()));
	}

	// ─── error path ──────────────────────────────────────────────────────

	private void handleUncaught(SlashCommandInteractionEvent event, String topName, Exception e) {
		String errorId = newErrorId();
		log.error("Uncaught error in /{} (error_id={})", topName, errorId, e);

		EmbedBuilder embed = Embeds.error("Internal error",
			"Something went wrong (id: `" + errorId + "`). The developer has been notified.");
		Embeds.brand(embed, event.getJDA());
		try {
			if (event.isAcknowledged()) {
				event.getHook().sendMessageEmbeds(embed.build()).setEphemeral(true).queue(
					ok -> {
					}, err -> log.warn("Could not send error follow-up: {}", err.toString()));
			} else {
				event.replyEmbeds(embed.build()).setEphemeral(true).queue(
					ok -> {
					}, err -> log.warn("Could not send error reply: {}", err.toString()));
			}
		} catch (Exception inner) {
			log.warn("Failed to deliver error reply for {}", errorId, inner);
		}

		sendDeveloperDm(event, errorId, e);
	}

	private void sendDeveloperDm(SlashCommandInteractionEvent event,
	                             String errorId, Exception e) {
		JDA jda = event.getJDA();
		long devId = config.developerId();

		String stack = stackToString(e);
		if (stack.length() > 1500) stack = stack.substring(0, 1500) + "…(truncated)";

		String body = "**Error " + errorId + "** in `/" + event.getFullCommandName() + "`\n"
			+ "User: " + event.getUser().getName() + " (" + event.getUser().getId() + ")\n"
			+ "Guild: " + (event.getGuild() == null ? "DM" : event.getGuild().getName()
			                                                 + " (" + event.getGuild().getId() + ")") + "\n"
			+ "```\n" + stack + "\n```";

		jda.retrieveUserById(devId)
			.flatMap(User::openPrivateChannel)
			.flatMap(c -> c.sendMessage(body))
			.queue(
				ok -> {
				},
				err -> log.warn("Could not DM developer about error {}: {}",
					errorId, err.toString()));
	}

	private static String newErrorId() {
		// 32 random bits formatted as exactly 8 hex chars; never throws.
		return String.format("%08x", ThreadLocalRandom.current().nextInt());
	}

	private static String stackToString(Throwable t) {
		java.io.StringWriter sw = new java.io.StringWriter();
		t.printStackTrace(new java.io.PrintWriter(sw));
		return sw.toString();
	}
}
