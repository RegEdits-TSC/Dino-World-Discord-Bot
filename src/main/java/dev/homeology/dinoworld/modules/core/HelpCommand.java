package dev.homeology.dinoworld.modules.core;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.config.AppConfig;
import dev.homeology.dinoworld.core.ModuleManager;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.events.interaction.command.CommandAutoCompleteInteractionEvent;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.Command.Choice;
import net.dv8tion.jda.api.interactions.commands.OptionMapping;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.*;

import java.util.*;

/**
 * {@code /help} — list every command available to the invoker, grouped by
 * {@link CommandCategory} in declaration order, or show detailed usage for
 * a specific command when the {@code command} option is supplied.
 *
 * <p>Visibility filter: commands marked {@link Command#devOnly()} are hidden
 * from non-developers. As defense in depth, commands whose
 * {@link Command#category()} is {@link CommandCategory#DEVELOPER} are also
 * hidden — even if {@code devOnly()} was forgotten on the command. The
 * autocomplete on {@code command} applies the same filter.
 *
 * <p>Reads the live command list from the {@link ModuleManager} on each
 * invocation so newly-loaded modules' commands appear immediately. Replies
 * ephemerally so the response doesn't clutter the channel.
 */
public final class HelpCommand extends ListenerAdapter implements Command {

	private final ModuleManager modules;
	private final AppConfig config;

	public HelpCommand(ModuleManager modules, AppConfig config) {
		this.modules = modules;
		this.config = config;
	}

	@Override
	public SlashCommandData slashData() {
		OptionData cmdOption = new OptionData(
			OptionType.STRING,
			"command",
			"Show detailed usage for a specific command",
			false,
			/*autocomplete*/ true);
		return Commands.slash("help", "List all available commands.")
			.addOptions(cmdOption);
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		boolean isDeveloper = event.getUser().getIdLong() == config.developerId();
		OptionMapping target = event.getOption("command");

		EmbedBuilder embed = (target == null)
			? renderList(isDeveloper)
			: renderDetail(target.getAsString(), isDeveloper);

		Embeds.brand(embed, event.getJDA());
		event.replyEmbeds(embed.build()).setEphemeral(true).queue();
	}

	// ─── list view ───────────────────────────────────────────────────────

	private EmbedBuilder renderList(boolean isDeveloper) {
		Map<CommandCategory, List<Command>> grouped = new EnumMap<>(CommandCategory.class);
		for (Command cmd : modules.aggregateCommands()) {
			if (!isVisible(cmd, isDeveloper)) continue;
			grouped.computeIfAbsent(cmd.category(), k -> new ArrayList<>()).add(cmd);
		}
		grouped.values().forEach(list -> list.sort(
			Comparator.comparing(c -> c.slashData().getName())));

		EmbedBuilder embed = Embeds.info("Help",
			"Here are the commands you can use. "
				+ "Run `/help command:<name>` for detailed usage.");
		for (CommandCategory cat : CommandCategory.values()) {
			List<Command> cmds = grouped.get(cat);
			if (cmds == null || cmds.isEmpty()) continue;
			StringBuilder lines = new StringBuilder();
			for (Command cmd : cmds) {
				var data = cmd.slashData();
				lines.append("`/").append(data.getName()).append("` — ")
					.append(data.getDescription()).append('\n');
			}
			embed.addField(cat.displayName(), lines.toString().trim(), false);
		}
		return embed;
	}

	// ─── detail view ─────────────────────────────────────────────────────

