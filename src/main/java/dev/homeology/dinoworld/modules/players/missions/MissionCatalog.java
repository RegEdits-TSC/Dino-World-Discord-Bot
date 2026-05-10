package dev.homeology.dinoworld.modules.players.missions;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * In-memory catalog of every {@link Mission} loaded from YAML at module
 * startup. Mirrors the {@code StaffCatalog} / {@code DinoCatalog}
 * pattern — fail-fast on missing or malformed input so a typo in the
 * mission YAML surfaces as a startup error rather than silently
 * skipping a mission.
 *
 * <p>Currently loads a single {@code data/missions/tutorial.yaml} but
 * the loader is set-aware so additional sets (e.g. seasonal) drop in
 * as new YAML files in the same directory and a one-line entry in
 * {@link #SHIPPED_SETS}.
 */
public final class MissionCatalog {

	private static final Logger log = LoggerFactory.getLogger(MissionCatalog.class);

	/**
	 * YAML files loaded at startup, in the order they appear in
	 * {@code /missions} listings. Add new sets here.
	 */
	private static final List<String> SHIPPED_SETS = List.of(
		"data/missions/tutorial.yaml"
	);

	private final Map<String, Mission> byId = new LinkedHashMap<>();
	private final List<MissionSet> sets;

	public MissionCatalog() {
		this(Thread.currentThread().getContextClassLoader(), SHIPPED_SETS);
	}

	/** Test seam — load specific resource paths, e.g. fixtures. */
	MissionCatalog(ClassLoader cl, List<String> resourcePaths) {
		var loaded = new java.util.ArrayList<MissionSet>();
		for (String path : resourcePaths) {
			MissionSet set = loadOne(cl, path);
			loaded.add(set);
			for (Mission m : set.missions()) {
				if (byId.put(m.id(), m) != null) {
					throw new IllegalStateException(
						"duplicate mission id '" + m.id() + "' across mission sets");
				}
			}
		}
		this.sets = List.copyOf(loaded);
		log.info("MissionCatalog loaded {} set(s), {} mission(s) total",
			sets.size(), byId.size());
	}

	private static MissionSet loadOne(ClassLoader cl, String path) {
		try (InputStream in = cl.getResourceAsStream(path)) {
			if (in == null) {
				throw new IllegalStateException("Missing required mission set: " + path);
			}
			try (InputStreamReader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
				Map<String, Object> raw = new Yaml().load(reader);
				if (raw == null) throw new IllegalStateException(path + " is empty");
				return parseSet(raw, path);
			}
		} catch (Exception e) {
			throw new IllegalStateException("Failed to load mission set " + path, e);
		}
	}

	@SuppressWarnings("unchecked")
	private static MissionSet parseSet(Map<String, Object> raw, String path) {
		String setId = requireString(raw, "set_id", path);
		String setName = requireString(raw, "display_name", path);
		String setDesc = optionalString(raw, "description", "");

		Object missionsNode = raw.get("missions");
		if (!(missionsNode instanceof List<?> rawList)) {
			throw new IllegalStateException(path + ": missing or malformed 'missions' list");
		}

		var parsed = new java.util.ArrayList<Mission>();
		for (Object entry : rawList) {
			if (!(entry instanceof Map<?, ?> map)) {
				throw new IllegalStateException(path + ": mission entry must be a map");
			}
			Map<String, Object> m = (Map<String, Object>) map;
			String id = setId + "." + requireString(m, "id", path);
			String displayName = requireString(m, "display_name", path);
			String description = optionalString(m, "description", "");
			String triggerRaw = requireString(m, "trigger", path);
			MissionTrigger trigger = MissionTrigger.parse(triggerRaw);
			long coins = requireLong(m, "reward_coins", path);
			long xp = requireLong(m, "reward_xp", path);
			parsed.add(new Mission(id, displayName, description, trigger, coins, xp));
		}
		return new MissionSet(setId, setName, setDesc, List.copyOf(parsed));
	}

	private static String requireString(Map<String, Object> map, String key, String path) {
		Object v = map.get(key);
		if (!(v instanceof String s) || s.isBlank()) {
			throw new IllegalStateException(path + ": '" + key + "' missing or blank");
		}
		return s;
	}

	private static String optionalString(Map<String, Object> map, String key, String fallback) {
		Object v = map.get(key);
		return v instanceof String s ? s : fallback;
	}

	private static long requireLong(Map<String, Object> map, String key, String path) {
		Object v = map.get(key);
		if (v instanceof Number n) return n.longValue();
		throw new IllegalStateException(path + ": '" + key + "' must be a number");
	}

	/** Look up by fully-qualified id ({@code <set_id>.<mission_id>}). */
	public Optional<Mission> byId(String id) {
		return Optional.ofNullable(byId.get(id));
	}

	/** Every mission across every set, in YAML declaration order. */
	public List<Mission> all() {
		return List.copyOf(byId.values());
	}

	/** Every loaded set in registration order. */
	public List<MissionSet> sets() {
		return sets;
	}

	/**
	 * One YAML file's worth of missions, kept together so {@code /missions}
	 * can group its display.
	 */
	public record MissionSet(
		String setId,
		String displayName,
		String description,
		List<Mission> missions
	) {
	}
}
