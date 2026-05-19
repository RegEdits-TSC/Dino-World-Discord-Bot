package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.modules.players.Player;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.staff.StaffEffectsService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.EggInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Function;

/**
 * Buys, lists, and hatches eggs. The economic heart of v1.
 *
 * <p>Two egg flavors:
 * <ul>
 *   <li><b>Mystery</b> — pay rarity's {@code mystery_egg_cost}; species
 *       resolved on /hatch by uniform pick from species in that rarity.</li>
 *   <li><b>Determined</b> — pay {@code rarity × determinedEggMultiplier}
 *       (or a per-species override); species recorded at purchase.</li>
 * </ul>
 *
 * <p>{@link #hatch(long, long)} performs four side effects in order:
 * pick species (if mystery), find compatible enclosure (or fail), create
 * the dino instance, and stamp the egg row. Any failure aborts before any
 * side effect is taken — there is no partial state.
 *
 * <p>The species picker for mystery eggs is injectable so tests can seed
 * the roll. Production uses {@link ThreadLocalRandom}.
 */
public final class EggService {

	private static final Logger log = LoggerFactory.getLogger(EggService.class);

	/**
	 * Reason text written to {@code coin_ledger} on egg purchase. Lets
	 * /debug ledger filtering find every egg-spend later.
	 */
	private static final String LEDGER_REASON_MYSTERY = "egg.buy.mystery";
	private static final String LEDGER_REASON_DETERMINED = "egg.buy.determined";

	private final DataSource dataSource;
	private final RarityCatalog rarities;
	private final DinoCatalog catalog;
	private final PlayerService players;
	private final DinoInstanceService dinos;
	private final EnclosureService enclosures;
	private final Function<List<DinoSpecies>, DinoSpecies> picker;
	private final Clock clock;
	private final StaffEffectsService staffEffects;
	private final TraitRoller traitRoller;
	private final ShinyRoller shinyRoller;

	/**
	 * Production constructor — uses {@link ThreadLocalRandom} for mystery
	 * picks and {@link Clock#systemUTC()} for timestamps.
	 */
	public EggService(DataSource dataSource,
	                  RarityCatalog rarities,
	                  DinoCatalog catalog,
	                  PlayerService players,
	                  DinoInstanceService dinos,
	                  EnclosureService enclosures) {
		this(dataSource, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(ThreadLocalRandom.current().nextInt(pool.size())),
			Clock.systemUTC(), null, new TraitRoller(), new ShinyRoller());
	}

	/**
	 * Production constructor with optional {@link StaffEffectsService}
	 * (null when staff module is disabled).
	 */
	public EggService(DataSource dataSource,
	                  RarityCatalog rarities,
	                  DinoCatalog catalog,
	                  PlayerService players,
	                  DinoInstanceService dinos,
	                  EnclosureService enclosures,
	                  StaffEffectsService staffEffects) {
		this(dataSource, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(ThreadLocalRandom.current().nextInt(pool.size())),
			Clock.systemUTC(), staffEffects, new TraitRoller(), new ShinyRoller());
	}

	/**
	 * Test seam — inject a deterministic picker and/or clock.
	 */
	public EggService(DataSource dataSource,
	                  RarityCatalog rarities,
	                  DinoCatalog catalog,
	                  PlayerService players,
	                  DinoInstanceService dinos,
	                  EnclosureService enclosures,
	                  Function<List<DinoSpecies>, DinoSpecies> picker,
	                  Clock clock) {
		this(dataSource, rarities, catalog, players, dinos, enclosures, picker, clock,
			null, new TraitRoller(), new ShinyRoller());
	}

	/**
	 * Test seam — inject a deterministic picker, clock, and optional
	 * {@link StaffEffectsService}.
	 */
	public EggService(DataSource dataSource,
	                  RarityCatalog rarities,
	                  DinoCatalog catalog,
	                  PlayerService players,
	                  DinoInstanceService dinos,
	                  EnclosureService enclosures,
	                  Function<List<DinoSpecies>, DinoSpecies> picker,
	                  Clock clock,
	                  StaffEffectsService staffEffects) {
		this(dataSource, rarities, catalog, players, dinos, enclosures, picker, clock,
			staffEffects, new TraitRoller(), new ShinyRoller());
	}

