package dev.homeology.dinoworld.modules.achievements;

import dev.homeology.dinoworld.modules.notify.NotificationService;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.players.missions.MissionCatalog;
import dev.homeology.dinoworld.modules.players.missions.MissionProgressService;
import dev.homeology.dinoworld.modules.zoo.DinoCatalog;
import dev.homeology.dinoworld.modules.zoo.DinoInstanceService;
import dev.homeology.dinoworld.modules.zoo.DinoSpecies;
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
 * Checks pending achievement triggers after a slash command has run,
 * unlocks any newly-satisfied achievements, grants their rewards, and
 * DMs the player.
 *
 * <p>Mirrors {@link dev.homeology.dinoworld.modules.players.missions.MissionAwarder}
 * in shape: called from
 * {@link dev.homeology.dinoworld.command.CommandRouter}'s worker thread
 * after each successful command execution; best-effort (router wraps
 * the call in its own try/catch).
 *
 * <p>Reaches into other modules' tables ({@code dino_instance},
 * {@code staff_member}, {@code mission_progress}, {@code coin_ledger})
 * via raw SQL for the state probes — production always loads those
 * modules so the dependency is acceptable.
 */
public final class AchievementAwarder {

	private static final Logger log = LoggerFactory.getLogger(AchievementAwarder.class);

	/** Ledger reason prefix used when granting an achievement coin reward. */
	public static final String LEDGER_REASON_PREFIX = "achievement:";

	/** Ledger reason recorded by the staff wages tick — pinned here to keep the trigger probe in sync. */
	private static final String LEDGER_REASON_WAGES = "wages.tick";

	private final DataSource dataSource;
	private final AchievementCatalog catalog;
	private final AchievementProgressService progress;
	private final PlayerService players;
	private final DinoCatalog dinoCatalog;
	private final MissionCatalog missionCatalog;
	private final MissionProgressService missionProgress;
	private final NotificationService notifications;

	public AchievementAwarder(DataSource dataSource,
	                          AchievementCatalog catalog,
	                          AchievementProgressService progress,
	                          PlayerService players,
	                          DinoCatalog dinoCatalog,
	                          MissionCatalog missionCatalog,
	                          MissionProgressService missionProgress,
	                          NotificationService notifications) {
		this.dataSource = dataSource;
		this.catalog = catalog;
		this.progress = progress;
		this.players = players;
		this.dinoCatalog = dinoCatalog;
		this.missionCatalog = missionCatalog;
		this.missionProgress = missionProgress;
		this.notifications = notifications;
	}

	/**
	 * Run the awarder pass after a slash command body has completed.
	 * The {@code event} is used only to send an ephemeral follow-up if
	 * any achievements unlock — pass {@code null} to skip the follow-up
	 * (e.g. when called from a tick or a test).
	 */
	public void afterCommand(SlashCommandInteractionEvent event) {
		long userId = event.getUser().getIdLong();
		List<Achievement> unlocked = detectAndAward(userId);
		if (unlocked.isEmpty()) return;
		sendFollowUp(event, unlocked);
		for (Achievement a : unlocked) sendUnlockDm(userId, a);
	}

	/**
	 * Pure detection — split out so tests can drive the awarder without
	 * a JDA event. Walks every achievement in catalog order, evaluates
	 * its trigger, INSERT-or-NO-OPs the progress row, and grants the
	 * reward only when our INSERT actually happened. Returns the
	 * achievements whose unlock fired this call (deduplicated across
	 * concurrent passes).
	 */
	public List<Achievement> detectAndAward(long userId) {
		Set<String> done = new HashSet<>(progress.unlockedFor(userId));
		List<Achievement> unlocked = new ArrayList<>();
		for (Achievement a : catalog.all()) {
			if (done.contains(a.id())) continue;
			if (!isSatisfied(a.trigger(), userId)) continue;
			if (!progress.markUnlocked(userId, a.id())) {
				done.add(a.id());
				continue;
			}
			grantReward(userId, a);
			autoEquipIfNoTitle(userId, a);
			unlocked.add(a);
			done.add(a.id());
		}
		return unlocked;
	}

