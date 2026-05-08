package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.LevelingService;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.EggInstance;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.MessageTopLevelComponent;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.buttons.Button;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * {@code /eggs} — the player's incubation inventory.
 *
 * <p>Two buckets, separated visually in the embed:
 * <ul>
 *   <li><b>Ready</b> — eggs whose {@code ready_at} has passed. Each gets
 *       a "Hatch" button using the {@code zoo:eggs:hatch:<id>} routing.</li>
 *   <li><b>Incubating</b> — still ticking. Time-remaining shown.</li>
 * </ul>
 *
 * <p>Footer carries the player's slot count
 * ({@link LevelingService#slotsForLevel(int)}) so the player can see
 * progress toward more incubation capacity.
 *
 * <p>Reply is ephemeral — the inventory is per-user and changes often.
 */
public final class EggsCommand implements Command {

	/**
	 * Discord caps each message at 5 action rows (5 buttons each), so we
	 * limit Hatch buttons to 5 per render. If the player has more ready
	 * eggs they'll need {@code /hatch} (no arg) to bulk hatch.
	 */
	private static final int MAX_HATCH_BUTTONS = 5;

	private final PlayerService players;
	private final EggService eggs;
	private final RarityCatalog rarities;
	private final DinoCatalog catalog;
	private final LevelingService leveling;

	public EggsCommand(PlayerService players,
	                   EggService eggs,
	                   RarityCatalog rarities,
	                   DinoCatalog catalog,
	                   LevelingService leveling) {
		this.players = players;
		this.eggs = eggs;
		this.rarities = rarities;
		this.catalog = catalog;
		this.leveling = leveling;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("eggs", "View your incubating eggs.");
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

		Rendered r = render(p, eggs.findPending(userId));
		var reply = event.getHook().editOriginalEmbeds(r.embed.build());
		if (!r.components.isEmpty()) {
			reply.setComponents(r.components);
		}
		reply.queue();
	}

	/**
	 * Render the inventory. Package-private so {@link ZooComponentHandler}
	 * can use the same layout for the {@code zoo:eggs:open} button.
	 */
	Rendered render(Player p, List<EggInstance> pending) {
		int slots = leveling.slotsForLevel(p.level());
		int active = pending.size();

		EmbedBuilder embed = Embeds.info("🥚  Incubation chamber",
			"You have **" + active + "** egg" + (active == 1 ? "" : "s")
				+ " using **" + active + " / " + slots + "** slots.");

		Instant now = Instant.now();
		List<EggInstance> ready = pending.stream().filter(e -> e.isReadyAt(now)).toList();
		List<EggInstance> incubating = pending.stream().filter(e -> !e.isReadyAt(now)).toList();

		if (!ready.isEmpty()) {
			StringBuilder body = new StringBuilder();
			for (EggInstance e : ready) {
				body.append("• ").append(label(e)).append(" — **Ready!** (id `").append(e.id()).append("`)\n");
			}
			embed.addField("Ready to hatch (" + ready.size() + ")", body.toString(), false);
		}
		if (!incubating.isEmpty()) {
			StringBuilder body = new StringBuilder();
			for (EggInstance e : incubating) {
				Duration left = Duration.between(now, e.readyAt());
				body.append("• ").append(label(e)).append(" — ")
					.append(formatRemaining(left)).append(" left\n");
			}
			embed.addField("Incubating (" + incubating.size() + ")", body.toString(), false);
		}
		if (pending.isEmpty()) {
			embed.addField("​", "No eggs incubating. Visit `/shop` to buy one.", false);
		}

		// Up to 5 Hatch buttons (1 action row); plus a "Hatch all" if there
		// are 2+ ready, plus an "Open shop" convenience button.
		List<MessageTopLevelComponent> components = new ArrayList<>();
		List<Button> hatchButtons = new ArrayList<>();
		int added = 0;
		for (EggInstance e : ready) {
			if (added >= MAX_HATCH_BUTTONS) break;
			hatchButtons.add(Button.success(
				ZooComponentHandler.NAMESPACE + ":eggs:hatch:" + e.id(),
				"Hatch " + label(e)));
			added++;
		}
		if (!hatchButtons.isEmpty()) {
			components.add(ActionRow.of(List.copyOf(hatchButtons)));
		}
		List<Button> bottomRow = new ArrayList<>();
		if (ready.size() >= 2) {
			bottomRow.add(Button.primary(
				ZooComponentHandler.NAMESPACE + ":eggs:hatch-all", "Hatch all ready"));
		}
		bottomRow.add(Button.secondary(
			ZooComponentHandler.NAMESPACE + ":shop:open", "Open shop"));
		components.add(ActionRow.of(List.copyOf(bottomRow)));

		return new Rendered(embed, components);
	}

	private String label(EggInstance e) {
		return e.speciesId()
			.flatMap(catalog::byId)
			.map(s -> s.displayName() + " egg")
			.orElseGet(() -> "Mystery " + rarities.require(e.rarity()).displayName().toLowerCase() + " egg");
	}

	private static String formatRemaining(Duration d) {
		long total = d.getSeconds();
		if (total < 60) return total + "s";
		long h = total / 3600;
		long m = (total % 3600) / 60;
		if (h > 0) return h + "h " + m + "m";
		return m + "m";
	}

	/**
	 * Rendered eggs view — exposed so the component handler can edit
	 * the existing message after a hatch.
	 */
	record Rendered(EmbedBuilder embed, List<MessageTopLevelComponent> components) {
	}
}
