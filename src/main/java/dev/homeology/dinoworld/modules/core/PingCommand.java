package dev.homeology.dinoworld.modules.core;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

/**
 * {@code /ping} — reports the bot's gateway and REST latency.
 *
 * <p>Public command, available to anyone. Replies non-ephemerally so the
 * answer is visible in-channel; this is the canonical "is the bot alive"
 * smoke test for end users. The two latencies measure different things:
 * gateway is the WebSocket heartbeat round-trip, REST is the HTTP API
 * round-trip — they vary independently and together hint at where any
 * slowness lives.
 */
public final class PingCommand implements Command {

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("ping", "Show the bot's gateway and REST latency.");
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		JDA jda = event.getJDA();
		long gatewayMs = jda.getGatewayPing();
		// The router has already deferred the reply; getRestPing().complete()
		// blocks this worker thread, which is fine — we're off the JDA
		// event-pool thread and the user already sees "thinking…".
		long restMs = jda.getRestPing().complete();

		EmbedBuilder embed = Embeds.info("Pong!", null)
			.addField("Gateway", gatewayMs + " ms", true)
			.addField("REST", restMs + " ms", true);
		Embeds.brand(embed, jda);
		event.getHook().editOriginalEmbeds(embed.build()).queue();
	}

	@Override
	public boolean deferEphemeral() {
		// /ping replies in-channel — keep the deferred reply public.
		return false;
	}
}
