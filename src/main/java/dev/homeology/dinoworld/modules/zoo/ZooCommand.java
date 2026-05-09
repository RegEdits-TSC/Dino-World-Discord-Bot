package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.LevelingService;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssue;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssueRenderer;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssueService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.buttons.Button;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;
import net.dv8tion.jda.api.interactions.commands.build.SubcommandData;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * {@code /zoo …} — the player's park surface, split into two subcommands:
 *
 * <ul>
 *   <li>{@code /zoo dashboard} — public park summary (rating, income,
 *       coins, level, enclosures). Shows a 🚨 / ⚠️ badge at the top when
 *       there are open issues so the player notices without running the
 *       issues command.</li>
 *   <li>{@code /zoo issues} — ephemeral list of open warnings (low-happiness
 *       dinos, homeless dinos, fired staff, wage runway low) with per-issue
 *       Clear buttons and a Clear-all action.</li>
 * </ul>
 *
 * <p>Dashboard has three render states keyed off player state:
 * <ol>
 *   <li><b>First run</b> — within {@link #JUST_CREATED_THRESHOLD} of the
 *       player row's creation, render a welcome embed.</li>
 *   <li><b>Returning, no dinos</b> — show the park embed with empty stats
 *       and prompt to visit the shop.</li>
 *   <li><b>Returning, has park</b> — render the real summary.</li>
 * </ol>
 */
public final class ZooCommand implements Command {

	/** Subcommand name for the existing park-summary view. */
	public static final String SUB_DASHBOARD = "dashboard";

	/** Subcommand name for the issues list. */
	public static final String SUB_ISSUES = "issues";

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
	private final ZooIssueService issues;

	public ZooCommand(PlayerService players,
	                  DinoCatalog catalog,
	                  DinoInstanceService dinos,
	                  EnclosureService enclosures,
	                  ParkRatingService rating,
	                  LevelingService leveling,
	                  ZooIssueService issues) {
		this.players = players;
		this.catalog = catalog;
		this.dinos = dinos;
		this.enclosures = enclosures;
		this.rating = rating;
		this.leveling = leveling;
		this.issues = issues;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("zoo", "View your dinosaur park.")
			.addSubcommands(
				new SubcommandData(SUB_DASHBOARD, "Show your park summary."),
				new SubcommandData(SUB_ISSUES, "List warnings about your zoo."));
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.TYCOON;
	}

	@Override
	public boolean deferEphemeral(String subcommandName) {
		// Dashboard stays public (current behavior); issues is private to the player.
		return SUB_ISSUES.equals(subcommandName);
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());
		// Auto-create the starter enclosure on first contact, regardless of subcommand.
		enclosures.ensureStarter(userId);

		String sub = event.getSubcommandName();
		if (SUB_ISSUES.equals(sub)) {
			handleIssues(event, userId);
		} else {
			// Default to dashboard for safety — Discord shouldn't send null
			// for a subcommand-only command, but be defensive.
			handleDashboard(event, userId);
		}
	}

	// ─── dashboard ───────────────────────────────────────────────────────

	private void handleDashboard(SlashCommandInteractionEvent event, long userId) {
		Player p = players.get(userId).orElseThrow();

		boolean isNew = Duration.between(p.createdAt(), Instant.now())
			.compareTo(JUST_CREATED_THRESHOLD) <= 0;

		EmbedBuilder embed = isNew ? welcomeEmbed(p) : parkEmbed(p);
		Embeds.brand(embed, event.getJDA());

		Button[] btns = buttonRow();
		event.getHook().editOriginalEmbeds(embed.build())
			.setComponents(ActionRow.of(btns[0], btns[1], btns[2], btns[3]))
			.queue();
	}

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
				+ (r.allBiomesMatch() ? "+10% biome match" : "biome match locked")
				+ (r.issuePenalty() > 0
					? ", −" + Math.round(r.issuePenalty() * 100) + "% issues"
					: "")
				+ ")_";

		// Issue badge — surfaces unresolved problems on the dashboard so
		// the player notices without running /zoo issues. Critical wins icon.
		String badge = issueBadge(p.userId());
		if (!badge.isEmpty()) description = badge + "\n" + description;

		EmbedBuilder b = Embeds.info("🦖  " + p.displayName() + "'s park", description);
		b.addField("Coins", String.valueOf(p.coins()), true);
		b.addField("Income / hr", String.valueOf(incomePerHour), true);
		b.addField("Dinos", ownedDinos.size() + " in " + enclosureCount + " enclosure"
			+ (enclosureCount == 1 ? "" : "s"), true);
		b.addField("Level",
			"**" + p.level() + "**  (" + xpInLevel + " / " + xpToNext + " XP)", true);
		b.addField("Incubation slots", String.valueOf(slots), true);
		b.addField("​", "​", true); // spacer for grid alignment

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

	private String issueBadge(long userId) {
		if (issues == null) return "";
		int total = issues.countOpenForOwner(userId);
		if (total == 0) return "";
		int criticals = issues.countOpenForOwner(userId, ZooIssue.Severity.CRITICAL);
		String icon = criticals > 0 ? "🚨" : "⚠️";
		return icon + " **" + total + " open issue" + (total == 1 ? "" : "s")
			+ "** — run `/zoo issues`";
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

	private static Button[] buttonRow() {
		return new Button[]{
			Button.primary(ZooComponentHandler.NAMESPACE + ":" + ZooComponentHandler.ACTION_SHOP_OPEN, "Shop"),
			Button.secondary(ZooComponentHandler.NAMESPACE + ":" + ZooComponentHandler.ACTION_EGGS_OPEN, "Eggs"),
			Button.secondary(ZooComponentHandler.NAMESPACE + ":" + ZooComponentHandler.ACTION_ENCLOSURES_OPEN, "Enclosures"),
			Button.success(ZooComponentHandler.NAMESPACE + ":" + ZooComponentHandler.ACTION_FEED_BULK, "Feed all")
		};
	}

	// ─── issues ──────────────────────────────────────────────────────────

	private void handleIssues(SlashCommandInteractionEvent event, long userId) {
		List<ZooIssue> open = issues.findOpenForOwner(userId);
		ZooIssueRenderer.Rendered r = ZooIssueRenderer.render(open);
		Embeds.brand(r.embed(), event.getJDA());

		var reply = event.getHook().editOriginalEmbeds(r.embed().build());
		if (!r.components().isEmpty()) reply.setComponents(r.components());
		reply.queue();
	}
}
