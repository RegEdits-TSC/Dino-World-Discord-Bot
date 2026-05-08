package dev.homeology.dinoworld.command;

import dev.homeology.dinoworld.config.AppConfig;
import dev.homeology.dinoworld.metrics.MetricsRegistry;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.entities.User;
import net.dv8tion.jda.api.events.interaction.GenericInteractionCreateEvent;
import net.dv8tion.jda.api.events.interaction.ModalInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.ButtonInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.EntitySelectInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.StringSelectInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.callbacks.IReplyCallback;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * JDA listener that dispatches button, select-menu, and modal-submit
 * interactions to per-namespace {@link ComponentHandler}s.
 *
 * <p>Routing convention — every component's {@code custom_id} is
 * colon-delimited:
 *
 * <pre>{@code
 * <namespace>:<action>:<arg1>:<arg2>:...
 * }</pre>
 *
 * The namespace is the registering module's name (e.g. {@code zoo:},
 * {@code players:}). Action and args are caller-defined strings. Discord
 * caps {@code custom_id} at 100 characters; encoders must stay under that.
 *
 * <p>Pipeline (mirrors {@link CommandRouter} where it makes sense):
 * <ol>
 *   <li>Parse the {@code custom_id}; resolve handler by namespace. Unknown
 *       namespace → silently {@code deferReply(true)} so Discord doesn't
 *       show "interaction failed".</li>
 *   <li>Apply the component-bucket {@link RateLimiter}; reject ephemerally
 *       if over.</li>
 *   <li>Set MDC tags ({@code component_id}, {@code user_id},
 *       {@code guild_id}).</li>
 *   <li>Schedule auto-defer at 2.0 s; if the handler hasn't replied by then,
 *       defer the reply ephemerally so the 3-second Discord timeout doesn't
 *       fire.</li>
 *   <li>Submit the handler body to the shared command executor — handlers
 *       never run on JDA's event-pool thread.</li>
 *   <li>Record metrics under {@code command="component:<namespace>"} so the
 *       existing {@code /debug metrics} dashboard surfaces them without
 *       schema changes.</li>
 *   <li>Turn any uncaught exception into a generic ephemeral embed plus a
 *       DM to {@code DEVELOPER_ID} containing an error ID and stack.</li>
 * </ol>
 *
 * <p>Component rate limit is hardcoded to 20 events per 10-second window
 * per user. Click-heavy interactive UIs (rapid button mashing, quick select
 * changes) need more headroom than the default slash-command bucket
 * (5/10s). If this proves wrong in practice, lift the limit into
 * {@link AppConfig}.
 */
public final class ComponentRouter extends ListenerAdapter {

	private static final Logger log = LoggerFactory.getLogger(ComponentRouter.class);

	/**
	 * Time after dispatch at which an unanswered interaction is auto-deferred.
	 */
	private static final long AUTO_DEFER_AFTER_MS = 2000L;

	/**
	 * Component rate limit: more permissive than the slash-command bucket
	 * because interactive UIs naturally produce bursts of clicks.
	 */
	private static final int COMPONENT_LIMIT_PER_10S = 20;

	private final Map<String, ComponentHandler> byNamespace = new HashMap<>();
	private final RateLimiter rateLimiter;
	private final CommandContext baseContext;
	private final ScheduledExecutorService scheduler;
	private final ExecutorService commandExecutor;
	private final MetricsRegistry metrics;
	private final AppConfig config;

	public ComponentRouter(CommandContext baseContext,
	                       ScheduledExecutorService scheduler,
	                       ExecutorService commandExecutor,
	                       MetricsRegistry metrics,
	                       AppConfig config) {
		this.baseContext = baseContext;
		this.scheduler = scheduler;
		this.commandExecutor = commandExecutor;
		this.metrics = metrics;
		this.config = config;
		this.rateLimiter = new RateLimiter(COMPONENT_LIMIT_PER_10S, config.developerId());
	}

