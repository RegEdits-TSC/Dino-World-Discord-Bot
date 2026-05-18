package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.command.ComponentHandler;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssue;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssueRenderer;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssueService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.label.Label;
import net.dv8tion.jda.api.components.textinput.TextInput;
import net.dv8tion.jda.api.components.textinput.TextInputStyle;
import net.dv8tion.jda.api.events.interaction.GenericInteractionCreateEvent;
import net.dv8tion.jda.api.events.interaction.ModalInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.ButtonInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.StringSelectInteractionEvent;
import net.dv8tion.jda.api.interactions.callbacks.IMessageEditCallback;
import net.dv8tion.jda.api.interactions.callbacks.IModalCallback;
import net.dv8tion.jda.api.interactions.callbacks.IReplyCallback;
import net.dv8tion.jda.api.interactions.modals.ModalMapping;
import net.dv8tion.jda.api.modals.Modal;
import net.dv8tion.jda.api.requests.restaction.interactions.ReplyCallbackAction;
import net.dv8tion.jda.api.utils.FileUpload;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Arrays;
import java.util.Optional;

/**
 * Handles every interactive component whose {@code custom_id} starts with
 * {@code zoo:}.
 *
 * <p>Two-level dispatch:
 * <ol>
 *   <li>{@code args[0]} picks a category — currently {@code shop} (steps
 *       9), {@code eggs} (step 10), {@code feed} (step 11),
 *       {@code sell} (step 12).</li>
 *   <li>The category handler reads {@code args[1..]} to choose the
 *       specific action.</li>
 * </ol>
 *
 * <p>Modal submissions use a different custom_id pattern
 * ({@code zoo:shop:build-enclosure-submit}) but flow through the same
 * dispatcher.
 */
public final class ZooComponentHandler implements ComponentHandler {

	private static final Logger log = LoggerFactory.getLogger(ZooComponentHandler.class);

	/**
	 * Custom-id namespace owned by this handler.
	 */
	public static final String NAMESPACE = "zoo";

	// Action prefixes referenced by ZooCommand for /zoo button row.
	public static final String ACTION_SHOP_OPEN = "shop:open";
	public static final String ACTION_EGGS_OPEN = "eggs:open";
	public static final String ACTION_ENCLOSURES_OPEN = "enclosures:open";
	public static final String ACTION_FEED_BULK = "feed:bulk";

	/**
	 * Modal id for the build-enclosure submit handler.
	 */
	private static final String MODAL_BUILD_ENCLOSURE = NAMESPACE + ":shop:build-enclosure-submit";

	/**
	 * XP granted to a dino per successful (non-cooldowned) player feed. Same
	 * value across the three feed entry points so a bulk-feed and a per-dino
	 * pick are economically identical. Staff auto-feeds intentionally don't
	 * grant XP — see {@link DinoInstanceService#awardXp}.
	 */
	static final int FEED_XP_AWARD = 12;

	private final PlayerService players;
	private final RarityCatalog rarities;
	private final DinoCatalog catalog;
	private final EggService eggs;
	private final EnclosureService enclosures;
	private final EggImageProvider images;
	private final EggsCommand eggsCommand;
	private final DinoInstanceService dinos;
	private final EnclosuresCommand enclosuresCommand;
	private final MoveCommand moveCommand;
	private final ZooIssueService issues;

	public ZooComponentHandler(PlayerService players,
	                           RarityCatalog rarities,
	                           DinoCatalog catalog,
	                           EggService eggs,
	                           EnclosureService enclosures,
	                           EggImageProvider images,
	                           EggsCommand eggsCommand,
	                           DinoInstanceService dinos,
	                           EnclosuresCommand enclosuresCommand,
	                           MoveCommand moveCommand,
	                           ZooIssueService issues) {
		this.players = players;
		this.rarities = rarities;
		this.catalog = catalog;
		this.eggs = eggs;
		this.enclosures = enclosures;
		this.images = images;
		this.eggsCommand = eggsCommand;
		this.dinos = dinos;
		this.enclosuresCommand = enclosuresCommand;
		this.moveCommand = moveCommand;
		this.issues = issues;
	}

	@Override
	public void handle(GenericInteractionCreateEvent event, String[] args, CommandContext ctx) {
		if (!(event instanceof IReplyCallback rc)) return;
		if (args.length == 0) {
			log.debug("zoo: missing action segment");
			return;
		}
		String category = args[0];
		String[] rest = Arrays.copyOfRange(args, 1, args.length);
		try {
			switch (category) {
				case "shop" -> handleShop(event, rc, rest);
				case "eggs" -> handleEggs(event, rc, rest);
				case "feed" -> handleFeed(event, rc, rest);
				case "sell" -> handleSell(event, rc, rest);
				case "enclosures" -> handleEnclosures(event, rc, rest);
				case "move" -> handleMove(event, rc, rest);
				case "issues" -> handleIssues(event, rc, rest);
				default -> {
					log.debug("zoo: unknown category '{}'", category);
					rc.reply("Unknown action.").setEphemeral(true).queue();
				}
			}
		} catch (GameException ex) {
			// Predictable, user-actionable game failure — title + body
			// supplied by the typed exception; no developer DM needed.
			replyError(rc, event, ex.userTitle(), ex.getMessage());
		} catch (RuntimeException ex) {
			// Unexpected — log loudly so the developer-DM error path can
			// surface it; embed shows a generic apology with the message tail.
			log.warn("zoo component '{}' failed", String.join(":", args), ex);
			replyError(rc, event, "Something went wrong", ex.getMessage());
		}
	}

	// ─── shop ────────────────────────────────────────────────────────────

	private void handleShop(GenericInteractionCreateEvent event, IReplyCallback rc, String[] rest) {
		if (rest.length == 0) {
			rc.reply("Unknown shop action.").setEphemeral(true).queue();
			return;
		}
		String action = rest[0];
		switch (action) {
			case "open" -> shopOpen(event, rc);
			case "tier" -> shopTier(event, rc);
			case "buy-mystery" -> shopBuyMystery(event, rc, rest);
			case "buy-determined" -> shopBuyDeterminedPick(event, rc);
			case "buy-determined-confirm" -> shopBuyDeterminedConfirm(event, rc, rest);
			case "build-enclosure" -> shopBuildEnclosure(event, rc);
			case "build-enclosure-submit" -> shopBuildEnclosureSubmit(event, rc);
			default -> rc.reply("Unknown shop action.").setEphemeral(true).queue();
		}
	}

