package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.awt.Color;
import java.util.List;

/**
 * {@code /hatch [egg_id?]} — hatch a specific egg or every ready egg.
 *
 * <p>With {@code egg_id}: hatch only that egg (must be owned by invoker
 * and past its ready_at).
 *
 * <p>Without arguments: hatch every ready-but-pending egg in one go,
 * stopping on the first {@link EggService.NoCompatibleEnclosureException}
 * and reporting the partial result.
 *
 * <p>Reply is public (not ephemeral) — successful hatches are
 * brag-worthy moments and visible to the channel.
 */
public final class HatchCommand implements Command {

	private final PlayerService players;
	private final EggService eggs;
	private final RarityCatalog rarities;

	public HatchCommand(PlayerService players, EggService eggs, RarityCatalog rarities) {
		this.players = players;
		this.eggs = eggs;
		this.rarities = rarities;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("hatch", "Hatch a ready egg (or all ready eggs).")
			.addOption(OptionType.INTEGER, "egg_id",
				"Hatch only this specific egg (omit to hatch every ready one).", false);
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.TYCOON;
	}

	@Override
	public boolean deferEphemeral() {
		return false;
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());

		OptionMapping idOpt = event.getOption("egg_id");
		try {
			if (idOpt != null) {
				EggService.HatchResult r = eggs.hatch(userId, idOpt.getAsLong());
				event.getHook().editOriginalEmbeds(buildSingleEmbed(r, event).build()).queue();
			} else {
				List<EggService.HatchResult> results = eggs.hatchAllReady(userId);
				event.getHook().editOriginalEmbeds(buildBulkEmbed(results, event).build()).queue();
			}
		} catch (GameException ex) {
			event.getHook().editOriginalEmbeds(Embeds.warning(ex.userTitle(), ex.getMessage()).build())
				.queue();
		}
	}

	private EmbedBuilder buildSingleEmbed(EggService.HatchResult r, SlashCommandInteractionEvent event) {
		Rarity rar = rarities.require(r.species().rarity());
		boolean shiny = r.dino().shiny();
		String title = shiny
			? "✨🦖  Shiny " + rar.displayName() + " " + r.species().displayName() + "!"
			: "🦖  Hatched a " + rar.displayName() + " " + r.species().displayName() + "!";
		String description = r.species().description()
			+ (shiny ? "\n\n**A shiny variant!** +50% income for life."
			: "")
			+ "\n\n_+" + r.xpAwarded() + " XP._";
		EmbedBuilder e = Embeds.success(title, description);
		e.setColor(new Color(rar.color()));
		e.addField("Era", r.species().era(), true);
		e.addField("Biome", r.species().biome(), true);
		long incomePerHour = shiny
			? Math.round(r.species().baseIncomePerHour() * ShinyRoller.SHINY_INCOME_MULTIPLIER)
			: r.species().baseIncomePerHour();
		e.addField("Income / hr", shiny ? incomePerHour + " ✨" : String.valueOf(incomePerHour), true);
		Embeds.brand(e, event.getJDA());
		return e;
	}

	private EmbedBuilder buildBulkEmbed(List<EggService.HatchResult> results,
	                                    SlashCommandInteractionEvent event) {
		if (results.isEmpty()) {
			return Embeds.warning("Nothing to hatch",
				"No eggs are ready right now. Run `/eggs` to see what's incubating.");
		}
		StringBuilder body = new StringBuilder();
		long totalXp = 0;
		int shinies = 0;
		for (EggService.HatchResult r : results) {
			boolean shiny = r.dino().shiny();
			if (shiny) shinies++;
			body.append("• ").append(rarities.require(r.species().rarity()).displayName())
				.append(" ").append(shiny ? "✨ " : "")
				.append("**").append(r.species().displayName()).append("** (+")
				.append(r.xpAwarded()).append(" XP)\n");
			totalXp += r.xpAwarded();
		}
		String shinyLine = shinies > 0
			? "\n**" + shinies + " shiny!** ✨"
			: "";
		EmbedBuilder e = Embeds.success(
			"🦖  Hatched " + results.size() + " egg" + (results.size() == 1 ? "" : "s") + "!",
			body.toString() + shinyLine + "\n_Total: +" + totalXp + " XP._");
		Embeds.brand(e, event.getJDA());
		return e;
	}
}
