package dev.homeology.dinoworld.modules.staff;

/**
 * The cross-module read-only API for staff-driven effects. Other zoo
 * services consult this to learn whether a player or enclosure is currently
 * benefiting from a hire — e.g. the happiness decay tick asks if a vet is
 * assigned to an enclosure, the income tick asks if any marketer is
 * employed by a player.
 *
 * <p>Lookups go through {@link StaffMemberService} and {@link StaffCatalog};
 * results are derived per call rather than cached, because staff state
 * changes infrequently and the queries are small. If the staff module is
 * disabled, the {@code zoo} module's tryGet returns empty and consumers
 * substitute the no-op multipliers (1.0 decay, 1.0 income, 1.0 incubation)
 * by checking for null at the call site — see modified {@code HappinessTickService}
 * and {@code IncomeTickService}.
 */
public final class StaffEffectsService {

	/**
	 * Returned by all multiplier methods when no relevant staff are
	 * employed — keeps callers branch-free.
	 */
	public static final double IDENTITY = 1.0;

	private final StaffMemberService staff;
	private final StaffCatalog catalog;

	public StaffEffectsService(StaffMemberService staff, StaffCatalog catalog) {
		this.staff = staff;
		this.catalog = catalog;
	}

	// ─── per enclosure ───────────────────────────────────────────────────

	/**
	 * Multiplier applied to the per-tick happiness decay for dinos in the
	 * given enclosure. Returns the {@link StaffEffect.DecayReduce#multiplier()
	 * vet's multiplier} (the smallest, i.e. most beneficial) if any vet is
	 * assigned, otherwise {@link #IDENTITY}.
	 *
	 * <p>Multiple vets in one enclosure do <em>not</em> compound — a single
	 * vet already drops decay to its floor.
	 */
	public double happinessDecayMultiplier(long enclosureId) {
		double best = IDENTITY;
		for (StaffMember m : staff.findByEnclosure(enclosureId)) {
			StaffRole r = catalog.byId(m.roleId()).orElse(null);
			if (r == null) continue;
			if (r.effect() instanceof StaffEffect.DecayReduce dr) {
				if (dr.multiplier() < best) best = dr.multiplier();
			}
		}
		return best;
	}

	/**
	 * @return total auto-feed capacity across every Zookeeper assigned to
	 *         {@code enclosureId}. Multiple zookeepers stack; zero means
	 *         no zookeeper is on duty.
	 */
	public int autoFeedCapacity(long enclosureId) {
		int sum = 0;
		for (StaffMember m : staff.findByEnclosure(enclosureId)) {
			StaffRole r = catalog.byId(m.roleId()).orElse(null);
			if (r == null) continue;
			if (r.effect() instanceof StaffEffect.AutoFeed af) {
				sum += af.capacity();
			}
		}
		return sum;
	}

	// ─── per player (global-scope) ──────────────────────────────────────

	/**
	 * Multiplier applied to a freshly-purchased egg's incubation duration
	 * for {@code userId}. Stacks multiplicatively across scientists,
	 * floored by {@link StaffEffect.IncubationSpeed#floor()}.
	 *
	 * <p>Returns {@link #IDENTITY} when no scientist is employed, so callers
	 * can multiply unconditionally.
	 */
	public double incubationMultiplier(long userId) {
		double mult = IDENTITY;
		double floor = 0.0;
		for (StaffMember m : staff.findGlobalByOwner(userId)) {
			StaffRole r = catalog.byId(m.roleId()).orElse(null);
			if (r == null) continue;
			if (r.effect() instanceof StaffEffect.IncubationSpeed is) {
				mult *= is.perUnitMultiplier();
				if (is.floor() > floor) floor = is.floor();
			}
		}
		return Math.max(mult, floor);
	}

	/**
	 * Multiplier applied to a player's hourly dino income. Each marketer
	 * adds {@link StaffEffect.IncomeMultiplier#perUnitBonus()}, capped at
	 * {@link StaffEffect.IncomeMultiplier#cap()}.
	 *
	 * <p>Returns {@link #IDENTITY} when no marketer is employed.
	 */
	public double incomeMultiplier(long userId) {
		double bonus = 0.0;
		double cap = Double.MAX_VALUE;
		boolean any = false;
		for (StaffMember m : staff.findGlobalByOwner(userId)) {
			StaffRole r = catalog.byId(m.roleId()).orElse(null);
			if (r == null) continue;
			if (r.effect() instanceof StaffEffect.IncomeMultiplier im) {
				bonus += im.perUnitBonus();
				// Use the strictest cap declared (in practice all marketers
				// share one definition; this is defensive).
				if (im.cap() < cap) cap = im.cap();
				any = true;
			}
		}
		if (!any) return IDENTITY;
		double total = IDENTITY + bonus;
		return Math.min(total, cap);
	}

	/**
	 * Sum of {@link StaffRole#wagePerHour()} across every staff member
	 * owned by {@code userId}. Returns 0 when the player has no staff
	 * (and therefore no wage drain).
	 *
	 * <p>Used by {@code /zoo income} to project net gain/loss without
	 * having to reach into the wages tick service for the same arithmetic
	 * the wage payment loop already performs.
	 */
	public long totalWagesPerHour(long userId) {
		long total = 0L;
		for (StaffMember m : staff.findByOwner(userId)) {
			StaffRole r = catalog.byId(m.roleId()).orElse(null);
			if (r != null) total += r.wagePerHour();
		}
		return total;
	}

	/**
	 * Number of staff members owned by {@code userId} — exposed as a
	 * cross-module convenience so consumers like {@code /zoo income}
	 * don't need to import {@link StaffMemberService} directly.
	 */
	public int staffCountForOwner(long userId) {
		return staff.findByOwner(userId).size();
	}
}
