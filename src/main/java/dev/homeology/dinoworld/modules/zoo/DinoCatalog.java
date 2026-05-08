package dev.homeology.dinoworld.modules.zoo;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.OptionalLong;
import java.util.regex.Pattern;

/**
 * In-memory catalog of every {@link DinoSpecies} loaded at startup from
 * {@code src/main/resources/data/dinos/*.yaml}.
 *
 * <p>One species per YAML file; the filename (sans extension) is the
 * authoritative {@code id}. Adding a species means dropping a new file in
 * the directory — no Java code changes, no migration, no rebuild of the
 * catalog itself. A bad/missing file fails the bot at module load
 * (intentional fail-fast — silently skipping a malformed species would
 * make game balance impossible to reason about).
 *
 * <p>Each species declares a {@code rarity} keyed against the
 * {@link RarityCatalog}; the catalog is passed in and validates every
 * loaded species so an unknown rarity surfaces here, not when the shop
 * tries to render it.
 *
 * <p>Discovery copies the {@code file:} / {@code jar:} listing dance from
 * {@link dev.homeology.dinoworld.database.MigrationRunner} so dev runs
 * (loose classpath dirs) and shadow-jar runs (packaged jar) both work
 * without configuration.
 */
public final class DinoCatalog {

	private static final Logger log = LoggerFactory.getLogger(DinoCatalog.class);
	private static final String RESOURCE_DIR = "data/dinos/";
	private static final Pattern YAML_FILE = Pattern.compile(".+\\.ya?ml$", Pattern.CASE_INSENSITIVE);

	private final RarityCatalog rarities;
	private final Map<String, DinoSpecies> byId = new LinkedHashMap<>();
	private final Map<String, List<DinoSpecies>> byRarity = new LinkedHashMap<>();

	public DinoCatalog(RarityCatalog rarities) {
		this(rarities, Thread.currentThread().getContextClassLoader());
	}

	DinoCatalog(RarityCatalog rarities, ClassLoader cl) {
		this.rarities = rarities;
		try {
			Enumeration<URL> roots = cl.getResources(RESOURCE_DIR);
			List<String> files = new ArrayList<>();
			while (roots.hasMoreElements()) {
				URL root = roots.nextElement();
				files.addAll(listYaml(root));
			}
			Collections.sort(files);

			Yaml yaml = new Yaml();
			for (String resourcePath : files) {
				try (InputStream in = cl.getResourceAsStream(resourcePath)) {
					if (in == null) {
						throw new IllegalStateException("Could not open resource: " + resourcePath);
					}
					try (InputStreamReader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
						Map<String, Object> raw = yaml.load(reader);
						if (raw == null) {
							throw new IllegalStateException("YAML file is empty: " + resourcePath);
						}
						DinoSpecies species = parse(resourcePath, raw);
						if (byId.containsKey(species.id())) {
							throw new IllegalStateException(
								"Duplicate dino id '" + species.id() + "' in " + resourcePath);
						}
						byId.put(species.id(), species);
					}
				} catch (IOException e) {
					throw new IllegalStateException("Failed to read " + resourcePath, e);
				}
			}
		} catch (IOException e) {
			throw new IllegalStateException("Could not enumerate dino catalog directory", e);
		}

		if (byId.isEmpty()) {
			throw new IllegalStateException(
				"DinoCatalog is empty — at least one .yaml file expected under " + RESOURCE_DIR);
		}

		// Index by rarity in canonical order, alphabetical within rarity.
		for (String r : RarityCatalog.KNOWN_IDS) {
			List<DinoSpecies> bucket = new ArrayList<>();
			for (DinoSpecies s : byId.values()) {
				if (s.rarity().equals(r)) bucket.add(s);
			}
			bucket.sort(Comparator.comparing(DinoSpecies::displayName));
			byRarity.put(r, List.copyOf(bucket));
		}

		log.info("DinoCatalog loaded {} species: {}", byId.size(), byId.keySet());
	}

	/**
	 * @return species by stable id, or empty if not loaded
	 */
	public Optional<DinoSpecies> byId(String id) {
		return Optional.ofNullable(byId.get(id));
	}

	/**
	 * @return every loaded species in load (alphabetical filename) order
	 */
	public List<DinoSpecies> all() {
		return List.copyOf(byId.values());
	}

	/**
	 * @return every species of a given rarity, sorted by display name.
	 *         Returns empty list (not null) for an unknown rarity.
	 */
	public List<DinoSpecies> byRarity(String rarity) {
		return byRarity.getOrDefault(rarity == null ? "" : rarity.toLowerCase(), List.of());
	}

	/**
	 * @return number of loaded species
	 */
	public int size() {
		return byId.size();
	}

	// ─── parsing ─────────────────────────────────────────────────────────

