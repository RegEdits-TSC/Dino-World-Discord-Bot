package dev.homeology.dinoworld.modules.players;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.User;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.time.Duration;
import java.time.Instant;

/**
 * {@code /profile [user]} — show a user's park-keeper profile.
 *
 * <p>The invoker's row is auto-created via {@link PlayerService#ensure} on
 * every call, which doubles as the display-name refresh mechanism. Looking
 * up someone else's profile is read-only — if the target user has never
 * interacted with the bot the embed says so rather than auto-creating a
 * shell row on their behalf.
 *
 * <p>Embed surfaces the leveling-curve numbers from {@link LevelingService}:
 * XP into current level, XP to the next, and the incubation-slot count
 * the player has unlocked so far.
 */
public final class ProfileCommand implements Command {

	private final PlayerService players;

	public ProfileCommand(PlayerService players) {
		this.players = players;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("profile", "Show your park-keeper profile.")
			.addOption(OptionType.USER, "user", "Whose profile to view (defaults to yourself).", false);
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.TYCOON;
	}

	@Override
	public boolean deferEphemeral() {
		// Profiles are public — looking up someone else's stats should be visible to the channel.
		return false;
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		User invoker = event.getUser();
		Player invokerPlayer = players.ensure(invoker.getIdLong(), invoker.getEffectiveName());

		var targetOpt = event.getOption("user");
		User target = targetOpt == null ? invoker : targetOpt.getAsUser();

		Player p;
		if (target.getIdLong() == invoker.getIdLong()) {
			p = invokerPlayer;
		} else {
			var found = players.get(target.getIdLong());
			if (found.isEmpty()) {
				EmbedBuilder e = Embeds.info("No profile",
					target.getEffectiveName() + " hasn't started a park yet.");
				Embeds.brand(e, event.getJDA());
				event.getHook().editOriginalEmbeds(e.build()).queue();
				return;
			}
			p = found.get();
		}

		LevelingService leveling = players.leveling();
		int slots = leveling.slotsForLevel(p.level());
		long days = Math.max(0, Duration.between(p.createdAt(), Instant.now()).toDays());

		String levelLine;
		if (leveling.isMaxLevel(p.level())) {
			levelLine = "**" + p.level() + "**  (MAX)";
		} else {
			long xpInLevel = leveling.xpProgressInLevel(p.xp());
			long xpToNext = leveling.xpToNextLevel(p.level());
			levelLine = "**" + p.level() + "**  (" + xpInLevel + " / " + xpToNext + " XP)";
		}

		EmbedBuilder embed = Embeds.info("🦖  " + p.displayName() + "'s park", "")
			.addField("Coins", String.valueOf(p.coins()), true)
			.addField("Level", levelLine, true)
			.addField("Incubation slots", String.valueOf(slots), true)
			.addField("Park age", days + " day" + (days == 1 ? "" : "s"), true);

		// Achievements + title — sourced lazily from the service registry so
		// ProfileCommand keeps its constructor stable and the achievements
		// module stays optional. If the module isn't loaded, the fields just
		// don't render.
		var ach = ctx.services().tryGet(
			dev.homeology.dinoworld.modules.achievements.AchievementCatalog.class);
		var progress = ctx.services().tryGet(
			dev.homeology.dinoworld.modules.achievements.AchievementProgressService.class);
		if (ach.isPresent() && progress.isPresent()) {
			int unlocked = progress.get().unlockedFor(p.userId()).size();
			embed.addField("Achievements", unlocked + " / " + ach.get().size(), true);
		}
		embed.addField("Title",
			p.equippedTitle().map(t -> "_" + t + "_").orElse("_(none)_"), true);

		// Granular XP progress moved to /rank, which renders a visual progress
		// bar; /profile keeps the at-a-glance grid clean.
		Embeds.brand(embed, event.getJDA());
		event.getHook().editOriginalEmbeds(embed.build()).queue();
	}
}
