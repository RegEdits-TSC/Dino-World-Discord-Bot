package dev.homeology.dinoworld.command;

import dev.homeology.dinoworld.config.AppConfig;
import net.dv8tion.jda.api.entities.Member;

import java.util.Set;

/**
 * Single source of truth for "may this user run this command".
 *
 * <p>Order of evaluation:
 * <ol>
 *   <li>If the invoker's user ID matches {@link AppConfig#developerId()},
 *       allow unconditionally — the developer bypass.</li>
 *   <li>If the command is {@link Command#devOnly()}, deny.</li>
 *   <li>Otherwise verify the member holds every permission in
 *       {@link Command#requiredPerms()}.</li>
 * </ol>
 *
 * <p>This is the runtime authority. Discord-side {@code DefaultMemberPermissions}
 * is a complementary UI hint — a server admin who hasn't been granted a
 * Discord permission may still <em>see</em> a command but will be denied
 * here at execution.
 */
public final class PermissionGate {

	/**
	 * Possible outcomes of a permission check.
	 */
	public enum Decision {
		ALLOW,
		DENY_DEV_ONLY,
		DENY_MISSING_PERMS
	}

	private final long developerId;

	public PermissionGate(long developerId) {
		this.developerId = developerId;
	}

	/**
	 * Convenience constructor for production wiring.
	 */
	public PermissionGate(AppConfig config) {
		this(config.developerId());
	}

	/**
	 * Evaluate the gate for an invocation.
	 *
	 * @param invokerId Discord user ID of the invoker (must always be supplied)
	 * @param member    the {@link Member} object — may be {@code null} if the
	 *                  command was invoked from a context without a guild
	 *                  member (e.g. DMs); permission checks then act as if
	 *                  the member has no permissions
	 * @param command   the command being invoked
	 * @return the decision
	 */
	public Decision check(long invokerId, Member member, Command command) {
		if (invokerId == developerId) return Decision.ALLOW;
		if (command.devOnly()) return Decision.DENY_DEV_ONLY;

		Set<net.dv8tion.jda.api.Permission> required = command.requiredPerms();
		if (required.isEmpty()) return Decision.ALLOW;
		if (member == null) return Decision.DENY_MISSING_PERMS;
		return member.hasPermission(required) ? Decision.ALLOW : Decision.DENY_MISSING_PERMS;
	}

	/**
	 * @return human-readable reason text for an ephemeral denial reply
	 */
	public static String denialMessage(Decision decision) {
		return switch (decision) {
			case DENY_DEV_ONLY -> "This command is restricted to the bot developer.";
			case DENY_MISSING_PERMS -> "You don't have permission to use this command.";
			case ALLOW -> ""; // not used
		};
	}
}
