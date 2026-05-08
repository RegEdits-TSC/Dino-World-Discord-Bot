package dev.homeology.dinoworld.util;

import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.entities.SelfUser;

import java.awt.*;
import java.time.Instant;

/**
 * Central factory for the bot's user-visible embeds.
 *
 * <p>Every reply the bot sends should flow through one of {@link #error},
 * {@link #warning}, {@link #success}, or {@link #info} so colors and
 * branding stay consistent. Callers may add fields, code blocks, or
 * additional description to the returned {@link EmbedBuilder} before
 * sending; the builder is mutable and chainable.
 *
 * <p>Color choices match Discord's official palette so the bot's visuals
 * blend with the platform's native UI cues:
 * <ul>
 *   <li>{@link #COLOR_ERROR} — Discord red (errors, denials, failures)</li>
 *   <li>{@link #COLOR_WARNING} — Discord yellow (lifecycle changes, soft warnings)</li>
 *   <li>{@link #COLOR_SUCCESS} — Discord green (successful state changes)</li>
 *   <li>{@link #COLOR_INFO} — Discord blurple (informational responses)</li>
 * </ul>
 *
 * <p>{@link #brand(EmbedBuilder, JDA)} stamps the standard footer (bot name +
 * avatar) and a current timestamp; call it once at the send site if the
 * caller has access to a {@link JDA} instance, otherwise the embed remains
 * unbranded but still correctly colored.
 */
public final class Embeds {

	/**
	 * Discord red — for errors, denials, and failures.
	 */
	public static final Color COLOR_ERROR = new Color(0xED4245);

	/**
	 * Discord yellow — for warnings and lifecycle transitions.
	 */
	public static final Color COLOR_WARNING = new Color(0xFEE75C);

	/**
	 * Discord green — for successful state changes.
	 */
	public static final Color COLOR_SUCCESS = new Color(0x57F287);

	/**
	 * Discord blurple — for general informational responses.
	 */
	public static final Color COLOR_INFO = new Color(0x5865F2);

	private Embeds() {
		// utility class
	}

	/**
	 * Build a red error embed with the given title and body.
	 */
	public static EmbedBuilder error(String title, String description) {
		return base(COLOR_ERROR, title, description);
	}

	/**
	 * Build a yellow warning embed with the given title and body.
	 */
	public static EmbedBuilder warning(String title, String description) {
		return base(COLOR_WARNING, title, description);
	}

	/**
	 * Build a green success embed with the given title and body.
	 */
	public static EmbedBuilder success(String title, String description) {
		return base(COLOR_SUCCESS, title, description);
	}

	/**
	 * Build a blurple info embed with the given title and body.
	 */
	public static EmbedBuilder info(String title, String description) {
		return base(COLOR_INFO, title, description);
	}

	/**
	 * Stamp the standard footer (bot name + avatar) and a current timestamp.
	 * Idempotent — calling again overwrites the previous footer.
	 *
	 * @param b   the embed builder to brand
	 * @param jda live JDA instance; the bot's self user supplies name + avatar
	 * @return {@code b} for chaining
	 */
	public static EmbedBuilder brand(EmbedBuilder b, JDA jda) {
		SelfUser self = jda.getSelfUser();
		b.setFooter(self.getName(), self.getEffectiveAvatarUrl());
		b.setTimestamp(Instant.now());
		return b;
	}

	private static EmbedBuilder base(Color color, String title, String description) {
		EmbedBuilder b = new EmbedBuilder().setColor(color);
		if (title != null && !title.isEmpty()) b.setTitle(title);
		if (description != null && !description.isEmpty()) b.setDescription(description);
		return b;
	}
}
