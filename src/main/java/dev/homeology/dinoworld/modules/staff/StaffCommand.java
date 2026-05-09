package dev.homeology.dinoworld.modules.staff;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.EnclosureService;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.buttons.Button;
import net.dv8tion.jda.api.components.selections.SelectOption;
import net.dv8tion.jda.api.components.selections.StringSelectMenu;
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
import java.util.Optional;
import java.util.OptionalLong;

/**
 * {@code /staff …} — hire and manage NPC staff (zookeeper, vet, scientist,
 * marketer).
 *
 * <p>Subcommands:
 * <ul>
 *   <li>{@code /staff list}   — table view of every hired staff member</li>
 *   <li>{@code /staff roles}  — catalog browser (unlock level, wage, effect)</li>
 *   <li>{@code /staff hire role:<id>} — hire a role; for enclosure-scope
 *       roles, a follow-up dropdown picks the assignment</li>
 *   <li>{@code /staff fire staff_id:<n>} — fire (no refund) via confirm button</li>
 *   <li>{@code /staff assign staff_id:<n> enclosure_id:<n>} — reassign for a fee</li>
 *   <li>{@code /staff rename staff_id:<n> name:<s>} — cosmetic</li>
 * </ul>
 *
 * <p>{@code staff_id}, {@code enclosure_id}, and {@code role} options
 * autocomplete from the invoker's current state. The actual purchase /
 * fire / reassign work happens inline (no follow-up component) for
 * commands that don't need a picker; the only interactive flow is the
 * enclosure-pick dropdown after {@code /staff hire} for enclosure-scope
 * roles, dispatched via {@link StaffComponentHandler}.
 */
public final class StaffCommand extends ListenerAdapter implements Command {

	private static final int AUTOCOMPLETE_LIMIT = 25;

	private final PlayerService players;
	private final StaffMemberService staff;
	private final StaffCatalog catalog;
	private final EnclosureService enclosures;

	public StaffCommand(PlayerService players,
	                    StaffMemberService staff,
	                    StaffCatalog catalog,
	                    EnclosureService enclosures) {
		this.players = players;
		this.staff = staff;
		this.catalog = catalog;
		this.enclosures = enclosures;
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
	public SlashCommandData slashData() {
		OptionData roleOpt = new OptionData(OptionType.STRING, "role",
			"Role to hire", true);
		for (StaffRole r : catalog.all()) {
			roleOpt.addChoice(r.displayName(), r.id());
		}

		OptionData staffIdOpt = new OptionData(OptionType.INTEGER, "staff_id",
			"Staff member id", true, true);
		OptionData enclosureIdOpt = new OptionData(OptionType.INTEGER, "enclosure_id",
			"Destination enclosure id", true, true);
		OptionData nameOpt = new OptionData(OptionType.STRING, "name",
			"New custom name (blank to clear)", false);

		return Commands.slash("staff", "Hire and manage your park's staff.")
			.addSubcommands(
				new SubcommandData("list", "Show every staff member you've hired."),
				new SubcommandData("roles", "Browse the staff catalog (wages, effects, unlocks)."),
				new SubcommandData("hire", "Hire a staff member.")
					.addOptions(roleOpt),
				new SubcommandData("fire", "Dismiss a staff member (no refund).")
					.addOptions(staffIdOpt),
				new SubcommandData("assign", "Reassign an enclosure-scope staff member to a different enclosure.")
					.addOptions(staffIdOpt, enclosureIdOpt),
				new SubcommandData("rename", "Give a staff member a custom name.")
					.addOptions(staffIdOpt, nameOpt));
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());

		String sub = event.getSubcommandName();
		if (sub == null) {
			reply(event, Embeds.error("Missing subcommand", "Use one of /staff list|hire|fire|assign|rename|roles."));
			return;
		}
		switch (sub) {
			case "list" -> handleList(event, userId);
			case "roles" -> handleRoles(event);
			case "hire" -> handleHire(event, userId);
			case "fire" -> handleFire(event, userId);
			case "assign" -> handleAssign(event, userId);
			case "rename" -> handleRename(event, userId);
			default -> reply(event, Embeds.error("Unknown subcommand", "/staff " + sub));
		}
	}

	// ─── handlers ────────────────────────────────────────────────────────

