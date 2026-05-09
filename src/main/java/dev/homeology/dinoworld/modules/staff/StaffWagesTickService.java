package dev.homeology.dinoworld.modules.staff;

import dev.homeology.dinoworld.modules.notify.NotificationService;
import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.IssueDetector;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Hourly tick that pays staff wages.
 *
 * <p>For each player with at least one staff member:
 * <ol>
 *   <li>Compute total wages owed.</li>
 *   <li>If the player can afford it, debit the full amount with reason
 *       {@code wages.tick} and stamp every member's {@code last_paid_at}.</li>
 *   <li>If not, fire staff one-by-one <b>highest-wage-first</b> (with
 *       most-recent-as-tie-breaker) until the surviving roster fits the
 *       balance, then debit the reduced wage. Each firing writes a
 *       {@code wages.unpaid:<roleId>} ledger entry and schedules a durable
 *       DM via {@link NotificationService}.</li>
 *   <li>If even firing everyone leaves the balance below the cheapest
 *       remaining wage, fire all of them, debit nothing, and DM once.</li>
 * </ol>
 *
 * <p>Bug-for-bug ordering: ledger entries are written before staff_member
 * deletion so {@code coin_ledger} survives even if delete fails (the
 * audit trail is the authoritative record).
 */
public final class StaffWagesTickService {

	private static final Logger log = LoggerFactory.getLogger(StaffWagesTickService.class);

	/** Ledger reason recorded for the bulk wage debit. */
	public static final String LEDGER_WAGES = "wages.tick";

	/** Ledger-reason prefix recorded when a staff member quits unpaid. */
	public static final String LEDGER_UNPAID_PREFIX = "wages.unpaid:";

	private final StaffMemberService staff;
	private final StaffCatalog catalog;
	private final PlayerService players;
	private final NotificationService notify;
	private final IssueDetector issueDetector;
	private final Clock clock;

	public StaffWagesTickService(StaffMemberService staff,
	                             StaffCatalog catalog,
	                             PlayerService players,
	                             NotificationService notify) {
		this(staff, catalog, players, notify, null, Clock.systemUTC());
	}

	/**
	 * Test seam — inject a fixed clock for deterministic last_paid_at.
	 * {@code issueDetector} may be null in unit tests that don't care
	 * about the issues table; production wiring always provides it.
	 */
	public StaffWagesTickService(StaffMemberService staff,
	                             StaffCatalog catalog,
	                             PlayerService players,
	                             NotificationService notify,
	                             Clock clock) {
		this(staff, catalog, players, notify, null, clock);
	}

	public StaffWagesTickService(StaffMemberService staff,
	                             StaffCatalog catalog,
	                             PlayerService players,
	                             NotificationService notify,
	                             IssueDetector issueDetector,
	                             Clock clock) {
		this.staff = staff;
		this.catalog = catalog;
		this.players = players;
		this.notify = notify;
		this.issueDetector = issueDetector;
		this.clock = clock;
	}

	public void runOnce() {
		List<StaffMember> all = staff.findAll();
		if (all.isEmpty()) return;

		// Group by owner so we process one player at a time.
		Map<Long, List<StaffMember>> byOwner = new HashMap<>();
		for (StaffMember m : all) {
			byOwner.computeIfAbsent(m.ownerUserId(), k -> new ArrayList<>()).add(m);
		}

		Instant now = clock.instant();
		for (Map.Entry<Long, List<StaffMember>> e : byOwner.entrySet()) {
			payOnePlayer(e.getKey(), e.getValue(), now);
		}
	}