	private DinoSpecies parse(String resourcePath, Map<String, Object> raw) {
		String filename = Path.of(resourcePath).getFileName().toString();
		String defaultId = filename.replaceFirst("\\.[^.]+$", "");

		String id = str(raw, "id", defaultId);
		String displayName = require(raw, "display_name", resourcePath);
		String category = require(raw, "category", resourcePath);
		String rarity = require(raw, "rarity", resourcePath).toLowerCase();
		String era = str(raw, "era", "Unknown");
		int tier = intRange(raw, "tier", resourcePath, 1, 5);
		long baseCost = longAtLeastZero(raw, "base_cost", resourcePath);
		long baseIncome = longAtLeastZero(raw, "base_income_per_hour", resourcePath);
		int popularity = intRange(raw, "popularity", resourcePath, 1, 100);
		int danger = intRange(raw, "danger", resourcePath, 1, 100);
		String biome = require(raw, "biome", resourcePath);
		String description = str(raw, "description", "");

		if (!List.of("dinosaur", "pterosaur", "marine_reptile").contains(category)) {
			throw new IllegalStateException(
				"Invalid category '" + category + "' in " + resourcePath
					+ " (expected dinosaur, pterosaur, or marine_reptile)");
		}
		if (rarities.byId(rarity).isEmpty()) {
			throw new IllegalStateException(
				"Unknown rarity '" + rarity + "' in " + resourcePath
					+ " (expected one of " + RarityCatalog.KNOWN_IDS + ")");
		}

		// Optional overrides — null means "use rarity default".
		OptionalInt incOverride = optionalInt(raw, "incubation_minutes", resourcePath, 1);
		OptionalLong costOverride = optionalLong(raw, "determined_egg_cost", resourcePath, 0);

		return new DinoSpecies(id, displayName, category, rarity, era, tier, baseCost, baseIncome,
			popularity, danger, biome, description, incOverride, costOverride);
	}

	private static String require(Map<String, Object> raw, String key, String resourcePath) {
		Object v = raw.get(key);
		if (v == null || v.toString().isBlank()) {
			throw new IllegalStateException("Missing required field '" + key + "' in " + resourcePath);
		}
		return v.toString();
	}

	private static String str(Map<String, Object> raw, String key, String fallback) {
		Object v = raw.get(key);
		return v == null ? fallback : v.toString();
	}

	private static int intRange(Map<String, Object> raw, String key, String resourcePath, int lo, int hi) {
		Object v = raw.get(key);
		if (!(v instanceof Number n)) {
			throw new IllegalStateException(
				"Field '" + key + "' must be a number in " + resourcePath + " (got " + v + ")");
		}
		int x = n.intValue();
		if (x < lo || x > hi) {
			throw new IllegalStateException(
				"Field '" + key + "'=" + x + " out of range [" + lo + ".." + hi + "] in " + resourcePath);
		}
		return x;
	}

	private static long longAtLeastZero(Map<String, Object> raw, String key, String resourcePath) {
		Object v = raw.get(key);
		if (!(v instanceof Number n)) {
			throw new IllegalStateException(
				"Field '" + key + "' must be a number in " + resourcePath + " (got " + v + ")");
		}
		long x = n.longValue();
		if (x < 0) {
			throw new IllegalStateException(
				"Field '" + key + "'=" + x + " must be >= 0 in " + resourcePath);
		}
		return x;
	}

	private static OptionalInt optionalInt(Map<String, Object> raw, String key, String resourcePath, int min) {
		Object v = raw.get(key);
		if (v == null) return OptionalInt.empty();
		if (!(v instanceof Number n)) {
			throw new IllegalStateException(
				"Field '" + key + "' must be a number in " + resourcePath + " (got " + v + ")");
		}
		int x = n.intValue();
		if (x < min) {
			throw new IllegalStateException(
				"Field '" + key + "'=" + x + " must be >= " + min + " in " + resourcePath);
		}
		return OptionalInt.of(x);
	}

	private static OptionalLong optionalLong(Map<String, Object> raw, String key, String resourcePath, long min) {
		Object v = raw.get(key);
		if (v == null) return OptionalLong.empty();
		if (!(v instanceof Number n)) {
			throw new IllegalStateException(
				"Field '" + key + "' must be a number in " + resourcePath + " (got " + v + ")");
		}
		long x = n.longValue();
		if (x < min) {
			throw new IllegalStateException(
				"Field '" + key + "'=" + x + " must be >= " + min + " in " + resourcePath);
		}
		return OptionalLong.of(x);
	}

	// ─── classpath enumeration (mirror MigrationRunner) ──────────────────

	private static List<String> listYaml(URL root) throws IOException {
		List<String> out = new ArrayList<>();
		String protocol = root.getProtocol();

		if ("file".equals(protocol)) {
			java.io.File dir = new java.io.File(java.net.URI.create(root.toString()));
			java.io.File[] children = dir.listFiles((d, name) -> YAML_FILE.matcher(name).matches());
			if (children == null) return out;
			for (java.io.File f : children) {
				out.add(RESOURCE_DIR + f.getName());
			}
		} else if ("jar".equals(protocol)) {
			String spec = root.getFile();
			int bang = spec.indexOf('!');
			String jarUrl = spec.substring(0, bang);
			String inside = spec.substring(bang + 2); // skip "!/"
			try (java.util.jar.JarFile jar = new java.util.jar.JarFile(
				new java.io.File(java.net.URI.create(jarUrl)))) {
				Enumeration<java.util.jar.JarEntry> entries = jar.entries();
				while (entries.hasMoreElements()) {
					java.util.jar.JarEntry e = entries.nextElement();
					String entryName = e.getName();
					// Defence against Zip Slip / path-traversal in malicious archives:
					// a JarEntry whose name contains ".." segments could let a tampered
					// jar resolve resources outside the intended catalog directory.
					if (entryName.contains("..") || entryName.contains("\\")) {
						log.warn("Skipping suspicious jar entry: {}", entryName);
						continue;
					}
					if (e.isDirectory() || !entryName.startsWith(inside)) continue;
					String tail = entryName.substring(inside.length());
					if (tail.contains("/")) continue;     // not direct child
					if (!YAML_FILE.matcher(tail).matches()) continue;
					out.add(entryName);
				}
			}
		} else {
			log.warn("Unsupported dino catalog root protocol '{}'", protocol);
		}
		return out;
	}

}
