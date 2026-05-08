package dev.homeology.dinoworld.modules.zoo;

/**
 * Base type for every game-specific runtime failure that should surface
 * to the player as a friendly embed rather than a generic "something went
 * wrong" stack-trace.
 *
 * <p>Subclasses carry a fixed {@link #userTitle()} (e.g. "Already hatched",
 * "Not enough coins") which {@link ZooComponentHandler} and
 * {@link HatchCommand} use as the embed title; the constructor's {@code
 * message} becomes the embed body. This keeps the catch-side handler
 * simple — one {@code catch (GameException ex)} block instead of one per
 * subtype — and makes adding a new exception type a one-file change.
 *
 * <p>Anything that <em>isn't</em> game logic (DB outage, programming bug,
 * unexpected state) should still throw {@link IllegalStateException} or a
 * lower-level exception so it bubbles up through the developer-DM error
 * path; {@code GameException} is reserved for predictable, user-actionable
 * conditions.
 */
public abstract class GameException extends RuntimeException {

	private final String userTitle;

	/**
	 * @param userTitle short embed-title text shown to the player
	 * @param message   embed-body text; describes the specific instance
	 */
	protected GameException(String userTitle, String message) {
		super(message);
		this.userTitle = userTitle;
	}

	/**
	 * @return the embed title appropriate for this failure type
	 */
	public String userTitle() {
		return userTitle;
	}
}