	/**
	 * Test seam — inject every collaborator including {@link TraitRoller}.
	 * Defaults the {@link ShinyRoller} to production. Tests that need to
	 * pin shiny outcomes use the 11-arg constructor below.
	 */
	public EggService(DataSource dataSource,
	                  RarityCatalog rarities,
	                  DinoCatalog catalog,
	                  PlayerService players,
	                  DinoInstanceService dinos,
	                  EnclosureService enclosures,
	                  Function<List<DinoSpecies>, DinoSpecies> picker,
	                  Clock clock,
	                  StaffEffectsService staffEffects,
	                  TraitRoller traitRoller) {
		this(dataSource, rarities, catalog, players, dinos, enclosures, picker, clock,
			staffEffects, traitRoller, new ShinyRoller());
	}

	/**
	 * Test seam — inject every collaborator including both rollers. Tests
	 * that pin shiny outcomes use this constructor with a seeded RNG.
	 */
	public EggService(DataSource dataSource,
	                  RarityCatalog rarities,
	                  DinoCatalog catalog,
	                  PlayerService players,
	                  DinoInstanceService dinos,
	                  EnclosureService enclosures,
	                  Function<List<DinoSpecies>, DinoSpecies> picker,
	                  Clock clock,
	                  StaffEffectsService staffEffects,
	                  TraitRoller traitRoller,
	                  ShinyRoller shinyRoller) {
		this.dataSource = dataSource;
		this.rarities = rarities;
		this.catalog = catalog;
		this.players = players;
		this.dinos = dinos;
		this.enclosures = enclosures;
		this.picker = picker;
		this.clock = clock;
		this.staffEffects = staffEffects;
		this.traitRoller = traitRoller;
		this.shinyRoller = shinyRoller;
	}

	// ─── purchase ────────────────────────────────────────────────────────

	/**
	 * Buy a mystery egg of the given rarity.
	 *
	 * @throws InsufficientCoinsException if the player can't afford it
	 * @throws IllegalArgumentException   if the rarity is unknown
	 */
	public EggInstance buyMystery(long userId, String rarityId) {
		Rarity r = rarities.byId(rarityId).orElseThrow(() ->
			new IllegalArgumentException("Unknown rarity: " + rarityId));
		assertLevelMeetsRarity(userId, r);
		assertSlotAvailable(userId);
		long cost = r.mysteryEggCost();
		debitOrThrow(userId, cost, LEDGER_REASON_MYSTERY + ":" + r.id());
		Instant now = clock.instant();
		long incubationMinutes = scientistAdjusted(userId, r.incubationMinutes());
		Instant readyAt = now.plus(Duration.ofMinutes(incubationMinutes));
		long id = insertEggRow(userId, r.id(), null, now, readyAt);
		log.info("user={} bought mystery {} egg id={} ready_at={}",
			userId, r.id(), id, readyAt);
		return new EggInstance(id, userId, r.id(), Optional.empty(),
			now, readyAt, Optional.empty(), OptionalLong.empty(), Optional.empty());
	}

	/**
	 * Buy a determined egg of a specific species.
	 *
	 * @throws InsufficientCoinsException if the player can't afford it
	 * @throws IllegalArgumentException   if the species is unknown
	 */
	public EggInstance buyDetermined(long userId, String speciesId) {
		DinoSpecies s = catalog.byId(speciesId).orElseThrow(() ->
			new IllegalArgumentException("Unknown species: " + speciesId));
		Rarity r = rarities.require(s.rarity());
		assertLevelMeetsRarity(userId, r);
		assertHabitatExists(userId, s);
		assertSlotAvailable(userId);
		long cost = s.effectiveDeterminedEggCost(r);
		int incubation = s.effectiveIncubationMinutes(r);
		debitOrThrow(userId, cost, LEDGER_REASON_DETERMINED + ":" + s.id());
		Instant now = clock.instant();
		long adjusted = scientistAdjusted(userId, incubation);
		Instant readyAt = now.plus(Duration.ofMinutes(adjusted));
		long id = insertEggRow(userId, r.id(), s.id(), now, readyAt);
		log.info("user={} bought determined {} egg id={} ready_at={}",
			userId, s.id(), id, readyAt);
		return new EggInstance(id, userId, r.id(), Optional.of(s.id()),
			now, readyAt, Optional.empty(), OptionalLong.empty(), Optional.empty());
	}

