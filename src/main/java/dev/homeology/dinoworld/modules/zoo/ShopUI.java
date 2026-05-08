package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.MessageTopLevelComponent;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.buttons.Button;
import net.dv8tion.jda.api.components.selections.SelectOption;
import net.dv8tion.jda.api.components.selections.StringSelectMenu;

import java.awt.Color;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Builds the shop embed + interactive components for one rarity tier.
 *
 * <p>Static helpers — no state — so the same call can be made from both
 * {@code /shop} (slash command) and {@code zoo:shop:open} (button on the
 * {@code /zoo} embed) without duplicating layout code.
 *
 * <p>Layout:
 * <ul>
 *   <li>Embed colored to the rarity, with the rarity's egg PNG as the
 *       image (or no image if the file isn't on the classpath).</li>
 *   <li>Description: mystery price + incubation duration + the user's
 *       current coin balance.</li>
 *   <li>Field listing every species in this rarity with its determined-egg
 *       cost, so the player can see options before opening the dropdown.</li>
 *   <li>Component row 1 — string select for tier (Common ... Mythic).</li>
 *   <li>Component row 2 — string select listing this tier's species, used
 *       to buy a determined egg in one click.</li>
 *   <li>Component row 3 — buttons "Buy mystery" and "Build enclosure".</li>
 * </ul>
 */
public final class ShopUI {

	/**
	 * Coins to build a new enclosure of {@code tier}: {@code 1000 × tier²}.
	 * Tier 1 = 1000, Tier 5 = 25000.
	 */
	public static long enclosureBuildCost(int tier) {
		return 1000L * tier * tier;
	}

	private ShopUI() {}

	/**
	 * Render the shop view for {@code rarityId} and bundle the components.
	 */
	public static View render(String rarityId,
	                          long userId,
	                          PlayerService players,
	                          RarityCatalog rarities,
	                          DinoCatalog catalog,
	                          EnclosureService enclosures) {
		Rarity r = rarities.require(rarityId);
		Player p = players.get(userId).orElseThrow();
		boolean rarityLocked = p.level() < r.minLevel();

		List<DinoSpecies> speciesInTier = catalog.byRarity(rarityId);

		EmbedBuilder embed = new EmbedBuilder()
			.setColor(new Color(r.color()))
			.setTitle((rarityLocked ? "🔒  " : "🛒  ") + "Shop — " + r.displayName() + " tier")
			.setImage("attachment://" + rarityId + ".png");

		StringBuilder desc = new StringBuilder();
		if (rarityLocked) {
			desc.append("**🔒 Unlocks at level ").append(r.minLevel())
				.append("** — you're level ").append(p.level()).append(".\n\n");
		}
		desc.append("**Mystery ").append(r.displayName()).append(" egg** — ")
			.append(r.mysteryEggCost()).append(" coins\n");
		desc.append("Incubates in ").append(formatDuration(r.incubationMinutes())).append(".\n");
		desc.append("Hatches into a random ").append(r.displayName().toLowerCase())
			.append("-tier species.\n\n");
		desc.append("_Your balance: **").append(p.coins()).append(" coins**_");
		embed.setDescription(desc.toString());

		if (!speciesInTier.isEmpty()) {
			StringBuilder field = new StringBuilder();
			for (DinoSpecies s : speciesInTier) {
				long cost = s.effectiveDeterminedEggCost(r);
				String prefix = (rarityLocked || !enclosures.hasHabitatForSpecies(userId, s)) ? "🔒 " : "• ";
				field.append(prefix).append("**").append(s.displayName()).append("** — ")
					.append(cost).append(" coins")
					.append(" _(").append(s.biome()).append(")_\n");
				if (field.length() > 900) {
					field.append("…");
					break;
				}
			}
			embed.addField("Determined eggs (named species)", field.toString(), false);
		}
		embed.addField("Build enclosure",
			"Tier 1: " + enclosureBuildCost(1) + " · Tier 3: " + enclosureBuildCost(3)
				+ " · Tier 5: " + enclosureBuildCost(5) + " coins", false);

		List<MessageTopLevelComponent> components = new ArrayList<>();

		// Row 1 — tier selector. Locked rarities still appear (with 🔒) so
		// players can see what's coming and target it as a goal.
		StringSelectMenu.Builder tierSel = StringSelectMenu.create(
			ZooComponentHandler.NAMESPACE + ":shop:tier")
			.setPlaceholder("Switch tier");
		for (Rarity rr : rarities.all()) {
			boolean locked = p.level() < rr.minLevel();
			String label = (locked ? "🔒 " : "") + rr.displayName();
			SelectOption opt = SelectOption.of(label, rr.id());
			if (locked) {
				opt = opt.withDescription("Unlocks at level " + rr.minLevel());
			}
			if (rr.id().equals(rarityId)) opt = opt.withDefault(true);
			tierSel.addOptions(opt);
		}
		components.add(ActionRow.of(tierSel.build()));

		// Row 2 — buy determined. Each species shows a 🔒 + reason in its
		// description if the rarity is locked or the player has no habitat
		// for it. Picking a locked species refuses on click via EggService.
		if (!speciesInTier.isEmpty()) {
			StringSelectMenu.Builder buyDet = StringSelectMenu.create(
				ZooComponentHandler.NAMESPACE + ":shop:buy-determined")
				.setPlaceholder("Buy a determined egg");
			int added = 0;
			for (DinoSpecies s : speciesInTier) {
				if (added >= 25) break;     // Discord cap
				long cost = s.effectiveDeterminedEggCost(r);
				boolean habitatOk = enclosures.hasHabitatForSpecies(userId, s);
				boolean locked = rarityLocked || !habitatOk;
				String label = (locked ? "🔒 " : "") + s.displayName()
					+ " — " + cost + " coins";
				if (label.length() > 100) label = label.substring(0, 97) + "…";
				SelectOption opt = SelectOption.of(label, s.id());
				if (rarityLocked) {
					opt = opt.withDescription("Locked — reach level " + r.minLevel());
				} else if (!habitatOk) {
					opt = opt.withDescription("Locked — build a "
						+ s.biome() + " habitat first");
				}
				buyDet.addOptions(opt);
				added++;
			}
			components.add(ActionRow.of(buyDet.build()));
		}

		// Row 3 — buy mystery + build enclosure. Mystery button stays
		// clickable on locked tiers so players see the level requirement
		// in the resulting error embed (per "show but refuse on click").
		Button buyMystery = Button.primary(
			ZooComponentHandler.NAMESPACE + ":shop:buy-mystery:" + rarityId,
			(rarityLocked ? "🔒 " : "") + "Buy mystery " + r.displayName() + " egg");
		Button buildEnclosure = Button.secondary(
			ZooComponentHandler.NAMESPACE + ":shop:build-enclosure",
			"Build enclosure");
		components.add(ActionRow.of(buyMystery, buildEnclosure));

		return new View(embed, components, rarityId);
	}

	/**
	 * Bundle returned from {@link #render}: the embed, components, and the
	 * tier id (so callers can pass it back through follow-ups).
	 */
	public record View(EmbedBuilder embed, List<MessageTopLevelComponent> components, String rarityId) {
	}

	/**
	 * Build the egg-image attachment for a given rarity. Returns empty if
	 * the file isn't on the classpath — caller should skip the file upload.
	 */
	public static Optional<net.dv8tion.jda.api.utils.FileUpload> imageAttachment(String rarityId,
	                                                                            EggImageProvider images) {
		return images.bytesFor(rarityId).map(bytes ->
			net.dv8tion.jda.api.utils.FileUpload.fromData(bytes, images.filenameFor(rarityId)));
	}

	private static String formatDuration(int minutes) {
		if (minutes < 60) return minutes + "m";
		int hours = minutes / 60;
		int rem = minutes % 60;
		return rem == 0 ? hours + "h" : hours + "h " + rem + "m";
	}
}