	private void handleList(SlashCommandInteractionEvent event, long userId) {
		List<StaffMember> hired = staff.findByOwner(userId);
		if (hired.isEmpty()) {
			reply(event, Embeds.info("No staff hired",
				"Hire a Zookeeper with `/staff hire role:zookeeper` (unlocks at level 5)."));
			return;
		}
		StringBuilder body = new StringBuilder();
		long totalWage = 0;
		for (StaffMember m : hired) {
			StaffRole r = catalog.byId(m.roleId()).orElse(null);
			String roleLabel = r == null ? m.roleId() : r.displayName();
			long wage = r == null ? 0L : r.wagePerHour();
			totalWage += wage;
			String location = m.enclosureId().isPresent()
				? "encl " + m.enclosureId().getAsLong()
				: "global";
			String name = m.customName().map(s -> "\"" + s + "\" · ").orElse("");
			body.append("• `#").append(m.id()).append("` ")
				.append(name)
				.append(roleLabel)
				.append(" · ").append(location)
				.append(" · ").append(wage).append(" coins/hr\n");
		}
		body.append("\n_Total wages: **").append(totalWage).append(" coins/hr**_");
		reply(event, Embeds.info("👥  Your staff (" + hired.size() + ")", body.toString()));
	}

	private void handleRoles(SlashCommandInteractionEvent event) {
		StringBuilder body = new StringBuilder();
		Player p = players.get(event.getUser().getIdLong()).orElseThrow();
		for (StaffRole r : catalog.all()) {
			String lock = p.level() >= r.unlockLevel() ? "" : "  🔒 lvl " + r.unlockLevel();
			body.append("**").append(r.displayName()).append("**").append(lock).append("\n")
				.append("• Hire: ").append(r.hireCost()).append(" coins · Wage: ")
				.append(r.wagePerHour()).append(" coins/hr · Max: ")
				.append(r.maxOwned()).append("\n")
				.append("• ").append(effectSummary(r)).append("\n\n");
		}
		body.append("_Reassign fee: ").append(catalog.reassignFee()).append(" coins._");
		reply(event, Embeds.info("📋  Staff roles", body.toString()));
	}

	private void handleHire(SlashCommandInteractionEvent event, long userId) {
		String roleId = req(event, "role").getAsString();
		StaffRole role = catalog.byId(roleId).orElse(null);
		if (role == null) {
			reply(event, Embeds.error("Unknown role", "No role `" + roleId + "` in the catalog."));
			return;
		}
		Player p = players.get(userId).orElseThrow();
		if (p.level() < role.unlockLevel()) {
			reply(event, Embeds.warning("Locked",
				role.displayName() + " unlocks at level " + role.unlockLevel()
					+ ". You're level " + p.level() + "."));
			return;
		}
		int owned = staff.countByOwnerAndRole(userId, role.id());
		if (owned >= role.maxOwned()) {
			reply(event, Embeds.warning("Cap reached",
				"You already employ " + owned + " " + role.displayName().toLowerCase() + "(s) — the cap is "
					+ role.maxOwned() + "."));
			return;
		}
		if (p.coins() < role.hireCost()) {
			reply(event, Embeds.error("Not enough coins",
				role.displayName() + " costs " + role.hireCost() + " coins; you have " + p.coins() + "."));
			return;
		}

		if (role.scope() == StaffRole.Scope.GLOBAL) {
			// No assignment needed — hire immediately.
			players.addCoins(userId, -role.hireCost(), "staff.hire:" + role.id(), null);
			StaffMember m = staff.create(userId, role.id(), OptionalLong.empty());
			Player after = players.get(userId).orElseThrow();
			reply(event, Embeds.success("👥  Hired " + role.displayName(),
				"Wages will start with the next hourly tick.\n"
					+ "Staff id: `#" + m.id() + "`\n"
					+ "_Balance: " + after.coins() + " coins._"));
			return;
		}

		// Enclosure scope — show a dropdown to pick the assignment.
		List<Enclosure> owned2 = enclosures.findByOwner(userId);
		if (owned2.isEmpty()) {
			reply(event, Embeds.warning("No enclosures",
				"Build an enclosure first via `/shop` — staff need a place to work."));
			return;
		}
		StringSelectMenu.Builder picker = StringSelectMenu.create(
				StaffComponentHandler.NAMESPACE + ":hire:pick:" + role.id())
			.setPlaceholder("Pick an enclosure for this " + role.displayName());
		int added = 0;
		for (Enclosure e : owned2) {
			if (added >= 25) break;
			String name = e.name().orElse("Enclosure #" + e.id());
			String label = name + " · " + e.biome() + " · tier " + e.tier();
			if (label.length() > 100) label = label.substring(0, 97) + "…";
			picker.addOptions(SelectOption.of(label, String.valueOf(e.id())));
			added++;
		}

		EmbedBuilder embed = Embeds.info("Hire a " + role.displayName(),
			"Cost: **" + role.hireCost() + " coins** · Wage: **" + role.wagePerHour()
				+ " coins/hr**\n" + effectSummary(role)
				+ "\n\nPick the enclosure they'll work in:");
		Embeds.brand(embed, event.getJDA());
		event.getHook().editOriginalEmbeds(embed.build())
			.setComponents(ActionRow.of(picker.build()))
			.queue();
	}

