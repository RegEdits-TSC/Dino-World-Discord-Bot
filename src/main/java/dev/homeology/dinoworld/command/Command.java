package dev.homeology.dinoworld.command;

import net.dv8tion.jda.api.Permission;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;

import java.util.Set;

/**
 * One slash command implementation.
 *
 * <p>Modules expose their commands via {@link dev.homeology.dinoworld.core.Module#commands()}.
 * The {@link CommandRegistry} collects {@link #slashData()} from every command
 * and pushes the union to Discord; the {@link CommandRouter} resolves
 * incoming events to a {@code Command} by name and invokes
 * {@link #execute(SlashCommandInteractionEvent, CommandContext)} after the
 * {@link PermissionGate} has signed off.
 */
public interface Command {

	/**
	 * @return the JDA description of this command (name, options, default
	 * permissions). Built fresh every call — implementations
	 * typically construct it inline.
	 */
	SlashCommandData slashData();

	/**
	 * Run the command. Wrapped by {@link CommandRouter} in MDC tags and a
	 * try/catch that turns uncaught exceptions into a generic ephemeral
	 * reply plus a developer DM, so implementations don't need to defend
	 * themselves from thrown {@code Exception} as long as the failure is
	 * acceptable to surface that way.
	 *
	 * @param event the JDA interaction event
	 * @param ctx   shared facilities (config, db, cache, scheduler, etc.)
	 */
	void execute(SlashCommandInteractionEvent event, CommandContext ctx);

	/**
	 * @return true if only the developer (configured {@code DEVELOPER_ID})
	 * may invoke this command; non-developers get an ephemeral
	 * "denied" reply
	 */
	default boolean devOnly() {
		return false;
	}

	/**
	 * @return Discord member permissions required to invoke this command
	 * (skipped entirely when the invoker is the developer)
	 */
	default Set<Permission> requiredPerms() {
		return Set.of();
	}

	/**
	 * Whether the auto-defer (if it fires) should mark the deferred reply
	 * ephemeral. Defaults to {@code true} so accidentally slow commands
	 * don't leak followups visibly. Override to {@code false} for commands
	 * whose replies are public (e.g. {@code /ping}).
	 */
	default boolean deferEphemeral() {
		return true;
	}

	/**
	 * @return the bucket this command appears under in {@code /help}.
	 * Defaults to {@link CommandCategory#GENERAL}; developer-only
	 * commands should override to {@link CommandCategory#DEVELOPER}
	 * so they're hidden from non-developers in the help listing.
	 */
	default CommandCategory category() {
		return CommandCategory.GENERAL;
	}
}
