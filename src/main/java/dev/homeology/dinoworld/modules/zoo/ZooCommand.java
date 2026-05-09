package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.LevelingService;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.buttons.Button;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * {@code /zoo} — the player's park dashboard.
 *
 * <p>Three behaviors keyed off player state:
 * <ol>
 *   <li><b>First run</b> — within {@link #JUST_CREATED_THRESHOLD} of the
 *       player row's creation, render a welcome embed listing 2–3 things
 *       to try next.</li>
 *   <li><b>Returning, no dinos</b> — show the park embed with empty stats
 *       and prompt to visit the shop.</li>
 *   <li><b>Returning, has park</b> — render the real summary: rating with
 *       breakdown, hourly income (rate × happiness), coin balance, level
 *       + XP-to-next, slot count, dino count, enclosure count.</li>
 * </ol>
 *
 * <p>The buttons below the embed are uniform across cases — Shop, Eggs,
 * and Feed-all — so the player always has a one-click path to the next
 * action regardless of state.
 */
public final class ZooCommand implements Command {

	/**
	 * Window after creation during which a player is treated as new and
	 * gets the welcome flow.
	 */
	static final Duration JUST_CREATED_THRESHOLD = Duration.ofSeconds(5);

	private final PlayerService players;
	private final DinoCatalog catalog;
	private final DinoInstanceService dinos;
	private final EnclosureService enclosures;
	private final ParkRatingService rating;
	private final LevelingService leveling;

	public ZooCommand(PlayerService players,
	                  DinoCatalog catalog,
	                  DinoInstanceService dinos,
	                  EnclosureService enclosures,
	                  ParkRatingService rating,
	                  LevelingService leveling) {
		this.players = players;
		this.catalog = catalog;
		this.dinos = dinos;
		this.enclosures = enclosures;
		this.rating = rating;
		this.leveling = leveling;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("zoo", "View your dinosaur park.");
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.TYCOON;
	}

	@Override
	public boolean deferEphemeral() {
		// Park dashboard is meant to be visible in-channel.
		return false;
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		long userId = event.getUser().getIdLong();
		Player p = players.ensure(userId, event.getUser().getEffectiveName());
		// Auto-create the starter enclosure on first contact.
		enclosures.ensureStarter(userId);

		boolean isNew = Duration.between(p.createdAt(), Instant.now())
			.compareTo(JUST_CREATED_THRESHOLD) <= 0;

		EmbedBuilder embed = isNew ? welcomeEmbed(p) : parkEmbed(p);
		Embeds.brand(embed, event.getJDA());

		Button[] btns = buttonRow();
		event.getHook().editOriginalEmbeds(embed.build())
			.setComponents(ActionRow.of(btns[0], btns[1], btns[2], btns[3]))
			.queue();
	}

	// ─── embeds ──────────────────────────────────────────────────────────

	private static EmbedBuilder welcomeEmbed(Player p) {
		return Embeds.success("🦖  Welcome to your park, " + p.displayName() + "!",
			"""
				A starter habitat is ready for your first dinosaur. Try:

				• `/shop` — buy your first egg (Common eggs cost 200 coins)
				• `/daily` — claim 100 coins (every 22 hours; +25 XP)
				• `/eggs` — see what's incubating, hatch when ready

				Keep your dinos fed with `/feed` so they stay happy and earn coins.
				""");
	}

	private EmbedBuilder parkEmbed(Player p) {
		List<DinoInstance> ownedDinos = dinos.findByOwner(p.userId());
		var ownedEnclosures = enclosures.findByOwner(p.userId());
		int enclosureCount = ownedEnclosures.size();

		long incomePerHour = computeIncomePerHour(ownedDinos);
		ParkRatingService.ParkRating r = rating.compute(p.userId());

		long xpInLevel = leveling.xpProgressInLevel(p.xp());
		long xpToNext = leveling.xpToNextLevel(p.level());
		int slots = leveling.slotsForLevel(p.level());

		String description = ownedDinos.isEmpty()
			? "Your park is empty. Visit `/shop` to buy your first egg."
			: "**Park rating: " + r.rating() + "** _("
				+ formatPercent(r.varietyBonus()) + " variety, "
				+ formatPercent(r.tierBalanceBonus()) + " tier balance, "
				+ (r.allBiomesMatch() ? "+10% biome match" : "biome match locked") + ")_";

		EmbedBuilder b = Embeds.info("🦖  " + p.displayName() + "'s park", description);
		b.addField("Coins", String.valueOf(p.coins()), true);
		b.addField("Income / hr", String.valueOf(incomePerHour), true);
		b.addField("Dinos", ownedDinos.size() + " in " + enclosureCount + " enclosure"
			+ (enclosureCount == 1 ? "" : "s"), true);
		b.addField("Level",
			"**" + p.level() + "**  (" + xpInLevel + " / " + xpToNext + " XP)", true);
		b.addField("Incubation slots", String.valueOf(slots), true);
		b.addField("​", "​", true); // spacer for grid alignment

		// One-line summary of each enclosure — keeps the embed scannable
		// without bloating it. Detailed view is /enclosures.
		if (!ownedEnclosures.isEmpty()) {
			StringBuilder summary = new StringBuilder();
			for (var e : ownedEnclosures) {
				int residents = enclosures.countDinosIn(e.id());
				String name = e.name().orElse("Enclosure #" + e.id());
				summary.append("• **").append(name).append("** — ")
					.append(e.biome()).append(" · tier ").append(e.tier())
					.append(" (").append(residents).append("/").append(e.capacity()).append(")\n");
				if (summary.length() > 900) {
					summary.append("…run `/enclosures` to see the rest");
					break;
				}
			}
			b.addField("Enclosures", summary.toString(), false);
		}
		return b;
	}

	private long computeIncomePerHour(List<DinoInstance> ownedDinos) {
		long total = 0L;
		for (DinoInstance d : ownedDinos) {
			DinoSpecies s = catalog.byId(d.speciesId()).orElse(null);
			if (s == null) continue;
			total += s.baseIncomePerHour() * d.happiness() / 100L;
		}
		return total;
	}

	private static String formatPercent(double frac) {
		int pct = (int) Math.round(frac * 100);
		return (pct >= 0 ? "+" : "") + pct + "%";
	}

	// ─── buttons ─────────────────────────────────────────────────────────

	private static Button[] buttonRow() {
		return new Button[]{
			Button.primary(ZooComponentHandler.NAMESPACE + ":" + ZooComponentHandler.ACTION_SHOP_OPEN, "Shop"),
			Button.secondary(ZooComponentHandler.NAMESPACE + ":" + ZooComponentHandler.ACTION_EGGS_OPEN, "Eggs"),
			Button.secondary(ZooComponentHandler.NAMESPACE + ":" + ZooComponentHandler.ACTION_ENCLOSURES_OPEN, "Enclosures"),
			Button.success(ZooComponentHandler.NAMESPACE + ":" + ZooComponentHandler.ACTION_FEED_BULK, "Feed all")
		};
	}
}
