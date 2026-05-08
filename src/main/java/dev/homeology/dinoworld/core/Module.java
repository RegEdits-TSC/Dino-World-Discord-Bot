package dev.homeology.dinoworld.core;

import dev.homeology.dinoworld.command.Command;

import java.util.List;

/**
 * A pluggable feature unit.
 *
 * <p>A module is the smallest deployable chunk of bot functionality. To add
 * a new feature:
 * <ol>
 *   <li>Drop a class implementing this interface under
 *       {@code modules/<name>/}.</li>
 *   <li>Add its fully-qualified class name to the SPI file
 *       {@code META-INF/services/dev.homeology.dinoworld.core.Module}.</li>
 *   <li>If the module needs persistent state, ship migrations under
 *       {@code db/migrations/<lowercased-name>/V*__*.sql}.</li>
 * </ol>
 *
 * <p>Lifecycle, in order: {@link #onLoad(ModuleContext)} →
 * {@link #onEnable()} → ... → {@link #onDisable()}. Modules are processed
 * alphabetically by {@link #name()} so ordering is deterministic across
 * builds.
 */
public interface Module {

	/**
	 * @return the module's stable name. Used for logging, the
	 * {@code DISABLED_MODULES} env toggle, the per-module migration
	 * folder, and {@code /debug system modules}. Should be lowercase
	 * alphanumeric.
	 */
	String name();

	/**
	 * Receive the shared facilities ({@link ModuleContext}) and any other
	 * one-time wiring. Migrations have already run by the time this is
	 * called. Avoid issuing JDA REST calls here — the bot may not be
	 * fully connected yet.
	 */
	default void onLoad(ModuleContext ctx) {
	}

	/**
	 * Called after every module has had {@link #onLoad}.
	 */
	default void onEnable() {
	}

	/**
	 * Called during clean shutdown, before JDA disconnects.
	 */
	default void onDisable() {
	}

	/**
	 * @return slash commands this module contributes; collected by
	 * {@link ModuleManager} and pushed to Discord by
	 * {@link dev.homeology.dinoworld.command.CommandRegistry}
	 */
	default List<Command> commands() {
		return List.of();
	}

	/**
	 * @return JDA listener objects (typically {@code ListenerAdapter}
	 * subclasses) this module wants registered. Registered on the
	 * JDA instance during bootstrap.
	 */
	default List<Object> listeners() {
		return List.of();
	}
}