	/**
	 * Register a handler for every component whose {@code custom_id} starts
	 * with {@code namespace + ":"}. Modules typically call this once during
	 * {@link dev.homeology.dinoworld.core.Module#onEnable()}.
	 *
	 * @throws IllegalStateException if {@code namespace} is already registered
	 */
	public void register(String namespace, ComponentHandler handler) {
		if (namespace == null || namespace.isBlank() || namespace.contains(":")) {
			throw new IllegalArgumentException(
				"Namespace must be non-empty and not contain ':' — got '" + namespace + "'");
		}
		ComponentHandler prev = byNamespace.put(namespace, handler);
		if (prev != null) {
			throw new IllegalStateException(
				"Component namespace '" + namespace + "' already registered to "
					+ prev.getClass().getName());
		}
	}

	@Override
	public void onButtonInteraction(ButtonInteractionEvent event) {
		dispatch(event, event.getComponentId());
	}

	@Override
	public void onStringSelectInteraction(StringSelectInteractionEvent event) {
		dispatch(event, event.getComponentId());
	}

	@Override
	public void onEntitySelectInteraction(EntitySelectInteractionEvent event) {
		dispatch(event, event.getComponentId());
	}

	@Override
	public void onModalInteraction(ModalInteractionEvent event) {
		dispatch(event, event.getModalId());
	}

	private void dispatch(GenericInteractionCreateEvent event, String customId) {
		long userId = event.getUser().getIdLong();
		String guildIdStr = event.getGuild() == null ? "-" : String.valueOf(event.getGuild().getIdLong());

		MDC.put("component_id", customId == null ? "<null>" : customId);
		MDC.put("user_id", String.valueOf(userId));
		MDC.put("guild_id", guildIdStr);

		try {
			if (customId == null || customId.isEmpty()) {
				log.debug("Component event with empty custom_id; deferring");
				silentlyDefer(event);
				return;
			}

			RouteKey key = parseRouteKey(customId);
			ComponentHandler handler = byNamespace.get(key.namespace());
			String namespace = key.namespace();
			String[] args = key.args();
			if (handler == null) {
				log.debug("No component handler for namespace '{}' (custom_id='{}')",
					namespace, customId);
				silentlyDefer(event);
				return;
			}

			if (!rateLimiter.tryAcquire(userId)) {
				log.info("Rate-limited component '{}' for user {}", customId, userId);
				metrics.recordRateLimited();
				replyEphemeralEmbed(event, Embeds.warning("Slow down",
					"You're clicking too quickly. Try again in a few seconds."));
				return;
			}

			AtomicBoolean acked = new AtomicBoolean(false);
			ScheduledFuture<?> deferTask = scheduler.schedule(() -> {
				if (acked.get()) return;
				if (event instanceof IReplyCallback rc && !rc.isAcknowledged()) {
					try {
						rc.deferReply(true).queue(
							ok -> {},
							err -> log.debug("Auto-defer failed for component '{}': {}",
								customId, err.toString()));
					} catch (IllegalStateException ignored) {
						// raced — handler acked between check and call
					}
				}
			}, AUTO_DEFER_AFTER_MS, TimeUnit.MILLISECONDS);

			Map<String, String> mdcSnapshot = MDC.getCopyOfContextMap();

			try {
				commandExecutor.submit(() ->
					runOnWorker(event, handler, namespace, args, mdcSnapshot, acked, deferTask));
			} catch (RejectedExecutionException e) {
				acked.set(true);
				deferTask.cancel(false);
				log.warn("Command executor rejected component '{}': queue full", customId);
				metrics.recordDenied("overload");
				replyEphemeralEmbed(event, Embeds.warning("Bot is busy",
					"The bot is overloaded right now. Please try again in a moment."));
			}
		} finally {
			MDC.remove("component_id");
			MDC.remove("user_id");
			MDC.remove("guild_id");
		}
	}

	private void runOnWorker(GenericInteractionCreateEvent event,
	                         ComponentHandler handler,
	                         String namespace,
	                         String[] args,
	                         Map<String, String> mdcSnapshot,
	                         AtomicBoolean acked,
	                         ScheduledFuture<?> deferTask) {
		if (mdcSnapshot != null) MDC.setContextMap(mdcSnapshot);
		String metricKey = "component:" + namespace;
		long startNs = System.nanoTime();
		try {
			handler.handle(event, args, baseContext);
			long elapsedNs = System.nanoTime() - startNs;
			metrics.recordDuration(metricKey, elapsedNs);
			metrics.recordInvocation(metricKey, "ok");
		} catch (Exception e) {
			metrics.recordInvocation(metricKey, "error");
			handleUncaught(event, namespace, e);
		} finally {
			acked.set(true);
			deferTask.cancel(false);
			MDC.clear();
		}
	}

