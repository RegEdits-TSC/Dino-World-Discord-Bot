package dev.homeology.dinoworld.modules.staff;

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
 * In-memory catalog of every {@link StaffRole}, loaded once at module
 * startup from {@code src/main/resources/data/staff/roles.yaml}.
 *
 * <p>Mirror of {@link dev.homeology.dinoworld.modules.zoo.RarityCatalog} —
 * single YAML file, top-level map keyed by id, fail-fast on missing or
 * malformed input. Game balance is unbalanced without role defaults; a
 * silent skip would surface as confusing NPEs in the wage tick later.
 *
 * <p>Also holds the {@link #reassignFee()} read from the same file. That
 * lets the reassignment cost be tuned without code changes; if the YAML
 * omits the field, defaults to {@value #DEFAULT_REASSIGN_FEE}.
 */
public final class StaffCatalog {

	private static final Logger log = LoggerFactory.getLogger(StaffCatalog.class);
	private static final String RESOURCE_PATH = "data/staff/roles.yaml";

	/**
	 * Default reassignment fee if the YAML omits {@code reassign_fee}.
	 */
	public static final long DEFAULT_REASSIGN_FEE = 500L;

	private final Map<String, StaffRole> byId = new LinkedHashMap<>();
	private final long reassignFee;

	public StaffCatalog() {
		this(Thread.currentThread().getContextClassLoader());
	}

	StaffCatalog(ClassLoader cl) {
		try (InputStream in = cl.getResourceAsStream(RESOURCE_PATH)) {
			if (in == null) {
				throw new IllegalStateException("Missing required resource: " + RESOURCE_PATH);
			}
			try (InputStreamReader reader = new InputStreamReader(in, StandardCharsets.UTF_8)) {
				Map<String, Object> raw = new Yaml().load(reader);
				if (raw == null) {
					throw new IllegalStateException(RESOURCE_PATH + " is empty");
				}

				Object rolesNode = raw.get("roles");
				if (!(rolesNode instanceof Map)) {
					throw new IllegalStateException(
						"Missing top-level 'roles' map in " + RESOURCE_PATH);
				}
				@SuppressWarnings("unchecked")
				Map<String, Object> rolesMap = (Map<String, Object>) rolesNode;
				for (Map.Entry<String, Object> entry : rolesMap.entrySet()) {
					String id = entry.getKey();
					if (!(entry.getValue() instanceof Map)) {
						throw new IllegalStateException(
							"Role '" + id + "' must be a map in " + RESOURCE_PATH);
					}
					@SuppressWarnings("unchecked")
					Map<String, Object> body = (Map<String, Object>) entry.getValue();
					byId.put(id, parseRole(id, body));
				}

				Object feeNode = raw.get("reassign_fee");
				if (feeNode == null) {
					this.reassignFee = DEFAULT_REASSIGN_FEE;
				} else if (feeNode instanceof Number n) {
					long v = n.longValue();
					if (v < 0) {
						throw new IllegalStateException(
							"reassign_fee must be >= 0 in " + RESOURCE_PATH);
					}
					this.reassignFee = v;
				} else {
					throw new IllegalStateException(
						"reassign_fee must be a number in " + RESOURCE_PATH);
				}
			}
		} catch (java.io.IOException e) {
			throw new IllegalStateException("Failed to read " + RESOURCE_PATH, e);
		}

		if (byId.isEmpty()) {
			throw new IllegalStateException(
				"StaffCatalog is empty — at least one role expected in " + RESOURCE_PATH);
		}
		log.info("StaffCatalog loaded {} role(s): {} (reassign_fee={})",
			byId.size(), byId.keySet(), reassignFee);
	}

	/**
	 * @return role by stable id, or empty if not loaded
	 */
	public Optional<StaffRole> byId(String id) {
		return Optional.ofNullable(byId.get(id));
	}

	/**
	 * @return role by id; throws if unknown. Use when the id has been
	 *         validated upstream (e.g. came from a row this catalog
	 *         already accepted).
	 */
	public StaffRole require(String id) {
		return byId(id).orElseThrow(() ->
			new IllegalStateException("Unknown staff role: " + id));
	}

	/**
	 * @return every loaded role in declaration order
	 */
	public List<StaffRole> all() {
		return List.copyOf(byId.values());
	}

	/**
	 * @return flat coin cost charged when {@code /staff assign} moves an
	 *         enclosure-scope hire to a different enclosure
	 */
	public long reassignFee() {
		return reassignFee;
	}

	/**
	 * @return number of loaded roles
	 */
	public int size() {
		return byId.size();
	}

	// ─── parsing ─────────────────────────────────────────────────────────

	private static StaffRole parseRole(String id, Map<String, Object> raw) {
		String displayName = requireStr(raw, "display_name", id);
		long hireCost = requireLong(raw, "hire_cost", id, 0);
		long wagePerHour = requireLong(raw, "wage_per_hour", id, 0);
		String scopeStr = requireStr(raw, "scope", id).toLowerCase();
		StaffRole.Scope scope = switch (scopeStr) {
			case "enclosure" -> StaffRole.Scope.ENCLOSURE;
			case "global" -> StaffRole.Scope.GLOBAL;
			default -> throw new IllegalStateException(
				"Role '" + id + "' has unknown scope '" + scopeStr
					+ "' (expected enclosure or global)");
		};
		int maxOwned = requireInt(raw, "max_owned", id, 1);
		int unlockLevel = requireInt(raw, "unlock_level", id, 1);

		Object effectNode = raw.get("effect");
		if (!(effectNode instanceof Map)) {
			throw new IllegalStateException(
				"Role '" + id + "' is missing 'effect' map");
		}
		@SuppressWarnings("unchecked")
		Map<String, Object> effectBody = (Map<String, Object>) effectNode;
		StaffEffect effect = parseEffect(id, scope, effectBody);

		return new StaffRole(id, displayName, hireCost, wagePerHour, scope,
			maxOwned, unlockLevel, effect);
	}

	private static StaffEffect parseEffect(String id, StaffRole.Scope scope,
	                                       Map<String, Object> raw) {
		String type = requireStr(raw, "type", id + ".effect");
		return switch (type) {
			case "auto_feed" -> {
				if (scope != StaffRole.Scope.ENCLOSURE) {
					throw new IllegalStateException(
						"Role '" + id + "' uses auto_feed but scope is " + scope
							+ " (auto_feed must be enclosure-scope)");
				}
				int capacity = requireInt(raw, "capacity", id + ".effect", 1);
				yield new StaffEffect.AutoFeed(capacity);
			}
			case "decay_reduce" -> {
				if (scope != StaffRole.Scope.ENCLOSURE) {
					throw new IllegalStateException(
						"Role '" + id + "' uses decay_reduce but scope is " + scope);
				}
				double mult = requireDouble(raw, "multiplier", id + ".effect", 0.0);
				if (mult > 1.0) {
					throw new IllegalStateException(
						"Role '" + id + "' decay_reduce.multiplier=" + mult
							+ " must be in [0, 1]");
				}
				yield new StaffEffect.DecayReduce(mult);
			}
			case "incubation_speed" -> {
				if (scope != StaffRole.Scope.GLOBAL) {
					throw new IllegalStateException(
						"Role '" + id + "' uses incubation_speed but scope is " + scope);
				}
				double per = requireDouble(raw, "per_unit_multiplier", id + ".effect", 0.0);
				double floor = requireDouble(raw, "floor", id + ".effect", 0.0);
				if (per > 1.0) {
					throw new IllegalStateException(
						"Role '" + id + "' incubation_speed.per_unit_multiplier=" + per
							+ " must be <= 1");
				}
				if (floor > 1.0 || floor < 0.0) {
					throw new IllegalStateException(
						"Role '" + id + "' incubation_speed.floor=" + floor
							+ " must be in [0, 1]");
				}
				yield new StaffEffect.IncubationSpeed(per, floor);
			}
			case "income_multiplier" -> {
				if (scope != StaffRole.Scope.GLOBAL) {
					throw new IllegalStateException(
						"Role '" + id + "' uses income_multiplier but scope is " + scope);
				}
				double bonus = requireDouble(raw, "per_unit_bonus", id + ".effect", 0.0);
				double cap = requireDouble(raw, "cap", id + ".effect", 1.0);
				yield new StaffEffect.IncomeMultiplier(bonus, cap);
			}
			default -> throw new IllegalStateException(
				"Role '" + id + "' has unknown effect type '" + type + "'");
		};
	}

	private static String requireStr(Map<String, Object> raw, String key, String ctx) {
		Object v = raw.get(key);
		if (v == null || v.toString().isBlank()) {
			throw new IllegalStateException(
				"Missing required field '" + key + "' in " + ctx);
		}
		return v.toString();
	}

	private static long requireLong(Map<String, Object> raw, String key, String ctx, long min) {
		Object v = raw.get(key);
		if (!(v instanceof Number n)) {
			throw new IllegalStateException(
				"Field '" + key + "' must be a number in " + ctx + " (got " + v + ")");
		}
		long x = n.longValue();
		if (x < min) {
			throw new IllegalStateException(
				"Field '" + key + "'=" + x + " must be >= " + min + " in " + ctx);
		}
		return x;
	}

	private static int requireInt(Map<String, Object> raw, String key, String ctx, int min) {
		return Math.toIntExact(requireLong(raw, key, ctx, min));
	}

	private static double requireDouble(Map<String, Object> raw, String key, String ctx, double min) {
		Object v = raw.get(key);
		if (!(v instanceof Number n)) {
			throw new IllegalStateException(
				"Field '" + key + "' must be a number in " + ctx + " (got " + v + ")");
		}
		double x = n.doubleValue();
		if (x < min) {
			throw new IllegalStateException(
				"Field '" + key + "'=" + x + " must be >= " + min + " in " + ctx);
		}
		return x;
	}
}