	private void handleFire(SlashCommandInteractionEvent event, long userId) {
		long staffId = req(event, "staff_id").getAsLong();
		StaffMember m = staff.findById(staffId).orElse(null);
		if (m == null || m.ownerUserId() != userId) {
			reply(event, Embeds.error("Not your staff", "No staff #" + staffId + " owned by you."));
			return;
		}
		StaffRole r = catalog.byId(m.roleId()).orElse(null);
		String roleLabel = r == null ? m.roleId() : r.displayName();
		String name = m.customName().map(s -> "\"" + s + "\" (" + roleLabel + ")").orElse(roleLabel);

		EmbedBuilder embed = Embeds.warning("⚠️  Fire " + name + "?",
			"This is permanent and refunds **nothing**.\n"
				+ "_Staff id: #" + staffId + "_");
		Embeds.brand(embed, event.getJDA());
		Button confirm = Button.danger(
			StaffComponentHandler.NAMESPACE + ":fire:confirm:" + staffId, "Yes, fire");
		Button cancel = Button.secondary(
			StaffComponentHandler.NAMESPACE + ":cancel", "Cancel");
		event.getHook().editOriginalEmbeds(embed.build())
			.setComponents(ActionRow.of(confirm, cancel))
			.queue();
	}

	private void handleAssign(SlashCommandInteractionEvent event, long userId) {
		long staffId = req(event, "staff_id").getAsLong();
		long destId = req(event, "enclosure_id").getAsLong();
		StaffMember m = staff.findById(staffId).orElse(null);
		if (m == null || m.ownerUserId() != userId) {
			reply(event, Embeds.error("Not your staff", "No staff #" + staffId + " owned by you."));
			return;
		}
		StaffRole r = catalog.byId(m.roleId()).orElse(null);
		if (r == null || r.scope() != StaffRole.Scope.ENCLOSURE) {
			reply(event, Embeds.warning("Wrong scope",
				"Only enclosure-scope staff can be reassigned."));
			return;
		}
		Enclosure dest = enclosures.findById(destId).orElse(null);
		if (dest == null || dest.ownerUserId() != userId) {
			reply(event, Embeds.error("Not your enclosure", "No enclosure #" + destId + " owned by you."));
			return;
		}
		if (m.enclosureId().isPresent() && m.enclosureId().getAsLong() == destId) {
			reply(event, Embeds.warning("No change",
				m.customName().orElse(r.displayName()) + " is already in that enclosure."));
			return;
		}
		long fee = catalog.reassignFee();
		Player p = players.get(userId).orElseThrow();
		if (p.coins() < fee) {
			reply(event, Embeds.error("Not enough coins",
				"Reassigning costs " + fee + " coins; you have " + p.coins() + "."));
			return;
		}
		players.addCoins(userId, -fee, "staff.reassign:" + r.id(), null);
		staff.reassign(staffId, destId);
		Player after = players.get(userId).orElseThrow();
		reply(event, Embeds.success("Reassigned",
			r.displayName() + " #" + staffId + " now works in **"
				+ dest.name().orElse("Enclosure #" + dest.id()) + "**.\n"
				+ "_Fee: " + fee + " coins · balance: " + after.coins() + "._"));
	}

