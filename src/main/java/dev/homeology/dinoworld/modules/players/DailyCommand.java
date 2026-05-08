package dev.homeology.dinoworld.modules.players;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.command.CommandCategory;
import dev.homeology.dinoworld.command.CommandContext;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.entities.User;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.Commands;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.time.Duration;
import java.time.Instant;

/**
 * {@code /daily} — claim a once-per-22h coin reward.
 *
 * <p>The 22-hour window (instead of strict 24h) is the standard
 * "daily-with-slack" pattern: a user who claimed at 7 pm on Monday can
 * claim again any time after 5 pm on Tuesday, accommodating mild schedule
 * drift without enabling reliable double-claims.
 *
 * <p>Reward is a flat {@value #REWARD_COINS} coins. Logged in {@code coin_ledger}
 * with {@code reason='daily'} so the audit trail is preserved.
 */
public final class DailyCommand implements Command {

	/**
	 * Cooldown window between {@code /daily} claims.
	 */
	public static final Duration COOLDOWN = Duration.ofHours(22);

	/**
	 * Coins awarded per successful claim. Round + easy to retune later.
	 */
	public static final long REWARD_COINS = 100L;

	/**
	 * XP awarded alongside the coin reward. Smaller than a hatch but
	 * dependable — turns daily check-ins into measurable level progress.
	 */
	public static final long REWARD_XP = 25L;

	private final PlayerService players;

	public DailyCommand(PlayerService players) {
		this.players = players;
	}

	@Override
	public SlashCommandData slashData() {
		return Commands.slash("daily", "Claim your daily coin reward (every 22 hours).");
	}

	@Override
	public CommandCategory category() {
		return CommandCategory.TYCOON;
	}

	@Override
	public void execute(SlashCommandInteractionEvent event, CommandContext ctx) {
		User invoker = event.getUser();
		Player p = players.ensure(invoker.getIdLong(), invoker.getEffectiveName());

		Instant now = Instant.now();
		if (p.lastDaily().isPresent()) {
			Instant nextOk = p.lastDaily().get().plus(COOLDOWN);
			if (now.isBefore(nextOk)) {
				Duration left = Duration.between(now, nextOk);
				EmbedBuilder embed = Embeds.warning("Already claimed",
					"You'll be able to claim again in " + humanizeShort(left) + ".");
				Embeds.brand(embed, event.getJDA());
				event.replyEmbeds(embed.build()).setEphemeral(true).queue();
				return;
			}
		}

		players.addCoins(invoker.getIdLong(), REWARD_COINS, "daily", null);
		players.addXp(invoker.getIdLong(), REWARD_XP);
		players.recordDailyClaim(invoker.getIdLong(), now);

		EmbedBuilder embed = Embeds.success("+" + REWARD_COINS + " coins, +" + REWARD_XP + " XP",
			"Come back in 22 hours for another claim.");
		Embeds.brand(embed, event.getJDA());
		event.replyEmbeds(embed.build()).queue();
	}

	private static String humanizeShort(Duration d) {
		long h = d.toHours();
		long m = d.toMinutesPart();
		if (h > 0) return h + "h " + m + "m";
		long s = d.toSecondsPart();
		return m + "m " + s + "s";
	}
}
