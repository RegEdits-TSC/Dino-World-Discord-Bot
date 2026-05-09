package dev.homeology.dinoworld.modules.staff;

import dev.homeology.dinoworld.modules.zoo.DinoInstanceService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Hourly tick that applies the {@link StaffEffect.AutoFeed Zookeeper
 * auto-feed} effect.
 *
 * <p>For each enclosure with one or more zookeepers, picks the lowest-
 * happiness dinos up to the summed capacity and resets each one's
 * happiness to 100 via {@link DinoInstanceService#recordFed} — bypassing
 * the human-only 6h cooldown. That's the value proposition: unattended
 * parks stay fed.
 *
 * <p>Designed for direct invocation from {@link dev.homeology.dinoworld.scheduler.TickScheduler}.
 * Back-fill works the same as zoo's other ticks: a 5-hour outage runs the
 * handler 5 times in series.
 */
public final class AutoFeedTickService {

	private static final Logger log = LoggerFactory.getLogger(AutoFeedTickService.class);

	private final StaffEffectsService effects;
	private final StaffMemberService staff;
	private final DinoInstanceService dinos;
	private final Clock clock;

	public AutoFeedTickService(StaffEffectsService effects,
	                           StaffMemberService staff,
	                           DinoInstanceService dinos) {
		this(effects, staff, dinos, Clock.systemUTC());
	}

	/**
	 * Test seam — inject a fixed clock for deterministic last_fed_at.
	 */
	public AutoFeedTickService(StaffEffectsService effects,
	                           StaffMemberService staff,
	                           DinoInstanceService dinos,
	                           Clock clock) {
		this.effects = effects;
		this.staff = staff;
		this.dinos = dinos;
		this.clock = clock;
	}

	public void runOnce() {
		List<StaffMember> all = staff.findAll();
		if (all.isEmpty()) return;

		// Group capacity per enclosure (multiple zookeepers stack).
		Map<Long, Integer> capacityByEnclosure = new HashMap<>();
		for (StaffMember m : all) {
			if (m.enclosureId().isEmpty()) continue;
			long encId = m.enclosureId().getAsLong();
			int cap = effects.autoFeedCapacity(encId);
			if (cap > 0) capacityByEnclosure.put(encId, cap);
		}
		if (capacityByEnclosure.isEmpty()) return;

		// Group dinos by enclosure once, then pick lowest-happiness up to capacity.
		Map<Long, java.util.ArrayList<DinoInstance>> byEnclosure = new HashMap<>();
		for (DinoInstance d : dinos.findAll()) {
			d.enclosureId().ifPresent(eid ->
				byEnclosure.computeIfAbsent(eid, k -> new java.util.ArrayList<>()).add(d));
		}

		Instant now = clock.instant();
		int fed = 0;
		for (Map.Entry<Long, Integer> e : capacityByEnclosure.entrySet()) {
			long enclosureId = e.getKey();
			int capacity = e.getValue();
			List<DinoInstance> residents = byEnclosure.get(enclosureId);
			if (residents == null || residents.isEmpty()) continue;

			// Sort ascending by current happiness (most needy first), stable
			// on id so tests are deterministic.
			residents.sort(Comparator.comparingInt(DinoInstance::happiness)
				.thenComparingLong(DinoInstance::id));

			int n = Math.min(capacity, residents.size());
			for (int i = 0; i < n; i++) {
				dinos.recordFed(residents.get(i).id(), now);
				fed++;
			}
		}
		if (fed > 0) {
			log.info("staff.autofeed fed {} dino(s) across {} enclosure(s)",
				fed, capacityByEnclosure.size());
		}
	}
}
