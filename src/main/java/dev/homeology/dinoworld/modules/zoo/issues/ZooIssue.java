package dev.homeology.dinoworld.modules.zoo.issues;

import java.time.Instant;
import java.util.Optional;
import java.util.OptionalLong;

/**
 * One row in {@code zoo_issue} — a warning or critical condition raised
 * about a player's park (low-happiness dino, homeless dino, staff who
 * quit unpaid, wage runway approaching empty).
 *
 * <p>{@code targetKind} / {@code targetId} are nullable for per-player
 * issues like {@link Type#WAGES_UNDERFUNDED}; {@code resolvedAt} is empty
 * while the issue is open.
 */
public record ZooIssue(
	long id,
	long ownerUserId,
	Type type,
	Severity severity,
	Optional<String> targetKind,
	OptionalLong targetId,
	String detail,
	Instant firstSeenAt,
	Instant lastSeenAt,
	Optional<Instant> resolvedAt
) {

	/**
	 * Issue category. Stored as the lowercase enum name in
	 * {@code zoo_issue.issue_type}.
	 */
	public enum Type {
		/** Dino's happiness has dropped to or below the warning threshold. */
		LOW_HAPPINESS,
		/** Dino has no enclosure assigned. */
		HOMELESS_DINO,
		/** A staff member quit because wages weren't paid. */
		STAFF_UNPAID,
		/** Player's wage runway is below 24h (warning) or 12h/1h (critical). */
		WAGES_UNDERFUNDED;

		public String dbValue() {
			return name().toLowerCase();
		}

		public static Type fromDb(String s) {
			return Type.valueOf(s.toUpperCase());
		}
	}

	/**
	 * Display weight. Drives sort order in the issues embed and the
	 * park-rating penalty applied by {@code ParkRatingService}.
	 */
	public enum Severity {
		WARNING,
		CRITICAL;

		public String dbValue() {
			return name().toLowerCase();
		}

		public static Severity fromDb(String s) {
			return Severity.valueOf(s.toUpperCase());
		}
	}

	public boolean isOpen() {
		return resolvedAt.isEmpty();
	}
}
