package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.selections.SelectOption;
import net.dv8tion.jda.api.components.selections.StringSelectMenu;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * {@code /feed} — pick a dino from a dropdown to restore its happiness.
 *
 * <p>Each dino has a {@value #COOLDOWN_HOURS}-hour cooldown enforced by
 * {@link DinoInstanceService#recordFed} via the {@code last_fed_at}
 * column; the dropdown shows every dino with an inline cooldown hint so
 * the player can plan rotations.
 *
 * <p>The actual feed action is dispatched through the component handler
 * ({@code zoo:feed:one}) — keeping the slash command itself a thin
 * launcher.
 */
public final class FeedCommand implements Command {

	/**
	 * Per-dino cooldown between feeds. 6 hours means a player with a few
	 * dinos can rotate them through one or two daily check-ins.
	 */
	public static final int COOLDOWN_HOURS = 6;

	/**
	 * Maximum dinos shown in the picker dropdown — Discord's
	 * StringSelectMenu cap. If a player has more, they'll need the
	 * /zoo "Feed all" button (which iterates all eligible dinos).
	 */
	private static final int MAX_OPTIONS = 25;

	private final PlayerService players;
	private final DinoInstanceService dinos;
	private final DinoCatalog catalog;

	public FeedCommand(PlayerService players, DinoInstanceService dinos, DinoCatalog catalog) {
		this.players = players;
		this.dinos = dinos;
		this.catalog = catalog;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("feed", "Pick a dino to feed (restores happiness to 100).");
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
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		long userId = event.getUser().getIdLong();
		players.ensure(userId, event.getUser().getEffectiveName());

		List<DinoInstance> owned = dinos.findByOwner(userId);
		if (owned.isEmpty()) {
			event.replyEmbeds(Embeds.warning("No dinos to feed",
				"Visit `/shop` and `/hatch` first.").build())
				.setEphemeral(true).queue();
			return;
		}

		Instant now = Instant.now();
		StringSelectMenu.Builder sel = StringSelectMenu.create(
			ZooComponentHandler.NAMESPACE + ":feed:one")
			.setPlaceholder("Pick a dino to feed");
		int added = 0;
		for (DinoInstance d : owned) {
			if (added >= MAX_OPTIONS) break;
			sel.addOptions(SelectOption.of(buildLabel(d, now), String.valueOf(d.id())));
			added++;
		}

		EmbedBuilder embed = Embeds.info("🍖  Feed a dino",
			"Pick from the dropdown below. Each dino has a "
				+ COOLDOWN_HOURS + "-hour cooldown after feeding.");
		Embeds.brand(embed, event.getJDA());
		event.replyEmbeds(embed.build())
			.addComponents(ActionRow.of(sel.build()))
			.setEphemeral(true).queue();
	}

	// ─── helpers shared with the component handler ───────────────────────

	/**
	 * @return human-readable status for one dino in the picker dropdown
	 */
	String buildLabel(DinoInstance d, Instant now) {
		DinoSpecies s = catalog.byId(d.speciesId()).orElse(null);
		String name = d.customName().orElseGet(() ->
			(s == null ? d.speciesId() : s.displayName()) + " #" + d.id());
		String suffix;
		if (isOnCooldown(d, now)) {
			Duration remaining = cooldownRemaining(d, now);
			suffix = " — cooldown " + formatDuration(remaining);
		} else {
			suffix = " — happy " + d.happiness() + "%, ready";
		}
		// Discord caps option labels at 100 chars
		String label = name + suffix;
		return label.length() > 100 ? label.substring(0, 97) + "…" : label;
	}

	/**
	 * @return true if {@code now} is still within the per-dino feed cooldown
	 */
	public static boolean isOnCooldown(DinoInstance d, Instant now) {
		return d.lastFedAt()
			.map(fed -> Duration.between(fed, now).toHours() < COOLDOWN_HOURS)
			.orElse(false);
	}

	/**
	 * @return remaining cooldown duration; zero if not on cooldown
	 */
	public static Duration cooldownRemaining(DinoInstance d, Instant now) {
		return d.lastFedAt()
			.map(fed -> Duration.ofHours(COOLDOWN_HOURS).minus(Duration.between(fed, now)))
			.filter(left -> !left.isNegative() && !left.isZero())
			.orElse(Duration.ZERO);
	}

	private static String formatDuration(Duration d) {
		long total = d.toMinutes();
		long h = total / 60;
		long m = total % 60;
		if (h > 0) return h + "h " + m + "m";
		return m + "m";
	}
}
