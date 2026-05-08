package dev.homeology.dinoworld.modules.core;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.core.ModuleManager;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.time.Duration;
import java.time.Instant;

/**
 * {@code /about} — public information embed: version, uptime, JVM, module count.
 *
 * <p>Public, GENERAL category. Reads the bot version from the shadow jar's
 * {@code Implementation-Version} manifest attribute (populated from
 * {@code build.gradle.kts}'s {@code version} field) so it never drifts.
 * Falls back to {@code "dev"} when running outside a packaged jar — e.g.
 * {@code ./gradlew run} — where no such manifest exists.
 */
public final class AboutCommand implements Command {

	/**
	 * Bot version — read from the jar manifest at class-load time, "dev" otherwise.
	 */
	public static final String VERSION = resolveVersion();

	private static String resolveVersion() {
		String v = AboutCommand.class.getPackage().getImplementationVersion();
		return v == null ? "dev" : v;
	}

	private final Instant startedAt;
	private final ModuleManager moduleManager;

	public AboutCommand(Instant startedAt, ModuleManager moduleManager) {
		this.startedAt = startedAt;
		this.moduleManager = moduleManager;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("about", "Show bot version, uptime, and runtime info.");
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		Duration uptime = Duration.between(startedAt, Instant.now());

		EmbedBuilder embed = Embeds.info("About Dino-World", null)
			.addField("Version", VERSION, true)
			.addField("Uptime", humanDuration(uptime), true)
			.addField("Modules", String.valueOf(moduleManager.active().size()), true)
			.addField("Java", Runtime.version().toString(), true);
		Embeds.brand(embed, event.getJDA());
		event.getHook().editOriginalEmbeds(embed.build()).queue();
	}

	@Override
	public boolean deferEphemeral() {
		return false; // public reply
	}

	/**
	 * Format a duration as the largest non-zero unit (s/m/h/d).
	 */
	static String humanDuration(Duration d) {
		long s = d.getSeconds();
		if (s < 60) return s + "s";
		if (s < 3600) return (s / 60) + "m " + (s % 60) + "s";
		if (s < 86400) return (s / 3600) + "h " + ((s % 3600) / 60) + "m";
		return (s / 86400) + "d " + ((s % 86400) / 3600) + "h";
	}
}
