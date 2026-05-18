package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.staff.StaffEffectsService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
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

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * {@code /dino …} — per-dino actions grouped under one verb.
 *
 * <p>Subcommands:
 * <ul>
 *   <li>{@code /dino inspect dino_id:<n>} — full stats sheet for one
 *       dino, including a "why isn't happiness 100%?" breakdown
 *       (biome match, decay rate, vet effect, last-fed cooldown).</li>
 *   <li>{@code /dino rename dino_id:<n> name:<s>} — set or clear the
 *       cosmetic custom name (40-char cap to match staff renames).
 *       Previously only settable at hatch time.</li>
 * </ul>
 *
 * <p>The {@code dino_id} option autocompletes from the invoker's owned
 * dinos — same UX as {@code /staff staff_id}.
 *
 * <p>All replies are ephemeral: per-dino stats are private inspection,
 * not channel chatter.
 */
public final class DinoCommand extends ListenerAdapter implements Command {

	/** Subcommand name for the per-dino stats sheet. */
	public static final String SUB_INSPECT = "inspect";

	/** Subcommand name for setting / clearing the custom display name. */
	public static final String SUB_RENAME = "rename";

	/** Discord caps autocomplete suggestions at 25. */
	private static final int AUTOCOMPLETE_LIMIT = 25;

	/** Custom-name length cap — matches staff/enclosure renames. */
	private static final int NAME_MAX_LENGTH = 40;

	private final PlayerService players;
	private final DinoInstanceService dinos;
	private final EnclosureService enclosures;
	private final DinoCatalog catalog;
	private final StaffEffectsService staffEffects;

	public DinoCommand(PlayerService players,
	                   DinoInstanceService dinos,
	                   EnclosureService enclosures,
	                   DinoCatalog catalog,
	                   StaffEffectsService staffEffects) {
		this.players = players;
		this.dinos = dinos;
		this.enclosures = enclosures;
		this.catalog = catalog;
		this.staffEffects = staffEffects;
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
		OptionData dinoIdOpt = new OptionData(OptionType.INTEGER, "dino_id",
			"Pick one of your dinos", true, true);
		OptionData nameOpt = new OptionData(OptionType.STRING, "name",
			"New custom name (blank to clear)", false);

		return Commands.slash("dino", "Per-dino actions: inspect, rename.")
			.addSubcommands(
				new SubcommandData(SUB_INSPECT,
					"Show one dino's full stats sheet, including why happiness isn't 100%.")
					.addOptions(dinoIdOpt),
				new SubcommandData(SUB_RENAME, "Set or clear a dino's custom name.")
					.addOptions(dinoIdOpt, nameOpt));
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());

