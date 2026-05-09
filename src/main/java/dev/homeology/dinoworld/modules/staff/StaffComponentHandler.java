package dev.homeology.dinoworld.modules.staff;

import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.command.ComponentHandler;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.EnclosureService;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.events.interaction.GenericInteractionCreateEvent;
import net.dv8tion.jda.api.events.interaction.component.StringSelectInteractionEvent;
import net.dv8tion.jda.api.interactions.callbacks.IMessageEditCallback;
import net.dv8tion.jda.api.interactions.callbacks.IReplyCallback;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;

/**
 * Handles every interactive component whose {@code custom_id} starts with
 * {@code staff:}. Routed by {@link dev.homeology.dinoworld.command.ComponentRouter}.
 *
 * <p>Two flows live here:
 * <ul>
 *   <li>{@code staff:hire:pick:<roleId>} — dropdown selection picks the
 *       enclosure for an enclosure-scope hire; debits coins and inserts
 *       the row.</li>
 *   <li>{@code staff:fire:confirm:<staffId>} — danger-button confirm of a
 *       fire request; deletes the row.</li>
 *   <li>{@code staff:cancel} — secondary "Cancel" button on the fire confirm,
 *       just edits the message to a cancelled state.</li>
 * </ul>
 *
 * <p>Mirrors the {@code zoo:} handler — same edit-or-reply policy so the
 * whole interaction stays in one ephemeral message.
 */
public final class StaffComponentHandler implements ComponentHandler {

	private static final Logger log = LoggerFactory.getLogger(StaffComponentHandler.class);

	/**
	 * Custom-id namespace owned by this handler. Registered with
	 * {@link dev.homeology.dinoworld.command.ComponentRouter} in
	 * {@link StaffModule#onEnable}.
	 */
	public static final String NAMESPACE = "staff";

	private final PlayerService players;
	private final StaffMemberService staff;
	private final StaffCatalog catalog;
	private final EnclosureService enclosures;

	public StaffComponentHandler(PlayerService players,
	                             StaffMemberService staff,
	                             StaffCatalog catalog,
	                             EnclosureService enclosures) {
		this.players = players;
		this.staff = staff;
		this.catalog = catalog;
		this.enclosures = enclosures;
	}

	@Override
	public void handle(GenericInteractionCreateEvent event, String[] args, CommandContext ctx) {
		if (!(event instanceof IReplyCallback rc)) return;
		if (args.length == 0) return;

		try {
			switch (args[0]) {
				case "hire" -> handleHire(event, rc, args);
				case "fire" -> handleFire(event, rc, args);
				case "cancel" -> handleCancel(event, rc);
				default -> rc.reply("Unknown staff action.").setEphemeral(true).queue();
			}
		} catch (RuntimeException ex) {
			log.warn("staff component '{}' failed", String.join(":", args), ex);
			replyError(rc, event, "Something went wrong", ex.getMessage());
		}
	}

	// ─── hire ────────────────────────────────────────────────────────────

