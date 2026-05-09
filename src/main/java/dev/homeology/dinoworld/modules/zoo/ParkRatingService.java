package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.zoo.issues.ZooIssue;
import dev.homeology.dinoworld.modules.zoo.issues.ZooIssueService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Computes a player's park rating — a single big-number summary used by
 * {@code /zoo} and (eventually) the leaderboard.
 *
 * <p>Formula, applied in order:
 *
 * <pre>{@code
 *   base = sum(species.popularity × dino.happiness / 100)            // per-dino contribution
 *   multiplier = 1.0
 *              + 0.10 × distinctCategoriesOwned                      // up to +0.30
 *              + 0.05 × distinctRaritiesOwned                        // up to +0.30
 *              + (everyDinoInBiomeMatchedEnclosure ? 0.10 : 0)
 *              − min(0.05 × openCriticalIssues, 0.25)                // critical-issue penalty
 *   rating = round(base × max(0, multiplier))
 * }</pre>
 *
 * <p>The result struct exposes both the final score and each component
 * bonus separately so {@code /zoo} can render an explanation
 * ("Rating 1240 — +20% variety, +15% tier balance, +10% biome match").
 *
 * <p>No persistence — rating is derived from current {@code dino_instance}
 * and {@code enclosure} state, so a recompute on each /zoo invocation is
 * cheap and always correct.
 */
public final class ParkRatingService {

	/**
	 * Penalty per open critical issue, capped by {@link #ISSUE_PENALTY_CAP}.
	 * Warning-tier issues do <b>not</b> apply a penalty — only criticals
	 * (homeless dinos, fired staff, ≤12h wage runway) reduce rating, so
	 * the proactive 24h-runway warning never punishes attentive players.
	 */
	public static final double ISSUE_PENALTY_PER_CRITICAL = 0.05;

	/**
	 * Cap on the cumulative critical-issue penalty (5+ criticals plateau here).
	 */
	public static final double ISSUE_PENALTY_CAP = 0.25;

	private final DinoInstanceService dinos;
	private final EnclosureService enclosures;
	private final DinoCatalog catalog;
	private final ZooIssueService issues;

	public ParkRatingService(DinoInstanceService dinos,
	                         EnclosureService enclosures,
	                         DinoCatalog catalog) {
		this(dinos, enclosures, catalog, null);
	}

	/**
	 * @param issues optional — when provided, open critical issues subtract
	 *               from the multiplier per {@link #ISSUE_PENALTY_PER_CRITICAL}.
	 *               When null (e.g. legacy tests), penalty is skipped.
	 */
	public ParkRatingService(DinoInstanceService dinos,
	                         EnclosureService enclosures,
	                         DinoCatalog catalog,
	                         ZooIssueService issues) {
		this.dinos = dinos;
		this.enclosures = enclosures;
		this.catalog = catalog;
		this.issues = issues;
	}

	/**
	 * Compute the park rating snapshot for one player.
	 */
	public ParkRating compute(long ownerUserId) {
		List<DinoInstance> owned = dinos.findByOwner(ownerUserId);
		if (owned.isEmpty()) {
			return new ParkRating(0L, 0L, 0, 0, false, 1.0, 0.0);
		}

		List<Enclosure> ownedEnclosures = enclosures.findByOwner(ownerUserId);
		Map<Long, Enclosure> enclosureById = new HashMap<>();
		for (Enclosure e : ownedEnclosures) enclosureById.put(e.id(), e);

		long base = 0L;
		Set<String> categories = new HashSet<>();
		Set<String> raritiesPresent = new HashSet<>();
		boolean allBiomesMatch = true;

		for (DinoInstance d : owned) {
			Optional<DinoSpecies> speciesOpt = catalog.byId(d.speciesId());
			if (speciesOpt.isEmpty()) continue; // unknown species — skip rather than fail
			DinoSpecies s = speciesOpt.get();

			base += (long) s.popularity() * d.happiness() / 100L;
			categories.add(s.category());
			raritiesPresent.add(s.rarity());

			if (allBiomesMatch) {
				if (d.enclosureId().isEmpty()) {
					allBiomesMatch = false;
				} else {
					Enclosure e = enclosureById.get(d.enclosureId().getAsLong());
					if (e == null || !e.biome().equalsIgnoreCase(s.biome())) {
						allBiomesMatch = false;
					}
				}
			}
		}

		int categoryCount = categories.size();
		int rarityCount = raritiesPresent.size();
		double issuePenalty = 0.0;
		if (issues != null) {
			int criticals = issues.countOpenForOwner(ownerUserId, ZooIssue.Severity.CRITICAL);
			issuePenalty = Math.min(ISSUE_PENALTY_CAP, criticals * ISSUE_PENALTY_PER_CRITICAL);
		}

		double multiplier = 1.0
			+ 0.10 * categoryCount
			+ 0.05 * rarityCount
			+ (allBiomesMatch ? 0.10 : 0.0)
			- issuePenalty;

		long rating = Math.round(base * Math.max(0.0, multiplier));
		return new ParkRating(rating, base, categoryCount, rarityCount,
			allBiomesMatch, multiplier, issuePenalty);
	}

	/**
	 * Snapshot of one rating computation.
	 *
	 * @param rating              final big number — sum-of-bases × multiplier
	 * @param base                raw sum before multipliers
	 * @param distinctCategories  number of unique categories owned (0–3)
	 * @param distinctRarities    number of unique rarity tiers owned (0–6)
	 * @param allBiomesMatch      true iff every dino is in a biome-matching enclosure
	 * @param multiplier          combined bonus multiplier applied to base (after penalty)
	 * @param issuePenalty        positive fraction subtracted from the multiplier
	 *                            for open critical issues (0.0 – {@link #ISSUE_PENALTY_CAP})
	 */
	public record ParkRating(
		long rating,
		long base,
		int distinctCategories,
		int distinctRarities,
		boolean allBiomesMatch,
		double multiplier,
		double issuePenalty
	) {
		/**
		 * @return the bonus from category variety (0.00 – 0.30)
		 */
		public double varietyBonus() {
			return 0.10 * distinctCategories;
		}

		/**
		 * @return the bonus from rarity-tier diversity (0.00 – 0.30)
		 */
		public double tierBalanceBonus() {
			return 0.05 * distinctRarities;
		}

		/**
		 * @return the biome-matching bonus (0.00 or 0.10)
		 */
		public double biomeBonus() {
			return allBiomesMatch ? 0.10 : 0.0;
		}
	}
}
