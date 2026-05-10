package dev.homeology.dinoworld.modules.players;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.missions.Mission;
import dev.homeology.dinoworld.modules.players.missions.MissionCatalog;
import dev.homeology.dinoworld.modules.players.missions.MissionProgressService;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * {@code /missions} — show the player's tutorial / mission progress.
 *
 * <p>Rewards are auto-awarded by {@code MissionAwarder} after the
 * triggering action; this command is the read-side surface so a player
 * can see what's done, what's pending, and how much they'd earn for
 * each remaining mission.
 *
 * <p>Replies ephemerally — mission progress is per-player, not channel
 * chatter.
 */
public final class MissionsCommand implements Command {

	private final PlayerService players;
	private final MissionCatalog catalog;
	private final MissionProgressService progress;

	public MissionsCommand(PlayerService players,
	                       MissionCatalog catalog,
	                       MissionProgressService progress) {
		this.players = players;
		this.catalog = catalog;
		this.progress = progress;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("missions",
			"Show your tutorial and mission progress with pending rewards.");
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.TYCOON;
	}

	@Override
	public boolean deferEphemeral() {
		return true;
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());

		Set<String> completed = progress.completedFor(userId);
		EmbedBuilder embed = renderEmbed(event, completed);
		event.getHook().editOriginalEmbeds(embed.build()).queue();
	}

	private EmbedBuilder renderEmbed(SlashCommandInteractionEvent event, Set<String> completed) {
		var sets = catalog.sets();
		int total = catalog.all().size();
		int doneTotal = (int) catalog.all().stream().filter(m -> completed.contains(m.id())).count();

		String header = "**" + doneTotal + " / " + total + " complete**"
			+ (doneTotal == total ? " — 🎉 every mission cleared!" : "");
		EmbedBuilder embed = doneTotal == total
			? Embeds.success("📜  Missions", header)
			: Embeds.info("📜  Missions", header);

		long pendingCoins = 0;
		long pendingXp = 0;

		for (var set : sets) {
			StringBuilder body = new StringBuilder();
			List<Mission> missions = set.missions();
			int doneInSet = 0;
			for (Mission m : missions) {
				boolean done = completed.contains(m.id());
				if (done) doneInSet++;
				else {
					pendingCoins += m.rewardCoins();
					pendingXp += m.rewardXp();
				}
				body.append(done ? "✅ " : "⬜ ")
					.append("**").append(m.displayName()).append("** — ")
					.append(format(m.rewardCoins())).append("c, ")
					.append(format(m.rewardXp())).append(" XP\n")
					.append("   _").append(m.description()).append("_\n");
			}
			String setHeader = set.displayName() + " (" + doneInSet + "/" + missions.size() + ")";
			embed.addField(setHeader, body.toString(), false);
		}

		if (pendingCoins > 0 || pendingXp > 0) {
			embed.addField("Remaining rewards",
				"+" + format(pendingCoins) + " coins, +" + format(pendingXp) + " XP across "
					+ (total - doneTotal) + " unfinished mission"
					+ (total - doneTotal == 1 ? "" : "s") + ".",
				false);
		}

		Embeds.brand(embed, event.getJDA());
		return embed;
	}

	private static String format(long n) {
		return String.format(Locale.ROOT, "%,d", n);
	}
}
