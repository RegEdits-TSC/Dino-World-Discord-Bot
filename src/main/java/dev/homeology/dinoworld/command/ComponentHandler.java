package dev.homeology.dinoworld.command;

import net.dv8tion.jda.api.events.interaction.GenericInteractionCreateEvent;

/**
 * Handler for an interactive component (button, select menu, modal submit)
 * routed by {@link ComponentRouter}.
 *
 * <p>Invoked off the JDA event-pool thread on the same bounded executor
 * {@link CommandRouter} uses, so handler bodies may do blocking work
 * (database, JDA REST) without backpressuring the gateway. The router has
 * already verified rate limits, set MDC tags, and arranged auto-defer at
 * 2.0 s, so handlers can focus on the action.
 *
 * <p>The {@code event} parameter is the most general type that covers all
 * four supported interactions; cast to {@code ButtonInteractionEvent},
 * {@code StringSelectInteractionEvent}, {@code EntitySelectInteractionEvent},
 * or {@code ModalInteractionEvent} as needed. {@code args} is the
 * colon-delimited tail of the {@code custom_id} after the namespace prefix
 * (see {@link ComponentRouter} for the format).
 */
@FunctionalInterface
public interface ComponentHandler {

	/**
	 * @param event the JDA interaction event (cast to specific type as needed)
	 * @param args  the colon-delimited args from the {@code custom_id} after the namespace
	 * @param ctx   shared facilities (config, db, services, etc.)
	 */
	void handle(GenericInteractionCreateEvent event, String[] args, CommandContext ctx);
}
