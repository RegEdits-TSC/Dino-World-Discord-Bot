package dev.homeology.dinoworld.modules.zoo;

/**
 * One rarity tier — a row from {@code data/rarities.yaml}.
 *
 * <p>Defines the per-rarity defaults used everywhere else: mystery-egg
 * price, determined-egg multiplier, incubation duration, hatch XP, and the
 * accent color used for embeds. Per-species YAMLs may override
 * {@code incubation_minutes} and {@code determined_egg_cost} individually.
 *
 * @param id                        lowercase identifier (also the YAML map key)
 * @param displayName               user-visible name (e.g. "Mythic")
 * @param color                     RGB int for embed accents
 * @param mysteryEggCost            coins per mystery egg of this rarity
 * @param determinedEggMultiplier   {@code mystery × multiplier = default determined cost}
 * @param incubationMinutes         default incubation duration; species can override
 * @param hatchXp                   XP awarded to the player on a successful hatch
 * @param minLevel                  minimum player level required to purchase eggs of this rarity;
 *                                  enforced by {@code EggService.buyMystery}/{@code buyDetermined}
 *                                  and surfaced in the shop UI as a lock indicator
 */
public record Rarity(
	String id,
	String displayName,
	int color,
	long mysteryEggCost,
	double determinedEggMultiplier,
	int incubationMinutes,
	int hatchXp,
	int minLevel
) {
	/**
	 * @return the default determined-egg cost for a species of this rarity
	 *         (rounded down to a whole coin).
	 */
	public long defaultDeterminedEggCost() {
		return (long) Math.floor(mysteryEggCost * determinedEggMultiplier);
	}
}
