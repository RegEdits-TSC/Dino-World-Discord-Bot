package dev.homeology.dinoworld.modules.zoo.model;

import java.time.Instant;
import java.util.Optional;
import java.util.OptionalLong;

/**
 * Snapshot of an {@code egg_instance} row — a purchased-but-not-yet-hatched
 * (or audit-trail-of-already-hatched) egg.
 *
 * <p>{@link #speciesId} disambiguates the two egg flavors:
 * <ul>
 *   <li><b>Determined egg</b> — speciesId set at purchase. The user knows
 *       what they're getting; they paid the rarity's premium.</li>
 *   <li><b>Mystery egg</b> — speciesId empty until hatch, when the
 *       hatcher rolls a random species of {@link #rarity}.</li>
 * </ul>
 *
 * <p>{@link #hatchedAt} and {@link #hatchDinoId} are written when /hatch
 * runs successfully; pre-hatch they're empty. Rows are kept post-hatch so
 * the audit trail (and any future "egg history" view) is intact.
 *
 * <p>{@link #notifiedAt} is stamped by the {@code zoo.egg_ready_notify}
 * tick the first time an egg's {@code ready_at} has passed, so each egg
 * triggers exactly one "ready to hatch" DM regardless of bot uptime.
 *
 * @param id             primary key
 * @param ownerUserId    player who owns this egg
 * @param rarity         one of {@link dev.homeology.dinoworld.modules.zoo.RarityCatalog#KNOWN_IDS}
 * @param speciesId      empty for mystery eggs pre-hatch; always set after hatch
 * @param purchasedAt    when the egg was bought
 * @param readyAt        earliest /hatch instant — the user can't hatch before this
 * @param hatchedAt      when this egg was successfully hatched (empty pre-hatch)
 * @param hatchDinoId    id of the {@code dino_instance} this egg produced (empty pre-hatch)
 * @param notifiedAt     when the player was DM'd that this egg was ready (empty if not yet sent)
 */
public record EggInstance(
	long id,
	long ownerUserId,
	String rarity,
	Optional<String> speciesId,
	Instant purchasedAt,
	Instant readyAt,
	Optional<Instant> hatchedAt,
	OptionalLong hatchDinoId,
	Optional<Instant> notifiedAt
) {
	/**
	 * @return {@code true} if this egg has never been hatched (i.e. it's
	 *         either still incubating or ready to hatch)
	 */
	public boolean isPending() {
		return hatchedAt.isEmpty();
	}

	/**
	 * @param now current instant
	 * @return {@code true} if this egg is pending and {@link #readyAt} has passed
	 */
	public boolean isReadyAt(Instant now) {
		return isPending() && !now.isBefore(readyAt);
	}
}