	// ─── inventory ───────────────────────────────────────────────────────

	/**
	 * @return every egg owned by the player that hasn't been hatched yet
	 *         (incubating + ready), ordered by purchase time
	 */
	public List<EggInstance> findPending(long userId) {
		List<EggInstance> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     SELECT_ALL + " WHERE owner_user_id = ? AND hatched_at IS NULL ORDER BY purchased_at")) {
			ps.setLong(1, userId);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("egg findPending({}) failed: {}", userId, e.toString());
		}
		log.debug("egg_instance db read pending owner={} → {} rows", userId, out.size());
		return out;
	}

	/**
	 * @return every egg that is ready to hatch but hasn't yet had a
	 *         notification DM sent (used by the zoo.egg_ready_notify tick)
	 */
	public List<EggInstance> findReadyButUnnotified() {
		long now = clock.instant().toEpochMilli();
		List<EggInstance> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     SELECT_ALL + " WHERE hatched_at IS NULL AND notified_at IS NULL AND ready_at <= ?")) {
			ps.setLong(1, now);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) out.add(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("egg findReadyButUnnotified failed: {}", e.toString());
		}
		log.debug("egg_instance db read ready-but-unnotified → {} rows", out.size());
		return out;
	}

	// ─── admin paths (used by /admin) ────────────────────────────────────

	/**
	 * Insert an egg row without charging coins. Optionally sets
	 * {@code ready_at = now} so the egg is immediately hatchable.
	 *
	 * @param userId        target player
	 * @param rarityId      one of {@link RarityCatalog#KNOWN_IDS}
	 * @param speciesId     null for mystery, otherwise must match an existing species
	 *                      whose rarity matches {@code rarityId}
	 * @param makeReadyNow  if true, ready_at is set to clock.instant(); otherwise the
	 *                      species/rarity incubation duration is applied
	 */
	public EggInstance adminCreate(long userId, String rarityId, String speciesId, boolean makeReadyNow) {
		Rarity r = rarities.byId(rarityId).orElseThrow(() ->
			new IllegalArgumentException("Unknown rarity: " + rarityId));
		DinoSpecies species = null;
		if (speciesId != null) {
			species = catalog.byId(speciesId).orElseThrow(() ->
				new IllegalArgumentException("Unknown species: " + speciesId));
			if (!species.rarity().equals(r.id())) {
				throw new IllegalArgumentException(
					"Species " + speciesId + " is " + species.rarity() + ", not " + r.id());
			}
		}
		Instant now = clock.instant();
		int incubation = species == null ? r.incubationMinutes() : species.effectiveIncubationMinutes(r);
		Instant readyAt = makeReadyNow ? now : now.plus(Duration.ofMinutes(incubation));
		long id = insertEggRow(userId, r.id(), speciesId, now, readyAt);
		log.info("admin: gave user={} {} egg id={} species={} readyNow={}",
			userId, r.id(), id, speciesId == null ? "mystery" : speciesId, makeReadyNow);
		return new EggInstance(id, userId, r.id(),
			speciesId == null ? Optional.empty() : Optional.of(speciesId),
			now, readyAt, Optional.empty(), OptionalLong.empty(), Optional.empty());
	}

	/**
	 * Force {@code ready_at = now} on a pending egg so {@code /hatch}
	 * succeeds immediately. Returns false if the egg isn't pending.
	 */
	public boolean adminForceReady(long eggId) {
		EggInstance egg = findById(eggId).orElse(null);
		if (egg == null || !egg.isPending()) return false;
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE egg_instance SET ready_at = ? WHERE id = ?")) {
			ps.setLong(1, clock.instant().toEpochMilli());
			ps.setLong(2, eggId);
			ps.executeUpdate();
			return true;
		} catch (SQLException e) {
			throw new IllegalStateException("adminForceReady(" + eggId + ") failed", e);
		}
	}

	/**
	 * Stamp {@code notified_at} on an egg row. Called by the notify tick
	 * after a DM has been (or failed to be) sent — failure still records
	 * the timestamp to avoid retry storms.
	 */
	public void markNotified(long eggId, Instant when) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE egg_instance SET notified_at = ? WHERE id = ?")) {
			ps.setLong(1, when.toEpochMilli());
			ps.setLong(2, eggId);
			ps.executeUpdate();
		} catch (SQLException e) {
			log.warn("egg markNotified({}) failed: {}", eggId, e.toString());
		}
	}

	public Optional<EggInstance> findById(long eggId) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(SELECT_ALL + " WHERE id = ?")) {
			ps.setLong(1, eggId);
			try (ResultSet rs = ps.executeQuery()) {
				if (!rs.next()) {
					log.debug("egg_instance db read id={} → no row", eggId);
					return Optional.empty();
				}
				log.debug("egg_instance db read id={} → loaded", eggId);
				return Optional.of(mapRow(rs));
			}
		} catch (SQLException e) {
			log.warn("egg findById({}) failed: {}", eggId, e.toString());
			return Optional.empty();
		}
	}

	// ─── hatch ───────────────────────────────────────────────────────────

	/**
	 * Hatch a single egg owned by {@code userId}.
	 *
	 * @throws IllegalStateException if the egg doesn't exist, isn't owned
	 *                               by this user, was already hatched, or
	 *                               isn't yet ready
	 * @throws NoCompatibleEnclosureException if the player has no enclosure
	 *                               with room AND tier ≥ rarity requirement
	 */
	public HatchResult hatch(long userId, long eggId) {
		EggInstance egg = findById(eggId).orElseThrow(() ->
			new EggNotFoundException("Egg " + eggId + " doesn't exist (or has been wiped)."));
		if (egg.ownerUserId() != userId) {
			throw new EggOwnershipException("Egg " + eggId + " isn't yours to hatch.");
		}
		if (!egg.isPending()) {
			throw new EggAlreadyHatchedException(
				"Egg " + eggId + " was already hatched. Run `/eggs` to see what's still incubating.");
		}
		Instant now = clock.instant();
		if (now.isBefore(egg.readyAt())) {
			java.time.Duration left = java.time.Duration.between(now, egg.readyAt());
			long h = left.toHours();
			long m = left.toMinutesPart();
			String when = h > 0 ? h + "h " + m + "m" : m + "m";
			throw new EggNotReadyException("Egg " + eggId + " is still incubating — ready in " + when + ".");
		}

		// Resolve species (mystery → roll; determined → use stored).
		DinoSpecies species = egg.speciesId()
			.flatMap(catalog::byId)
			.orElseGet(() -> {
				List<DinoSpecies> pool = catalog.byRarity(egg.rarity());
				if (pool.isEmpty()) {
					throw new IllegalStateException(
						"No species available in rarity " + egg.rarity() + " — catalog mis-shipped");
				}
				return picker.apply(pool);
			});

		// Pick an enclosure or fail before mutating anything.
		Optional<Enclosure> enclosure = enclosures.findCompatibleForSpecies(userId, species);
		if (enclosure.isEmpty()) {
			throw new NoCompatibleEnclosureException(
				"No enclosure with capacity for a " + species.rarity()
					+ " " + species.displayName()
					+ " (needs tier " + EnclosureService.MIN_TIER_FOR_RARITY.get(species.rarity())
					+ ", biome '" + species.biome() + "')");
		}

		// Roll personality trait and shiny, then create the dino, then stamp the egg.
		DinoTrait trait = traitRoller.roll().orElse(null);
		boolean shiny = shinyRoller.roll();
		DinoInstance dino = dinos.create(
			userId, species.id(), OptionalLong.of(enclosure.get().id()), null, trait, shiny);
		stampHatched(eggId, dino.id(), now);

		// XP reward.
		Rarity r = rarities.require(egg.rarity());
		players.addXp(userId, r.hatchXp());
		log.info("user={} hatched egg={} → species={} dino={} trait={} shiny={} (+{} xp)",
			userId, eggId, species.id(), dino.id(),
			trait == null ? "plain" : trait.id(), shiny, r.hatchXp());

		return new HatchResult(eggId, species, dino, r.hatchXp());
	}

	/**
	 * Hatch every ready egg owned by {@code userId}. Stops on the first
	 * {@link NoCompatibleEnclosureException} and returns the partial result
	 * — letting the caller surface "you ran out of space at egg #3".
	 */
	public List<HatchResult> hatchAllReady(long userId) {
		List<HatchResult> out = new ArrayList<>();
		Instant now = clock.instant();
		for (EggInstance egg : findPending(userId)) {
			if (!egg.isReadyAt(now)) continue;
			out.add(hatch(userId, egg.id()));
		}
		return out;
	}

	// ─── persistence helpers ─────────────────────────────────────────────

	private void assertLevelMeetsRarity(long userId, Rarity r) {
		Player p = players.get(userId).orElseThrow(() ->
			new IllegalStateException("Player " + userId + " not found — call ensure() first"));
		if (p.level() < r.minLevel()) {
			throw new RarityLockedException(
				r.displayName() + " eggs unlock at level " + r.minLevel()
					+ ". You're level " + p.level() + " — keep hatching to level up.");
		}
	}

	private void assertHabitatExists(long userId, DinoSpecies species) {
		if (!enclosures.hasHabitatForSpecies(userId, species)) {
			int requiredTier = EnclosureService.MIN_TIER_FOR_RARITY
				.getOrDefault(species.rarity(), 1);
			throw new NoHabitatException(
				"You don't own an enclosure that can house a " + species.displayName()
					+ " (" + species.biome() + ", needs tier ≥ " + requiredTier
					+ "). Build one in `/shop` first.");
		}
	}

	private void assertSlotAvailable(long userId) {
		Player p = players.get(userId).orElseThrow(() ->
			new IllegalStateException("Player " + userId + " not found — call ensure() first"));
		int slots = players.leveling().slotsForLevel(p.level());
		int pending = findPending(userId).size();
		if (pending >= slots) {
			throw new EggSlotsFullException(
				"Your incubation chamber is full (" + pending + " / " + slots
					+ "). Hatch a ready egg or level up to unlock another slot.");
		}
	}

	/**
	 * @return incubation minutes scaled by the player's
	 *         {@link StaffEffectsService#incubationMultiplier(long)} (1.0
	 *         when the staff module is disabled or no scientist is hired).
	 *         Result floors at 1 minute so a fully-stacked discount can't
	 *         produce a zero-incubation egg.
	 */
	private long scientistAdjusted(long userId, int baseMinutes) {
		if (staffEffects == null) return baseMinutes;
		double mult = staffEffects.incubationMultiplier(userId);
		long minutes = Math.round(baseMinutes * mult);
		return Math.max(1L, minutes);
	}

	private void debitOrThrow(long userId, long cost, String reason) {
		Player p = players.get(userId).orElseThrow(() ->
			new IllegalStateException("Player " + userId + " not found — call ensure() first"));
		if (p.coins() < cost) {
			throw new InsufficientCoinsException(
				"Need " + cost + " coins; have " + p.coins());
		}
		players.addCoins(userId, -cost, reason, null);
	}

	private long insertEggRow(long userId, String rarity, String speciesId,
	                          Instant purchasedAt, Instant readyAt) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     INSERT INTO egg_instance(owner_user_id, rarity, species_id, purchased_at, ready_at)
			     VALUES (?, ?, ?, ?, ?)
			     """, Statement.RETURN_GENERATED_KEYS)) {
			ps.setLong(1, userId);
			ps.setString(2, rarity);
			if (speciesId == null) ps.setNull(3, java.sql.Types.VARCHAR);
			else ps.setString(3, speciesId);
			ps.setLong(4, purchasedAt.toEpochMilli());
			ps.setLong(5, readyAt.toEpochMilli());
			ps.executeUpdate();
			try (ResultSet rs = ps.getGeneratedKeys()) {
				if (!rs.next()) throw new IllegalStateException("INSERT did not return a key");
				return rs.getLong(1);
			}
		} catch (SQLException e) {
			throw new IllegalStateException("egg insert failed for owner=" + userId, e);
		}
	}

	private void stampHatched(long eggId, long dinoId, Instant when) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE egg_instance SET hatched_at = ?, hatch_dino_id = ? WHERE id = ?")) {
			ps.setLong(1, when.toEpochMilli());
			ps.setLong(2, dinoId);
			ps.setLong(3, eggId);
			ps.executeUpdate();
		} catch (SQLException e) {
			throw new IllegalStateException("egg stamp-hatched failed for id=" + eggId, e);
		}
	}

	// ─── row mapping ─────────────────────────────────────────────────────

	private static final String SELECT_ALL = """
		SELECT id, owner_user_id, rarity, species_id,
		       purchased_at, ready_at, hatched_at, hatch_dino_id, notified_at
		FROM egg_instance
		""";

	private static EggInstance mapRow(ResultSet rs) throws SQLException {
		String species = rs.getString("species_id");
		Optional<String> speciesId = (species == null) ? Optional.empty() : Optional.of(species);

		long hatchedRaw = rs.getLong("hatched_at");
		Optional<Instant> hatchedAt = rs.wasNull() ? Optional.empty()
			: Optional.of(Instant.ofEpochMilli(hatchedRaw));

		long hatchDino = rs.getLong("hatch_dino_id");
		OptionalLong hatchDinoId = rs.wasNull() ? OptionalLong.empty() : OptionalLong.of(hatchDino);

		long notifiedRaw = rs.getLong("notified_at");
		Optional<Instant> notifiedAt = rs.wasNull() ? Optional.empty()
			: Optional.of(Instant.ofEpochMilli(notifiedRaw));

		return new EggInstance(
			rs.getLong("id"),
			rs.getLong("owner_user_id"),
			rs.getString("rarity"),
			speciesId,
			Instant.ofEpochMilli(rs.getLong("purchased_at")),
			Instant.ofEpochMilli(rs.getLong("ready_at")),
			hatchedAt,
			hatchDinoId,
			notifiedAt
		);
	}

	// ─── result + exception types ────────────────────────────────────────

	/**
	 * What a successful hatch produced.
	 */
	public record HatchResult(long eggId, DinoSpecies species, DinoInstance dino, int xpAwarded) {
	}

	/** Thrown when a player tries to spend more coins than they have. */
	public static final class InsufficientCoinsException extends GameException {
		public InsufficientCoinsException(String msg) {
			super("Not enough coins", msg);
		}
	}

	/** Thrown when a player tries to buy an egg but their pending eggs already fill every level-derived incubation slot. */
	public static final class EggSlotsFullException extends GameException {
		public EggSlotsFullException(String msg) {
			super("Slots full", msg);
		}
	}

	/** Thrown when a player tries to buy an egg of a rarity their current level hasn't unlocked yet. */
	public static final class RarityLockedException extends GameException {
		public RarityLockedException(String msg) {
			super("Rarity locked", msg);
		}
	}

	/** Thrown when a player tries to buy a determined egg but owns no enclosure that could ever house the species. */
	public static final class NoHabitatException extends GameException {
		public NoHabitatException(String msg) {
			super("No habitat", msg);
		}
	}

	/**
	 * Thrown by {@link #hatch} when the player has no enclosure able to
	 * accommodate the species (insufficient tier, wrong domain, or full).
	 */
	public static final class NoCompatibleEnclosureException extends GameException {
		public NoCompatibleEnclosureException(String msg) {
			super("No room", msg);
		}
	}

	/** Thrown when {@link #hatch} or {@link #adminForceReady} is asked about an egg id that doesn't exist. */
	public static final class EggNotFoundException extends GameException {
		public EggNotFoundException(String msg) {
			super("Egg not found", msg);
		}
	}

	/** Thrown when a player tries to hatch (or otherwise act on) an egg they don't own. */
	public static final class EggOwnershipException extends GameException {
		public EggOwnershipException(String msg) {
			super("Not your egg", msg);
		}
	}

	/** Thrown when a player tries to hatch an egg whose row already has a {@code hatched_at}. */
	public static final class EggAlreadyHatchedException extends GameException {
		public EggAlreadyHatchedException(String msg) {
			super("Already hatched", msg);
		}
	}

	/** Thrown when a player tries to hatch an egg before its {@code ready_at}. */
	public static final class EggNotReadyException extends GameException {
		public EggNotReadyException(String msg) {
			super("Not ready yet", msg);
		}
	}
}
