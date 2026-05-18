package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.staff.StaffEffectsService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Runs the hourly income tick — every owned dino contributes
 * {@code species.base_income_per_hour × dino.happiness / 100} coins,
 * aggregated per player into a single ledger entry per tick.
 *
 * <p>One ledger row per player per tick (rather than per dino) keeps
 * {@code coin_ledger} reasonable in volume — a player with 30 dinos still
 * produces 1 row per hour, not 30. The {@code reason} is
 * {@code income.tick} so audits can filter cleanly.
 *
 * <p>Players whose tick total rounds to zero (e.g. brand-new accounts with
 * no dinos, or a fleet of fully-unhappy dinos) get no addCoins call —
 * skipping them keeps the ledger empty until something interesting
 * happens.
 *
 * <p>Designed for direct invocation from a
 * {@link dev.homeology.dinoworld.scheduler.TickScheduler} job. The
 * scheduler's restart back-fill handles missed ticks: a 5-hour outage
 * triggers 5 calls to {@link #runOnce()} in series, each crediting one
 * hour of income.
 */
public final class IncomeTickService {

	private static final Logger log = LoggerFactory.getLogger(IncomeTickService.class);

	/**
	 * Ledger reason recorded for every income credit.
	 */
	public static final String LEDGER_REASON = "income.tick";

	private final DinoInstanceService dinos;
	private final DinoCatalog catalog;
	private final PlayerService players;
	private final StaffEffectsService staffEffects;

	public IncomeTickService(DinoInstanceService dinos,
	                         DinoCatalog catalog,
	                         PlayerService players) {
		this(dinos, catalog, players, null);
	}

	/**
	 * {@code staffEffects} may be null when the staff module is disabled,
	 * in which case income is not modified.
	 */
	public IncomeTickService(DinoInstanceService dinos,
	                         DinoCatalog catalog,
	                         PlayerService players,
	                         StaffEffectsService staffEffects) {
		this.dinos = dinos;
		this.catalog = catalog;
		this.players = players;
		this.staffEffects = staffEffects;
	}

	/**
	 * Compute the per-hour income one player would earn this tick — the
	 * sum across owned dinos of {@code species.baseIncomePerHour ×
	 * dino.happiness / 100}, scaled by the player's Marketer multiplier
	 * (1.0 if no Marketer is hired).
	 *
	 * <p>Pure derivation; does not write to the ledger or mutate state.
	 * Used by {@code IssueDetector.applyWageRunwayIssue} to project
	 * whether income offsets wages.
	 */
	public long computeIncomeFor(long userId) {
		List<DinoInstance> owned = dinos.findByOwner(userId);
		long base = 0L;
		for (DinoInstance d : owned) {
			Optional<DinoSpecies> speciesOpt = catalog.byId(d.speciesId());
			if (speciesOpt.isEmpty()) continue;
			long contribution = contributionFor(d, speciesOpt.get(), owned);
			if (contribution <= 0) continue;
			base += contribution;
		}
		if (base == 0) return 0L;
		double mult = staffEffects == null ? 1.0 : staffEffects.incomeMultiplier(userId);
		return mult == 1.0 ? base : Math.round(base * mult);
	}

	/**
	 * Aggregate one hour of income across all dinos and commit per-player.
	 */
	public void runOnce() {
		List<DinoInstance> all = dinos.findAll();
		if (all.isEmpty()) return;

		// Group by owner so the SOCIAL trait can count enclosure-mates
		// within the same owner without a per-dino query.
		Map<Long, List<DinoInstance>> byOwner = new HashMap<>();
		for (DinoInstance d : all) byOwner.computeIfAbsent(d.ownerUserId(), k -> new ArrayList<>()).add(d);

		Map<Long, Long> perPlayer = new HashMap<>();
		for (Map.Entry<Long, List<DinoInstance>> e : byOwner.entrySet()) {
			for (DinoInstance d : e.getValue()) {
				Optional<DinoSpecies> speciesOpt = catalog.byId(d.speciesId());
				if (speciesOpt.isEmpty()) continue;
				long contribution = contributionFor(d, speciesOpt.get(), e.getValue());
				if (contribution <= 0) continue;
				perPlayer.merge(d.ownerUserId(), contribution, Long::sum);
			}
		}
		if (perPlayer.isEmpty()) {
			log.debug("income.tick: no positive contributions");
			return;
		}
		long totalCredited = 0;
		int credited = 0;
		for (Map.Entry<Long, Long> e : perPlayer.entrySet()) {
			long payout = e.getValue();
			// Marketer effect: scale per-player payout by their income
			// multiplier (1.0 if no marketer is employed).
			if (staffEffects != null) {
				double mult = staffEffects.incomeMultiplier(e.getKey());
				if (mult != 1.0) payout = Math.round(payout * mult);
			}
			if (payout > 0) {
				players.addCoins(e.getKey(), payout, LEDGER_REASON, null);
				totalCredited += payout;
				credited++;
			}
		}
		log.info("income.tick credited {} player(s) total {} coins", credited, totalCredited);
	}

	/**
	 * Per-dino contribution before the per-player Marketer multiplier.
	 *
	 * <p>Multiplier order (applied left-to-right): species base × happiness
	 * × trait flat × SOCIAL bonus. Future shiny and level multipliers slot
	 * in between trait and Marketer — keep the chain documented when new
	 * factors are added.
	 *
	 * @param ownerRoster every dino owned by the same player; used by the
	 *                    SOCIAL trait to count enclosure-mates
	 */
	private long contributionFor(DinoInstance d, DinoSpecies species,
	                             List<DinoInstance> ownerRoster) {
		long baseContribution = (long) species.baseIncomePerHour() * d.happiness() / 100L;
		if (baseContribution <= 0) return 0L;

		DinoTrait trait = d.trait().orElse(null);
		if (trait == null) return baseContribution;

		double mult = trait.incomeMult();
		if (trait == DinoTrait.SOCIAL && d.enclosureId().isPresent()) {
			long enclosureId = d.enclosureId().getAsLong();
			int mates = 0;
			for (DinoInstance other : ownerRoster) {
				if (other.id() == d.id()) continue;
				if (other.enclosureId().isPresent() && other.enclosureId().getAsLong() == enclosureId) {
					mates++;
				}
			}
			mult *= trait.socialBonus(mates + 1); // +1 so the count includes d itself
		}
		return Math.round(baseContribution * mult);
	}
}
