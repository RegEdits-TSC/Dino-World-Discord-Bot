package dev.homeology.dinoworld.modules.zoo.model;

import java.time.Instant;
import java.util.Optional;
import java.util.OptionalLong;

/**
 * Snapshot of a {@code dino_instance} row — one owned, hatched dinosaur.
 *
 * <p>Stats fall into three groups:
 * <ul>
 *   <li><b>Identity</b> — id, owner, species, enclosure assignment, optional
 *       custom name.</li>
 *   <li><b>Progression (placeholders for /battle)</b> — level, xp,
 *       currentHp. Stored now so the schema doesn't need to change when
 *       battle ships in v2.</li>
 *   <li><b>Income loop</b> — happiness (0–100), lastFedAt, lastDecayAt.
 *       The hourly tick uses these to compute coins/hour and to decay
 *       happiness toward zero.</li>
 * </ul>
 *
 * @param id            primary key
 * @param ownerUserId   player who owns this dino
 * @param speciesId     {@link dev.homeology.dinoworld.modules.zoo.DinoSpecies#id()} key
 * @param enclosureId   id of the enclosure currently housing this dino, or empty if homeless
 * @param customName    optional player-supplied name
 * @param level         current battle level (placeholder; stays 1 in v1)
 * @param xp            accumulated battle XP (placeholder; stays 0 in v1)
 * @param currentHp     persistent HP (placeholder; stays 100 in v1)
 * @param happiness     0–100; multiplied into income/hour
 * @param lastFedAt     when the player last fed this dino (cooldown source)
 * @param lastDecayAt   most recent happiness-decay tick instant for this dino
 * @param acquiredAt    when this dino was hatched
 */
public record DinoInstance(
	long id,
	long ownerUserId,
	String speciesId,
	OptionalLong enclosureId,
	Optional<String> customName,
	int level,
	long xp,
	int currentHp,
	int happiness,
	Optional<Instant> lastFedAt,
	Instant lastDecayAt,
	Instant acquiredAt
) {
}
