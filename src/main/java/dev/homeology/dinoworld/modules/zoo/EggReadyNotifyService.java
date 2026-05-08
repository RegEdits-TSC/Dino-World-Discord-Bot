package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.notify.NotificationService;
import dev.homeology.dinoworld.modules.zoo.model.EggInstance;
import dev.homeology.dinoworld.util.Embeds;
import net.dv8tion.jda.api.EmbedBuilder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.awt.Color;
import java.time.Clock;
import java.time.Instant;
import java.util.List;

/**
 * Sends a one-time DM when an egg becomes ready to hatch.
 *
 * <p>Registered as the {@code zoo.egg_ready_notify} TickScheduler job at a
 * 5-minute cadence. Each tick:
 * <ol>
 *   <li>Queries every egg whose {@code ready_at} has passed but whose
 *       {@code notified_at} is still NULL.</li>
 *   <li>Issues a DM via {@link NotificationService#dmNow} for each.</li>
 *   <li>Stamps {@code notified_at} regardless of DM success — failure
 *       drops + logs (per the prep-phase notify policy) and re-trying
 *       a guaranteed-to-fail DM is wasteful.</li>
 * </ol>
 *
 * <p>Because the row only flips to "notified" once, this is naturally
 * exactly-once UX: a player who was offline during the ready transition
 * still gets exactly one DM whenever the bot next runs the tick.
 */
public final class EggReadyNotifyService {

	private static final Logger log = LoggerFactory.getLogger(EggReadyNotifyService.class);

	private final EggService eggs;
	private final RarityCatalog rarities;
	private final DinoCatalog catalog;
	private final NotificationService notify;
	private final Clock clock;

	public EggReadyNotifyService(EggService eggs,
	                             RarityCatalog rarities,
	                             DinoCatalog catalog,
	                             NotificationService notify) {
		this(eggs, rarities, catalog, notify, Clock.systemUTC());
	}

	/**
	 * Test seam — inject a fixed {@link Clock} so the notification
	 * timestamp is reproducible.
	 */
	public EggReadyNotifyService(EggService eggs,
	                             RarityCatalog rarities,
	                             DinoCatalog catalog,
	                             NotificationService notify,
	                             Clock clock) {
		this.eggs = eggs;
		this.rarities = rarities;
		this.catalog = catalog;
		this.notify = notify;
		this.clock = clock;
	}

	public void runOnce() {
		List<EggInstance> due = eggs.findReadyButUnnotified();
		if (due.isEmpty()) return;
		Instant stamp = clock.instant();
		log.info("egg_ready_notify: {} egg(s) ready to announce", due.size());
		for (EggInstance e : due) {
			try {
				notify.dmNow(e.ownerUserId(), buildEmbed(e));
			} catch (Exception ex) {
				log.warn("egg_ready_notify dm failed for egg={} owner={}: {}",
					e.id(), e.ownerUserId(), ex.toString());
			}
			eggs.markNotified(e.id(), stamp);
		}
	}

	private net.dv8tion.jda.api.entities.MessageEmbed buildEmbed(EggInstance e) {
		Rarity r = rarities.require(e.rarity());
		String label = e.speciesId()
			.flatMap(catalog::byId)
			.map(s -> s.displayName() + " egg")
			.orElseGet(() -> "Mystery " + r.displayName().toLowerCase() + " egg");

		EmbedBuilder embed = Embeds.success("🥚  " + label + " ready to hatch!",
			"Run `/hatch` (or hit the Hatch button on `/eggs`) to bring it into your park.");
		embed.setColor(new Color(r.color()));
		return embed.build();
	}
}
