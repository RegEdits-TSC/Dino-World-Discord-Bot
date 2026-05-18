package dev.homeology.dinoworld.modules.players;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.User;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.OptionType;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;
import net.dv8tion.jda.api.utils.FileUpload;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.InputStream;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * {@code /rank [user]} — display a Discord-style rank card with the
 * user's avatar, level, and an XP progress bar.
 *
 * <p>The card is generated as a PNG by {@link RankCardRenderer} and sent
 * as a file attachment instead of a text embed. Public reply (matches
 * {@code /profile}) so players can show off their progress.
 *
 * <p>The avatar is fetched from Discord's CDN with a short timeout —
 * if the download fails or takes too long, the card renders with a
 * placeholder ring instead of stalling the whole interaction.
 */
public final class RankCommand implements Command {

	private static final Logger log = LoggerFactory.getLogger(RankCommand.class);

	/** Avatar download timeout — short so a slow CDN doesn't burn the deferred reply window. */
	private static final long AVATAR_DOWNLOAD_TIMEOUT_MS = 5_000L;

	/** Avatar size requested from Discord's CDN — twice the rendered size for clean downscaling. */
	private static final int AVATAR_FETCH_SIZE = 256;

	private final PlayerService players;

	public RankCommand(PlayerService players) {
		this.players = players;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("rank", "Show your rank card with avatar, level, and XP progress.")
			.addOption(OptionType.USER, "user",
				"Whose rank card to view (defaults to yourself).", false);
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.TYCOON;
	}

	@Override
	public boolean deferEphemeral() {
		// Public — rank cards are meant to be shown off in-channel, like /profile.
		return false;
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		User invoker = event.getUser();
		players.ensure(invoker.getIdLong(), invoker.getEffectiveName());

		var targetOpt = event.getOption("user");
		User target = targetOpt == null ? invoker : targetOpt.getAsUser();

		Player p;
		if (target.getIdLong() == invoker.getIdLong()) {
			p = players.get(invoker.getIdLong()).orElseThrow();
		} else {
			var found = players.get(target.getIdLong());
			if (found.isEmpty()) {
				EmbedBuilder e = Embeds.info("No rank yet",
					target.getEffectiveName() + " hasn't started a park yet.");
				Embeds.brand(e, event.getJDA());
				event.getHook().editOriginalEmbeds(e.build()).queue();
				return;
			}
			p = found.get();
		}

		LevelingService leveling = players.leveling();
		boolean maxLevel = leveling.isMaxLevel(p.level());
		long xpInLevel = maxLevel ? 0L : leveling.xpProgressInLevel(p.xp());
		// xpToNext is forced to 1 at max so the renderer's overload doesn't
		// reject a 0 — the maxLevel flag tells it to show "MAX" anyway.
		long xpToNext = maxLevel ? 1L : leveling.xpToNextLevel(p.level());

		BufferedImage avatar = fetchAvatar(target);
		byte[] png = RankCardRenderer.render(p.displayName(), p.level(),
			xpInLevel, xpToNext, avatar, maxLevel,
			p.equippedTitle().orElse(null));

		String filename = "rank-" + target.getId() + ".png";
		event.getHook()
			.editOriginalAttachments(FileUpload.fromData(png, filename))
			.queue();
	}

	/**
	 * Fetch the target's avatar with a hard timeout. Returns {@code null}
	 * (the renderer's placeholder path) if the download fails — we never
	 * want a slow CDN to abort the whole rank card.
	 */
	private BufferedImage fetchAvatar(User target) {
		try (InputStream stream = target.getEffectiveAvatar()
			.download(AVATAR_FETCH_SIZE)
			.get(AVATAR_DOWNLOAD_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
			return ImageIO.read(stream);
		} catch (TimeoutException e) {
			log.warn("avatar download timed out for user={}", target.getId());
		} catch (Exception e) {
			log.warn("avatar download failed for user={}: {}", target.getId(), e.toString());
		}
		return null;
	}
}
