package dev.homeology.dinoworld.modules.zoo;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.core.Module;
import dev.homeology.dinoworld.core.ModuleContext;
import dev.homeology.dinoworld.modules.notify.NotificationService;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.staff.StaffEffectsService;

import java.time.Duration;
import java.util.List;

/**
 * Owns the Zoo Tycoon game state — catalogs, persistent CRUD services,
 * tick-driven income/decay/notify, and the player-facing commands.
 *
 * <p>Loaded last alphabetically (c &lt; n &lt; p &lt; z), so its
 * {@code onEnable} can safely consume services from earlier modules:
 * {@code PlayerService} (from {@code players}) and
 * {@code NotificationService} (from {@code notify}).
 *
 * <p>Owns migrations {@code zoo/V1__core_tables.sql} (enclosures, dinos,
 * eggs) and {@code zoo/V2__egg_notified.sql} (notified_at column).
 */
public final class ZooModule implements Module {

	private RarityCatalog rarities;
	private DinoCatalog catalog;
	private EnclosureService enclosures;
	private DinoInstanceService dinos;
	private EggService eggs;
	private ParkRatingService parkRating;
	private IncomeTickService incomeTick;
	private HappinessTickService happinessTick;
	private EggReadyNotifyService eggReadyNotify;
	private EggImageProvider eggImages;
	private ZooCommand zooCommand;
	private ShopCommand shopCommand;
	private EggsCommand eggsCommand;
	private HatchCommand hatchCommand;
	private FeedCommand feedCommand;
	private SellCommand sellCommand;
	private EnclosuresCommand enclosuresCommand;
	private MoveCommand moveCommand;
	private AdminCommand adminCommand;
	private ModuleContext ctx;

	@Override
	public String name() {
		return "zoo";
	}

	@Override
	public void onLoad(ModuleContext ctx) {
		this.ctx = ctx;
		// Rarities first — DinoCatalog validates each species' rarity against this.
		this.rarities = new RarityCatalog();
		ctx.services().register(RarityCatalog.class, rarities);
		this.catalog = new DinoCatalog(rarities);
		ctx.services().register(DinoCatalog.class, catalog);

		// Persistent CRUD layer — tables defined in zoo/V1.
		this.enclosures = new EnclosureService(ctx.database().dataSource());
		ctx.services().register(EnclosureService.class, enclosures);
		this.dinos = new DinoInstanceService(ctx.database().dataSource());
		ctx.services().register(DinoInstanceService.class, dinos);

		// EggService composes everything above plus PlayerService (registered
		// by the `players` module which loads before us alphabetically).
		PlayerService playerService = ctx.services().get(PlayerService.class);
		// StaffEffectsService is published by the staff module (loads before
		// zoo: c < n < p < s < z). tryGet supports staff being disabled.
		StaffEffectsService staffEffects = ctx.services().tryGet(StaffEffectsService.class).orElse(null);
		this.eggs = new EggService(ctx.database().dataSource(),
			rarities, catalog, playerService, dinos, enclosures, staffEffects);
		ctx.services().register(EggService.class, eggs);

		// Pure-derivation rating helper — no persistence.
		this.parkRating = new ParkRatingService(dinos, enclosures, catalog);
		ctx.services().register(ParkRatingService.class, parkRating);

		// Hourly tick handlers (registered with the scheduler in onEnable).
		// Staff effects (Marketer income multiplier, Vet decay reduction) are
		// applied per-tick when the staff module is loaded.
		this.incomeTick = new IncomeTickService(dinos, catalog, playerService, staffEffects);
		this.happinessTick = new HappinessTickService(dinos, enclosures, catalog, staffEffects);

		// Asset cache for shop + egg-ready embeds. Files may be missing —
		// EggImageProvider returns Optional.empty and embeds skip the image.
		this.eggImages = new EggImageProvider();
		ctx.services().register(EggImageProvider.class, eggImages);
	}

	@Override
	public void onEnable() {
		PlayerService players = ctx.services().get(PlayerService.class);
		NotificationService notify = ctx.services().get(NotificationService.class);

		this.zooCommand = new ZooCommand(players, catalog, dinos, enclosures,
			parkRating, players.leveling());
		this.shopCommand = new ShopCommand(players, rarities, catalog, eggImages, enclosures);
		this.eggsCommand = new EggsCommand(players, eggs, rarities, catalog, players.leveling());
		this.hatchCommand = new HatchCommand(players, eggs, rarities);
		this.feedCommand = new FeedCommand(players, dinos, catalog);
		this.sellCommand = new SellCommand(players, dinos, catalog);
		this.enclosuresCommand = new EnclosuresCommand(players, enclosures, dinos, catalog);
		this.moveCommand = new MoveCommand(players, dinos, enclosures, catalog);

		ctx.components().register(ZooComponentHandler.NAMESPACE,
			new ZooComponentHandler(players, rarities, catalog, eggs, enclosures, eggImages,
				eggsCommand, dinos, enclosuresCommand, moveCommand));

		// Recurring jobs. TickScheduler back-fills missed ticks (capped at 24h)
		// so a bot outage credits up to one day of offline income/decay on
		// restart. Job names are namespaced to keep tick_state readable.
		ctx.tickScheduler().register("zoo.income", Duration.ofHours(1), incomeTick::runOnce);
		ctx.tickScheduler().register("zoo.happiness_decay", Duration.ofHours(1), happinessTick::runOnce);

		// 5-minute egg-ready announcer. Notifications are exactly-once via
		// the egg_instance.notified_at column, so a long outage still DMs
		// each newly-ready egg one time on restart.
		this.eggReadyNotify = new EggReadyNotifyService(eggs, rarities, catalog, notify);
		ctx.tickScheduler().register("zoo.egg_ready_notify",
			Duration.ofMinutes(5), eggReadyNotify::runOnce);

		// Dev-only utility command — built last so it can reference every
		// service registered above. AdminWipeService spans every table the
		// bot owns, so it lives here too.
		AdminWipeService wipe = new AdminWipeService(ctx.database().dataSource());
		ctx.services().register(AdminWipeService.class, wipe);
		this.adminCommand = new AdminCommand(players, eggs, dinos, rarities, catalog,
			incomeTick, happinessTick, eggReadyNotify, wipe);
	}

	@Override
	public List<Object> listeners() {
		// AdminCommand is also a ListenerAdapter for slash autocomplete.
		return adminCommand == null ? List.of() : List.of(adminCommand);
	}

	@Override
	public List<Command> commands() {
		// commands() is queried after onEnable, so commands are non-null by then.
		if (zooCommand == null) return List.of();
		return List.of(zooCommand, shopCommand, eggsCommand, hatchCommand,
			feedCommand, sellCommand, enclosuresCommand, moveCommand, adminCommand);
	}
}