	private void handleHire(GenericInteractionCreateEvent event, IReplyCallback rc, String[] args) {
		// Expected: hire:pick:<roleId>
		if (args.length < 3 || !"pick".equals(args[1])) {
			rc.reply("Unknown hire action.").setEphemeral(true).queue();
			return;
		}
		String roleId = args[2];
		StaffRole role = catalog.byId(roleId).orElse(null);
		if (role == null) {
			replyError(rc, event, "Unknown role", "Catalog mismatch — contact the developer.");
			return;
		}
		if (!(event instanceof StringSelectInteractionEvent sse) || sse.getValues().isEmpty()) {
			rc.reply("No enclosure selected.").setEphemeral(true).queue();
			return;
		}
		long enclosureId;
		try {
			enclosureId = Long.parseLong(sse.getValues().get(0));
		} catch (NumberFormatException nfe) {
			rc.reply("Bad enclosure id.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		Enclosure enc = enclosures.findById(enclosureId).orElse(null);
		if (enc == null || enc.ownerUserId() != userId) {
			replyError(rc, event, "Not your enclosure", "That enclosure doesn't belong to you.");
			return;
		}
		// Re-check guards (state may have changed since slash invocation).
		Player p = players.get(userId).orElseThrow();
		if (p.level() < role.unlockLevel()) {
			replyError(rc, event, "Locked",
				role.displayName() + " unlocks at level " + role.unlockLevel() + ".");
			return;
		}
		int owned = staff.countByOwnerAndRole(userId, role.id());
		if (owned >= role.maxOwned()) {
			replyError(rc, event, "Cap reached",
				"You already employ " + owned + " " + role.displayName().toLowerCase() + "(s).");
			return;
		}
		if (p.coins() < role.hireCost()) {
			replyError(rc, event, "Not enough coins",
				role.displayName() + " costs " + role.hireCost() + " coins; you have " + p.coins() + ".");
			return;
		}

		players.addCoins(userId, -role.hireCost(), "staff.hire:" + role.id(), null);
		StaffMember m = staff.create(userId, role.id(), OptionalLong.of(enclosureId));
		Player after = players.get(userId).orElseThrow();
		EmbedBuilder ack = Embeds.success("👥  Hired " + role.displayName(),
			"Working in **" + enc.name().orElse("Enclosure #" + enc.id())
				+ "** (" + enc.biome() + " · tier " + enc.tier() + ").\n"
				+ "Wages start with the next hourly tick.\n"
				+ "Staff id: `#" + m.id() + "`\n"
				+ "_Balance: " + after.coins() + " coins._");
		Embeds.brand(ack, event.getJDA());
		if (event instanceof IMessageEditCallback mec) {
			mec.editMessageEmbeds(ack.build()).setComponents().queue();
		} else {
			rc.replyEmbeds(ack.build()).setEphemeral(true).queue();
		}
		log.info("user={} hired role={} (id={}) in enclosure={}",
			userId, role.id(), m.id(), enclosureId);
	}

	// ─── fire ────────────────────────────────────────────────────────────

	private void handleFire(GenericInteractionCreateEvent event, IReplyCallback rc, String[] args) {
		// Expected: fire:confirm:<staffId>
		if (args.length < 3 || !"confirm".equals(args[1])) {
			rc.reply("Unknown fire action.").setEphemeral(true).queue();
			return;
		}
		long staffId;
		try {
			staffId = Long.parseLong(args[2]);
		} catch (NumberFormatException nfe) {
			rc.reply("Bad staff id.").setEphemeral(true).queue();
			return;
		}
		long userId = event.getUser().getIdLong();
		StaffMember m = staff.findById(staffId).orElse(null);
		if (m == null || m.ownerUserId() != userId) {
			replyError(rc, event, "Not your staff", "No staff #" + staffId + " owned by you.");
			return;
		}
		StaffRole r = catalog.byId(m.roleId()).orElse(null);
		String roleLabel = r == null ? m.roleId() : r.displayName();
		Optional<String> customName = m.customName();
		boolean removed = staff.delete(staffId);
		if (!removed) {
			replyError(rc, event, "Already gone", "That staff member is no longer in your roster.");
			return;
		}
		String name = customName.map(s -> "\"" + s + "\" (" + roleLabel + ")").orElse(roleLabel);
		EmbedBuilder ack = Embeds.success("👋  Fired " + name,
			"Staff #" + staffId + " is gone. Wage savings start with the next tick.");
		Embeds.brand(ack, event.getJDA());
		if (event instanceof IMessageEditCallback mec) {
			mec.editMessageEmbeds(ack.build()).setComponents().queue();
		} else {
			rc.replyEmbeds(ack.build()).setEphemeral(true).queue();
		}
		log.info("user={} fired staff={} (role={})", userId, staffId, m.roleId());
	}

	// ─── cancel ──────────────────────────────────────────────────────────

	private void handleCancel(GenericInteractionCreateEvent event, IReplyCallback rc) {
		EmbedBuilder embed = Embeds.info("Cancelled", "No changes.");
		Embeds.brand(embed, event.getJDA());
		if (event instanceof IMessageEditCallback mec) {
			mec.editMessageEmbeds(embed.build()).setComponents().queue();
		} else {
			rc.replyEmbeds(embed.build()).setEphemeral(true).queue();
		}
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static void replyError(IReplyCallback rc, GenericInteractionCreateEvent event,
	                               String title, String body) {
		EmbedBuilder embed = Embeds.error(title, body);
		Embeds.brand(embed, event.getJDA());
		if (rc.isAcknowledged()) {
			rc.getHook().sendMessageEmbeds(embed.build()).setEphemeral(true).queue();
		} else {
			rc.replyEmbeds(embed.build()).setEphemeral(true).queue();
		}
	}
}
