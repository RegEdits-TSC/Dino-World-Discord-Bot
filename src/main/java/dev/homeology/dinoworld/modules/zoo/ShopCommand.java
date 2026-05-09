package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.PlayerService;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;
import net.dv8tion.jda.api.utils.FileUpload;

import java.util.Optional;

/**
 * {@code /shop} — open the egg shop, defaulting to the Common tier.
 *
 * <p>Delegates layout and components to {@link ShopUI#render} so the same
 * UI can be served from a slash command and from the {@code zoo:shop:open}
 * button on /zoo. Replies ephemerally — every shop action is per-user, no
 * point cluttering the channel.
 */
public final class ShopCommand implements Command {

	/**
	 * Default tier shown when no other state exists.
	 */
	public static final String DEFAULT_TIER = "common";

	private final PlayerService players;
	private final RarityCatalog rarities;
	private final DinoCatalog catalog;
	private final EggImageProvider images;
	private final EnclosureService enclosures;

	public ShopCommand(PlayerService players,
	                   RarityCatalog rarities,
	                   DinoCatalog catalog,
	                   EggImageProvider images,
	                   EnclosureService enclosures) {
		this.players = players;
		this.rarities = rarities;
		this.catalog = catalog;
		this.images = images;
		this.enclosures = enclosures;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("shop", "Buy eggs and build enclosures.");
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

		ShopUI.View view = ShopUI.render(DEFAULT_TIER, userId, players, rarities, catalog, enclosures);
		var reply = event.getHook().editOriginalEmbeds(view.embed().build())
			.setComponents(view.components());

		Optional<FileUpload> file = ShopUI.imageAttachment(DEFAULT_TIER, images);
		file.ifPresent(f -> reply.setFiles(f));
		reply.queue();
	}
}
