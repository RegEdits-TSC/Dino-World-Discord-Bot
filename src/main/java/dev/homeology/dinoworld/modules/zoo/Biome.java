package dev.homeology.dinoworld.modules.zoo;

import java.util.Locale;
import java.util.Optional;

/**
 * Canonical set of habitat biomes. Single source of truth used by:
 * <ul>
 *   <li>The species YAML loader — every {@code biome:} field must match
 *       one of these names.</li>
 *   <li>The build-enclosure flow — typed-text input is validated against
 *       {@link #fromString} so typos like "marineee" are rejected with a
 *       clear list of valid options.</li>
 *   <li>{@link EnclosureService#findCompatibleForSpecies} and
 *       {@code /move}'s destination filter — both use {@link #domain} to
 *       enforce the cross-domain rule (a marine dino cannot live in a
 *       forest enclosure, ever).</li>
 *   <li>{@link HappinessTickService} — applies a higher decay rate for
 *       dinos in a same-domain but biome-mismatched enclosure (a
 *       forest velociraptor in a desert habitat is unhappy but not
 *       refused; a marine mosasaurus in a desert is structurally
 *       impossible).</li>
 * </ul>
 *
 * <p>The lowercase {@link #label()} is the canonical wire form — what
 * appears in YAML, the database, and Discord embeds.
 */
public enum Biome {
	FOREST(Domain.LAND),
	DESERT(Domain.LAND),
	GRASSLAND(Domain.LAND),
	MOUNTAIN(Domain.LAND),
	AERIAL(Domain.AIR),
	MARINE(Domain.WATER);

	private final Domain domain;

	Biome(Domain domain) {
		this.domain = domain;
	}

	/**
	 * @return broad habitat category. Cross-domain placements are refused
	 *         by every flow that creates dino-to-enclosure mappings.
	 */
	public Domain domain() {
		return domain;
	}

	/**
	 * @return canonical lowercase label (also the YAML/DB form)
	 */
	public String label() {
		return name().toLowerCase(Locale.ROOT);
	}

	/**
	 * Parse a biome label, case-insensitive and trimmed. Returns empty
	 * for any string not exactly matching a {@link Biome} name.
	 */
	public static Optional<Biome> fromString(String s) {
		if (s == null) return Optional.empty();
		String trimmed = s.trim().toUpperCase(Locale.ROOT);
		if (trimmed.isEmpty()) return Optional.empty();
		try {
			return Optional.of(Biome.valueOf(trimmed));
		} catch (IllegalArgumentException e) {
			return Optional.empty();
		}
	}

	/**
	 * @return {@code true} if both biome strings parse to the same domain.
	 *         An unknown biome on either side returns {@code false}.
	 */
	public static boolean sameDomain(String a, String b) {
		Optional<Domain> da = fromString(a).map(Biome::domain);
		Optional<Domain> db = fromString(b).map(Biome::domain);
		return da.isPresent() && db.isPresent() && da.get() == db.get();
	}

	/**
	 * Asymmetric placement rule: can a species native to {@code speciesBiome}
	 * physically live in an enclosure built as {@code enclosureBiome}?
	 *
	 * <p>Allowed pairings:
	 * <ul>
	 *   <li>Same domain — always (a forest dino in a desert enclosure is
	 *       same-domain biome-mismatched, decays faster but lives there).</li>
	 *   <li><b>Aerial species in any LAND enclosure</b> — flying species can
	 *       roost in land habitats; happiness still suffers via the
	 *       biome-mismatch path in {@link HappinessTickService}, but the
	 *       placement is legal. The reverse is <em>not</em> allowed: a land
	 *       species cannot be assigned to an aerial enclosure.</li>
	 * </ul>
	 *
	 * <p>Marine species are strict — {@code WATER} only, no fallback.
	 *
	 * @return {@code true} if the placement is structurally legal; an unknown
	 *         biome on either side returns {@code false}
	 */
	public static boolean canHouse(String enclosureBiome, String speciesBiome) {
		Optional<Domain> e = fromString(enclosureBiome).map(Biome::domain);
		Optional<Domain> s = fromString(speciesBiome).map(Biome::domain);
		if (e.isEmpty() || s.isEmpty()) return false;
		if (e.get() == s.get()) return true;
		return s.get() == Domain.AIR && e.get() == Domain.LAND;
	}

	/**
	 * @return comma-joined lowercase labels — used in error messages
	 *         that surface the valid set to the player.
	 */
	public static String labelsCsv() {
		StringBuilder sb = new StringBuilder();
		for (Biome b : values()) {
			if (sb.length() > 0) sb.append(", ");
			sb.append(b.label());
		}
		return sb.toString();
	}

	/**
	 * Broad habitat category — determines what species can physically
	 * coexist. Land, air, and water are mutually exclusive at the
	 * placement layer.
	 */
	public enum Domain {
		LAND, AIR, WATER;
	}
}
