package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.selections.SelectOption;
import net.dv8tion.jda.api.components.selections.StringSelectMenu;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.util.List;

/**
 * {@code /sell} — pick a dino from a dropdown to permanently sell.
 *
 * <p>The dropdown selection (handled by {@link ZooComponentHandler}'s
 * {@code zoo:sell:pick}) renders a confirmation embed with the sell price
 * and XP reward; only clicking the {@code zoo:sell:confirm:<id>} button
 * actually deletes the dino.
 *
 * <p>Sale economics (cheap to retune later):
 * <ul>
 *   <li>Price = {@code species.base_income_per_hour × 24} — one full day
 *       of income at perfect happiness, denominated in coins.</li>
 *   <li>XP = {@code species.base_income_per_hour × 5} — meaningful, but
 *       deliberately less than hatching the same rarity (so selling
 *       isn't the dominant XP source).</li>
 * </ul>
 */
public final class SellCommand implements Command {

	/**
	 * Maximum dinos shown in the dropdown — Discord cap.
	 */
	private static final int MAX_OPTIONS = 25;

	private final PlayerService players;
	private final DinoInstanceService dinos;
	private final DinoCatalog catalog;

	public SellCommand(PlayerService players, DinoInstanceService dinos, DinoCatalog catalog) {
		this.players = players;
		this.dinos = dinos;
		this.catalog = catalog;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("sell", "Sell a dinosaur for coins (with confirmation).");
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

		List<DinoInstance> owned = dinos.findByOwner(userId);
		if (owned.isEmpty()) {
			event.replyEmbeds(Embeds.warning("Nothing to sell",
				"You have no dinos. Visit `/shop`.").build())
				.setEphemeral(true).queue();
			return;
		}

		StringSelectMenu.Builder sel = StringSelectMenu.create(
			ZooComponentHandler.NAMESPACE + ":sell:pick")
			.setPlaceholder("Pick a dino to sell");
		int added = 0;
		for (DinoInstance d : owned) {
			if (added >= MAX_OPTIONS) break;
			sel.addOptions(SelectOption.of(buildLabel(d), String.valueOf(d.id())));
			added++;
		}

		EmbedBuilder embed = Embeds.warning("💸  Sell a dino",
			"Pick from the dropdown. The next screen will confirm the price before anything's removed.");
		Embeds.brand(embed, event.getJDA());
		event.replyEmbeds(embed.build())
			.addComponents(ActionRow.of(sel.build()))
			.setEphemeral(true).queue();
	}

	// ─── pricing — exposed for the component handler ─────────────────────

	/**
	 * @return coins paid out for selling one of {@code species}
	 */
	public static long sellPrice(DinoSpecies species) {
		return species.baseIncomePerHour() * 24L;
	}

	/**
	 * @return XP awarded to the player when selling one of {@code species}
	 */
	public static long sellXp(DinoSpecies species) {
		return species.baseIncomePerHour() * 5L;
	}

	private String buildLabel(DinoInstance d) {
		DinoSpecies s = catalog.byId(d.speciesId()).orElse(null);
		String name = d.customName().orElseGet(() ->
			(s == null ? d.speciesId() : s.displayName()) + " #" + d.id());
		long price = s == null ? 0 : sellPrice(s);
		String label = name + " — " + price + " coins";
		return label.length() > 100 ? label.substring(0, 97) + "…" : label;
	}
}
