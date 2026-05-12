package dev.homeology.dinoworld.modules.players.missions;

import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Checks pending mission triggers after a slash command has run, awards
 * any newly-satisfied missions, and sends an ephemeral follow-up so the
 * player sees the milestone in the same flow as the action that
 * triggered it.
 *
 * <p>Called from {@link dev.homeology.dinoworld.command.CommandRouter}'s
 * worker thread after each successful command execution. Best-effort:
 * an exception inside the awarder must not roll back the command's own
 * response, so the router wraps this call in its own try/catch.
 *
 * <p>Reaches into other modules' tables ({@code egg_instance},
 * {@code dino_instance}) via raw SQL for the state probes — adding a
 * service-layer hop for one count query was overkill. The trade is
 * that the missions module assumes the zoo migrations are present;
 * production always loads both.
 */
public final class MissionAwarder {

	private static final Logger log = LoggerFactory.getLogger(MissionAwarder.class);

	private final DataSource dataSource;
	private final MissionCatalog catalog;
	private final MissionProgressService progress;
	private final PlayerService players;

	public MissionAwarder(DataSource dataSource,
	                      MissionCatalog catalog,
	                      MissionProgressService progress,
	                      PlayerService players) {
		this.dataSource = dataSource;
		this.catalog = catalog;
		this.progress = progress;
		this.players = players;
	}

	/**
	 * Run the awarder pass after a slash command body has completed.
	 * Sends one combined follow-up if any missions newly satisfied so
	 * the player isn't spammed with several DMs in quick succession.
	 */
	public void afterCommand(SlashCommandInteractionEvent event,
	                         String topCommandName) {
		List<Mission> awarded = detectAndAward(
			event.getUser().getIdLong(),
			topCommandName,
			event.getSubcommandName());
		if (!awarded.isEmpty()) sendFollowUp(event, awarded);
	}

	/**
	 * Pure work — split out so tests can drive the awarder without
	 * mocking a full JDA event. Walks each mission set in YAML order,
	 * asks {@link #isSatisfied} whether the current mission is true, and
	 * INSERT-or-NO-OPs the progress row. Returns only the missions whose
	 * INSERT actually happened, so duplicate calls (or races) don't
	 * double-pay.
	 *
	 * <p>Per-set ordering is implicit: within a set, a mission is only
	 * considered after every earlier mission in the same set is
	 * completed. Hitting an incomplete-and-unsatisfied mission stops
	 * scanning the rest of that set on this pass — later missions wait
	 * for their predecessor regardless of their own trigger state.
	 * Multiple sets are independent, so a seasonal set's progress
	 * doesn't gate the tutorial's.
	 */
	List<Mission> detectAndAward(long userId, String commandName, String subcommandName) {
		Set<String> done = new HashSet<>(progress.completedFor(userId));
		List<Mission> awarded = new ArrayList<>();
		for (MissionCatalog.MissionSet set : catalog.sets()) {
			for (Mission m : set.missions()) {
				if (done.contains(m.id())) continue;
				// First undone mission in this set. If its trigger is
				// satisfied right now, fire it and let the loop continue
				// so a cascading state change (e.g. owns_egg already true
				// when buy_first_egg unlocks) can award the next one too.
				// Otherwise stop scanning this set — later missions wait.
				if (!isSatisfied(m.trigger(), userId, commandName, subcommandName)) break;
				// Race-safe: markCompleted INSERTs ON CONFLICT DO NOTHING and
				// returns false if another path already inserted. Only grant
				// the reward when our INSERT actually happened.
				if (!progress.markCompleted(userId, m.id())) {
					done.add(m.id());
					continue;
				}
				grantReward(userId, m);
				awarded.add(m);
				done.add(m.id());
			}
		}
		return awarded;
	}

	private boolean isSatisfied(MissionTrigger trigger, long userId,
	                            String commandName, String subcommandName) {
		return switch (trigger) {
			case MissionTrigger.RanCommand rc ->
				commandName.equals(rc.command())
					&& (rc.subcommand() == null || rc.subcommand().equals(subcommandName));
			case MissionTrigger.StateTrigger st -> switch (st.state()) {
				case CLAIMED_DAILY -> hasClaimedDaily(userId);
				case OWNS_EGG -> count("egg_instance", "owner_user_id", userId) > 0;
				case OWNS_DINO -> count("dino_instance", "owner_user_id", userId) > 0;
				case FED_DINO -> hasFedAnyDino(userId);
			};
		};
	}

	private boolean hasClaimedDaily(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT 1 FROM player WHERE user_id = ? AND last_daily IS NOT NULL")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next();
			}
		} catch (SQLException e) {
			log.warn("missions: hasClaimedDaily({}) failed: {}", userId, e.toString());
			return false;
		}
	}

	private boolean hasFedAnyDino(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT 1 FROM dino_instance WHERE owner_user_id = ? AND last_fed_at IS NOT NULL LIMIT 1")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next();
			}
		} catch (SQLException e) {
			log.warn("missions: hasFedAnyDino({}) failed: {}", userId, e.toString());
			return false;
		}
	}

	private long count(String table, String column, long value) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?")) {
			ps.setLong(1, value);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getLong(1) : 0;
			}
		} catch (SQLException e) {
			log.warn("missions: count({}) failed: {}", table, e.toString());
			return 0;
		}
	}

	private void grantReward(long userId, Mission m) {
		if (m.rewardCoins() > 0) {
			players.addCoins(userId, m.rewardCoins(), "mission:" + m.id(), null);
		}
		if (m.rewardXp() > 0) {
			players.addXp(userId, m.rewardXp());
		}
		log.info("missions: awarded user={} mission={} (+{} coins, +{} xp)",
			userId, m.id(), m.rewardCoins(), m.rewardXp());
	}

	private void sendFollowUp(SlashCommandInteractionEvent event, List<Mission> awarded) {
		StringBuilder body = new StringBuilder();
		long totalCoins = 0;
		long totalXp = 0;
		for (Mission m : awarded) {
			body.append("• **").append(m.displayName()).append("** — +")
				.append(format(m.rewardCoins())).append(" coins, +")
				.append(format(m.rewardXp())).append(" XP\n");
			totalCoins += m.rewardCoins();
			totalXp += m.rewardXp();
		}
		if (awarded.size() > 1) {
			body.append("\n_Total: +").append(format(totalCoins)).append(" coins, +")
				.append(format(totalXp)).append(" XP._");
		}
		String title = awarded.size() == 1
			? "🎉  Mission complete"
			: "🎉  " + awarded.size() + " missions complete";
		EmbedBuilder embed = Embeds.success(title, body.toString());
		Embeds.brand(embed, event.getJDA());
		// Follow-up — separate from the command's own reply so we never
		// clobber whatever it sent. Ephemeral so it's only seen by the
		// player who triggered it.
		event.getHook().sendMessageEmbeds(embed.build()).setEphemeral(true).queue(
			ok -> {
			},
			err -> log.warn("missions: follow-up send failed: {}", err.toString()));
	}

	private static String format(long n) {
		return String.format(Locale.ROOT, "%,d", n);
	}
}
