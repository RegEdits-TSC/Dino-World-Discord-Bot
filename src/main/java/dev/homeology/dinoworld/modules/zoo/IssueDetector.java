package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.zoo.issues.ZooIssue;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssueService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;

import java.util.Collection;
import java.util.Optional;
import java.util.OptionalLong;

/**
 * Glue layer that turns "an interesting condition just happened" calls
 * from tick services into raise/resolve writes against
 * {@link ZooIssueService}.
 *
 * <p>Owns every threshold constant in one place so the rules can be tuned
 * without touching the tick services that detect them.
 *
 * <p>Each method is idempotent — calling them every tick with stable
 * inputs is safe. {@link ZooIssueService#raise} UPSERTs against the open
 * row, and the resolve sweeps no-op on already-closed rows.
 */
public final class IssueDetector {

	/**
	 * Happiness ≤ this value raises a {@link ZooIssue.Type#LOW_HAPPINESS}
	 * issue. The threshold matches "noticeably unhappy" — about a day of
	 * unfed decay in the native biome (4%/hr × 25h ≈ 0).
	 */
	public static final int HAPPINESS_RAISE_AT = 25;

	/**
	 * Happiness ≥ this value auto-resolves an existing low_happiness
	 * issue. Hysteresis between {@link #HAPPINESS_RAISE_AT} and this value
	 * prevents the issue from flapping when a single feed nudges happiness
	 * back above the raise threshold by one point.
	 */
	public static final int HAPPINESS_CLEAR_AT = 35;

	/** target_kind constant for dino-targeted issues. */
	public static final String TARGET_DINO = "dino";

	/** target_kind constant for staff-targeted issues. */
	public static final String TARGET_STAFF = "staff";

	private final ZooIssueService issues;
	private final DinoCatalog catalog;
	private final IncomeTickService incomeTick;

	public IssueDetector(ZooIssueService issues, DinoCatalog catalog) {
		this(issues, catalog, null);
	}

	/**
	 * @param incomeTick used to derive {@code incomePerHour} for the wage
	 *                   runway calculation. May be null if the caller will
	 *                   only use the happiness/staff issue paths.
	 */
	public IssueDetector(ZooIssueService issues, DinoCatalog catalog,
	                     IncomeTickService incomeTick) {
		this.issues = issues;
		this.catalog = catalog;
		this.incomeTick = incomeTick;
	}

	// ─── happiness + homelessness ────────────────────────────────────────

	/**
	 * Sweep the freshly-decayed dino set: raise low_happiness / homeless
	 * issues for affected dinos, auto-resolve any open issue whose
	 * condition has cleared.
	 *
	 * <p>Called once per tick by {@link HappinessTickService} after the
	 * decay loop has applied its updates, so {@code dino.happiness}
	 * reflects this tick's value.
	 */
	public void applyHappinessIssues(Collection<DinoInstance> dinos) {
		for (DinoInstance d : dinos) {
			String name = displayName(d);

			// Low happiness: raise at threshold, clear at the higher hysteresis bound.
			if (d.happiness() <= HAPPINESS_RAISE_AT) {
				issues.raise(d.ownerUserId(),
					ZooIssue.Type.LOW_HAPPINESS,
					ZooIssue.Severity.WARNING,
					Optional.of(TARGET_DINO),
					OptionalLong.of(d.id()),
					"⚠️ " + name + "'s happiness is at " + d.happiness() + "% — feed them with `/feed`.");
			} else if (d.happiness() >= HAPPINESS_CLEAR_AT) {
				issues.resolveByMatch(d.ownerUserId(),
					ZooIssue.Type.LOW_HAPPINESS,
					Optional.of(TARGET_DINO),
					OptionalLong.of(d.id()));
			}

			// Homelessness: raise/clear based purely on enclosure assignment.
			if (d.enclosureId().isEmpty()) {
				issues.raise(d.ownerUserId(),
					ZooIssue.Type.HOMELESS_DINO,
					ZooIssue.Severity.CRITICAL,
					Optional.of(TARGET_DINO),
					OptionalLong.of(d.id()),
					"🚨 " + name + " has no enclosure — assign one with `/move`.");
			} else {
				issues.resolveByMatch(d.ownerUserId(),
					ZooIssue.Type.HOMELESS_DINO,
					Optional.of(TARGET_DINO),
					OptionalLong.of(d.id()));
			}
		}
	}

