package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.MessageTopLevelComponent;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.buttons.Button;
import net.dv8tion.jda.api.components.selections.SelectOption;
import net.dv8tion.jda.api.components.selections.StringSelectMenu;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * {@code /enclosures} — list every habitat the player owns plus its
 * occupants, with management actions (rename, demolish) wired through
 * {@link ZooComponentHandler}.
 *
 * <p>Replies ephemerally — the inventory is per-user. Layout:
 * <ul>
 *   <li>One field per enclosure ({@code Discord MessageEmbed} caps at 25
 *       fields, well above any realistic v1 player).</li>
 *   <li>Header: name (or "#id"), biome, tier, occupancy. Body: bulleted
 *       list of resident dinos with happiness%.</li>
 *   <li>StringSelectMenu lets the player pick an enclosure to manage —
 *       routes to {@code zoo:enclosures:pick} which shows
 *       Rename/Demolish buttons for the chosen one.</li>
 * </ul>
 */
public final class EnclosuresCommand implements Command {

	/**
	 * Discord caps a SelectMenu at 25 options.
	 */
	private static final int MAX_PICKER_OPTIONS = 25;

	private final PlayerService players;
	private final EnclosureService enclosures;
	private final DinoInstanceService dinos;
	private final DinoCatalog catalog;

	public EnclosuresCommand(PlayerService players,
	                         EnclosureService enclosures,
	                         DinoInstanceService dinos,
	                         DinoCatalog catalog) {
		this.players = players;
		this.enclosures = enclosures;
		this.dinos = dinos;
		this.catalog = catalog;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("enclosures", "List your habitats and the dinos living in each.");
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
		Player p = players.ensure(userId, event.getUser().getEffectiveName());

		Rendered r = renderList(p);
		var reply = event.replyEmbeds(r.embed.build()).setEphemeral(true);
		if (!r.components.isEmpty()) reply.addComponents(r.components);
		reply.queue();
	}

	/**
	 * Render the list of enclosures + their dinos. Package-private so
	 * {@link ZooComponentHandler} can use the same layout for refresh
	 * after rename/demolish.
	 */
	Rendered renderList(Player p) {
		List<Enclosure> ownedEnclosures = enclosures.findByOwner(p.userId());
		List<DinoInstance> ownedDinos = dinos.findByOwner(p.userId());
		Map<Long, List<DinoInstance>> byEnclosure = new HashMap<>();
		for (DinoInstance d : ownedDinos) {
			d.enclosureId().ifPresent(id ->
				byEnclosure.computeIfAbsent(id, k -> new ArrayList<>()).add(d));
		}

		EmbedBuilder embed = Embeds.info("🌿  " + p.displayName() + "'s habitats",
			ownedEnclosures.isEmpty()
				? "You have no enclosures. Visit `/shop` and click **Build enclosure**."
				: "**" + ownedEnclosures.size() + "** enclosure"
					+ (ownedEnclosures.size() == 1 ? "" : "s")
					+ ", " + ownedDinos.size() + " resident"
					+ (ownedDinos.size() == 1 ? "" : "s") + ".");

		for (Enclosure e : ownedEnclosures) {
			List<DinoInstance> residents = byEnclosure.getOrDefault(e.id(), List.of());
			String name = e.name().orElse("Enclosure #" + e.id());
			String header = name + " — " + e.biome() + " · tier " + e.tier()
				+ " · " + residents.size() + "/" + e.capacity();
			String body = residents.isEmpty() ? "_empty_" : residents.stream()
				.map(d -> "• " + dinoLabel(d) + " (" + d.happiness() + "% happy)")
				.collect(Collectors.joining("\n"));
			if (body.length() > 1000) body = body.substring(0, 997) + "…";
			embed.addField(header, body, false);
		}

		List<MessageTopLevelComponent> components = new ArrayList<>();
		if (!ownedEnclosures.isEmpty()) {
			StringSelectMenu.Builder picker = StringSelectMenu.create(
				ZooComponentHandler.NAMESPACE + ":enclosures:pick")
				.setPlaceholder("Manage an enclosure (rename / demolish)");
			int added = 0;
			for (Enclosure e : ownedEnclosures) {
				if (added >= MAX_PICKER_OPTIONS) break;
				String label = e.name().orElse("Enclosure #" + e.id())
					+ " (" + e.biome() + " · tier " + e.tier() + ")";
				if (label.length() > 100) label = label.substring(0, 97) + "…";
				picker.addOptions(SelectOption.of(label, String.valueOf(e.id())));
				added++;
			}
			components.add(ActionRow.of(picker.build()));
		}
		components.add(ActionRow.of(Button.secondary(
			ZooComponentHandler.NAMESPACE + ":shop:open", "Open shop")));

		return new Rendered(embed, components);
	}

	private String dinoLabel(DinoInstance d) {
		String name = d.customName().orElseGet(() ->
			catalog.byId(d.speciesId()).map(DinoSpecies::displayName).orElse(d.speciesId())
				+ " #" + d.id());
		return name;
	}

	/**
	 * Rendered list view — exposed so the component handler can re-render
	 * after a rename or demolish.
	 */
	record Rendered(EmbedBuilder embed, List<MessageTopLevelComponent> components) {
	}
}