		String sub = event.getSubcommandName();
		if (sub == null) {
			reply(event, Embeds.error("Missing subcommand", "Use /dino inspect or /dino rename."));
			return;
		}
		switch (sub) {
			case SUB_INSPECT -> handleInspect(event, userId);
			case SUB_RENAME -> handleRename(event, userId);
			default -> reply(event, Embeds.error("Unknown subcommand", "/dino " + sub));
		}
	}

	// ─── inspect ─────────────────────────────────────────────────────────

	private void handleInspect(SlashCommandInteractionEvent event, long userId) {
		long dinoId = req(event, "dino_id").getAsLong();
		DinoInstance d = dinos.findById(dinoId).orElse(null);
		if (d == null || d.ownerUserId() != userId) {
			reply(event, Embeds.error("Not your dino", "No dino #" + dinoId + " owned by you."));
			return;
		}
		DinoSpecies s = catalog.byId(d.speciesId()).orElse(null);
		if (s == null) {
			reply(event, Embeds.error("Unknown species",
				"Catalog mismatch on `" + d.speciesId() + "` — contact the developer."));
			return;
		}

		Enclosure enc = d.enclosureId().isPresent()
			? enclosures.findById(d.enclosureId().getAsLong()).orElse(null)
			: null;

		String displayName = d.customName().orElseGet(() -> s.displayName() + " #" + d.id());
		String header = "🦖  " + displayName;
		String description = "**" + s.displayName() + "** · " + capitalize(s.rarity())
			+ " · " + capitalize(s.category()) + " · " + capitalize(s.biome()) + " biome\n_"
			+ s.description() + "_";

		EmbedBuilder embed = Embeds.info(header, description);

		// Top-level stats grid.
		long incomePerHour = (long) s.baseIncomePerHour() * d.happiness() / 100L;
		embed.addField("Happiness", happinessLabel(d.happiness()), true);
		embed.addField("Income / hr", incomePerHour + " coins", true);
		embed.addField("Personality", personalityLabel(d), true);
		embed.addField("Level", levelLabel(d), true);

		// Location block.
		embed.addField("Location", locationLine(s, enc), false);

		// Why-isn't-happiness-100 block — the headline feature of /dino inspect.
		embed.addField("Happiness breakdown", happinessBreakdown(d, s, enc), false);

		// Last fed + cooldown.
		embed.addField("Feeding", feedingLine(d, Instant.now()), false);

		// Acquired age.
		embed.addField("Acquired", relativePast(d.acquiredAt(), Instant.now()), true);
		embed.addField("ID", "`#" + d.id() + "`", true);
		embed.addField("​", "​", true); // grid spacer

		reply(event, embed);
	}

	// ─── rename ──────────────────────────────────────────────────────────

	private void handleRename(SlashCommandInteractionEvent event, long userId) {
		long dinoId = req(event, "dino_id").getAsLong();
		OptionMapping nameOpt = event.getOption("name");
		String newName = nameOpt == null ? null : nameOpt.getAsString();

		DinoInstance d = dinos.findById(dinoId).orElse(null);
		if (d == null || d.ownerUserId() != userId) {
			reply(event, Embeds.error("Not your dino", "No dino #" + dinoId + " owned by you."));
			return;
		}
		if (newName != null && newName.length() > NAME_MAX_LENGTH) {
			reply(event, Embeds.error("Too long",
				"Name must be " + NAME_MAX_LENGTH + " characters or fewer."));
			return;
		}

		boolean updated = dinos.rename(dinoId, newName);
		if (!updated) {
			reply(event, Embeds.error("Rename failed",
				"The dino may have been sold between picking it and submitting."));
			return;
		}
		String shown = (newName == null || newName.isBlank())
			? "(name cleared — falls back to species + ID)"
			: "**" + newName.trim() + "**";
		reply(event, Embeds.success("✏️  Renamed dino #" + dinoId,
			"Now displayed as " + shown + "."));
	}

	// ─── render helpers ──────────────────────────────────────────────────

	private static String personalityLabel(DinoInstance d) {
		return d.trait()
			.map(t -> t.emoji() + " " + t.displayName())
			.orElse("_Plain_");
	}

	/**
	 * @return a "Lv N · X/Y XP ▰▰▰▱▱▱▱▱▱▱" line, or "MAX" at the cap.
	 *         The bar is a 10-segment unicode strip so the grid stays
	 *         legible inside the inline field cell.
	 */
	private static String levelLabel(DinoInstance d) {
		int level = d.level();
		if (DinoLeveling.isMaxLevel(level)) {
			return "**Lv " + level + "** · MAX";
		}
		long toNext = DinoLeveling.xpToNextLevel(level);
		long inLevel = DinoLeveling.xpProgressInLevel(d.xp());
		int filled = toNext == 0 ? 10 : (int) Math.clamp(inLevel * 10L / toNext, 0L, 10L);
		String bar = "▰".repeat(filled) + "▱".repeat(10 - filled);
		return "**Lv " + level + "** · " + inLevel + "/" + toNext + " XP\n" + bar;
	}

	private String happinessLabel(int happiness) {
		String emoji;
		if (happiness >= 80) emoji = "😊";
		else if (happiness >= 50) emoji = "🙂";
		else if (happiness > IssueDetector.HAPPINESS_RAISE_AT) emoji = "😐";
		else emoji = "😟";
		return happiness + "% " + emoji;
	}

	private String locationLine(DinoSpecies s, Enclosure enc) {
		if (enc == null) {
			return "🚨 **Homeless** — no enclosure assigned. Use `/move` to place this dino in a habitat.";
		}
		String name = enc.name().orElse("Enclosure #" + enc.id());
		boolean match = enc.biome().equalsIgnoreCase(s.biome());
		String matchIcon = match ? "✅" : "⚠️";
		String matchLabel = match
			? "biome match"
			: s.biome() + " dino in " + enc.biome() + " enclosure (mismatch)";
		return "**" + name + "** — " + capitalize(enc.biome())
			+ " · Tier " + enc.tier()
			+ "\n" + matchIcon + " " + matchLabel;
	}

	/**
	 * Explains what the per-hour decay rate is and why — the "why isn't
	 * happiness 100%?" question. Mirrors the math in
	 * {@link HappinessTickService#decayFor(DinoInstance, java.util.Map)}
	 * and {@link StaffEffectsService#happinessDecayMultiplier(long)}.
	 */
	private String happinessBreakdown(DinoInstance d, DinoSpecies s, Enclosure enc) {
		StringBuilder b = new StringBuilder();

		int base;
		String reason;
		if (enc == null) {
			base = HappinessTickService.DECAY_MISMATCH;
			reason = "homeless dino — no enclosure";
		} else if (enc.biome().equalsIgnoreCase(s.biome())) {
			base = HappinessTickService.DECAY_BASE;
			reason = "native biome match (" + s.biome() + ")";
		} else {
			base = HappinessTickService.DECAY_MISMATCH;
			reason = "biome mismatch (" + s.biome() + " dino in " + enc.biome() + ")";
		}

		double traitMult = d.trait().map(DinoTrait::decayMult).orElse(1.0);
		double vetMult = (staffEffects != null && enc != null)
			? staffEffects.happinessDecayMultiplier(enc.id())
			: StaffEffectsService.IDENTITY;
		int effective = (int) Math.round(base * traitMult * vetMult);

		b.append("• Base decay: **−").append(base).append("%/hr** (").append(reason).append(")\n");
		if (d.trait().isPresent() && traitMult != 1.0) {
			DinoTrait t = d.trait().get();
			int delta = (int) Math.round((traitMult - 1.0) * 100);
			String sign = delta > 0 ? "+" : "";
			b.append("• Personality: ").append(t.emoji()).append(" ").append(t.displayName())
				.append(" **×").append(formatMult(traitMult))
				.append("** (").append(sign).append(delta).append("% decay)\n");
		}
		if (vetMult < StaffEffectsService.IDENTITY) {
			int pctOff = (int) Math.round((1 - vetMult) * 100);
			b.append("• Vet on duty: **×").append(formatMult(vetMult))
				.append("** (−").append(pctOff).append("% decay)\n");
		}
		if (traitMult != 1.0 || vetMult < StaffEffectsService.IDENTITY) {
			b.append("• Effective decay: **−").append(effective).append("%/hr**\n");
		}
		b.append("• Current: **").append(d.happiness()).append("%**");
		if (d.happiness() < 100) {
			b.append(" — feed via `/feed` to restore to 100%");
		} else {
			b.append(" — fully happy");
		}
		return b.toString();
	}

	private String feedingLine(DinoInstance d, Instant now) {
		if (d.lastFedAt().isEmpty()) {
			return "Never fed. Use `/feed` to start the care loop.";
		}
		Instant fed = d.lastFedAt().get();
		String last = relativePast(fed, now);
		if (FeedCommand.isOnCooldown(d, now)) {
			Duration left = FeedCommand.cooldownRemaining(d, now);
			return "Last fed " + last + ". On cooldown — feedable in " + formatDuration(left) + ".";
		}
		return "Last fed " + last + ". **Ready to feed now** via `/feed`.";
	}

	// ─── shared helpers ──────────────────────────────────────────────────

	private static OptionMapping req(SlashCommandInteractionEvent event, String name) {
		OptionMapping m = event.getOption(name);
		if (m == null) throw new IllegalStateException("Missing required option: " + name);
		return m;
	}

	private void reply(SlashCommandInteractionEvent event, EmbedBuilder embed) {
		Embeds.brand(embed, event.getJDA());
		event.getHook().editOriginalEmbeds(embed.build()).queue();
	}

	private static String capitalize(String s) {
		if (s == null || s.isEmpty()) return s;
		return Character.toUpperCase(s.charAt(0)) + s.substring(1);
	}

	private static String formatMult(double m) {
		// 0.5 → "0.5", 0.75 → "0.75"
		if (m == Math.floor(m * 10) / 10.0) return String.format(Locale.ROOT, "%.1f", m);
		return String.format(Locale.ROOT, "%.2f", m);
	}

	private static String formatDuration(Duration d) {
		long total = Math.max(0, d.toMinutes());
		long h = total / 60;
		long m = total % 60;
		if (h > 0) return h + "h " + m + "m";
		return m + "m";
	}

	private static String relativePast(Instant when, Instant now) {
		Duration d = Duration.between(when, now);
		if (d.isNegative() || d.toMinutes() < 1) return "just now";
		long mins = d.toMinutes();
		if (mins < 60) return mins + "m ago";
		long hrs = d.toHours();
		if (hrs < 24) return hrs + "h ago";
		return d.toDays() + "d ago";
	}

	// ─── autocomplete ────────────────────────────────────────────────────

	@Override
	public void onCommandAutoCompleteInteraction(CommandAutoCompleteInteractionEvent event) {
		if (!"dino".equals(event.getName())) return;
		String focused = event.getFocusedOption().getName();
		if (!"dino_id".equals(focused)) {
			event.replyChoices(List.of()).queue();
			return;
		}
		String prefix = event.getFocusedOption().getValue().toLowerCase(Locale.ROOT);
		long userId = event.getUser().getIdLong();

		List<Choice> out = new ArrayList<>();
		for (DinoInstance d : dinos.findByOwner(userId)) {
			if (out.size() >= AUTOCOMPLETE_LIMIT) break;
			DinoSpecies s = catalog.byId(d.speciesId()).orElse(null);
			String speciesName = s == null ? d.speciesId() : s.displayName();
			String display = d.customName().orElse(speciesName);
			String idStr = String.valueOf(d.id());
			// Match on either the id or the display string so users can search by either.
			if (!prefix.isEmpty()
				&& !idStr.contains(prefix)
				&& !display.toLowerCase(Locale.ROOT).contains(prefix)) {
				continue;
			}
			String label = "#" + d.id() + " · " + display
				+ " (" + d.happiness() + "% happy)";
			if (label.length() > 100) label = label.substring(0, 97) + "…";
			out.add(new Choice(label, d.id()));
		}
		event.replyChoices(out).queue();
	}
}
