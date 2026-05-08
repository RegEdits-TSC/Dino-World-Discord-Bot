package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Runs the hourly income tick — every owned dino contributes
 * {@code species.base_income_per_hour × dino.happiness / 100} coins,
 * aggregated per player into a single ledger entry per tick.
 *
 * <p>One ledger row per player per tick (rather than per dino) keeps
 * {@code coin_ledger} reasonable in volume — a player with 30 dinos still
 * produces 1 row per hour, not 30. The {@code reason} is
 * {@code income.tick} so audits can filter cleanly.
 *
 * <p>Players whose tick total rounds to zero (e.g. brand-new accounts with
 * no dinos, or a fleet of fully-unhappy dinos) get no addCoins call —
 * skipping them keeps the ledger empty until something interesting
 * happens.
 *
 * <p>Designed for direct invocation from a
 * {@link dev.homeology.dinoworld.scheduler.TickScheduler} job. The
 * scheduler's restart back-fill handles missed ticks: a 5-hour outage
 * triggers 5 calls to {@link #runOnce()} in series, each crediting one
 * hour of income.
 */
public final class IncomeTickService {

	private static final Logger log = LoggerFactory.getLogger(IncomeTickService.class);

	/**
	 * Ledger reason recorded for every income credit.
	 */
	public static final String LEDGER_REASON = "income.tick";

	private final DinoInstanceService dinos;
	private final DinoCatalog catalog;
	private final PlayerService players;

	public IncomeTickService(DinoInstanceService dinos,
	                         DinoCatalog catalog,
	                         PlayerService players) {
		this.dinos = dinos;
		this.catalog = catalog;
		this.players = players;
	}

	/**
	 * Aggregate one hour of income across all dinos and commit per-player.
	 */
	public void runOnce() {
		List<DinoInstance> all = dinos.findAll();
		if (all.isEmpty()) return;

		Map<Long, Long> perPlayer = new HashMap<>();
		for (DinoInstance d : all) {
			Optional<DinoSpecies> speciesOpt = catalog.byId(d.speciesId());
			if (speciesOpt.isEmpty()) continue;
			long contribution = speciesOpt.get().baseIncomePerHour() * d.happiness() / 100L;
			if (contribution <= 0) continue;
			perPlayer.merge(d.ownerUserId(), contribution, Long::sum);
		}
		if (perPlayer.isEmpty()) {
			log.debug("income.tick: no positive contributions");
			return;
		}
		for (Map.Entry<Long, Long> e : perPlayer.entrySet()) {
			players.addCoins(e.getKey(), e.getValue(), LEDGER_REASON, null);
		}
		log.info("income.tick credited {} player(s) total {} coins",
			perPlayer.size(), perPlayer.values().stream().mapToLong(Long::longValue).sum());
	}
}
