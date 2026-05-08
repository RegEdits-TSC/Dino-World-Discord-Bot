package dev.homeology.dinoworld.lifecycle;

/**
 * Process exit codes used by Dino-World to signal intent to a supervising
 * process (run.sh / run.bat / systemd).
 *
 * <p>The supervisor distinguishes "stop for good" from "please relaunch" by
 * looking at the JVM's exit code — see {@code scripts/run.sh} and the
 * {@code RestartForceExitStatus=64} directive in {@code dinoworld.service}.
 */
public final class ExitCodes {

	/**
	 * Clean shutdown — the supervisor must NOT relaunch the bot.
	 */
	public static final int OK = 0;

	/**
	 * Restart requested — the supervisor SHOULD relaunch the bot.
	 * Triggered by the {@code /debug system restart} command.
	 */
	public static final int RESTART = 64;

	private ExitCodes() {
		// utility class
	}
}
