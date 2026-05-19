package dev.homeology.dinoworld.modules.achievements;

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
 * In-memory catalog of {@link Achievement} entries loaded from YAML at
 * module startup. Mirrors {@code MissionCatalog} — fail-fast on missing
 * or malformed input so typos in the YAML surface as a startup error
 * rather than silently dropping an achievement.
 *
 * <p>Currently ships a single {@code data/achievements/v1.yaml}. Adding
 * future tiers means dropping another YAML file alongside it and adding
 * its path to {@link #SHIPPED_CATALOGS}.
 */
public final class AchievementCatalog {

	private static final Logger log = LoggerFactory.getLogger(AchievementCatalog.class);

	/**
	 * YAML files loaded at startup, in {@code /achievements} listing
	 * order. Add new catalogs here.
	 */
	private static final List<String> SHIPPED_CATALOGS = List.of(
		"data/achievements/v1.yaml"
	);

	private final Map<String, Achievement> byId = new LinkedHashMap<>();
	private final Map<String, Achievement> byTitle = new LinkedHashMap<>();
	private final List<AchievementSet> sets;

	public AchievementCatalog() {
		this(Thread.currentThread().getContextClassLoader(), SHIPPED_CATALOGS);
	}

	/** Test seam — load specific resource paths, e.g. fixtures. */
	AchievementCatalog(ClassLoader cl, List<String> resourcePaths) {
		var loaded = new java.util.ArrayList<AchievementSet>();
		for (String path : resourcePaths) {
			AchievementSet set = loadOne(cl, path);
			loaded.add(set);
			for (Achievement a : set.achievements()) {
				if (byId.put(a.id(), a) != null) {
					throw new IllegalStateException(
						"duplicate achievement id '" + a.id() + "' across catalogs");
				}
				if (byTitle.put(a.title().toLowerCase(java.util.Locale.ROOT), a) != null) {
					throw new IllegalStateException(
						"duplicate achievement title '" + a.title() + "' across catalogs");
				}
			}
		}
		this.sets = List.copyOf(loaded);
		log.info("AchievementCatalog loaded {} catalog(s), {} achievement(s) total",
			sets.size(), byId.size());
	}

	private static AchievementSet loadOne(ClassLoader cl, String path) {
		try (InputStream in = cl.getResourceAsStream(path)) {
			if (in == null) {
				throw new IllegalStateException("Missing required achievements catalog: " + path);
			}
			try (InputStreamReader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
				Map<String, Object> raw = new Yaml().load(reader);
				if (raw == null) throw new IllegalStateException(path + " is empty");
				return parseSet(raw, path);
			}
		} catch (Exception e) {
			throw new IllegalStateException("Failed to load achievement catalog " + path, e);
		}
	}

	@SuppressWarnings("unchecked")
	private static AchievementSet parseSet(Map<String, Object> raw, String path) {
		String catalogId = requireString(raw, "catalog_id", path);
		String displayName = requireString(raw, "display_name", path);
		String description = optionalString(raw, "description", "");

		Object node = raw.get("achievements");
		if (!(node instanceof List<?> rawList)) {
			throw new IllegalStateException(path + ": missing or malformed 'achievements' list");
		}

		var parsed = new java.util.ArrayList<Achievement>();
		for (Object entry : rawList) {
			if (!(entry instanceof Map<?, ?> map)) {
				throw new IllegalStateException(path + ": achievement entry must be a map");
			}
			Map<String, Object> m = (Map<String, Object>) map;
			String id = catalogId + "." + requireString(m, "id", path);
			String dn = requireString(m, "display_name", path);
			String desc = optionalString(m, "description", "");
			String title = requireString(m, "title", path);
			String triggerRaw = requireString(m, "trigger", path);
			AchievementTrigger trigger = AchievementTrigger.parse(triggerRaw);
			long coins = requireLong(m, "reward_coins", path);
			long xp = requireLong(m, "reward_xp", path);
			parsed.add(new Achievement(id, dn, desc, title, trigger, coins, xp));
		}
		return new AchievementSet(catalogId, displayName, description, List.copyOf(parsed));
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

	/** Look up by fully-qualified id ({@code <catalog_id>.<achievement_id>}). */
	public Optional<Achievement> byId(String id) {
		return Optional.ofNullable(byId.get(id));
	}

	/** Look up by display title — case-insensitive. Used by /achievements equip. */
	public Optional<Achievement> byTitle(String title) {
		if (title == null || title.isBlank()) return Optional.empty();
		return Optional.ofNullable(byTitle.get(title.toLowerCase(java.util.Locale.ROOT)));
	}

	/** Every achievement across every catalog, in YAML declaration order. */
	public List<Achievement> all() {
		return List.copyOf(byId.values());
	}

	/** Every loaded catalog in registration order. */
	public List<AchievementSet> sets() {
		return sets;
	}

	/** Total number of achievements — used by /profile's "X / N" line. */
	public int size() {
		return byId.size();
	}

	/**
	 * One YAML file's worth of achievements, kept together so the
	 * /achievements command can group its display.
	 */
	public record AchievementSet(
		String catalogId,
		String displayName,
		String description,
		List<Achievement> achievements
	) {
	}
}
