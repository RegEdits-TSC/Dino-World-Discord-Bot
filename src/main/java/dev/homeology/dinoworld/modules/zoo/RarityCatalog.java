package dev.homeology.dinoworld.modules.zoo;

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
 * In-memory map of every {@link Rarity} loaded from
 * {@code src/main/resources/data/rarities.yaml}.
 *
 * <p>The YAML structure is a top-level map keyed by rarity id (lowercase),
 * where each value is the rarity's configuration:
 *
 * <pre>{@code
 * common:
 *   display_name: Common
 *   color: 0x9D9D9D
 *   mystery_egg_cost: 200
 *   determined_egg_multiplier: 2.5
 *   incubation_minutes: 30
 *   hatch_xp: 10
 * }</pre>
 *
 * <p>Loaded once at module load. Missing or malformed file fails fast — the
 * game economy is unbalanced without rarity defaults, and silently
 * continuing would make every downstream lookup throw.
 */
public final class RarityCatalog {

	private static final Logger log = LoggerFactory.getLogger(RarityCatalog.class);
	private static final String RESOURCE_PATH = "data/rarities.yaml";

	/**
	 * The set of rarity ids the game recognises. Held as a constant so tests
	 * and validation paths can refer to it without instantiating a catalog.
	 */
	public static final List<String> KNOWN_IDS = List.of(
		"common", "uncommon", "rare", "epic", "legendary", "mythic");

	private final Map<String, Rarity> byId = new LinkedHashMap<>();

	public RarityCatalog() {
		this(Thread.currentThread().getContextClassLoader());
	}

	RarityCatalog(ClassLoader cl) {
		try (InputStream in = cl.getResourceAsStream(RESOURCE_PATH)) {
			if (in == null) {
				throw new IllegalStateException(
					"Missing required resource: " + RESOURCE_PATH);
			}
			Map<String, Object> raw = new Yaml().load(new InputStreamReader(in, StandardCharsets.UTF_8));
			if (raw == null) {
				throw new IllegalStateException(RESOURCE_PATH + " is empty");
			}
			for (String expected : KNOWN_IDS) {
				Object v = raw.get(expected);
				if (!(v instanceof Map)) {
					throw new IllegalStateException(
						"Missing rarity '" + expected + "' in " + RESOURCE_PATH);
				}
				@SuppressWarnings("unchecked")
				Map<String, Object> body = (Map<String, Object>) v;
				byId.put(expected, parse(expected, body));
			}
		} catch (java.io.IOException e) {
			throw new IllegalStateException("Failed to read " + RESOURCE_PATH, e);
		}
		log.info("RarityCatalog loaded {} rarities", byId.size());
	}

	/**
	 * @return the rarity by id, or empty if unknown
	 */
	public Optional<Rarity> byId(String id) {
		return Optional.ofNullable(byId.get(id == null ? null : id.toLowerCase()));
	}

	/**
	 * @return the rarity by id; throws if unknown. Use when the id has been
	 *         validated upstream (e.g. came from a species YAML the catalog
	 *         already accepted).
	 */
	public Rarity require(String id) {
		return byId(id).orElseThrow(() ->
			new IllegalStateException("Unknown rarity: " + id));
	}

	/**
	 * @return rarities in canonical order: common → mythic
	 */
	public List<Rarity> all() {
		return List.copyOf(byId.values());
	}

	/**
	 * @return number of loaded rarities (always 6 if validation passed)
	 */
	public int size() {
		return byId.size();
	}

	// ─── parsing ─────────────────────────────────────────────────────────

	private static Rarity parse(String id, Map<String, Object> raw) {
		String displayName = require(raw, "display_name", id);
		int color = parseColor(raw, id);
		long mysteryCost = requireLong(raw, "mystery_egg_cost", id, 0);
		double multiplier = requireDouble(raw, "determined_egg_multiplier", id, 1.0);
		int incubation = requireInt(raw, "incubation_minutes", id, 1);
		int hatchXp = requireInt(raw, "hatch_xp", id, 0);
		int minLevel = requireInt(raw, "min_level", id, 1);
		return new Rarity(id, displayName, color, mysteryCost, multiplier, incubation, hatchXp, minLevel);
	}

	private static int parseColor(Map<String, Object> raw, String id) {
		Object v = raw.get("color");
		if (v instanceof Number n) return n.intValue();
		if (v instanceof String s) {
			try {
				return Integer.decode(s);
			} catch (NumberFormatException e) {
				throw new IllegalStateException(
					"Rarity '" + id + "' color must be a hex/decimal int, got: " + s, e);
			}
		}
		throw new IllegalStateException("Rarity '" + id + "' is missing 'color'");
	}

	private static String require(Map<String, Object> raw, String key, String id) {
		Object v = raw.get(key);
		if (v == null || v.toString().isBlank()) {
			throw new IllegalStateException(
				"Rarity '" + id + "' is missing required field '" + key + "'");
		}
		return v.toString();
	}

	private static long requireLong(Map<String, Object> raw, String key, String id, long min) {
		Object v = raw.get(key);
		if (!(v instanceof Number n)) {
			throw new IllegalStateException(
				"Rarity '" + id + "' field '" + key + "' must be a number, got: " + v);
		}
		long x = n.longValue();
		if (x < min) {
			throw new IllegalStateException(
				"Rarity '" + id + "' field '" + key + "'=" + x + " must be >= " + min);
		}
		return x;
	}

	private static int requireInt(Map<String, Object> raw, String key, String id, int min) {
		return Math.toIntExact(requireLong(raw, key, id, min));
	}

	private static double requireDouble(Map<String, Object> raw, String key, String id, double min) {
		Object v = raw.get(key);
		if (!(v instanceof Number n)) {
			throw new IllegalStateException(
				"Rarity '" + id + "' field '" + key + "' must be a number, got: " + v);
		}
		double x = n.doubleValue();
		if (x < min) {
			throw new IllegalStateException(
				"Rarity '" + id + "' field '" + key + "'=" + x + " must be >= " + min);
		}
		return x;
	}
}
