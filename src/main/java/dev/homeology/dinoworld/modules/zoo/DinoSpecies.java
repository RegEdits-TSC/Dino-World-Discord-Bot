package dev.homeology.dinoworld.modules.zoo;

import java.util.OptionalInt;
import java.util.OptionalLong;

/**
 * One species of in-game collectible — a dinosaur, pterosaur, or marine
 * reptile. Loaded from a YAML file under
 * {@code src/main/resources/data/dinos/<id>.yaml} by {@link DinoCatalog}
 * at module load time.
 *
 * <p>Per-species YAMLs declare a {@code rarity} (one of the six
 * {@link RarityCatalog#KNOWN_IDS}) and pull defaults for incubation
 * duration and determined-egg cost from the matching {@link Rarity}.
 * {@link #incubationMinutesOverride} and {@link #determinedEggCostOverride}
 * let an individual species deviate without rewriting the rarity defaults.
 *
 * @param id                          stable kebab-case identifier (also the YAML filename)
 * @param displayName                 user-visible name (e.g. "Velociraptor")
 * @param category                    {@code dinosaur} | {@code pterosaur} | {@code marine_reptile}
 * @param rarity                      one of {@link RarityCatalog#KNOWN_IDS}
 * @param era                         geological era ("Late Cretaceous", "Jurassic", etc.)
 * @param tier                        progression tier 1–5 (legacy field, retained while balance settles)
 * @param baseCost                    legacy direct-purchase cost; superseded by egg pricing
 * @param baseIncomePerHour           coins generated per in-game hour at 100% happiness
 * @param popularity                  1–100 visitor draw — feeds park-rating math
 * @param danger                      1–100 escape risk / containment cost
 * @param biome                       required habitat ({@code forest}, {@code desert}, {@code marine}, {@code aerial}, {@code mountain}, {@code grassland})
 * @param description                 short flavor text
 * @param incubationMinutesOverride   per-species incubation override, empty means "use rarity default"
 * @param determinedEggCostOverride   per-species determined-egg cost override, empty means "use rarity default"
 */
public record DinoSpecies(
	String id,
	String displayName,
	String category,
	String rarity,
	String era,
	int tier,
	long baseCost,
	long baseIncomePerHour,
	int popularity,
	int danger,
	String biome,
	String description,
	OptionalInt incubationMinutesOverride,
	OptionalLong determinedEggCostOverride
) {
	/**
	 * Effective incubation minutes for this species, applying the rarity
	 * default if no override is set.
	 */
	public int effectiveIncubationMinutes(Rarity r) {
		return incubationMinutesOverride.orElse(r.incubationMinutes());
	}

	/**
	 * Effective determined-egg cost for this species, applying the rarity
	 * default if no override is set.
	 */
	public long effectiveDeterminedEggCost(Rarity r) {
		return determinedEggCostOverride.orElse(r.defaultDeterminedEggCost());
	}
}
