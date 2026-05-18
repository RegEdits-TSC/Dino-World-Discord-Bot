package dev.homeology.dinoworld.modules.achievements;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.events.interaction.command.CommandAutoCompleteInteractionEvent;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.Command.Choice;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.OptionData;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;
import net.dv8tion.jda.api.interactions.commands.build.SubcommandData;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * {@code /achievements …} — the read-side and equip surface for the
 * achievement system. Unlocks themselves happen automatically via
 * {@link AchievementAwarder} after each command.
 *
 * <p>Subcommands:
 * <ul>
 *   <li>{@code /achievements list} — show every achievement grouped by
 *       set, with unlock state and reward.</li>
 *   <li>{@code /achievements equip title:<name>} — set the equipped
 *       title; rejected if the title isn't yet unlocked.</li>
 *   <li>{@code /achievements unequip} — clear the equipped title.</li>
 * </ul>
 *
 * <p>The {@code title} option autocompletes from the invoker's unlocked
 * titles so only valid choices appear in the dropdown.
 */
public final class AchievementsCommand extends ListenerAdapter implements Command {

	public static final String SUB_LIST = "list";
	public static final String SUB_EQUIP = "equip";
	public static final String SUB_UNEQUIP = "unequip";

	private static final int AUTOCOMPLETE_LIMIT = 25;

	private final PlayerService players;
	private final AchievementCatalog catalog;
	private final AchievementProgressService progress;

	public AchievementsCommand(PlayerService players,
	                           AchievementCatalog catalog,
	                           AchievementProgressService progress) {
		this.players = players;
		this.catalog = catalog;
		this.progress = progress;
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.TYCOON;
	}

	@Override
	public boolean deferEphemeral() {
		// Achievement progress is per-player; replies stay private.
		return true;
	}

	@Override
	public SlashCommandData slashData() {
		OptionData titleOpt = new OptionData(OptionType.STRING, "title",
			"Pick one of your unlocked titles", true, true);

		return Commands.slash("achievements", "Browse achievements, equip a title, or unequip.")
			.addSubcommands(
				new SubcommandData(SUB_LIST, "Show every achievement with your unlock state."),
				new SubcommandData(SUB_EQUIP, "Equip one of your unlocked titles.")
					.addOptions(titleOpt),
				new SubcommandData(SUB_UNEQUIP, "Clear the title currently shown on /profile and /rank."));
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());

		String sub = event.getSubcommandName();
		if (sub == null) {
			reply(event, Embeds.error("Missing subcommand",
				"Use /achievements list, equip, or unequip."));
			return;
		}
		switch (sub) {
			case SUB_LIST -> handleList(event, userId);
			case SUB_EQUIP -> handleEquip(event, userId);
			case SUB_UNEQUIP -> handleUnequip(event, userId);
			default -> reply(event, Embeds.error("Unknown subcommand", "/achievements " + sub));
		}
	}

	// ─── list ──────────────────────────────────────────────────────────

	private void handleList(SlashCommandInteractionEvent event, long userId) {
		Set<String> unlocked = progress.unlockedFor(userId);
		EmbedBuilder embed = Embeds.info(
			"🏆  Achievements", "**" + unlocked.size() + " / " + catalog.size() + " unlocked**");
		for (AchievementCatalog.AchievementSet set : catalog.sets()) {
			StringBuilder body = new StringBuilder();
			for (Achievement a : set.achievements()) {
				boolean done = unlocked.contains(a.id());
				body.append(done ? "✅ " : "⬜ ")
					.append("**").append(a.displayName()).append("** — _")
					.append(a.title()).append("_")
					.append("\n   ").append(a.description());
				if (a.rewardCoins() > 0 || a.rewardXp() > 0) {
					body.append(" (+").append(format(a.rewardCoins()))
						.append("c, +").append(format(a.rewardXp())).append(" XP)");
				}
				body.append('\n');
			}
			embed.addField(set.displayName(), body.toString().trim(), false);
		}
		reply(event, embed);
	}

	// ─── equip / unequip ───────────────────────────────────────────────

	private void handleEquip(SlashCommandInteractionEvent event, long userId) {
		OptionMapping titleOpt = event.getOption("title");
		if (titleOpt == null) {
			reply(event, Embeds.error("Missing title", "Specify which title to equip."));
			return;
		}
		String title = titleOpt.getAsString();
		Achievement a = catalog.byTitle(title).orElse(null);
		if (a == null) {
			reply(event, Embeds.error("Unknown title",
				"No achievement grants the title `" + title + "`."));
			return;
		}
		Set<String> unlocked = progress.unlockedFor(userId);
		if (!unlocked.contains(a.id())) {
			reply(event, Embeds.warning("Title locked",
				"You haven't unlocked **" + a.displayName() + "** yet. "
					+ "Run `/achievements list` to see what's left."));
			return;
		}
		players.setEquippedTitle(userId, a.title());
		reply(event, Embeds.success("Title equipped",
			"Now displayed on `/profile` and `/rank`: _" + a.title() + "_"));
	}

	private void handleUnequip(SlashCommandInteractionEvent event, long userId) {
		Player p = players.get(userId).orElseThrow();
		if (p.equippedTitle().isEmpty()) {
			reply(event, Embeds.info("Nothing to unequip", "You don't have a title equipped."));
			return;
		}
		players.setEquippedTitle(userId, null);
		reply(event, Embeds.success("Title cleared",
			"No title will be shown on `/profile` or `/rank`."));
	}

	// ─── autocomplete ──────────────────────────────────────────────────

	@Override
	public void onCommandAutoCompleteInteraction(CommandAutoCompleteInteractionEvent event) {
		if (!"achievements".equals(event.getName())) return;
		if (!"title".equals(event.getFocusedOption().getName())) {
			event.replyChoices(List.of()).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		String prefix = event.getFocusedOption().getValue().toLowerCase(Locale.ROOT);

		Set<String> unlocked = progress.unlockedFor(userId);
		List<Choice> out = new ArrayList<>();
		for (Achievement a : catalog.all()) {
			if (out.size() >= AUTOCOMPLETE_LIMIT) break;
			if (!unlocked.contains(a.id())) continue;
			if (!prefix.isEmpty() && !a.title().toLowerCase(Locale.ROOT).contains(prefix)) continue;
			out.add(new Choice(a.title(), a.title()));
		}
		event.replyChoices(out).queue();
	}

	// ─── helpers ───────────────────────────────────────────────────────

	private void reply(SlashCommandInteractionEvent event, EmbedBuilder embed) {
		Embeds.brand(embed, event.getJDA());
		event.getHook().editOriginalEmbeds(embed.build()).queue();
	}

	private static String format(long n) {
		return String.format(Locale.ROOT, "%,d", n);
	}
}