	private boolean isSatisfied(AchievementTrigger trigger, long userId) {
		return switch (trigger) {
			case AchievementTrigger.Event e -> isEventSatisfied(e.kind(), userId);
			case AchievementTrigger.PlayerLevel pl -> playerLevelAtLeast(userId, pl.threshold());
			case AchievementTrigger.DinoLevel dl -> hasDinoAtLeastLevel(userId, dl.threshold());
			case AchievementTrigger.FeedsTotal ft -> feedsTotal(userId) >= ft.threshold();
			case AchievementTrigger.HatchesTotal ht -> count("dino_instance", "owner_user_id", userId) >= ht.threshold();
			case AchievementTrigger.KeepDinos kd -> count("dino_instance", "owner_user_id", userId) >= kd.threshold();
			case AchievementTrigger.OwnEnclosures oe -> count("enclosure", "owner_user_id", userId) >= oe.threshold();
			case AchievementTrigger.CoinsEarned ce -> lifetimeCoinsEarned(userId) >= ce.threshold();
			case AchievementTrigger.CoinsHeld ch -> coinsHeld(userId) >= ch.threshold();
			case AchievementTrigger.WagesPaid wp -> countWagePayments(userId) >= wp.threshold();
			case AchievementTrigger.HatchedRarity hr -> hasHatchedRarity(userId, hr.rarityId());
			case AchievementTrigger.TraitDiversity td -> distinctTraits(userId) >= td.threshold();
			case AchievementTrigger.TutorialComplete __ -> tutorialComplete(userId);
		};
	}

	// ─── state probes ───────────────────────────────────────────────────

	private boolean isEventSatisfied(AchievementTrigger.EventKind kind, long userId) {
		return switch (kind) {
			case FIRST_HATCH -> count("dino_instance", "owner_user_id", userId) > 0;
			case FIRST_SHINY -> existsBoolColumn("dino_instance", "owner_user_id", userId, "is_shiny", 1);
			case FIRST_FEED -> existsFedDino(userId);
			case FIRST_STAFF_HIRE -> count("staff_member", "owner_user_id", userId) > 0;
			case FIRST_ENCLOSURE -> count("enclosure", "owner_user_id", userId) >= 2; // starter + user-built
		};
	}

	private boolean playerLevelAtLeast(long userId, int threshold) {
		return players.get(userId).map(p -> p.level() >= threshold).orElse(false);
	}