	private void payOnePlayer(long userId, List<StaffMember> roster, Instant now) {
		Player p = players.get(userId).orElse(null);
		if (p == null) {
			log.warn("wages.tick: roster references unknown player {} — skipping", userId);
			return;
		}

		// Sort roster: highest wage first (cheapest survives), most-recent
		// hire as tie-breaker (older hires are loyal).
		roster.sort(Comparator
			.comparingLong((StaffMember m) -> wageOf(m))
			.reversed()
			.thenComparing(Comparator.comparing(StaffMember::hiredAt).reversed()));

		long balance = p.coins();
		long totalDue = 0;
		for (StaffMember m : roster) totalDue += wageOf(m);

		if (totalDue == 0) return;

		// Common case: can afford everything.
		if (balance >= totalDue) {
			players.addCoins(userId, -totalDue, LEDGER_WAGES, null);
			for (StaffMember m : roster) staff.markPaid(m.id(), now);
			log.info("wages.tick: paid {} coins for {} staff to user={}",
				totalDue, roster.size(), userId);
			// Roster is intact — assess runway against the still-full wage bill.
			if (issueDetector != null) {
				issueDetector.applyWageRunwayIssue(userId, balance - totalDue, totalDue);
			}
			return;
		}

		// Underpaid path: fire from the front (highest-wage) until what
		// remains fits the balance.
		long survivingDue = totalDue;
		List<StaffMember> fired = new ArrayList<>();
		int firedFromTop = 0;
		for (StaffMember m : roster) {
			if (balance >= survivingDue) break;
			survivingDue -= wageOf(m);
			fired.add(m);
			firedFromTop++;
		}

		// If even firing everyone leaves us short of the cheapest, fire all.
		// (firedFromTop will already equal roster.size() from the loop above
		// in that case; guard explicitly for clarity.)
		if (balance < survivingDue) {
			fired = new ArrayList<>(roster);
			survivingDue = 0;
		}

		// Apply firings: ledger entry first, then DM + issue snapshot, then delete the row.
		for (StaffMember m : fired) {
			StaffRole r = catalog.byId(m.roleId()).orElse(null);
			String roleLabel = r == null ? m.roleId() : r.displayName();
			players.addCoins(userId, 0, LEDGER_UNPAID_PREFIX + m.roleId(), null);
			scheduleQuitDm(userId, roleLabel, m.customName());
			if (issueDetector != null) {
				issueDetector.recordStaffQuit(userId, roleLabel, m.customName(), m.id());
			}
			staff.delete(m.id());
		}

		// Pay surviving roster, if any.
		if (survivingDue > 0) {
			players.addCoins(userId, -survivingDue, LEDGER_WAGES, null);
			for (StaffMember m : roster) {
				if (!fired.contains(m)) staff.markPaid(m.id(), now);
			}
		}
		log.info("wages.tick: user={} could not afford {} wages — fired {} (highest-wage-first), paid {} survivors {} coins",
			userId, totalDue, fired.size(), roster.size() - fired.size(), survivingDue);

		// Reassess runway against the surviving wage bill — could be 0 (everyone fired).
		if (issueDetector != null) {
			long balanceAfter = players.get(userId).map(Player::coins).orElse(balance - survivingDue);
			issueDetector.applyWageRunwayIssue(userId, balanceAfter, survivingDue);
		}
	}

	private long wageOf(StaffMember m) {
		StaffRole r = catalog.byId(m.roleId()).orElse(null);
		return r == null ? 0L : r.wagePerHour();
	}

	private void scheduleQuitDm(long userId, String roleLabel, java.util.Optional<String> customName) {
		String body = customName.isPresent()
			? "Your " + roleLabel + " (" + customName.get() + ") quit because wages weren't paid this hour.\n"
			+ "Top up your balance and `/staff hire " + roleLabel.toLowerCase() + "` again to bring them back."
			: "Your " + roleLabel + " quit because wages weren't paid this hour.\n"
			+ "Top up your balance and `/staff hire " + roleLabel.toLowerCase() + "` again to bring them back.";
		EmbedBuilder embed = Embeds.warning("💸  " + roleLabel + " quit", body);
		notify.schedule(userId, clock.instant(), embed.build());
	}
}