	private static void silentlyDefer(GenericInteractionCreateEvent event) {
		if (!(event instanceof IReplyCallback rc) || rc.isAcknowledged()) return;
		try {
			rc.deferReply(true).queue(
				ok -> {},
				err -> log.debug("Silent defer failed: {}", err.toString()));
		} catch (IllegalStateException ignored) {
			// already acked
		}
	}

	private void replyEphemeralEmbed(GenericInteractionCreateEvent event, EmbedBuilder embed) {
		if (!(event instanceof IReplyCallback rc)) return;
		Embeds.brand(embed, event.getJDA());
		rc.replyEmbeds(embed.build()).setEphemeral(true).queue(
			ok -> {},
			err -> log.warn("Could not send ephemeral component reply: {}", err.toString()));
	}

	// ─── error path ──────────────────────────────────────────────────────

	private void handleUncaught(GenericInteractionCreateEvent event, String namespace, Exception e) {
		String errorId = newErrorId();
		log.error("Uncaught error in component '{}' (error_id={})", namespace, errorId, e);

		if (event instanceof IReplyCallback rc) {
			EmbedBuilder embed = Embeds.error("Internal error",
				"Something went wrong (id: `" + errorId + "`). The developer has been notified.");
			Embeds.brand(embed, event.getJDA());
			try {
				if (rc.isAcknowledged()) {
					rc.getHook().sendMessageEmbeds(embed.build()).setEphemeral(true).queue(
						ok -> {}, err -> log.warn("Could not send error follow-up: {}", err.toString()));
				} else {
					rc.replyEmbeds(embed.build()).setEphemeral(true).queue(
						ok -> {}, err -> log.warn("Could not send error reply: {}", err.toString()));
				}
			} catch (Exception inner) {
				log.warn("Failed to deliver error reply for {}", errorId, inner);
			}
		}

		sendDeveloperDm(event, namespace, errorId, e);
	}

	private void sendDeveloperDm(GenericInteractionCreateEvent event, String namespace,
	                             String errorId, Exception e) {
		JDA jda = event.getJDA();
		long devId = config.developerId();

		String stack = stackToString(e);
		if (stack.length() > 1500) stack = stack.substring(0, 1500) + "…(truncated)";

		String body = "**Error " + errorId + "** in component `" + namespace + "`\n"
			+ "User: " + event.getUser().getName() + " (" + event.getUser().getId() + ")\n"
			+ "Guild: " + (event.getGuild() == null ? "DM" : event.getGuild().getName()
			                                                 + " (" + event.getGuild().getId() + ")") + "\n"
			+ "```\n" + stack + "\n```";

		jda.retrieveUserById(devId)
			.flatMap(User::openPrivateChannel)
			.flatMap(c -> c.sendMessage(body))
			.queue(
				ok -> {},
				err -> log.warn("Could not DM developer about error {}: {}",
					errorId, err.toString()));
	}

	/**
	 * Split a {@code custom_id} into its routing namespace and argument array.
	 * Package-private for testing.
	 */
	record RouteKey(String namespace, String[] args) {}

	static RouteKey parseRouteKey(String customId) {
		int colon = customId.indexOf(':');
		if (colon < 0) return new RouteKey(customId, new String[0]);
		String ns = customId.substring(0, colon);
		String tail = customId.substring(colon + 1);
		return new RouteKey(ns, tail.isEmpty() ? new String[0] : tail.split(":", -1));
	}

	private static String newErrorId() {
		return String.format("%08x", ThreadLocalRandom.current().nextInt());
	}

	private static String stackToString(Throwable t) {
		java.io.StringWriter sw = new java.io.StringWriter();
		t.printStackTrace(new java.io.PrintWriter(sw));
		return sw.toString();
	}
}