	private void handleRename(SlashCommandInteractionEvent event, long userId) {
		long staffId = req(event, "staff_id").getAsLong();
		OptionMapping nameOpt = event.getOption("name");
		String newName = nameOpt == null ? null : nameOpt.getAsString();
		StaffMember m = staff.findById(staffId).orElse(null);
		if (m == null || m.ownerUserId() != userId) {
			reply(event, Embeds.error("Not your staff", "No staff #" + staffId + " owned by you."));
			return;
		}
		if (newName != null && newName.length() > 40) {
			reply(event, Embeds.error("Too long", "Name must be 40 characters or fewer."));
			return;
		}
		staff.rename(staffId, newName);
		String shown = (newName == null || newName.isBlank())
			? "(name cleared)" : newName.trim();
		reply(event, Embeds.success("✏️  Renamed", "Staff #" + staffId + " is now **" + shown + "**."));
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static OptionMapping req(SlashCommandInteractionEvent event, String name) {
		OptionMapping m = event.getOption(name);
		if (m == null) throw new IllegalStateException("Missing required option: " + name);
		return m;
	}

	private void reply(SlashCommandInteractionEvent event, EmbedBuilder embed) {
		Embeds.brand(embed, event.getJDA());
		event.getHook().editOriginalEmbeds(embed.build()).queue();
	}

	static String effectSummary(StaffRole r) {
		StaffEffect e = r.effect();
		if (e instanceof StaffEffect.AutoFeed af) {
			return "Auto-feeds up to " + af.capacity() + " lowest-happiness dinos / hr in the assigned enclosure.";
		}
		if (e instanceof StaffEffect.DecayReduce dr) {
			return "Reduces happiness decay in the assigned enclosure by " + Math.round((1 - dr.multiplier()) * 100) + "%.";
		}
		if (e instanceof StaffEffect.IncubationSpeed is) {
			int pct = (int) Math.round((1 - is.perUnitMultiplier()) * 100);
			int floor = (int) Math.round((1 - is.floor()) * 100);
			return "Cuts egg incubation time by " + pct + "% per scientist (capped at -" + floor + "%).";
		}
		if (e instanceof StaffEffect.IncomeMultiplier im) {
			int pct = (int) Math.round(im.perUnitBonus() * 100);
			int cap = (int) Math.round((im.cap() - 1) * 100);
			return "Boosts hourly dino income by +" + pct + "% per marketer (capped at +" + cap + "%).";
		}
		return "";
	}

	// ─── autocomplete ────────────────────────────────────────────────────

	@Override
	public void onCommandAutoCompleteInteraction(CommandAutoCompleteInteractionEvent event) {
		if (!"staff".equals(event.getName())) return;
		String focused = event.getFocusedOption().getName();
		String prefix = event.getFocusedOption().getValue().toLowerCase(Locale.ROOT);
		long userId = event.getUser().getIdLong();
		switch (focused) {
			case "staff_id" -> event.replyChoices(staffChoices(userId, prefix)).queue();
			case "enclosure_id" -> event.replyChoices(enclosureChoices(userId, prefix)).queue();
			default -> event.replyChoices(List.of()).queue();
		}
	}

	private List<Choice> staffChoices(long userId, String prefix) {
		List<Choice> out = new ArrayList<>();
		for (StaffMember m : staff.findByOwner(userId)) {
			if (out.size() >= AUTOCOMPLETE_LIMIT) break;
			String idStr = String.valueOf(m.id());
			if (!prefix.isEmpty() && !idStr.contains(prefix)) continue;
			StaffRole r = catalog.byId(m.roleId()).orElse(null);
			String roleLabel = r == null ? m.roleId() : r.displayName();
			String name = m.customName().orElse(roleLabel);
			String label = "#" + m.id() + " · " + name;
			if (label.length() > 100) label = label.substring(0, 97) + "…";
			out.add(new Choice(label, m.id()));
		}
		return out;
	}

	private List<Choice> enclosureChoices(long userId, String prefix) {
		List<Choice> out = new ArrayList<>();
		for (Enclosure e : enclosures.findByOwner(userId)) {
			if (out.size() >= AUTOCOMPLETE_LIMIT) break;
			String idStr = String.valueOf(e.id());
			if (!prefix.isEmpty() && !idStr.contains(prefix)) continue;
			Optional<String> name = e.name();
			String label = "#" + e.id() + " · " + name.orElse("Enclosure") + " · " + e.biome();
			if (label.length() > 100) label = label.substring(0, 97) + "…";
			out.add(new Choice(label, e.id()));
		}
		return out;
	}
}