	private EmbedBuilder renderDetail(String name, boolean isDeveloper) {
		String lookup = name.trim().toLowerCase(Locale.ROOT);
		Command target = modules.aggregateCommands().stream()
			.filter(c -> c.slashData().getName().equals(lookup))
			.findFirst()
			.orElse(null);

		if (target == null || !isVisible(target, isDeveloper)) {
			return Embeds.error("Unknown command",
				"No command named `/" + lookup + "` is available to you. "
					+ "Run `/help` (no argument) to see the full list.");
		}

		SlashCommandData data = target.slashData();
		EmbedBuilder embed = Embeds.info("/" + data.getName(), data.getDescription())
			.addField("Category", target.category().displayName(), true);
		if (target.devOnly()) {
			embed.addField("Restricted to", "Developer", true);
		}

		// Top-level options (only when there are no subcommands).
		List<OptionData> opts = data.getOptions();
		if (!opts.isEmpty()) {
			embed.addField("Options", renderOptions(opts), false);
		}

		// Top-level subcommands (when there are no groups).
		List<SubcommandData> subs = data.getSubcommands();
		if (!subs.isEmpty()) {
			embed.addField("Subcommands", renderSubcommands(subs), false);
		}

		// Subcommand groups — one field per group.
		List<SubcommandGroupData> groups = data.getSubcommandGroups();
		if (!groups.isEmpty()) {
			for (SubcommandGroupData group : groups) {
				String body = "*" + group.getDescription() + "*\n"
					+ renderSubcommands(group.getSubcommands());
				embed.addField(group.getName(), truncateField(body), false);
			}
		}

		return embed;
	}

	private static String renderSubcommands(List<SubcommandData> subs) {
		StringBuilder sb = new StringBuilder();
		for (SubcommandData sub : subs) {
			sb.append("`").append(sub.getName());
			String optStr = renderOptionSignature(sub.getOptions());
			if (!optStr.isEmpty()) sb.append(' ').append(optStr);
			sb.append("` — ").append(sub.getDescription()).append('\n');
		}
		return sb.toString().trim();
	}

	/**
	 * One option per line with type, required marker, and choice list when
	 * the choice set is short enough to be useful.
	 */
	private static String renderOptions(List<OptionData> opts) {
		StringBuilder sb = new StringBuilder();
		for (OptionData o : opts) {
			sb.append("• `").append(o.isRequired() ? "<" : "[").append(o.getName())
				.append(o.isRequired() ? ">" : "]").append("` ")
				.append("(").append(o.getType().name().toLowerCase(Locale.ROOT)).append(") — ")
				.append(o.getDescription());
			var choices = o.getChoices();
			if (!choices.isEmpty() && choices.size() <= 8) {
				sb.append(" *(choices: ");
				for (int i = 0; i < choices.size(); i++) {
					if (i > 0) sb.append(", ");
					sb.append(choices.get(i).getName());
				}
				sb.append(")*");
			}
			sb.append('\n');
		}
		return sb.toString().trim();
	}

	/**
	 * Compact inline signature for use after a command/subcommand name —
	 * e.g. {@code <logger> <level>} or {@code <type> [name]}.
	 */
	private static String renderOptionSignature(List<OptionData> opts) {
		if (opts == null || opts.isEmpty()) return "";
		StringBuilder sb = new StringBuilder();
		for (int i = 0; i < opts.size(); i++) {
			if (i > 0) sb.append(' ');
			OptionData o = opts.get(i);
			sb.append(o.isRequired() ? "<" : "[").append(o.getName()).append(o.isRequired() ? ">" : "]");
		}
		return sb.toString();
	}

	/**
	 * Embed field bodies cap at 1024 chars. Trim with an ellipsis if needed.
	 */
	private static String truncateField(String body) {
		return body.length() <= 1024 ? body : body.substring(0, 1020) + "\n…";
	}

	private static boolean isVisible(Command cmd, boolean isDeveloper) {
		if (isDeveloper) return true;
		if (cmd.devOnly()) return false;
		return cmd.category() != CommandCategory.DEVELOPER;
	}

	// ─── autocomplete ────────────────────────────────────────────────────

	@Override
	public void onCommandAutoCompleteInteraction(CommandAutoCompleteInteractionEvent event) {
		if (!"help".equals(event.getName())) return;
		if (!"command".equals(event.getFocusedOption().getName())) return;

		boolean isDeveloper = event.getUser().getIdLong() == config.developerId();
		String prefix = event.getFocusedOption().getValue().toLowerCase(Locale.ROOT);

		List<Choice> choices = modules.aggregateCommands().stream()
			.filter(c -> isVisible(c, isDeveloper))
			.map(c -> c.slashData().getName())
			.filter(n -> n.toLowerCase(Locale.ROOT).contains(prefix))
			.sorted()
			.limit(25)
			.map(n -> new Choice(n, n))
			.toList();

		event.replyChoices(choices).queue();
	}
}
