package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.LevelingService;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.staff.StaffEffectsService;
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
import java.util.Locale;

/**
 * {@code /zoo …} — the player's park surface, split into three subcommands:
 *
 * <ul>
 *   <li>{@code /zoo dashboard} — public park summary (rating, income,
 *       coins, level, enclosures). Shows a 🚨 / ⚠️ badge at the top when
 *       there are open issues so the player notices without running the
 *       issues command.</li>
 *   <li>{@code /zoo issues} — ephemeral list of open warnings (low-happiness
 *       dinos, homeless dinos, fired staff, wage runway low) with per-issue
 *       Clear buttons and a Clear-all action.</li>
 *   <li>{@code /zoo income} — ephemeral profit/loss view: hourly income from
 *       dinos, hourly staff wages, hourly net, and a 24-hour projection with
 *       a 🟢/🔴/⚖️ verdict so the player knows at a glance whether their
 *       park is sustainable.</li>
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

	/** Subcommand name for the income / profit-loss view. */
	public static final String SUB_INCOME = "income";

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
	private final IncomeTickService incomeTick;
	private final StaffEffectsService staffEffects;

	public ZooCommand(PlayerService players,
	                  DinoCatalog catalog,
	                  DinoInstanceService dinos,
	                  EnclosureService enclosures,
	                  ParkRatingService rating,
	                  LevelingService leveling,
	                  ZooIssueService issues,
	                  IncomeTickService incomeTick,
	                  StaffEffectsService staffEffects) {
		this.players = players;
		this.catalog = catalog;
		this.dinos = dinos;
		this.enclosures = enclosures;
		this.rating = rating;
		this.leveling = leveling;
		this.issues = issues;
		this.incomeTick = incomeTick;
		this.staffEffects = staffEffects;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("zoo", "View your dinosaur park.")
			.addSubcommands(
				new SubcommandData(SUB_DASHBOARD, "Show your park summary."),
				new SubcommandData(SUB_ISSUES, "List warnings about your zoo."),
				new SubcommandData(SUB_INCOME,
					"See if your park is making or losing money over a 24h window."));
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.TYCOON;
	}

	@Override
	public boolean deferEphemeral(String subcommandName) {
		// Dashboard stays public (current behavior); issues and income are
		// private — they're for the player to consult, not channel chatter.
		return SUB_ISSUES.equals(subcommandName) || SUB_INCOME.equals(subcommandName);
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());
		// Auto-create the starter enclosure on first contact, regardless of subcommand.
		enclosures.ensureStarter(userId);

		String sub = event.getSubcommandName();
		switch (sub == null ? SUB_DASHBOARD : sub) {
			case SUB_ISSUES -> handleIssues(event, userId);
			case SUB_INCOME -> handleIncome(event, userId);
			// Default to dashboard for safety — Discord shouldn't send null
			// for a subcommand-only command, but be defensive.
			default -> handleDashboard(event, userId);
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

				• `/shop` — buy your first egg (Common eggs cost 500 coins)
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

		int slots = leveling.slotsForLevel(p.level());
		String levelDisplay = leveling.isMaxLevel(p.level())
			? "**" + p.level() + "**  (MAX)"
			: "**" + p.level() + "**  ("
				+ leveling.xpProgressInLevel(p.xp()) + " / "
				+ leveling.xpToNextLevel(p.level()) + " XP)";

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
		b.addField("Level", levelDisplay, true);
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

	// ─── income ──────────────────────────────────────────────────────────

	/** Hours in the projection window — change here if the subcommand
	 *  ever needs to expose other windows (12h, 7d, etc.). */
	private static final int PROJECTION_HOURS = 24;

	private void handleIncome(SlashCommandInteractionEvent event, long userId) {
		Player p = players.get(userId).orElseThrow();
		int dinoCount = dinos.findByOwner(userId).size();
		int staffCount = staffEffects == null ? 0 : staffEffects.staffCountForOwner(userId);

		long incomePerHour = incomeTick.computeIncomeFor(userId);
		long wagesPerHour = staffEffects == null ? 0L : staffEffects.totalWagesPerHour(userId);
		long netPerHour = incomePerHour - wagesPerHour;
		long netProjected = netPerHour * PROJECTION_HOURS;

		EmbedBuilder embed = incomeEmbed(p, dinoCount, staffCount,
			incomePerHour, wagesPerHour, netPerHour, netProjected);
		Embeds.brand(embed, event.getJDA());
		event.getHook().editOriginalEmbeds(embed.build()).queue();
	}

	private EmbedBuilder incomeEmbed(Player p, int dinoCount, int staffCount,
	                                 long incomePerHour, long wagesPerHour,
	                                 long netPerHour, long netProjected) {
		// Empty-park short-circuit so the verdict line doesn't say "breaking
		// even" when the player has literally nothing yet.
		if (dinoCount == 0 && staffCount == 0) {
			return Embeds.info("💰  Park income",
				"Your park is empty — no dinos earning, no staff to pay.\n"
					+ "Visit `/shop` to buy your first egg and start earning.");
		}

		String verdict;
		EmbedBuilder embed;
		if (netPerHour > 0) {
			verdict = "🟢 **Making money: +" + formatNumber(netProjected)
				+ " coins / " + PROJECTION_HOURS + "h**";
			embed = Embeds.success("💰  Park income", verdict);
		} else if (netPerHour < 0) {
			verdict = "🔴 **Losing money: " + formatNumber(netProjected)
				+ " coins / " + PROJECTION_HOURS + "h**";
			embed = Embeds.error("💰  Park income", verdict);
		} else {
			verdict = "⚖️ **Breaking even: 0 coins / " + PROJECTION_HOURS + "h**";
			embed = Embeds.warning("💰  Park income", verdict);
		}

		embed.addField("Income / hr",
			"+" + formatNumber(incomePerHour) + " coins"
				+ (dinoCount > 0
					? " _(from " + dinoCount + " dino" + (dinoCount == 1 ? "" : "s") + ")_"
					: ""),
			true);
		embed.addField("Wages / hr",
			(wagesPerHour > 0 ? "−" + formatNumber(wagesPerHour) : "0") + " coins"
				+ (staffCount > 0
					? " _(for " + staffCount + " staff)_"
					: " _(no staff)_"),
			true);
		embed.addField("Net / hr",
			signed(netPerHour) + " coins",
			true);

		// Runway only matters when we're losing — show how many hours of
		// current balance buffer the player has before staff start quitting.
		// Mirrors the math IssueDetector.applyWageRunwayIssue uses.
		if (netPerHour < 0) {
			long drainPerHour = -netPerHour;
			long runwayHours = p.coins() <= 0 ? 0 : p.coins() / drainPerHour;
			String runwayDetail;
			if (runwayHours == 0) {
				runwayDetail = "**0 hours** — staff will quit at the next wage tick. Top up via `/sell` or `/daily`.";
			} else if (runwayHours < 24) {
				runwayDetail = "**" + runwayHours + " hour"
					+ (runwayHours == 1 ? "" : "s") + "** of buffer at current rates.";
			} else {
				runwayDetail = "**" + (runwayHours / 24) + " day"
					+ (runwayHours / 24 == 1 ? "" : "s") + "** of buffer at current rates.";
			}
			embed.addField("Runway", runwayDetail, false);
		}

		embed.addField("Current balance",
			formatNumber(p.coins()) + " coins · projected after " + PROJECTION_HOURS + "h: **"
				+ formatNumber(p.coins() + netProjected) + "**",
			false);
		return embed;
	}

	/** Format with thousand-separators and an explicit sign for the net field. */
	private static String signed(long n) {
		if (n > 0) return "+" + formatNumber(n);
		if (n < 0) return "−" + formatNumber(-n); // U+2212 minus, matches verdict line
		return "0";
	}

	private static String formatNumber(long n) {
		return String.format(Locale.ROOT, "%,d", n);
	}
}
