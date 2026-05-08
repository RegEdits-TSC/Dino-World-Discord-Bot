package dev.homeology.dinoworld.modules.core;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.User;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.OptionData;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

/**
 * {@code /feedback} — ship a user's suggestion or bug report directly to the
 * configured {@code DEVELOPER_ID} as a DM.
 *
 * <p>Public, GENERAL category. Two abuse-prevention layers stack on top of
 * the global per-user rate limiter:
 * <ol>
 *   <li><b>Cooldown</b> — each non-developer user may submit at most one
 *       feedback every {@link #COOLDOWN}. Backed by the {@code feedback_log}
 *       table (core V3 migration), so it survives restarts.</li>
 *   <li><b>Blacklist</b> — users on {@code feedback_blacklist} (managed via
 *       {@code /debug feedback block}) are blocked outright with a clear
 *       reply, before any DM is attempted.</li>
 * </ol>
 *
 * <p>The configured {@code DEVELOPER_ID} bypasses both — consistent with
 * how the global {@code RateLimiter} treats the developer.
 *
 * <p>The reply to a successful invoker is always a generic success embed
 * (we don't surface the developer's DM-availability status to arbitrary
 * users); failures to deliver are logged at WARN.
 */
public final class FeedbackCommand implements Command {

	private static final Logger log = LoggerFactory.getLogger(FeedbackCommand.class);

	/** Hard cap on the message option; matches a comfortable embed-field width. */
	private static final int MAX_MESSAGE_LEN = 1500;

	/** Per-user cooldown between {@code /feedback} submissions. */
	private static final Duration COOLDOWN = Duration.ofHours(24);

	private final FeedbackStore store;

	public FeedbackCommand(FeedbackStore store) {
		this.store = store;
	}

	@Override
	public SlashCommandData slashData() {
		OptionData msg = new OptionData(OptionType.STRING, "message",
			"Your suggestion or bug report", true);
		msg.setMaxLength(MAX_MESSAGE_LEN);
		return Commands.slash("feedback", "Send feedback or a bug report to the developer.")
			.addOptions(msg);
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		User user = event.getUser();
		long userId = user.getIdLong();
		long devId = ctx.config().developerId();
		boolean isDeveloper = userId == devId;

		// 1. Blacklist check (skipped for developer).
		if (!isDeveloper && store.isBlocked(userId)) {
			log.info("Rejected /feedback from blacklisted user {}", userId);
			replyEphemeral(event, Embeds.error("Blocked",
				"You're not allowed to use `/feedback`. If you believe this is a mistake, "
					+ "reach out to a server admin or the developer through other channels."));
			return;
		}

		// 2. Cooldown check (skipped for developer). Rolling 24h since last send.
		if (!isDeveloper) {
			Instant now = Instant.now();
			Instant earliest = store.lastSentAt(userId)
				.map(last -> last.plus(COOLDOWN))
				.orElse(Instant.MIN);
			if (now.isBefore(earliest)) {
				Duration remaining = Duration.between(now, earliest);
				log.info("Rejected /feedback from user {} (cooldown, {} left)", userId, format(remaining));
				replyEphemeral(event, Embeds.warning("Slow down",
					"You can send feedback once every 24 hours. Try again in **"
						+ format(remaining) + "**."));
				return;
			}
		}

		// 3. Allowed — record the send (developer skipped, no need to track) and deliver.
		String message = Objects.requireNonNull(event.getOption("message")).getAsString();
		String guildLine = event.getGuild() == null
			? "DM"
			: event.getGuild().getName() + " (" + event.getGuild().getId() + ")";

		EmbedBuilder dm = Embeds.info("Feedback received", message)
			.addField("From", user.getName() + " (" + user.getId() + ")", false)
			.addField("Where", guildLine, false);
		Embeds.brand(dm, event.getJDA());

		event.getJDA().retrieveUserById(devId)
			.flatMap(User::openPrivateChannel)
			.flatMap(c -> c.sendMessageEmbeds(dm.build()))
			.queue(
				ok -> log.info("Feedback delivered from user {}", userId),
				err -> log.warn("Could not DM developer with feedback from user {}: {}",
					userId, err.toString()));

		if (!isDeveloper) {
			try {
				store.recordSent(userId, Instant.now());
			} catch (RuntimeException e) {
				// DM was already queued; the user-facing reply still says "thanks".
				// Worst case the user can re-send in error — preferable to silently
				// blocking them on a transient DB hiccup.
				log.warn("Could not record feedback timestamp for user {}: {}", userId, e.toString());
			}
		}

		EmbedBuilder reply = Embeds.success("Thanks!",
			"Your feedback has been sent to the developer.");
		Embeds.brand(reply, event.getJDA());
		event.getHook().editOriginalEmbeds(reply.build()).queue();
	}

	private static void replyEphemeral(SlashCommandInteractionEvent event, EmbedBuilder embed) {
		// Router has already deferred ephemerally — fill the original.
		Embeds.brand(embed, event.getJDA());
		event.getHook().editOriginalEmbeds(embed.build()).queue();
	}

	/** Format a {@link Duration} as the largest sensible unit for cooldown messaging. */
	private static String format(Duration d) {
		long s = Math.max(d.getSeconds(), 0);
		if (s < 60) return s + "s";
		if (s < 3600) return (s / 60) + "m " + (s % 60) + "s";
		long h = s / 3600;
		long m = (s % 3600) / 60;
		return h + "h " + m + "m";
	}
}