	/**
	 * Render the shop UI. Two paths:
	 *
	 * <ul>
	 *   <li>If invoked by a button click on an existing ephemeral message
	 *       (e.g. "Back to shop" after a purchase, or the "Open shop"
	 *       button on /eggs), <b>edit that ephemeral in place</b> so the
	 *       whole shop session stays in one message.</li>
	 *   <li>Otherwise (e.g. /zoo's public-message Shop button), <b>reply
	 *       with a fresh ephemeral</b> — we don't want to overwrite the
	 *       public /zoo embed with a private shop view.</li>
	 * </ul>
	 */
	private void shopOpen(GenericInteractionCreateEvent event, IReplyCallback rc) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());
		ShopUI.View view = ShopUI.render(ShopCommand.DEFAULT_TIER, userId, players, rarities, catalog, enclosures);
		Optional<FileUpload> file = ShopUI.imageAttachment(ShopCommand.DEFAULT_TIER, images);

		if (isEphemeralEditableEvent(event)) {
			IMessageEditCallback mec = (IMessageEditCallback) event;
			var edit = mec.editMessageEmbeds(view.embed().build()).setComponents(view.components());
			file.ifPresentOrElse(f -> edit.setFiles(f).queue(),
				() -> edit.setReplace(true).queue());
		} else {
			ReplyCallbackAction reply = rc.replyEmbeds(view.embed().build())
				.addComponents(view.components())
				.setEphemeral(true);
			file.ifPresent(reply::addFiles);
			reply.queue();
		}
	}

	/**
	 * @return true when {@code event} originated from an ephemeral message
	 *         (component click or modal submit), and so {@code editMessage*}
	 *         is safe to call without clobbering a public message.
	 */
	private static boolean isEphemeralEditableEvent(GenericInteractionCreateEvent event) {
		if (!(event instanceof IMessageEditCallback)) return false;
		if (event instanceof net.dv8tion.jda.api.events.interaction.component.GenericComponentInteractionCreateEvent gc) {
			return gc.getMessage().isEphemeral();
		}
		if (event instanceof ModalInteractionEvent me) {
			var msg = me.getMessage();
			return msg != null && msg.isEphemeral();
		}
		return false;
	}

	/**
	 * Single source of truth for "render an embed inside an in-progress
	 * ephemeral session": when the event came from an ephemeral component
	 * or modal, <b>edit the message in place</b>; otherwise (slash command,
	 * or click on a public message) reply with a fresh ephemeral. Components
	 * are replaced wholesale, attachments are wiped unless {@code file} is
	 * present.
	 *
	 * <p>Used by every menu transition so a single ephemeral message hosts
	 * the whole user flow (shop, eggs, sell, feed, move, enclosures,
	 * hatch).
	 */
	private static void editOrReply(GenericInteractionCreateEvent event,
	                                IReplyCallback rc,
	                                EmbedBuilder embed,
	                                java.util.List<net.dv8tion.jda.api.components.MessageTopLevelComponent> components,
	                                java.util.Optional<FileUpload> file) {
		Embeds.brand(embed, event.getJDA());
		if (isEphemeralEditableEvent(event)) {
			IMessageEditCallback mec = (IMessageEditCallback) event;
			var edit = mec.editMessageEmbeds(embed.build());
			if (components.isEmpty()) edit.setComponents();
			else edit.setComponents(components);
			if (file.isPresent()) edit.setFiles(file.get()).queue();
			else edit.setReplace(true).queue();
		} else {
			var reply = rc.replyEmbeds(embed.build()).setEphemeral(true);
			if (!components.isEmpty()) reply.addComponents(components);
			file.ifPresent(reply::addFiles);
			reply.queue();
		}
	}

	private void shopTier(GenericInteractionCreateEvent event, IReplyCallback rc) {
		if (!(event instanceof StringSelectInteractionEvent sse)) {
			rc.reply("Tier select must come from a select menu.").setEphemeral(true).queue();
			return;
		}
		String rarityId = sse.getValues().isEmpty() ? ShopCommand.DEFAULT_TIER : sse.getValues().get(0);
		if (rarities.byId(rarityId).isEmpty()) {
			rc.reply("Unknown rarity.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		ShopUI.View view = ShopUI.render(rarityId, userId, players, rarities, catalog, enclosures);

		// Edit the message in place so the same ephemeral keeps showing the
		// shop. Adding a fresh attachment requires resetting attachments.
		var edit = sse.editMessageEmbeds(view.embed().build())
			.setComponents(view.components());
		ShopUI.imageAttachment(rarityId, images).ifPresentOrElse(
			f -> edit.setFiles(f).queue(),
			() -> edit.setReplace(true).queue());
	}

	private void shopBuyMystery(GenericInteractionCreateEvent event, IReplyCallback rc, String[] rest) {
		if (rest.length < 2) {
			rc.reply("Missing rarity.").setEphemeral(true).queue();
			return;
		}
		String rarityId = rest[1];
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());
		eggs.buyMystery(userId, rarityId);
		Player p = players.get(userId).orElseThrow();
		EmbedBuilder ack = Embeds.success("Mystery egg purchased",
			"You bought a mystery " + rarities.require(rarityId).displayName().toLowerCase()
				+ " egg. It'll be ready to hatch in "
				+ formatMins(rarities.require(rarityId).incubationMinutes()) + ".\n"
				+ "_Balance: " + p.coins() + " coins._");
		// Edit-in-place: replace the shop UI's buttons with a single
		// "Back to shop" so the player can't double-click the original
		// "Buy mystery" button and get charged twice.
		replaceWithSuccess(event, rc, ack, "Back to shop", NAMESPACE + ":shop:open");
	}

	/**
	 * Step 1 of the determined-egg purchase: render a confirmation embed
	 * with the price + a "Buy this egg" button. The dropdown selection
	 * itself does NOT charge — the player only loses coins after clicking
	 * the explicit confirm button (custom_id includes the species id).
	 */
	private void shopBuyDeterminedPick(GenericInteractionCreateEvent event, IReplyCallback rc) {
		if (!(event instanceof StringSelectInteractionEvent sse) || sse.getValues().isEmpty()) {
			rc.reply("No species selected.").setEphemeral(true).queue();
			return;
		}
		String speciesId = sse.getValues().get(0);
		DinoSpecies s = catalog.byId(speciesId).orElse(null);
		if (s == null) {
			replyError(rc, event, "Unknown species", "Catalog mismatch — contact the developer.");
			return;
		}
		long userId = event.getUser().getIdLong();
		Player p = players.ensure(userId, event.getUser().getEffectiveName());
		Rarity r = rarities.require(s.rarity());
		long cost = s.effectiveDeterminedEggCost(r);
		int incubation = s.effectiveIncubationMinutes(r);

		String balanceLine = p.coins() < cost
			? "_Balance: " + p.coins() + " coins — **insufficient**, need " + (cost - p.coins()) + " more._"
			: "_Balance: " + p.coins() + " coins._";

		EmbedBuilder embed = Embeds.info("🛒  Confirm purchase: " + s.displayName() + " egg",
			"**" + r.displayName() + "** · " + s.biome() + " · "
				+ s.baseIncomePerHour() + " coins/hr at full happiness\n\n"
				+ "Cost: **" + cost + "** coins\n"
				+ "Incubates in " + formatMins(incubation) + ".\n\n"
				+ balanceLine);
		Embeds.brand(embed, event.getJDA());

		net.dv8tion.jda.api.components.buttons.Button confirm =
			net.dv8tion.jda.api.components.buttons.Button.success(
				NAMESPACE + ":shop:buy-determined-confirm:" + speciesId,
				"Buy this egg")
				.withDisabled(p.coins() < cost);
		net.dv8tion.jda.api.components.buttons.Button back =
			net.dv8tion.jda.api.components.buttons.Button.secondary(
				NAMESPACE + ":shop:open", "Back to shop");
		var row = net.dv8tion.jda.api.components.actionrow.ActionRow.of(confirm, back);

		// Edit the shop UI in place so the same ephemeral message keeps
		// the whole shop session — picking a species shouldn't spawn a
		// second ephemeral on top of the first. We also drop any image
		// attachment that the previous render added (the rarity egg PNG).
		if (isEphemeralEditableEvent(event)) {
			((IMessageEditCallback) event)
				.editMessageEmbeds(embed.build())
				.setComponents(row)
				.setReplace(true)
				.queue();
		} else {
			rc.replyEmbeds(embed.build())
				.addComponents(row)
				.setEphemeral(true).queue();
		}
	}

	/**
	 * Step 2 of the determined-egg purchase: actually charge coins and
	 * insert the egg row. Triggered by the "Buy this egg" button created
	 * in {@link #shopBuyDeterminedPick}.
	 */
	private void shopBuyDeterminedConfirm(GenericInteractionCreateEvent event,
	                                      IReplyCallback rc, String[] rest) {
		if (rest.length < 2) {
			rc.reply("Missing species id.").setEphemeral(true).queue();
			return;
		}
		String speciesId = rest[1];
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());
		eggs.buyDetermined(userId, speciesId);
		DinoSpecies s = catalog.byId(speciesId).orElseThrow();
		Player p = players.get(userId).orElseThrow();
		EmbedBuilder ack = Embeds.success(s.displayName() + " egg purchased",
			"Ready to hatch in "
				+ formatMins(s.effectiveIncubationMinutes(rarities.require(s.rarity()))) + ".\n"
				+ "_Balance: " + p.coins() + " coins._");
		// Edit-in-place — replaces the confirmation embed + Buy button
		// with the success state, so the player can't double-click the
		// confirm button and get charged twice.
		replaceWithSuccess(event, rc, ack, "Back to shop", NAMESPACE + ":shop:open");
	}

	private void shopBuildEnclosure(GenericInteractionCreateEvent event, IReplyCallback rc) {
		if (!(event instanceof IModalCallback mc)) {
			rc.reply("This control can't open a modal.").setEphemeral(true).queue();
			return;
		}
		shopBuildEnclosureImpl(mc);
	}

	private void shopBuildEnclosureImpl(IModalCallback mc) {
		TextInput biome = TextInput.create("biome", TextInputStyle.SHORT)
			.setPlaceholder("forest, desert, marine, aerial, mountain, grassland")
			.setRequired(true)
			.setMaxLength(20)
			.build();
		TextInput tier = TextInput.create("tier", TextInputStyle.SHORT)
			.setPlaceholder("1 to 5 — higher tier holds rarer dinos")
			.setRequired(true)
			.setMaxLength(1)
			.build();
		TextInput name = TextInput.create("name", TextInputStyle.SHORT)
			.setPlaceholder("(optional)")
			.setRequired(false)
			.setMaxLength(40)
			.build();
		Modal modal = Modal.create(MODAL_BUILD_ENCLOSURE, "Build a new enclosure")
			.addComponents(
				Label.of("Biome", biome),
				Label.of("Tier", tier),
				Label.of("Name", name))
			.build();
		mc.replyModal(modal).queue();
	}

	private void shopBuildEnclosureSubmit(GenericInteractionCreateEvent event, IReplyCallback rc) {
		if (!(event instanceof ModalInteractionEvent mie)) {
			rc.reply("Modal submit handler invoked with wrong event type.").setEphemeral(true).queue();
			return;
		}
		ModalMapping biomeM = mie.getValue("biome");
		ModalMapping tierM = mie.getValue("tier");
		ModalMapping nameM = mie.getValue("name");
		if (biomeM == null || tierM == null) {
			replyError(rc, event, "Missing fields", "Biome and tier are required.");
			return;
		}
		String biomeRaw = biomeM.getAsString().trim().toLowerCase();
		Biome parsedBiome = Biome.fromString(biomeRaw).orElse(null);
		if (parsedBiome == null) {
			replyError(rc, event, "Invalid biome",
				"`" + biomeRaw + "` isn't a real biome. Valid: " + Biome.labelsCsv() + ".");
			return;
		}
		String biome = parsedBiome.label();
		int tier;
		try {
			tier = Integer.parseInt(tierM.getAsString().trim());
		} catch (NumberFormatException nfe) {
			replyError(rc, event, "Invalid tier", "Tier must be a number 1–5.");
			return;
		}
		if (tier < 1 || tier > 5) {
			replyError(rc, event, "Invalid tier", "Tier must be 1, 2, 3, 4, or 5.");
			return;
		}
		String name = nameM == null ? null : nameM.getAsString();
		long userId = event.getUser().getIdLong();
		Player p = players.ensure(userId, event.getUser().getEffectiveName());

		long cost = ShopUI.enclosureBuildCost(tier);
		if (p.coins() < cost) {
			replyError(rc, event, "Not enough coins",
				"This enclosure costs " + cost + " coins; you have " + p.coins() + ".");
			return;
		}
		// Capacity scales with tier so higher tiers feel meaningfully bigger.
		int capacity = 3 + tier;
		players.addCoins(userId, -cost, "enclosure.build:tier" + tier, null);
		Enclosure built = enclosures.create(userId, biome, capacity, tier, name);

		Player after = players.get(userId).orElseThrow();
		EmbedBuilder ack = Embeds.success("Enclosure built",
			"Tier " + tier + " " + biome + " enclosure with capacity " + capacity + ".\n"
				+ "_Balance: " + after.coins() + " coins._");
		editOrReply(event, rc, ack,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(
				net.dv8tion.jda.api.components.buttons.Button.secondary(
					NAMESPACE + ":shop:open", "Back to shop"))),
			java.util.Optional.empty());
		log.info("user={} built enclosure id={} tier={} biome={}", userId, built.id(), tier, biome);
	}

	// ─── eggs ────────────────────────────────────────────────────────────

	private void handleEggs(GenericInteractionCreateEvent event, IReplyCallback rc, String[] rest) {
		if (rest.length == 0) {
			rc.reply("Unknown eggs action.").setEphemeral(true).queue();
			return;
		}
		String action = rest[0];
		switch (action) {
			case "open" -> eggsOpen(event, rc);
			case "hatch" -> {
				if (rest.length < 2) {
					rc.reply("Missing egg id.").setEphemeral(true).queue();
					return;
				}
				try {
					long eggId = Long.parseLong(rest[1]);
					eggsHatchOne(event, rc, eggId);
				} catch (NumberFormatException nfe) {
					rc.reply("Bad egg id.").setEphemeral(true).queue();
				}
			}
			case "hatch-all" -> eggsHatchAll(event, rc);
			default -> rc.reply("Unknown eggs action.").setEphemeral(true).queue();
		}
	}

	private void eggsOpen(GenericInteractionCreateEvent event, IReplyCallback rc) {
		long userId = event.getUser().getIdLong();
		Player p = players.ensure(userId, event.getUser().getEffectiveName());
		EggsCommand.Rendered r = eggsCommand.render(p, eggs.findPending(userId));
		editOrReply(event, rc, r.embed(), r.components(), java.util.Optional.empty());
	}

	private void eggsHatchOne(GenericInteractionCreateEvent event, IReplyCallback rc, long eggId) {
		long userId = event.getUser().getIdLong();
		EggService.HatchResult result = eggs.hatch(userId, eggId);
		Rarity rar = rarities.require(result.species().rarity());
		EmbedBuilder ack = Embeds.success(
			"🦖  Hatched " + rar.displayName() + " " + result.species().displayName() + "!",
			result.species().description() + "\n_+" + result.xpAwarded() + " XP._");
		editOrReply(event, rc, ack,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(
				net.dv8tion.jda.api.components.buttons.Button.secondary(
					NAMESPACE + ":eggs:open", "Back to eggs"))),
			java.util.Optional.empty());
	}

	private void eggsHatchAll(GenericInteractionCreateEvent event, IReplyCallback rc) {
		long userId = event.getUser().getIdLong();
		var results = eggs.hatchAllReady(userId);
		if (results.isEmpty()) {
			editOrReply(event, rc,
				Embeds.warning("No eggs ready",
					"Nothing in your inventory has finished incubating yet."),
				java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(
					net.dv8tion.jda.api.components.buttons.Button.secondary(
						NAMESPACE + ":eggs:open", "Back to eggs"))),
				java.util.Optional.empty());
			return;
		}
		StringBuilder body = new StringBuilder();
		long totalXp = 0;
		for (EggService.HatchResult r : results) {
			body.append("• ").append(rarities.require(r.species().rarity()).displayName())
				.append(" **").append(r.species().displayName()).append("** (+")
				.append(r.xpAwarded()).append(" XP)\n");
			totalXp += r.xpAwarded();
		}
		EmbedBuilder ack = Embeds.success(
			"🦖  Hatched " + results.size() + " egg" + (results.size() == 1 ? "" : "s") + "!",
			body.toString() + "\n_+" + totalXp + " XP total._");
		editOrReply(event, rc, ack,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(
				net.dv8tion.jda.api.components.buttons.Button.secondary(
					NAMESPACE + ":eggs:open", "Back to eggs"))),
			java.util.Optional.empty());
	}

	// ─── feed ────────────────────────────────────────────────────────────

	private void handleFeed(GenericInteractionCreateEvent event, IReplyCallback rc, String[] rest) {
		if (rest.length == 0) {
			rc.reply("Unknown feed action.").setEphemeral(true).queue();
			return;
		}
		switch (rest[0]) {
			case "one" -> feedOne(event, rc);
			case "bulk" -> feedBulk(event, rc);
			default -> rc.reply("Unknown feed action.").setEphemeral(true).queue();
		}
	}

	private void feedOne(GenericInteractionCreateEvent event, IReplyCallback rc) {
		if (!(event instanceof StringSelectInteractionEvent sse) || sse.getValues().isEmpty()) {
			rc.reply("No dino selected.").setEphemeral(true).queue();
			return;
		}
		long dinoId;
		try {
			dinoId = Long.parseLong(sse.getValues().get(0));
		} catch (NumberFormatException nfe) {
			rc.reply("Bad dino id.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		var dino = dinos.findById(dinoId).orElse(null);
		if (dino == null || dino.ownerUserId() != userId) {
			replyError(rc, event, "Not your dino", "That dino doesn't belong to you.");
			return;
		}
		java.time.Instant now = java.time.Instant.now();
		if (FeedCommand.isOnCooldown(dino, now)) {
			java.time.Duration left = FeedCommand.cooldownRemaining(dino, now);
			replyError(rc, event, "On cooldown",
				"Try again in " + (left.toHours() > 0 ? left.toHours() + "h " : "")
					+ (left.toMinutesPart()) + "m.");
			return;
		}
		dinos.recordFed(dinoId, now);
		DinoInstanceService.AwardResult xp = dinos.awardXp(dinoId, FEED_XP_AWARD).orElse(null);
		String name = dino.customName().orElseGet(() ->
			catalog.byId(dino.speciesId()).map(DinoSpecies::displayName).orElse(dino.speciesId())
				+ " #" + dino.id());
		String description = "Happiness restored to 100. Next feed in "
			+ FeedCommand.COOLDOWN_HOURS + " hours.";
		if (xp != null && xp.leveledUp()) {
			description += "\n🎉 **Level up!** " + name + " is now level " + xp.newLevel() + ".";
		}
		EmbedBuilder ack = Embeds.success("🍖  Fed " + name, description);
		editOrReply(event, rc, ack, java.util.List.of(), java.util.Optional.empty());
	}

	private void feedBulk(GenericInteractionCreateEvent event, IReplyCallback rc) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());
		java.time.Instant now = java.time.Instant.now();
		var owned = dinos.findByOwner(userId);
		int fed = 0;
		int skipped = 0;
		int levelUps = 0;
		for (var d : owned) {
			if (FeedCommand.isOnCooldown(d, now)) {
				skipped++;
				continue;
			}
			dinos.recordFed(d.id(), now);
			DinoInstanceService.AwardResult xp = dinos.awardXp(d.id(), FEED_XP_AWARD).orElse(null);
			if (xp != null && xp.leveledUp()) levelUps++;
			fed++;
		}
		EmbedBuilder ack;
		if (fed == 0 && skipped == 0) {
			ack = Embeds.warning("No dinos to feed",
				"Hatch some eggs first — `/eggs` shows what's incubating.");
		} else if (fed == 0) {
			ack = Embeds.warning("All on cooldown",
				skipped + " dino" + (skipped == 1 ? " is" : "s are") + " still on cooldown. "
					+ "Try `/feed` to see when each is ready.");
		} else {
			String description = "Happiness restored to 100"
				+ (skipped > 0 ? "; " + skipped + " on cooldown skipped." : ".");
			if (levelUps > 0) {
				description += "\n🎉 **" + levelUps + " level-up"
					+ (levelUps == 1 ? "" : "s") + "** — see `/dino inspect` for details.";
			}
			ack = Embeds.success("🍖  Fed " + fed + " dino" + (fed == 1 ? "" : "s"), description);
		}
		editOrReply(event, rc, ack, java.util.List.of(), java.util.Optional.empty());
	}

	// ─── sell ────────────────────────────────────────────────────────────

	private void handleSell(GenericInteractionCreateEvent event, IReplyCallback rc, String[] rest) {
		if (rest.length == 0) {
			rc.reply("Unknown sell action.").setEphemeral(true).queue();
			return;
		}
		switch (rest[0]) {
			case "pick" -> sellPick(event, rc);
			case "confirm" -> {
				if (rest.length < 2) {
					rc.reply("Missing dino id.").setEphemeral(true).queue();
					return;
				}
				try {
					sellConfirm(event, rc, Long.parseLong(rest[1]));
				} catch (NumberFormatException nfe) {
					rc.reply("Bad dino id.").setEphemeral(true).queue();
				}
			}
			default -> rc.reply("Unknown sell action.").setEphemeral(true).queue();
		}
	}

	private void sellPick(GenericInteractionCreateEvent event, IReplyCallback rc) {
		if (!(event instanceof StringSelectInteractionEvent sse) || sse.getValues().isEmpty()) {
			rc.reply("No dino selected.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		long dinoId;
		try {
			dinoId = Long.parseLong(sse.getValues().get(0));
		} catch (NumberFormatException nfe) {
			rc.reply("Bad dino id.").setEphemeral(true).queue();
			return;
		}
		var dino = dinos.findById(dinoId).orElse(null);
		if (dino == null || dino.ownerUserId() != userId) {
			replyError(rc, event, "Not your dino", "That dino doesn't belong to you.");
			return;
		}
		DinoSpecies s = catalog.byId(dino.speciesId()).orElse(null);
		if (s == null) {
			replyError(rc, event, "Unknown species", "Catalog mismatch — contact the developer.");
			return;
		}
		long price = SellCommand.sellPrice(s);
		long xp = SellCommand.sellXp(s);
		String name = dino.customName().orElseGet(() -> s.displayName() + " #" + dino.id());
		EmbedBuilder embed = Embeds.warning("💸  Confirm sale",
			"Are you sure you want to sell **" + name + "**?\n\n"
				+ "• Payout: **" + price + " coins**\n"
				+ "• XP: **+" + xp + "**\n"
				+ "• This is permanent.");
		net.dv8tion.jda.api.components.buttons.Button confirm =
			net.dv8tion.jda.api.components.buttons.Button.danger(
				NAMESPACE + ":sell:confirm:" + dinoId, "Confirm sale");
		editOrReply(event, rc, embed,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(confirm)),
			java.util.Optional.empty());
	}

	private void sellConfirm(GenericInteractionCreateEvent event, IReplyCallback rc, long dinoId) {
		long userId = event.getUser().getIdLong();
		var dino = dinos.findById(dinoId).orElse(null);
		if (dino == null || dino.ownerUserId() != userId) {
			replyError(rc, event, "Not your dino", "That dino doesn't belong to you.");
			return;
		}
		DinoSpecies s = catalog.byId(dino.speciesId()).orElse(null);
		if (s == null) {
			replyError(rc, event, "Unknown species", "Catalog mismatch — contact the developer.");
			return;
		}
		long price = SellCommand.sellPrice(s);
		long xp = SellCommand.sellXp(s);
		String name = dino.customName().orElseGet(() -> s.displayName() + " #" + dino.id());

		players.addCoins(userId, price, "sell:" + s.id(), null);
		players.addXp(userId, xp);
		boolean removed = dinos.delete(dinoId);
		if (!removed) {
			log.warn("sell: dino {} disappeared between confirm and delete", dinoId);
		}
		EmbedBuilder embed = Embeds.success("💰  Sold " + name,
			"+" + price + " coins, +" + xp + " XP.");
		editOrReply(event, rc, embed, java.util.List.of(), java.util.Optional.empty());
	}

	// ─── enclosures ──────────────────────────────────────────────────────

	private static final String MODAL_ENCLOSURE_RENAME_PREFIX = NAMESPACE + ":enclosures:rename-submit:";

	private void handleEnclosures(GenericInteractionCreateEvent event, IReplyCallback rc, String[] rest) {
		if (rest.length == 0) {
			rc.reply("Unknown enclosures action.").setEphemeral(true).queue();
			return;
		}
		// Modal submit ids include the encId in the action segment, e.g.
		// rest = ["rename-submit", "42"] — strip that out before switching.
		String action = rest[0];
		switch (action) {
			case "open" -> enclosuresOpen(event, rc);
			case "pick" -> enclosuresPick(event, rc);
			case "rename" -> requireIdThen(event, rc, rest, this::enclosuresRename);
			case "rename-submit" -> requireIdThen(event, rc, rest, this::enclosuresRenameSubmit);
			case "demolish" -> requireIdThen(event, rc, rest, this::enclosuresDemolish);
			case "demolish-confirm" -> requireIdThen(event, rc, rest, this::enclosuresDemolishConfirm);
			default -> rc.reply("Unknown enclosures action.").setEphemeral(true).queue();
		}
	}

	private interface EnclosureAction {
		void run(GenericInteractionCreateEvent event, IReplyCallback rc, long enclosureId);
	}

	private void requireIdThen(GenericInteractionCreateEvent event, IReplyCallback rc,
	                           String[] rest, EnclosureAction action) {
		if (rest.length < 2) {
			rc.reply("Missing enclosure id.").setEphemeral(true).queue();
			return;
		}
		long encId;
		try {
			encId = Long.parseLong(rest[1]);
		} catch (NumberFormatException nfe) {
			rc.reply("Bad enclosure id.").setEphemeral(true).queue();
			return;
		}
		action.run(event, rc, encId);
	}

	private void enclosuresOpen(GenericInteractionCreateEvent event, IReplyCallback rc) {
		long userId = event.getUser().getIdLong();
		Player p = players.ensure(userId, event.getUser().getEffectiveName());
		EnclosuresCommand.Rendered r = enclosuresCommand.renderList(p);
		editOrReply(event, rc, r.embed(), r.components(), java.util.Optional.empty());
	}

	private void enclosuresPick(GenericInteractionCreateEvent event, IReplyCallback rc) {
		if (!(event instanceof StringSelectInteractionEvent sse) || sse.getValues().isEmpty()) {
			rc.reply("No enclosure selected.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		long encId;
		try {
			encId = Long.parseLong(sse.getValues().get(0));
		} catch (NumberFormatException nfe) {
			rc.reply("Bad enclosure id.").setEphemeral(true).queue();
			return;
		}
		var enc = enclosures.findById(encId).orElse(null);
		if (enc == null || enc.ownerUserId() != userId) {
			replyError(rc, event, "Not your enclosure", "That enclosure doesn't belong to you.");
			return;
		}
		int residents = enclosures.countDinosIn(encId);
		String name = enc.name().orElse("Enclosure #" + enc.id());
		EmbedBuilder embed = Embeds.info("🌿  " + name,
			"**Biome:** " + enc.biome() + "\n"
				+ "**Tier:** " + enc.tier() + "\n"
				+ "**Capacity:** " + residents + " / " + enc.capacity() + "\n\n"
				+ (residents == 0
					? "_Empty — safe to demolish._"
					: "_" + residents + " dino" + (residents == 1 ? "" : "s")
						+ " living here. Demolish disabled until empty._"));
		net.dv8tion.jda.api.components.buttons.Button rename =
			net.dv8tion.jda.api.components.buttons.Button.primary(
				NAMESPACE + ":enclosures:rename:" + encId, "Rename");
		net.dv8tion.jda.api.components.buttons.Button demolish =
			net.dv8tion.jda.api.components.buttons.Button.danger(
				NAMESPACE + ":enclosures:demolish:" + encId, "Demolish");
		if (residents > 0) demolish = demolish.asDisabled();
		net.dv8tion.jda.api.components.buttons.Button back =
			net.dv8tion.jda.api.components.buttons.Button.secondary(
				NAMESPACE + ":enclosures:open", "Back to list");

		editOrReply(event, rc, embed,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(rename, demolish, back)),
			java.util.Optional.empty());
	}

	private void enclosuresRename(GenericInteractionCreateEvent event, IReplyCallback rc, long encId) {
		long userId = event.getUser().getIdLong();
		var enc = enclosures.findById(encId).orElse(null);
		if (enc == null || enc.ownerUserId() != userId) {
			replyError(rc, event, "Not your enclosure", "That enclosure doesn't belong to you.");
			return;
		}
		if (!(event instanceof IModalCallback mc)) {
			rc.reply("Can't open a modal from this control.").setEphemeral(true).queue();
			return;
		}
		TextInput nameField = TextInput.create("name", TextInputStyle.SHORT)
			.setPlaceholder(enc.name().orElse(""))
			.setRequired(false)
			.setMaxLength(40)
			.build();
		Modal modal = Modal.create(MODAL_ENCLOSURE_RENAME_PREFIX + encId, "Rename enclosure")
			.addComponents(net.dv8tion.jda.api.components.label.Label.of("New name (blank = clear)", nameField))
			.build();
		mc.replyModal(modal).queue();
	}

	private void enclosuresRenameSubmit(GenericInteractionCreateEvent event, IReplyCallback rc, long encId) {
		if (!(event instanceof ModalInteractionEvent mie)) {
			rc.reply("Wrong event type.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		var enc = enclosures.findById(encId).orElse(null);
		if (enc == null || enc.ownerUserId() != userId) {
			replyError(rc, event, "Not your enclosure", "That enclosure doesn't belong to you.");
			return;
		}
		var nameMapping = mie.getValue("name");
		String newName = nameMapping == null ? null : nameMapping.getAsString();
		boolean updated = enclosures.rename(encId, newName);
		if (!updated) {
			replyError(rc, event, "Rename failed", "The enclosure may have been deleted.");
			return;
		}
		String shown = (newName == null || newName.isBlank())
			? "Enclosure #" + encId + " (name cleared)"
			: newName.trim();
		EmbedBuilder ack = Embeds.success("✏️  Renamed", "This enclosure is now **" + shown + "**.");
		editOrReply(event, rc, ack,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(
				net.dv8tion.jda.api.components.buttons.Button.secondary(
					NAMESPACE + ":enclosures:open", "Back to list"))),
			java.util.Optional.empty());
	}

	private void enclosuresDemolish(GenericInteractionCreateEvent event, IReplyCallback rc, long encId) {
		long userId = event.getUser().getIdLong();
		var enc = enclosures.findById(encId).orElse(null);
		if (enc == null || enc.ownerUserId() != userId) {
			replyError(rc, event, "Not your enclosure", "That enclosure doesn't belong to you.");
			return;
		}
		int residents = enclosures.countDinosIn(encId);
		if (residents > 0) {
			replyError(rc, event, "Not empty",
				"This enclosure has " + residents + " dino"
					+ (residents == 1 ? "" : "s")
					+ " living in it. Sell or relocate them first.");
			return;
		}
		if (enclosures.findByOwner(userId).size() <= 1) {
			replyError(rc, event, "Last enclosure",
				"You can't demolish your only enclosure — eggs need somewhere to hatch.");
			return;
		}
		String name = enc.name().orElse("Enclosure #" + enc.id());
		EmbedBuilder embed = Embeds.warning("⚠️  Confirm demolish",
			"Permanently remove **" + name + "** (" + enc.biome() + " · tier "
				+ enc.tier() + ")?\nThis cannot be undone.");
		net.dv8tion.jda.api.components.buttons.Button confirm =
			net.dv8tion.jda.api.components.buttons.Button.danger(
				NAMESPACE + ":enclosures:demolish-confirm:" + encId, "Yes, demolish");
		net.dv8tion.jda.api.components.buttons.Button cancel =
			net.dv8tion.jda.api.components.buttons.Button.secondary(
				NAMESPACE + ":enclosures:open", "Cancel");
		editOrReply(event, rc, embed,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(confirm, cancel)),
			java.util.Optional.empty());
	}

	private void enclosuresDemolishConfirm(GenericInteractionCreateEvent event, IReplyCallback rc, long encId) {
		long userId = event.getUser().getIdLong();
		var enc = enclosures.findById(encId).orElse(null);
		if (enc == null || enc.ownerUserId() != userId) {
			replyError(rc, event, "Not your enclosure", "That enclosure doesn't belong to you.");
			return;
		}
		// Re-check guards in case state changed between confirm-show and click.
		if (enclosures.countDinosIn(encId) > 0) {
			replyError(rc, event, "Not empty", "Dinos moved in since you opened this prompt.");
			return;
		}
		if (enclosures.findByOwner(userId).size() <= 1) {
			replyError(rc, event, "Last enclosure", "Can't demolish your only enclosure.");
			return;
		}
		boolean removed = enclosures.delete(encId);
		if (!removed) {
			replyError(rc, event, "Demolish failed", "The enclosure may already be gone.");
			return;
		}
		String name = enc.name().orElse("Enclosure #" + enc.id());
		EmbedBuilder ack = Embeds.success("💥  Demolished " + name, "The enclosure has been removed.");
		editOrReply(event, rc, ack,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(
				net.dv8tion.jda.api.components.buttons.Button.secondary(
					NAMESPACE + ":enclosures:open", "Back to list"))),
			java.util.Optional.empty());
		log.info("user={} demolished enclosure id={}", userId, encId);
	}

	// ─── move ────────────────────────────────────────────────────────────

	private void handleMove(GenericInteractionCreateEvent event, IReplyCallback rc, String[] rest) {
		if (rest.length == 0) {
			rc.reply("Unknown move action.").setEphemeral(true).queue();
			return;
		}
		switch (rest[0]) {
			case "to" -> moveTo(event, rc);
			case "do" -> {
				if (rest.length < 2) {
					rc.reply("Missing dino id.").setEphemeral(true).queue();
					return;
				}
				try {
					moveDo(event, rc, Long.parseLong(rest[1]));
				} catch (NumberFormatException nfe) {
					rc.reply("Bad dino id.").setEphemeral(true).queue();
				}
			}
			default -> rc.reply("Unknown move action.").setEphemeral(true).queue();
		}
	}

	private void moveTo(GenericInteractionCreateEvent event, IReplyCallback rc) {
		if (!(event instanceof StringSelectInteractionEvent sse) || sse.getValues().isEmpty()) {
			rc.reply("No dino selected.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		long dinoId;
		try {
			dinoId = Long.parseLong(sse.getValues().get(0));
		} catch (NumberFormatException nfe) {
			rc.reply("Bad dino id.").setEphemeral(true).queue();
			return;
		}
		var dino = dinos.findById(dinoId).orElse(null);
		if (dino == null || dino.ownerUserId() != userId) {
			replyError(rc, event, "Not your dino", "That dino doesn't belong to you.");
			return;
		}
		DinoSpecies species = catalog.byId(dino.speciesId()).orElse(null);
		if (species == null) {
			replyError(rc, event, "Unknown species", "Catalog mismatch — contact the developer.");
			return;
		}
		int requiredTier = EnclosureService.MIN_TIER_FOR_RARITY.getOrDefault(species.rarity(), 1);

		// Build the destination dropdown — only enclosures the species can
		// fit into per Biome.canHouse: same-domain always, plus aerial
		// species accepted in LAND habitats (with a happiness penalty).
		// Marine is strict: water dinos cannot leave water. We allow the
		// dino's CURRENT enclosure too (no-op move is harmless), but
		// exclude full ones.
		var candidates = enclosures.findByOwner(userId).stream()
			.filter(e -> e.tier() >= requiredTier)
			.filter(e -> Biome.canHouse(e.biome(), species.biome()))
			.filter(e -> e.id() == dino.enclosureId().orElse(-1L)
				|| enclosures.slotsAvailable(e) > 0)
			.toList();

		if (candidates.isEmpty()) {
			replyError(rc, event, "Nowhere to move",
				"No enclosure with tier ≥ " + requiredTier
					+ " and free space can house a " + species.biome()
					+ " species. Build a " + species.biome() + " habitat in `/shop` first.");
			return;
		}

		net.dv8tion.jda.api.components.selections.StringSelectMenu.Builder picker =
			net.dv8tion.jda.api.components.selections.StringSelectMenu.create(
				NAMESPACE + ":move:do:" + dinoId)
				.setPlaceholder("Pick a destination enclosure");
		for (var e : candidates) {
			String name = e.name().orElse("Enclosure #" + e.id());
			int residents = enclosures.countDinosIn(e.id());
			boolean biomeMatch = e.biome().equalsIgnoreCase(species.biome());
			String label = name + " · " + e.biome()
				+ " · tier " + e.tier()
				+ " · " + residents + "/" + e.capacity()
				+ (biomeMatch ? " · biome match" : "");
			if (label.length() > 100) label = label.substring(0, 97) + "…";
			picker.addOptions(net.dv8tion.jda.api.components.selections.SelectOption.of(
				label, String.valueOf(e.id())));
		}

		String dinoName = dino.customName().orElseGet(() ->
			species.displayName() + " #" + dino.id());
		EmbedBuilder embed = Embeds.info("📦  Move " + dinoName,
			"Pick a destination. Tier ≥ " + requiredTier + " is required for this rarity. "
				+ "Biome match is preferred but not enforced.");
		editOrReply(event, rc, embed,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(picker.build())),
			java.util.Optional.empty());
	}

	private void moveDo(GenericInteractionCreateEvent event, IReplyCallback rc, long dinoId) {
		if (!(event instanceof StringSelectInteractionEvent sse) || sse.getValues().isEmpty()) {
			rc.reply("No destination selected.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		long destId;
		try {
			destId = Long.parseLong(sse.getValues().get(0));
		} catch (NumberFormatException nfe) {
			rc.reply("Bad enclosure id.").setEphemeral(true).queue();
			return;
		}
		var dino = dinos.findById(dinoId).orElse(null);
		if (dino == null || dino.ownerUserId() != userId) {
			replyError(rc, event, "Not your dino", "That dino doesn't belong to you.");
			return;
		}
		var dest = enclosures.findById(destId).orElse(null);
		if (dest == null || dest.ownerUserId() != userId) {
			replyError(rc, event, "Not your enclosure", "That enclosure doesn't belong to you.");
			return;
		}
		DinoSpecies species = catalog.byId(dino.speciesId()).orElse(null);
		if (species == null) {
			replyError(rc, event, "Unknown species", "Catalog mismatch — contact the developer.");
			return;
		}
		int requiredTier = EnclosureService.MIN_TIER_FOR_RARITY.getOrDefault(species.rarity(), 1);
		if (dest.tier() < requiredTier) {
			replyError(rc, event, "Tier too low",
				species.rarity() + " species need tier ≥ " + requiredTier + ".");
			return;
		}
		// Illegal placement refused at confirm-time too — defense in depth in
		// case the dropdown was crafted/replayed. Aerial species are allowed
		// in LAND enclosures here per Biome.canHouse.
		if (!Biome.canHouse(dest.biome(), species.biome())) {
			replyError(rc, event, "Wrong habitat",
				species.displayName() + " (" + species.biome() + ") cannot live in a "
					+ dest.biome() + " enclosure. Build a "
					+ species.biome() + " habitat instead.");
			return;
		}
		// Re-check capacity at confirm-time (state may have shifted between
		// menu render and selection). Allow no-op same-enclosure moves.
		boolean sameAsCurrent = dino.enclosureId().isPresent()
			&& dino.enclosureId().getAsLong() == destId;
		if (!sameAsCurrent && enclosures.slotsAvailable(dest) <= 0) {
			replyError(rc, event, "No room", "That enclosure filled up before you confirmed.");
			return;
		}

		dinos.assignToEnclosure(dinoId, java.util.OptionalLong.of(destId));

		String dinoName = dino.customName().orElseGet(() ->
			species.displayName() + " #" + dino.id());
		String destName = dest.name().orElse("Enclosure #" + dest.id());
		boolean biomeMatch = dest.biome().equalsIgnoreCase(species.biome());
		EmbedBuilder ack = Embeds.success("📦  Moved " + dinoName,
			"New home: **" + destName + "** (" + dest.biome() + " · tier " + dest.tier() + ")"
				+ (biomeMatch ? "" : "\n_Biome doesn't match — park rating bonus locked until they move to a "
					+ species.biome() + " enclosure._"));
		editOrReply(event, rc, ack,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(
				net.dv8tion.jda.api.components.buttons.Button.secondary(
					NAMESPACE + ":enclosures:open", "View enclosures"))),
			java.util.Optional.empty());
		log.info("user={} moved dino={} → enclosure={}", userId, dinoId, destId);
	}

	/**
	 * Convenience wrapper around {@link #editOrReply}: wraps {@code ack}
	 * with a single follow-up button (e.g. "Back to shop") and routes
	 * via the standard edit-or-reply path.
	 */
	private static void replaceWithSuccess(GenericInteractionCreateEvent event,
	                                       IReplyCallback rc,
	                                       EmbedBuilder ack,
	                                       String followLabel,
	                                       String followCustomId) {
		net.dv8tion.jda.api.components.buttons.Button follow =
			net.dv8tion.jda.api.components.buttons.Button.secondary(followCustomId, followLabel);
		editOrReply(event, rc, ack,
			java.util.List.of(net.dv8tion.jda.api.components.actionrow.ActionRow.of(follow)),
			java.util.Optional.empty());
	}

	// ─── issues ──────────────────────────────────────────────────────────

	private void handleIssues(GenericInteractionCreateEvent event, IReplyCallback rc, String[] rest) {
		if (rest.length == 0) {
			rc.reply("Unknown issues action.").setEphemeral(true).queue();
			return;
		}
		String action = rest[0];
		switch (action) {
			case "clear" -> issuesClear(event, rc);
			case "clear-all" -> issuesClearAll(event, rc);
			case "fix-feed" -> {
				if (rest.length < 2) {
					rc.reply("Missing dino id.").setEphemeral(true).queue();
					return;
				}
				try {
					issuesFixFeed(event, rc, Long.parseLong(rest[1]));
				} catch (NumberFormatException nfe) {
					rc.reply("Bad dino id.").setEphemeral(true).queue();
				}
			}
			case "fix-move" -> {
				if (rest.length < 2) {
					rc.reply("Missing dino id.").setEphemeral(true).queue();
					return;
				}
				try {
					issuesFixMove(event, rc, Long.parseLong(rest[1]));
				} catch (NumberFormatException nfe) {
					rc.reply("Bad dino id.").setEphemeral(true).queue();
				}
			}
			default -> rc.reply("Unknown issues action.").setEphemeral(true).queue();
		}
	}

	private void issuesClear(GenericInteractionCreateEvent event, IReplyCallback rc) {
		if (!(event instanceof StringSelectInteractionEvent sse) || sse.getValues().isEmpty()) {
			rc.reply("No issue selected.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		long issueId;
		try {
			issueId = Long.parseLong(sse.getValues().get(0));
		} catch (NumberFormatException nfe) {
			rc.reply("Bad issue id.").setEphemeral(true).queue();
			return;
		}
		// Owner check is inside resolve() — silently no-ops on cross-user attempts.
		issues.resolve(issueId, userId);
		rerenderIssues(event, rc, userId);
	}

	private void issuesClearAll(GenericInteractionCreateEvent event, IReplyCallback rc) {
		long userId = event.getUser().getIdLong();
		issues.resolveAllForOwner(userId);
		rerenderIssues(event, rc, userId);
	}

	private void issuesFixFeed(GenericInteractionCreateEvent event, IReplyCallback rc, long dinoId) {
		long userId = event.getUser().getIdLong();
		DinoInstance d = dinos.findById(dinoId).orElse(null);
		if (d == null || d.ownerUserId() != userId) {
			replyError(rc, event, "Not your dino", "That dino doesn't belong to you.");
			return;
		}
		java.time.Instant now = java.time.Instant.now();
		if (FeedCommand.isOnCooldown(d, now)) {
			java.time.Duration left = FeedCommand.cooldownRemaining(d, now);
			replyError(rc, event, "On cooldown",
				"Try again in " + (left.toHours() > 0 ? left.toHours() + "h " : "")
					+ (left.toMinutesPart()) + "m.");
			return;
		}
		dinos.recordFed(dinoId, now);
		dinos.awardXp(dinoId, FEED_XP_AWARD);
		// Resolve immediately so the row vanishes on rerender — happiness sweep
		// would do this on the next tick anyway, but waiting an hour is bad UX.
		issues.resolveByMatch(userId, ZooIssue.Type.LOW_HAPPINESS,
			java.util.Optional.of(IssueDetector.TARGET_DINO),
			java.util.OptionalLong.of(dinoId));
		rerenderIssues(event, rc, userId);
	}

	private void issuesFixMove(GenericInteractionCreateEvent event, IReplyCallback rc, long dinoId) {
		long userId = event.getUser().getIdLong();
		DinoInstance d = dinos.findById(dinoId).orElse(null);
		if (d == null || d.ownerUserId() != userId) {
			replyError(rc, event, "Not your dino", "That dino doesn't belong to you.");
			return;
		}
		DinoSpecies species = catalog.byId(d.speciesId()).orElse(null);
		if (species == null) {
			replyError(rc, event, "Unknown species", "Catalog mismatch — contact the developer.");
			return;
		}
		// Pick the first compatible enclosure: same biome preferred, otherwise
		// any housing-compatible one with free space and adequate tier. This
		// is a one-click "get them off the streets" — finer control via /move.
		int requiredTier = EnclosureService.MIN_TIER_FOR_RARITY.getOrDefault(species.rarity(), 1);
		java.util.List<Enclosure> candidates = enclosures.findByOwner(userId).stream()
			.filter(e -> e.tier() >= requiredTier)
			.filter(e -> Biome.canHouse(e.biome(), species.biome()))
			.filter(e -> enclosures.slotsAvailable(e) > 0)
			.sorted((a, b) -> {
				boolean aMatch = a.biome().equalsIgnoreCase(species.biome());
				boolean bMatch = b.biome().equalsIgnoreCase(species.biome());
				if (aMatch != bMatch) return aMatch ? -1 : 1;
				return Integer.compare(b.tier(), a.tier());
			})
			.toList();
		if (candidates.isEmpty()) {
			replyError(rc, event, "Nowhere to move",
				"No enclosure with tier ≥ " + requiredTier
					+ " and free space can house a " + species.biome()
					+ " species. Build a " + species.biome() + " habitat in `/shop` first.");
			return;
		}
		Enclosure dest = candidates.get(0);
		dinos.assignToEnclosure(dinoId, java.util.OptionalLong.of(dest.id()));
		issues.resolveByMatch(userId, ZooIssue.Type.HOMELESS_DINO,
			java.util.Optional.of(IssueDetector.TARGET_DINO),
			java.util.OptionalLong.of(dinoId));
		rerenderIssues(event, rc, userId);
	}

	private void rerenderIssues(GenericInteractionCreateEvent event, IReplyCallback rc, long userId) {
		ZooIssueRenderer.Rendered r = ZooIssueRenderer.render(issues.findOpenForOwner(userId));
		editOrReply(event, rc, r.embed(), r.components(), Optional.empty());
	}

	// ─── shared helpers ──────────────────────────────────────────────────

	private static void placeholder(IReplyCallback rc, GenericInteractionCreateEvent event,
	                                String title, String stepRef) {
		EmbedBuilder embed = Embeds.info(title + " — coming soon",
			"This action lands in " + stepRef + " of the v1 game implementation.");
		Embeds.brand(embed, event.getJDA());
		rc.replyEmbeds(embed.build()).setEphemeral(true).queue();
	}

	private static void replyError(IReplyCallback rc, GenericInteractionCreateEvent event,
	                               String title, String body) {
		EmbedBuilder embed = Embeds.error(title, body);
		Embeds.brand(embed, event.getJDA());
		try {
			if (rc.isAcknowledged()) {
				rc.getHook().sendMessageEmbeds(embed.build()).setEphemeral(true).queue();
			} else {
				rc.replyEmbeds(embed.build()).setEphemeral(true).queue();
			}
		} catch (Exception ignored) {
			// best-effort; the original handler-level catch already logged.
		}
	}

	private static String formatMins(int minutes) {
		if (minutes < 60) return minutes + " minute" + (minutes == 1 ? "" : "s");
		int h = minutes / 60;
		int m = minutes % 60;
		return m == 0 ? h + " hour" + (h == 1 ? "" : "s")
			: h + "h " + m + "m";
	}

	/**
	 * @return the modal id used by the build-enclosure flow — exposed so
	 *         tests don't have to hard-code the string.
	 */
	public static String modalIdBuildEnclosure() {
		return MODAL_BUILD_ENCLOSURE;
	}

	private static Optional<FileUpload> attachmentForRarity(String rarity, EggImageProvider images) {
		return ShopUI.imageAttachment(rarity, images);
	}
}