	private boolean hasDinoAtLeastLevel(long userId, int threshold) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT 1 FROM dino_instance WHERE owner_user_id = ? AND level >= ? LIMIT 1")) {
			ps.setLong(1, userId);
			ps.setInt(2, threshold);
			try (ResultSet rs = ps.executeQuery()) { return rs.next(); }
		} catch (SQLException e) {
			log.warn("achievements: hasDinoAtLeastLevel({}) failed: {}", userId, e.toString());
			return false;
		}
	}

	/**
	 * Total player-initiated feeds, derived from per-dino XP. Feeding is
	 * the only XP source ({@link DinoInstanceService#FEED_XP_AWARD}-per-feed)
	 * so SUM(xp)/FEED_XP_AWARD across owned dinos is the count of feeds
	 * against currently-owned dinos. Sold dinos drop out of the sum —
	 * acceptable for an achievement milestone.
	 */
	private long feedsTotal(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COALESCE(SUM(xp), 0) FROM dino_instance WHERE owner_user_id = ?")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				long totalXp = rs.next() ? rs.getLong(1) : 0L;
				return totalXp / DinoInstanceService.FEED_XP_AWARD;
			}
		} catch (SQLException e) {
			log.warn("achievements: feedsTotal({}) failed: {}", userId, e.toString());
			return 0L;
		}
	}

	private long lifetimeCoinsEarned(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE user_id = ? AND delta > 0")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getLong(1) : 0L;
			}
		} catch (SQLException e) {
			log.warn("achievements: lifetimeCoinsEarned({}) failed: {}", userId, e.toString());
			return 0L;
		}
	}

	private long coinsHeld(long userId) {
		return players.get(userId).map(Player::coins).orElse(0L);
	}

	private long countWagePayments(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM coin_ledger WHERE user_id = ? AND reason = ?")) {
			ps.setLong(1, userId);
			ps.setString(2, LEDGER_REASON_WAGES);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getLong(1) : 0L;
			}
		} catch (SQLException e) {
			log.warn("achievements: countWagePayments({}) failed: {}", userId, e.toString());
			return 0L;
		}
	}

	private boolean hasHatchedRarity(long userId, String rarityId) {
		// Resolve species ids for the rarity once via DinoCatalog (in-memory map).
		List<DinoSpecies> pool = dinoCatalog.byRarity(rarityId);
		if (pool.isEmpty()) return false;
		// Build a parameter list — pool is bounded by catalog size.
		StringBuilder sb = new StringBuilder(
			"SELECT 1 FROM dino_instance WHERE owner_user_id = ? AND species_id IN (");
		for (int i = 0; i < pool.size(); i++) {
			if (i > 0) sb.append(',');
			sb.append('?');
		}
		sb.append(") LIMIT 1");
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(sb.toString())) {
			ps.setLong(1, userId);
			for (int i = 0; i < pool.size(); i++) ps.setString(i + 2, pool.get(i).id());
			try (ResultSet rs = ps.executeQuery()) { return rs.next(); }
		} catch (SQLException e) {
			log.warn("achievements: hasHatchedRarity({}, {}) failed: {}", userId, rarityId, e.toString());
			return false;
		}
	}

	private long distinctTraits(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(DISTINCT trait) FROM dino_instance WHERE owner_user_id = ? AND trait IS NOT NULL")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getLong(1) : 0L;
			}
		} catch (SQLException e) {
			log.warn("achievements: distinctTraits({}) failed: {}", userId, e.toString());
			return 0L;
		}
	}

	private boolean tutorialComplete(long userId) {
		long tutorialSize = missionCatalog.all().stream()
			.filter(m -> m.id().startsWith("tutorial."))
			.count();
		if (tutorialSize == 0) return false;
		long done = missionProgress.completedFor(userId).stream()
			.filter(id -> id.startsWith("tutorial."))
			.count();
		return done >= tutorialSize;
	}

	private long count(String table, String column, long value) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?")) {
			ps.setLong(1, value);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getLong(1) : 0L;
			}
		} catch (SQLException e) {
			log.warn("achievements: count({}) failed: {}", table, e.toString());
			return 0L;
		}
	}

	private boolean existsBoolColumn(String table, String column, long value,
	                                 String boolCol, int boolValue) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT 1 FROM " + table + " WHERE " + column + " = ? AND " + boolCol + " = ? LIMIT 1")) {
			ps.setLong(1, value);
			ps.setInt(2, boolValue);
			try (ResultSet rs = ps.executeQuery()) { return rs.next(); }
		} catch (SQLException e) {
			log.warn("achievements: existsBoolColumn({}) failed: {}", table, e.toString());
			return false;
		}
	}

	private boolean existsFedDino(long userId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT 1 FROM dino_instance WHERE owner_user_id = ? AND last_fed_at IS NOT NULL LIMIT 1")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) { return rs.next(); }
		} catch (SQLException e) {
			log.warn("achievements: existsFedDino({}) failed: {}", userId, e.toString());
			return false;
		}
	}

	// ─── reward + presentation ──────────────────────────────────────────

	private void grantReward(long userId, Achievement a) {
		if (a.rewardCoins() > 0) {
			players.addCoins(userId, a.rewardCoins(), LEDGER_REASON_PREFIX + a.id(), null);
		}
		if (a.rewardXp() > 0) {
			players.addXp(userId, a.rewardXp());
		}
		log.info("achievements: unlocked user={} id={} (+{} coins, +{} xp)",
			userId, a.id(), a.rewardCoins(), a.rewardXp());
	}

	private void autoEquipIfNoTitle(long userId, Achievement a) {
		players.get(userId).ifPresent(p -> {
			if (p.equippedTitle().isEmpty()) {
				players.setEquippedTitle(userId, a.title());
				log.info("achievements: auto-equipped title '{}' for user={}", a.title(), userId);
			}
		});
	}

	private void sendFollowUp(SlashCommandInteractionEvent event, List<Achievement> unlocked) {
		if (event == null) return;
		StringBuilder body = new StringBuilder();
		for (Achievement a : unlocked) {
			body.append("• 🏆 **").append(a.displayName()).append("** — title: _")
				.append(a.title()).append("_");
			if (a.rewardCoins() > 0 || a.rewardXp() > 0) {
				body.append(" (+").append(format(a.rewardCoins())).append(" coins, +")
					.append(format(a.rewardXp())).append(" XP)");
			}
			body.append('\n');
		}
		String title = unlocked.size() == 1
			? "🏆  Achievement unlocked"
			: "🏆  " + unlocked.size() + " achievements unlocked";
		EmbedBuilder embed = Embeds.success(title, body.toString());
		Embeds.brand(embed, event.getJDA());
		event.getHook().sendMessageEmbeds(embed.build()).setEphemeral(true).queue(
			ok -> {},
			err -> log.warn("achievements: follow-up send failed: {}", err.toString()));
	}

	private void sendUnlockDm(long userId, Achievement a) {
		if (notifications == null) return;
		EmbedBuilder e = Embeds.info("🏆  " + a.displayName(),
			a.description()
				+ "\n\n**Title earned:** _" + a.title() + "_"
				+ "\n\n_+" + format(a.rewardCoins()) + " coins, +"
				+ format(a.rewardXp()) + " XP_");
		notifications.dmNow(userId, e.build());
	}

	private static String format(long n) {
		return String.format(Locale.ROOT, "%,d", n);
	}
}
