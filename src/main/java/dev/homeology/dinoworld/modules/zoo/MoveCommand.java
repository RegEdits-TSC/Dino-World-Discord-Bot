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
 * {@code /move} — relocate a dino from one enclosure to another (or
 * out of an enclosure entirely).
 *
 * <p>Two-step picker pattern, same shape as {@code /feed} and {@code /sell}:
 * <ol>
 *   <li>{@code /move} renders a {@link StringSelectMenu} of every owned
 *       dino. Each option's label includes the dino's current enclosure
 *       so the player knows what they're moving.</li>
 *   <li>Selecting a dino routes through {@link ZooComponentHandler}'s
 *       {@code zoo:move:to:<dinoId>} which re-prompts with another
 *       select menu — this time only enclosures the species is
 *       <em>allowed</em> to live in (tier ≥ rarity requirement, free
 *       capacity).</li>
 *   <li>Selecting a destination triggers {@code zoo:move:do:<dinoId>}
 *       and applies the assignment.</li>
 * </ol>
 *
 * <p>Biome match is preferred but not required — moving a forest dino
 * into a marine enclosure is allowed. Only tier and capacity are hard
 * constraints (matching the rules used by hatch's
 * {@link EnclosureService#findCompatibleForSpecies}).
 */
public final class MoveCommand implements Command {

	/**
	 * Discord SelectMenu cap.
	 */
	private static final int MAX_OPTIONS = 25;

	private final PlayerService players;
	private final DinoInstanceService dinos;
	private final EnclosureService enclosures;
	private final DinoCatalog catalog;

	public MoveCommand(PlayerService players,
	                   DinoInstanceService dinos,
	                   EnclosureService enclosures,
	                   DinoCatalog catalog) {
		this.players = players;
		this.dinos = dinos;
		this.enclosures = enclosures;
		this.catalog = catalog;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("move", "Move a dino to a different enclosure.");
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
			event.replyEmbeds(Embeds.warning("Nothing to move",
				"You have no dinos. Hatch one from `/eggs`.").build())
				.setEphemeral(true).queue();
			return;
		}

		StringSelectMenu.Builder sel = StringSelectMenu.create(
			ZooComponentHandler.NAMESPACE + ":move:to")
			.setPlaceholder("Pick a dino to move");
		int added = 0;
		for (DinoInstance d : owned) {
			if (added >= MAX_OPTIONS) break;
			sel.addOptions(SelectOption.of(buildLabel(d), String.valueOf(d.id())));
			added++;
		}

		EmbedBuilder embed = Embeds.info("📦  Move a dino",
			"Pick a dino. The next prompt will list enclosures it can live in "
				+ "(tier and capacity must allow it; biome doesn't need to match).");
		Embeds.brand(embed, event.getJDA());
		event.replyEmbeds(embed.build())
			.addComponents(ActionRow.of(sel.build()))
			.setEphemeral(true).queue();
	}

	/**
	 * Build the per-dino option label used in the dino picker.
	 * Package-private so the component handler can reuse it.
	 */
	String buildLabel(DinoInstance d) {
		DinoSpecies s = catalog.byId(d.speciesId()).orElse(null);
		String name = d.customName().orElseGet(() ->
			(s == null ? d.speciesId() : s.displayName()) + " #" + d.id());
		String where = d.enclosureId().isEmpty()
			? "homeless"
			: enclosures.findById(d.enclosureId().getAsLong())
				.map(e -> e.name().orElse("#" + e.id()))
				.orElse("?");
		String label = name + " — currently in " + where;
		return label.length() > 100 ? label.substring(0, 97) + "…" : label;
	}
}
