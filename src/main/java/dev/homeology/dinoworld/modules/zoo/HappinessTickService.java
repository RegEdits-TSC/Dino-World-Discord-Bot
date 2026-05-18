package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.staff.StaffEffectsService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Runs the hourly happiness-decay tick. Decay rate scales with how well
 * the dino's enclosure matches its native habitat:
 *
 * <ul>
 *   <li><b>Perfect biome match</b> ({@code species.biome == enclosure.biome}):
 *       loses {@value #DECAY_BASE} happiness/hour. Reaches zero in
 *       {@code 100 / DECAY_BASE = 25} hours unfed — one feed a day keeps
 *       things stable.</li>
 *   <li><b>Same-domain mismatch</b> (e.g. a forest velociraptor in a
 *       desert enclosure): {@value #DECAY_MISMATCH}/hour, double the
 *       base rate. The dino is comfortable enough to live there but
 *       visibly unhappy — the player feels the cost without losing the
 *       dino entirely.</li>
 *   <li><b>Homeless</b> (no enclosure assigned): same accelerated rate as
 *       same-domain mismatch. Should never happen in normal flow but
 *       handled defensively.</li>
 * </ul>
 *
 * <p>Cross-domain placements (water dino in land enclosure) are refused
 * upstream by every flow that creates dino-to-enclosure mappings, so this
 * service never sees them in practice. If one ever leaks through, it's
 * treated like a same-domain mismatch — the dino just decays faster.
 *
 * <p>Designed for direct invocation from a
 * {@link dev.homeology.dinoworld.scheduler.TickScheduler} job. Back-fill
 * works the same way income does: a 5-hour outage runs the handler 5
 * times in series.
 */
public final class HappinessTickService {

	private static final Logger log = LoggerFactory.getLogger(HappinessTickService.class);

	/**
	 * Happiness lost per hourly tick when the dino is in its native biome.
	 */
	public static final int DECAY_BASE = 4;

	/**
	 * Happiness lost per hour when the dino is in a same-domain but
	 * non-matching biome (or has no enclosure at all). 2× base.
	 */
	public static final int DECAY_MISMATCH = 8;

	private final DinoInstanceService dinos;
	private final EnclosureService enclosures;
	private final DinoCatalog catalog;
	private final StaffEffectsService staffEffects;
	private final IssueDetector issueDetector;
	private final Clock clock;

	public HappinessTickService(DinoInstanceService dinos,
	                            EnclosureService enclosures,
	                            DinoCatalog catalog) {
		this(dinos, enclosures, catalog, null, null, Clock.systemUTC());
	}

	public HappinessTickService(DinoInstanceService dinos,
	                            EnclosureService enclosures,
	                            DinoCatalog catalog,
	                            StaffEffectsService staffEffects) {
		this(dinos, enclosures, catalog, staffEffects, null, Clock.systemUTC());
	}

	/**
	 * Test seam — inject a fixed clock for deterministic last_decay_at.
	 * {@code staffEffects} may be null when the staff module is disabled,
	 * in which case decay is unmodified. {@code issueDetector} may be
	 * null in unit tests that don't care about the issues sweep.
	 */
	public HappinessTickService(DinoInstanceService dinos,
	                            EnclosureService enclosures,
	                            DinoCatalog catalog,
	                            StaffEffectsService staffEffects,
	                            IssueDetector issueDetector,
	                            Clock clock) {
		this.dinos = dinos;
		this.enclosures = enclosures;
		this.catalog = catalog;
		this.staffEffects = staffEffects;
		this.issueDetector = issueDetector;
		this.clock = clock;
	}

	/**
	 * Backwards-compatible 4-arg constructor for the existing test that
	 * passes {@code (dinos, enclosures, catalog, clock)} positionally —
	 * keeps the suite green without rewriting it.
	 */
	public HappinessTickService(DinoInstanceService dinos,
	                            EnclosureService enclosures,
	                            DinoCatalog catalog,
	                            Clock clock) {
		this(dinos, enclosures, catalog, null, null, clock);
	}

	public void runOnce() {
		Instant now = clock.instant();
		List<DinoInstance> all = dinos.findAll();
		if (all.isEmpty()) return;

		// Cache enclosures by id so we don't hit the DB once per dino.
		Map<Long, Enclosure> enclosureById = new HashMap<>();
		int touched = 0;
		for (DinoInstance d : all) {
			double decay = decayFor(d, enclosureById);
			// Trait effect: a small per-dino multiplier on the biome/mismatch
			// base. Lazy/vigorous slow decay; gluttonous/proud speed it up.
			if (d.trait().isPresent()) {
				decay *= d.trait().get().decayMult();
			}
			// Vet effect: apply per-enclosure decay multiplier (1.0 if no vet,
			// 0.5 with at least one vet). Defaulted to 1.0 when staff module
			// is disabled.
			if (staffEffects != null && d.enclosureId().isPresent()) {
				double mult = staffEffects.happinessDecayMultiplier(d.enclosureId().getAsLong());
				decay *= mult;
			}
			int applied = (int) Math.round(decay);
			int newHappiness = Math.max(0, d.happiness() - applied);
			dinos.applyHappiness(d.id(), newHappiness, now);
			touched++;
		}
		log.info("happiness.tick advanced {} dino(s)", touched);

		// Issue sweep runs after decay so the threshold check sees this
		// tick's happiness. Re-fetch to get the post-update values.
		if (issueDetector != null) {
			issueDetector.applyHappinessIssues(dinos.findAll());
		}
	}

	/**
	 * Decay rate to apply to one dino this tick. Package-private so
	 * tests can pin the exact mapping without re-running the loop.
	 */
	int decayFor(DinoInstance d, Map<Long, Enclosure> enclosureById) {
		if (d.enclosureId().isEmpty()) return DECAY_MISMATCH;

		Enclosure e = enclosureById.computeIfAbsent(d.enclosureId().getAsLong(),
			id -> enclosures.findById(id).orElse(null));
		if (e == null) return DECAY_MISMATCH;

		DinoSpecies species = catalog.byId(d.speciesId()).orElse(null);
		if (species == null) return DECAY_BASE; // unknown species — don't punish

		if (e.biome().equalsIgnoreCase(species.biome())) return DECAY_BASE;
		// Same-domain mismatch (or, theoretically, a leaked cross-domain
		// placement) → faster decay.
		return DECAY_MISMATCH;
	}
}