	// ─── staff ───────────────────────────────────────────────────────────

	/**
	 * Record a snapshot issue when a staff member quits because wages
	 * weren't paid. Manual-clear only — this records a past event so
	 * auto-resolve doesn't apply.
	 */
	public void recordStaffQuit(long userId, String roleLabel,
	                            Optional<String> customName, long staffIdSnapshot) {
		String label = customName.map(n -> roleLabel + " (" + n + ")").orElse(roleLabel);
		issues.raise(userId,
			ZooIssue.Type.STAFF_UNPAID,
			ZooIssue.Severity.CRITICAL,
			Optional.of(TARGET_STAFF),
			OptionalLong.of(staffIdSnapshot),
			"🚨 Your " + label + " quit because wages weren't paid this hour.");
	}

	// ─── wage runway ─────────────────────────────────────────────────────

	/**
	 * Convenience overload for callers that don't have an
	 * {@link IncomeTickService} reference handy. Falls back to
	 * {@code incomePerHour = 0} when no income service was wired in,
	 * which produces a strictly more conservative warning than the full
	 * computation.
	 */
	public void applyWageRunwayIssue(long userId, long balance, long wagesPerHour) {
		long income = incomeTick == null ? 0L : incomeTick.computeIncomeFor(userId);
		applyWageRunwayIssue(userId, balance, wagesPerHour, income);
	}

	/**
	 * Apply the tiered runway warning for one player after the wage tick
	 * has settled their balance.
	 *
	 * <p>The single open row for this player escalates in place between
	 * the 24h / 12h / 1h tiers as the situation worsens (UPSERT on the
	 * partial unique index). When income covers wages, or no staff remain,
	 * any open row is closed.
	 *
	 * @param userId        the player
	 * @param balance       balance after the wage tick
	 * @param wagesPerHour  total hourly wages owed by surviving roster
	 * @param incomePerHour total hourly income (after Marketer multiplier)
	 */
	public void applyWageRunwayIssue(long userId, long balance,
	                                 long wagesPerHour, long incomePerHour) {
		// No staff or income covers wages → balance trends up; nothing to warn about.
		if (wagesPerHour <= 0 || incomePerHour >= wagesPerHour) {
			issues.resolveByMatch(userId,
				ZooIssue.Type.WAGES_UNDERFUNDED,
				Optional.empty(),
				OptionalLong.empty());
			return;
		}

		long netDrainPerHour = wagesPerHour - incomePerHour;
		// Use floor-division: 1 coin short of 12 wages/hr → 0 hours of runway.
		long runwayHours = Math.max(0L, balance) / netDrainPerHour;

		if (runwayHours >= 24) {
			issues.resolveByMatch(userId,
				ZooIssue.Type.WAGES_UNDERFUNDED,
				Optional.empty(),
				OptionalLong.empty());
			return;
		}

		ZooIssue.Severity severity;
		String tierLabel;
		if (runwayHours < 1) {
			severity = ZooIssue.Severity.CRITICAL;
			tierLabel = "Less than 1 hour of wage runway — staff will quit next tick";
		} else if (runwayHours < 12) {
			severity = ZooIssue.Severity.CRITICAL;
			tierLabel = "Less than 12 hours of wage runway";
		} else {
			severity = ZooIssue.Severity.WARNING;
			tierLabel = "Less than 24 hours of wage runway";
		}

		String detail = "⏰ " + tierLabel + ". (balance: " + balance
			+ ", draining " + netDrainPerHour + "/hr)";

		issues.raise(userId,
			ZooIssue.Type.WAGES_UNDERFUNDED,
			severity,
			Optional.empty(),
			OptionalLong.empty(),
			detail);
	}

	// ─── helpers ─────────────────────────────────────────────────────────

	private String displayName(DinoInstance d) {
		return d.customName().orElseGet(() -> {
			DinoSpecies s = catalog == null ? null : catalog.byId(d.speciesId()).orElse(null);
			return (s == null ? d.speciesId() : s.displayName()) + " #" + d.id();
		});
	}
}
