package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.EggInstance;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.User;
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
import net.dv8tion.jda.api.interactions.commands.build.SubcommandGroupData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * {@code /admin …} — developer-only utility command for testing the
 * game's economy without grinding through every flow manually.
 *
 * <p>Surface is grouped by category:
 * <ul>
 *   <li>{@code /admin coins give|take|set <user> <amount>} — adjust coin balance</li>
 *   <li>{@code /admin xp    give|set       <user> <amount>} — adjust XP (and recompute level)</li>
 *   <li>{@code /admin egg   give           <user> <rarity> [species] [ready_now]} — grant an egg without charging</li>
 *   <li>{@code /admin egg   ready          <egg_id>} — fast-forward an incubating egg</li>
 *   <li>{@code /admin tick  income|decay|notify} — fire one of the recurring tick jobs immediately</li>
 *   <li>{@code /admin reset daily          <user>} — clear /daily cooldown</li>
 *   <li>{@code /admin reset feed           <dino_id>} — clear /feed cooldown</li>
 * </ul>
 *
 * <p>{@link #devOnly()} returns true so {@link dev.homeology.dinoworld.command.PermissionGate}
 * blocks anyone who isn't {@code DEVELOPER_ID}. All coin mutations flow
 * through {@link PlayerService#addCoins} with reason prefix {@code admin.}
 * so {@code coin_ledger} stays auditable; admin grants/takes can be
 * filtered out of any future "real economy" reports.
 */
public final class AdminCommand extends ListenerAdapter implements Command {

	/**
	 * Discord caps autocomplete responses at 25 choices.
	 */
	private static final int AUTOCOMPLETE_LIMIT = 25;

	private static final Logger log = LoggerFactory.getLogger(AdminCommand.class);

	private final PlayerService players;
	private final EggService eggs;
	private final DinoInstanceService dinos;
	private final RarityCatalog rarities;
	private final DinoCatalog catalog;
	private final IncomeTickService incomeTick;
	private final HappinessTickService happinessTick;
	private final EggReadyNotifyService eggReadyNotify;
	private final AdminWipeService wipe;

	public AdminCommand(PlayerService players,
	                    EggService eggs,
	                    DinoInstanceService dinos,
	                    RarityCatalog rarities,
	                    DinoCatalog catalog,
	                    IncomeTickService incomeTick,
	                    HappinessTickService happinessTick,
	                    EggReadyNotifyService eggReadyNotify,
	                    AdminWipeService wipe) {
		this.players = players;
		this.eggs = eggs;
		this.dinos = dinos;
		this.rarities = rarities;
		this.catalog = catalog;
		this.incomeTick = incomeTick;
		this.happinessTick = happinessTick;
		this.eggReadyNotify = eggReadyNotify;
		this.wipe = wipe;
	}

	@Override
	public boolean devOnly() {
		return true;
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.DEVELOPER;
	}

	@Override
	public boolean deferEphemeral() {
		return true;
	}

	@Override
	public SlashCommandData slashData() {
		// Reusable option specs — keeps the builder below readable.
		OptionData userOpt = new OptionData(OptionType.USER, "user", "Target user", true);
		OptionData amountOpt = new OptionData(OptionType.INTEGER, "amount", "Amount", true);
		OptionData rarityOpt = new OptionData(OptionType.STRING, "rarity", "Rarity tier", true);
		for (String r : RarityCatalog.KNOWN_IDS) rarityOpt.addChoice(r, r);

		SubcommandGroupData coins = new SubcommandGroupData("coins", "Adjust coin balances")
			.addSubcommands(
				new SubcommandData("give", "Add coins to a user")
					.addOptions(userOpt, amountOpt),
				new SubcommandData("take", "Subtract coins from a user")
					.addOptions(userOpt, amountOpt),
				new SubcommandData("set", "Set a user's coin balance to an exact amount")
					.addOptions(userOpt, amountOpt));

		SubcommandGroupData xp = new SubcommandGroupData("xp", "Adjust XP (recomputes level)")
			.addSubcommands(
				new SubcommandData("give", "Add XP to a user").addOptions(userOpt, amountOpt),
				new SubcommandData("set", "Set a user's XP to an exact amount").addOptions(userOpt, amountOpt));

		SubcommandGroupData egg = new SubcommandGroupData("egg", "Grant or fast-forward eggs")
			.addSubcommands(
				new SubcommandData("give", "Grant an egg without charging coins")
					.addOptions(
						userOpt,
						rarityOpt,
						new OptionData(OptionType.STRING, "species",
							"Species id (omit for mystery)", false, true),
						new OptionData(OptionType.BOOLEAN, "ready_now",
							"Set ready_at to now (default false)", false)),
				new SubcommandData("ready", "Force an existing egg to be ready to hatch")
					.addOptions(new OptionData(OptionType.INTEGER, "egg_id",
						"Egg row id (autocomplete shows pending eggs)", true, true)));

		SubcommandGroupData tick = new SubcommandGroupData("tick", "Trigger a tick job once now")
			.addSubcommands(
				new SubcommandData("income", "Run zoo.income one time"),
				new SubcommandData("decay", "Run zoo.happiness_decay one time"),
				new SubcommandData("notify", "Run zoo.egg_ready_notify one time"));

		OptionData confirmOpt = new OptionData(OptionType.BOOLEAN, "confirm",
			"Must be true to actually run — safety guard.", true);

		SubcommandGroupData reset = new SubcommandGroupData("reset",
			"Cooldown clears and destructive resets (player wipe, tycoon reset)")
			.addSubcommands(
				new SubcommandData("daily", "Clear /daily cooldown for a user").addOptions(userOpt),
				new SubcommandData("feed", "Clear /feed cooldown for a dino")
					.addOptions(new OptionData(OptionType.INTEGER, "dino_id",
						"Dino row id (autocomplete shows owned dinos)", true, true)),
				new SubcommandData("tycoon",
					"Wipe a user's eggs/dinos/enclosures and reset their coins/xp/level")
					.addOptions(userOpt, confirmOpt),
				new SubcommandData("player",
					"FULL WIPE: delete the user's row plus every related table")
					.addOptions(userOpt, confirmOpt));

		return Commands.slash("admin", "Developer-only game state controls.")
			.addSubcommandGroups(coins, xp, egg, tick, reset);
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		String group = event.getSubcommandGroup();
		String sub = event.getSubcommandName();
		log.info("admin invoked: /admin {} {}", group, sub);
		try {
			switch (group) {
				case "coins" -> handleCoins(event, sub);
				case "xp" -> handleXp(event, sub);
				case "egg" -> handleEgg(event, sub);
				case "tick" -> handleTick(event, sub);
				case "reset" -> handleReset(event, sub);
				default -> reply(event, Embeds.error("Unknown group", "/admin " + group));
			}
		} catch (RuntimeException ex) {
			log.warn("/admin {} {} failed", group, sub, ex);
			reply(event, Embeds.error("Admin error", String.valueOf(ex.getMessage())));
		}
	}

	// ─── coins ───────────────────────────────────────────────────────────

	private void handleCoins(SlashCommandInteractionEvent event, String sub) {
		User target = req(event, "user").getAsUser();
		long amount = req(event, "amount").getAsLong();
		players.ensure(target.getIdLong(), target.getEffectiveName());
		switch (sub) {
			case "give" -> {
				if (amount <= 0) { reply(event, Embeds.error("Bad amount", "Must be > 0.")); return; }
				players.addCoins(target.getIdLong(), amount, "admin.give", null);
				replyOk(event, "+" + amount + " coins → " + target.getEffectiveName(),
					"New balance: " + players.get(target.getIdLong()).orElseThrow().coins());
			}
			case "take" -> {
				if (amount <= 0) { reply(event, Embeds.error("Bad amount", "Must be > 0.")); return; }
				players.addCoins(target.getIdLong(), -amount, "admin.take", null);
				replyOk(event, "−" + amount + " coins ← " + target.getEffectiveName(),
					"New balance: " + players.get(target.getIdLong()).orElseThrow().coins());
			}
			case "set" -> {
				long delta = players.setCoins(target.getIdLong(), amount, "admin.set");
				replyOk(event, "Coins set to " + amount + " for " + target.getEffectiveName(),
					"Delta applied: " + (delta >= 0 ? "+" : "") + delta);
			}
			default -> reply(event, Embeds.error("Unknown subcommand", "/admin coins " + sub));
		}
	}

	// ─── xp ──────────────────────────────────────────────────────────────

	private void handleXp(SlashCommandInteractionEvent event, String sub) {
		User target = req(event, "user").getAsUser();
		long amount = req(event, "amount").getAsLong();
		players.ensure(target.getIdLong(), target.getEffectiveName());
		switch (sub) {
			case "give" -> {
				players.addXp(target.getIdLong(), amount);
				Player p = players.get(target.getIdLong()).orElseThrow();
				replyOk(event, (amount >= 0 ? "+" : "") + amount + " XP → " + target.getEffectiveName(),
					"Level " + p.level() + " · " + p.xp() + " XP total");
			}
			case "set" -> {
				if (amount < 0) { reply(event, Embeds.error("Bad amount", "XP must be ≥ 0.")); return; }
				players.setXp(target.getIdLong(), amount);
				Player p = players.get(target.getIdLong()).orElseThrow();
				replyOk(event, "XP set to " + amount + " for " + target.getEffectiveName(),
					"Level " + p.level());
			}
			default -> reply(event, Embeds.error("Unknown subcommand", "/admin xp " + sub));
		}
	}

	// ─── egg ─────────────────────────────────────────────────────────────

	private void handleEgg(SlashCommandInteractionEvent event, String sub) {
		switch (sub) {
			case "give" -> {
				User target = req(event, "user").getAsUser();
				String rarity = req(event, "rarity").getAsString();
				OptionMapping speciesOpt = event.getOption("species");
				OptionMapping readyOpt = event.getOption("ready_now");
				String species = speciesOpt == null ? null : speciesOpt.getAsString();
				boolean readyNow = readyOpt != null && readyOpt.getAsBoolean();
				players.ensure(target.getIdLong(), target.getEffectiveName());
				EggInstance e = eggs.adminCreate(target.getIdLong(), rarity, species, readyNow);
				replyOk(event, "Egg granted (id " + e.id() + ")",
					"Owner: " + target.getEffectiveName()
						+ "\nRarity: " + rarity
						+ "\nSpecies: " + (species == null ? "mystery" : species)
						+ "\nReady at: " + e.readyAt());
			}
			case "ready" -> {
				long eggId = req(event, "egg_id").getAsLong();
				if (!eggs.adminForceReady(eggId)) {
					reply(event, Embeds.error("No-op",
						"Egg " + eggId + " not found or already hatched."));
					return;
				}
				replyOk(event, "Egg " + eggId + " ready",
					"`ready_at` set to now. /hatch will pick it up.");
			}
			default -> reply(event, Embeds.error("Unknown subcommand", "/admin egg " + sub));
		}
	}

	// ─── tick ────────────────────────────────────────────────────────────

	private void handleTick(SlashCommandInteractionEvent event, String sub) {
		switch (sub) {
			case "income" -> {
				incomeTick.runOnce();
				replyOk(event, "income tick fired", "Check `coin_ledger` for the rows.");
			}
			case "decay" -> {
				happinessTick.runOnce();
				replyOk(event, "happiness decay fired",
					"Each owned dino lost " + HappinessTickService.DECAY_BASE
					+ " (or " + HappinessTickService.DECAY_MISMATCH + " if mismatched) happiness.");
			}
			case "notify" -> {
				eggReadyNotify.runOnce();
				replyOk(event, "egg-ready notify fired",
					"DMs queued for any newly-ready, unannounced eggs.");
			}
			default -> reply(event, Embeds.error("Unknown subcommand", "/admin tick " + sub));
		}
	}

	// ─── reset ───────────────────────────────────────────────────────────

	private void handleReset(SlashCommandInteractionEvent event, String sub) {
		switch (sub) {
			case "daily" -> {
				User target = req(event, "user").getAsUser();
				players.ensure(target.getIdLong(), target.getEffectiveName());
				players.resetDailyCooldown(target.getIdLong());
				replyOk(event, "/daily cooldown cleared for " + target.getEffectiveName(),
					"They can claim again immediately.");
			}
			case "feed" -> {
				long dinoId = req(event, "dino_id").getAsLong();
				if (dinos.findById(dinoId).isEmpty()) {
					reply(event, Embeds.error("No such dino", "id=" + dinoId));
					return;
				}
				dinos.resetFeedCooldown(dinoId);
				replyOk(event, "/feed cooldown cleared for dino " + dinoId,
					"Owner can feed it immediately.");
			}
			case "tycoon" -> handleResetTycoon(event);
			case "player" -> handleResetPlayer(event);
			default -> reply(event, Embeds.error("Unknown subcommand", "/admin reset " + sub));
		}
	}

	private void handleResetTycoon(SlashCommandInteractionEvent event) {
		if (!req(event, "confirm").getAsBoolean()) {
			reply(event, Embeds.warning("Confirmation required",
				"Re-run with `confirm:true` to actually wipe this user's tycoon state."));
			return;
		}
		User target = req(event, "user").getAsUser();
		AdminWipeService.TycoonResetStats stats = wipe.resetTycoon(target.getIdLong());
		replyOk(event, "🔁  Tycoon state reset for " + target.getEffectiveName(),
			"Eggs deleted: " + stats.eggs() + "\n"
				+ "Dinos deleted: " + stats.dinos() + "\n"
				+ "Staff fired: " + stats.staff() + "\n"
				+ "Enclosures deleted: " + stats.enclosures() + "\n"
				+ "Missions cleared: " + stats.missions() + "\n"
				+ "Player row reset: " + (stats.playerReset() ? "yes" : "no (no row existed)"));
	}

	private void handleResetPlayer(SlashCommandInteractionEvent event) {
		if (!req(event, "confirm").getAsBoolean()) {
			reply(event, Embeds.warning("Confirmation required",
				"Re-run with `confirm:true` to delete this user's row from EVERY table."));
			return;
		}
		User target = req(event, "user").getAsUser();
		AdminWipeService.WipeStats stats = wipe.wipePlayer(target.getIdLong());
		String body = "**" + target.getEffectiveName() + "** "
			+ (stats.playerExisted() ? "wiped." : "had no player row to wipe.")
			+ "\n"
			+ "• egg_instance: " + stats.eggs() + "\n"
			+ "• dino_instance: " + stats.dinos() + "\n"
			+ "• staff_member: " + stats.staff() + "\n"
			+ "• enclosure: " + stats.enclosures() + "\n"
			+ "• coin_ledger: " + stats.ledger() + "\n"
			+ "• mission_progress: " + stats.missions() + "\n"
			+ "• notification_queue: " + stats.notifications() + "\n"
			+ "• feedback_log: " + stats.feedback() + "\n"
			+ "• feedback_blacklist: " + stats.blacklist() + "\n"
			+ "• player: " + stats.player();
		replyOk(event, "💥  Full wipe complete", body);
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static OptionMapping req(SlashCommandInteractionEvent event, String name) {
		OptionMapping m = event.getOption(name);
		if (m == null) {
			throw new IllegalStateException("Missing required option: " + name);
		}
		return m;
	}

	private void replyOk(SlashCommandInteractionEvent event, String title, String body) {
		EmbedBuilder e = Embeds.success("🛠️  " + title, body);
		Embeds.brand(e, event.getJDA());
		event.getHook().editOriginalEmbeds(e.build()).queue();
	}

	private void reply(SlashCommandInteractionEvent event, EmbedBuilder e) {
		Embeds.brand(e, event.getJDA());
		event.getHook().editOriginalEmbeds(e.build()).queue();
	}

	// ─── autocomplete ────────────────────────────────────────────────────

	@Override
	public void onCommandAutoCompleteInteraction(CommandAutoCompleteInteractionEvent event) {
		if (!"admin".equals(event.getName())) return;
		String focused = event.getFocusedOption().getName();
		String prefix = event.getFocusedOption().getValue().toLowerCase(Locale.ROOT);

		switch (focused) {
			case "species" -> event.replyChoices(speciesChoices(event, prefix)).queue();
			case "egg_id" -> event.replyChoices(eggChoices(event, prefix)).queue();
			case "dino_id" -> event.replyChoices(dinoChoices(event, prefix)).queue();
			default -> event.replyChoices(List.of()).queue();
		}
	}

	/**
	 * Species autocomplete. If a {@code rarity} is already chosen, narrows
	 * to that tier so {@code /admin egg give … rarity:rare species:…} only
	 * surfaces rare species (matching the validation in
	 * {@link EggService#adminCreate}).
	 */
	private List<Choice> speciesChoices(CommandAutoCompleteInteractionEvent event, String prefix) {
		OptionMapping rarityOpt = event.getOption("rarity");
		String rarity = rarityOpt == null ? null : rarityOpt.getAsString().toLowerCase(Locale.ROOT);

		List<DinoSpecies> pool = (rarity != null && rarities.byId(rarity).isPresent())
			? catalog.byRarity(rarity)
			: catalog.all();

		List<Choice> out = new ArrayList<>();
		for (DinoSpecies s : pool) {
			if (out.size() >= AUTOCOMPLETE_LIMIT) break;
			if (!s.id().toLowerCase(Locale.ROOT).contains(prefix)
				&& !s.displayName().toLowerCase(Locale.ROOT).contains(prefix)) continue;
			String label = s.displayName() + " · " + s.rarity();
			if (label.length() > 100) label = label.substring(0, 97) + "…";
			out.add(new Choice(label, s.id()));
		}
		return out;
	}

	/**
	 * Egg id autocomplete: surfaces the invoker's own pending eggs (any
	 * stage), since that's overwhelmingly what the dev wants to fast-forward.
	 */
	private List<Choice> eggChoices(CommandAutoCompleteInteractionEvent event, String prefix) {
		long userId = event.getUser().getIdLong();
		List<Choice> out = new ArrayList<>();
		for (EggInstance e : eggs.findPending(userId)) {
			if (out.size() >= AUTOCOMPLETE_LIMIT) break;
			String idStr = String.valueOf(e.id());
			if (!prefix.isEmpty() && !idStr.contains(prefix)) continue;
			String species = e.speciesId().orElse("mystery");
			String label = "#" + e.id() + " · " + e.rarity() + " · " + species;
			if (label.length() > 100) label = label.substring(0, 97) + "…";
			out.add(new Choice(label, e.id()));
		}
		return out;
	}

	/**
	 * Dino id autocomplete: surfaces every dino owned by the invoker (or
	 * the {@code user} option, when present — handy for resetting another
	 * player's feed cooldown).
	 */
	private List<Choice> dinoChoices(CommandAutoCompleteInteractionEvent event, String prefix) {
		OptionMapping userOpt = event.getOption("user");
		long ownerId = userOpt == null ? event.getUser().getIdLong() : userOpt.getAsUser().getIdLong();
		List<Choice> out = new ArrayList<>();
		for (DinoInstance d : dinos.findByOwner(ownerId)) {
			if (out.size() >= AUTOCOMPLETE_LIMIT) break;
			String idStr = String.valueOf(d.id());
			if (!prefix.isEmpty() && !idStr.contains(prefix)) continue;
			DinoSpecies s = catalog.byId(d.speciesId()).orElse(null);
			String name = d.customName().orElseGet(() ->
				(s == null ? d.speciesId() : s.displayName()) + " #" + d.id());
			String label = "#" + d.id() + " · " + name;
			if (label.length() > 100) label = label.substring(0, 97) + "…";
			out.add(new Choice(label, d.id()));
		}
		return out;
	}
}
