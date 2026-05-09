package dev.homeology.dinoworld.modules.zoo.issues;

import dev.homeology.dinoworld.modules.zoo.ZooComponentHandler;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.components.MessageTopLevelComponent;
import net.dv8tion.jda.api.components.actionrow.ActionRow;
import net.dv8tion.jda.api.components.buttons.Button;
import net.dv8tion.jda.api.components.selections.SelectOption;
import net.dv8tion.jda.api.components.selections.StringSelectMenu;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Pure-render helper for {@code /zoo issues} — turns a list of
 * {@link ZooIssue}s into the embed + components shown to the player.
 *
 * <p>Layout:
 * <ul>
 *   <li><b>Empty</b>: green "All clear" embed with no components.</li>
 *   <li><b>Populated</b>: info embed with one field per issue (capped at
 *       Discord's 25-field max), plus three component rows:
 *       <ol>
 *         <li>Quick-fix action for the first issue, when applicable
 *             (Feed button for low_happiness, Move dropdown trigger for
 *             homeless_dino). No row added when neither applies.</li>
 *         <li>StringSelectMenu of "Clear: …" options, one per issue.</li>
 *         <li>Danger button "Clear all".</li>
 *       </ol>
 *   </li>
 * </ul>
 */
public final class ZooIssueRenderer {

	/** Discord caps embed fields and select-menu options at 25. */
	private static final int MAX_OPTIONS = 25;

	private ZooIssueRenderer() {}

	public static Rendered render(List<ZooIssue> openIssues) {
		if (openIssues.isEmpty()) {
			EmbedBuilder embed = Embeds.success("✅  All clear",
				"Nothing in your zoo needs attention right now.");
			return new Rendered(embed, List.of());
		}

		int total = openIssues.size();
		int criticals = 0;
		for (ZooIssue i : openIssues) if (i.severity() == ZooIssue.Severity.CRITICAL) criticals++;

		String summary = total + " open issue" + (total == 1 ? "" : "s")
			+ (criticals > 0 ? " — **" + criticals + " critical**" : "");
		EmbedBuilder embed = Embeds.warning("🚨  Zoo issues", summary);

		Instant now = Instant.now();
		int shown = 0;
		for (ZooIssue i : openIssues) {
			if (shown >= MAX_OPTIONS) break;
			String icon = i.severity() == ZooIssue.Severity.CRITICAL ? "🚨" : "⚠️";
			String header = icon + " " + titleFor(i.type());
			String body = i.detail() + "\n_first seen " + relative(i.firstSeenAt(), now) + "_";
			embed.addField(header, body, false);
			shown++;
		}
		if (shown < total) {
			embed.addField("…and more",
				"Showing the first " + shown + " of " + total + " open issues.", false);
		}

		List<MessageTopLevelComponent> components = new ArrayList<>();

		// Quick-fix row for the most-severe issue (first in the list, since
		// the DAO sorts critical-first then oldest-first).
		ZooIssue top = openIssues.get(0);
		Button quickFix = quickFixFor(top);
		if (quickFix != null) {
			components.add(ActionRow.of(quickFix));
		}

		// Clear-one dropdown.
		StringSelectMenu.Builder clearMenu = StringSelectMenu.create(
				ZooComponentHandler.NAMESPACE + ":issues:clear")
			.setPlaceholder("Clear an issue");
		int added = 0;
		for (ZooIssue i : openIssues) {
			if (added >= MAX_OPTIONS) break;
			String label = "Clear: " + truncate(stripEmojiPrefix(i.detail()), 90);
			clearMenu.addOptions(SelectOption.of(label, String.valueOf(i.id())));
			added++;
		}
		components.add(ActionRow.of(clearMenu.build()));

		// Clear-all button.
		components.add(ActionRow.of(Button.danger(
			ZooComponentHandler.NAMESPACE + ":issues:clear-all", "Clear all")));

		return new Rendered(embed, components);
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private static Button quickFixFor(ZooIssue issue) {
		if (issue.targetId().isEmpty()) return null;
		long id = issue.targetId().getAsLong();
		return switch (issue.type()) {
			case LOW_HAPPINESS -> Button.success(
				ZooComponentHandler.NAMESPACE + ":issues:fix-feed:" + id, "Feed this dino");
			case HOMELESS_DINO -> Button.primary(
				ZooComponentHandler.NAMESPACE + ":issues:fix-move:" + id, "Move to enclosure…");
			default -> null;
		};
	}

	private static String titleFor(ZooIssue.Type t) {
		return switch (t) {
			case LOW_HAPPINESS -> "Low happiness";
			case HOMELESS_DINO -> "Homeless dino";
			case STAFF_UNPAID -> "Staff quit (unpaid wages)";
			case WAGES_UNDERFUNDED -> "Wage runway low";
		};
	}

	private static String relative(Instant when, Instant now) {
		Duration d = Duration.between(when, now);
		if (d.isNegative()) return "just now";
		long mins = d.toMinutes();
		if (mins < 1) return "just now";
		if (mins < 60) return mins + "m ago";
		long hrs = d.toHours();
		if (hrs < 24) return hrs + "h ago";
		return d.toDays() + "d ago";
	}

	private static String truncate(String s, int max) {
		if (s.length() <= max) return s;
		return s.substring(0, max - 1) + "…";
	}

	/** Drop the leading emoji + space from a detail string, if present. */
	private static String stripEmojiPrefix(String s) {
		// Emojis used in detail strings are 1–2 codepoints followed by a space.
		// Strip greedily up to (but not past) the first space.
		int sp = s.indexOf(' ');
		if (sp <= 0 || sp > 4) return s;
		String head = s.substring(0, sp);
		// Heuristic: if it doesn't contain a letter, it's the icon prefix.
		for (int i = 0; i < head.length(); i++) {
			if (Character.isLetter(head.charAt(i))) return s;
		}
		return s.substring(sp + 1);
	}

	public record Rendered(EmbedBuilder embed, List<MessageTopLevelComponent> components) {
	}
}
