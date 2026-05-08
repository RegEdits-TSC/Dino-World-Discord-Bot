package dev.homeology.dinoworld.modules.zoo;

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
 *   rating = round(base × multiplier)
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

	private final DinoInstanceService dinos;
	private final EnclosureService enclosures;
	private final DinoCatalog catalog;

	public ParkRatingService(DinoInstanceService dinos,
	                         EnclosureService enclosures,
	                         DinoCatalog catalog) {
		this.dinos = dinos;
		this.enclosures = enclosures;
		this.catalog = catalog;
	}

	/**
	 * Compute the park rating snapshot for one player.
	 */
	public ParkRating compute(long ownerUserId) {
		List<DinoInstance> owned = dinos.findByOwner(ownerUserId);
		if (owned.isEmpty()) {
			return new ParkRating(0L, 0L, 0, 0, false, 1.0);
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
		double multiplier = 1.0
			+ 0.10 * categoryCount
			+ 0.05 * rarityCount
			+ (allBiomesMatch ? 0.10 : 0.0);

		long rating = Math.round(base * multiplier);
		return new ParkRating(rating, base, categoryCount, rarityCount, allBiomesMatch, multiplier);
	}

	/**
	 * Snapshot of one rating computation.
	 *
	 * @param rating              final big number — sum-of-bases × multiplier
	 * @param base                raw sum before multipliers
	 * @param distinctCategories  number of unique categories owned (0–3)
	 * @param distinctRarities    number of unique rarity tiers owned (0–6)
	 * @param allBiomesMatch      true iff every dino is in a biome-matching enclosure
	 * @param multiplier          combined bonus multiplier applied to base
	 */
	public record ParkRating(
		long rating,
		long base,
		int distinctCategories,
		int distinctRarities,
		boolean allBiomesMatch,
		double multiplier
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
