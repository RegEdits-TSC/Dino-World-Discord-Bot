package dev.homeology.dinoworld.core;

import dev.homeology.dinoworld.command.Command;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;

/**
 * Discovers, lifecycles, and exposes the bot's modules.
 *
 * <p>Discovery is via {@link ServiceLoader} reading
 * {@code META-INF/services/dev.homeology.dinoworld.core.Module}. Discovered
 * modules are sorted alphabetically by {@link Module#name()} so processing
 * order is deterministic across builds and hosts (anyone who needs explicit
 * ordering can add a {@code priority()} method later — non-breaking).
 *
 * <p>Modules whose lowercased name appears in {@code DISABLED_MODULES} are
 * skipped entirely — neither {@code onLoad} nor {@code onEnable} run.
 */
public final class ModuleManager {

	private static final Logger log = LoggerFactory.getLogger(ModuleManager.class);

	private final List<Module> active = new ArrayList<>();

	/**
	 * Discover modules via SPI, filtering out those listed in {@code DISABLED_MODULES}.
	 */
	public List<Module> discover(Set<String> disabledModuleNames) {
		List<Module> all = new ArrayList<>();
		for (Module m : ServiceLoader.load(Module.class)) {
			all.add(m);
		}
		all.sort(Comparator.comparing(Module::name, String.CASE_INSENSITIVE_ORDER));

		List<Module> kept = new ArrayList<>();
		for (Module m : all) {
			String lower = m.name().toLowerCase(Locale.ROOT);
			if (disabledModuleNames.contains(lower)) {
				log.info("Module '{}' disabled by config -- skipping", lower);
			} else {
				kept.add(m);
			}
		}
		log.info("Discovered {} module(s); {} active after DISABLED_MODULES filter",
			all.size(), kept.size());
		return kept;
	}

	/**
	 * Drive {@link Module#onLoad(ModuleContext)} on each active module.
	 */
	public void loadAll(List<Module> modules, ModuleContext ctx) {
		for (Module m : modules) {
			try {
				log.debug("onLoad: {}", m.name());
				m.onLoad(ctx);
				active.add(m);
			} catch (Exception e) {
				throw new IllegalStateException(
					"Module '" + m.name() + "' failed during onLoad", e);
			}
		}
	}

	/**
	 * Drive {@link Module#onEnable()} on every loaded module.
	 */
	public void enableAll() {
		for (Module m : active) {
			try {
				log.debug("onEnable: {}", m.name());
				m.onEnable();
			} catch (Exception e) {
				log.error("Module '{}' threw during onEnable; continuing", m.name(), e);
			}
		}
		log.info("All modules enabled");
	}

	/**
	 * Drive {@link Module#onDisable()} in reverse order; never throws.
	 */
	public void disableAll() {
		for (int i = active.size() - 1; i >= 0; i--) {
			Module m = active.get(i);
			try {
				log.debug("onDisable: {}", m.name());
				m.onDisable();
			} catch (Exception e) {
				log.warn("Module '{}' threw during onDisable; continuing", m.name(), e);
			}
		}
	}

	/**
	 * @return immutable list of active modules in load order
	 */
	public List<Module> active() {
		return List.copyOf(active);
	}

	/**
	 * Aggregate every module's commands into a single list.
	 */
	public List<Command> aggregateCommands() {
		List<Command> out = new ArrayList<>();
		for (Module m : active) out.addAll(m.commands());
		return out;
	}

	/**
	 * Aggregate every module's JDA listener objects.
	 */
	public List<Object> aggregateListeners() {
		List<Object> out = new ArrayList<>();
		for (Module m : active) out.addAll(m.listeners());
		return out;
	}
}
