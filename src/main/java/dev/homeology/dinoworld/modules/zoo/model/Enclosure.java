package dev.homeology.dinoworld.modules.zoo.model;

import java.time.Instant;
import java.util.Optional;

/**
 * Snapshot of an {@code enclosure} row — a habitat owned by a player.
 *
 * <p>Each player gets one starter enclosure (tier 1, biome "forest",
 * capacity 3) the first time they touch the zoo; subsequent enclosures
 * are bought via {@code /shop} and may be larger or biome-specialized.
 *
 * @param id           primary key
 * @param ownerUserId  player who owns this enclosure
 * @param biome        habitat type — must match a dino's required biome to count for the park-rating bonus
 * @param capacity     maximum number of dinos that can live here
 * @param tier         1–5; gates which species rarities the enclosure accepts
 * @param name         optional user-supplied label, empty until the player customizes it
 * @param createdAt    when this enclosure was built
 */
public record Enclosure(
	long id,
	long ownerUserId,
	String biome,
	int capacity,
	int tier,
	Optional<String> name,
	Instant createdAt
) {
}
