package dev.homeology.dinoworld.modules.players;

import java.time.Instant;
import java.util.Optional;

/**
 * Snapshot of a row in the {@code player} table.
 *
 * <p>Returned by {@link PlayerService} read paths. Holds derived
 * {@link Instant}s rather than raw epoch millis so callers don't have to
 * convert at every read site. Cached values use this type directly.
 *
 * @param userId      Discord snowflake (primary key)
 * @param displayName the most recent display name we observed for this user
 * @param coins       current balance of the in-game currency (always ≥ 0 by convention)
 * @param xp          accumulated experience points (placeholder — not used in v1)
 * @param level       current level (placeholder — not used in v1; defaults to 1)
 * @param createdAt   when this row was first inserted; useful for "is this a new player?" detection
 * @param lastSeen    most recent interaction timestamp; refreshed on every {@code ensure(...)}
 * @param lastDaily   when this player last claimed {@code /daily}, or empty if never
 */
public record Player(
	long userId,
	String displayName,
	long coins,
	long xp,
	int level,
	Instant createdAt,
	Instant lastSeen,
	Optional<Instant> lastDaily
) {
}
