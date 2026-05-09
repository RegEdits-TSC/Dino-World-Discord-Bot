package dev.homeology.dinoworld.modules.staff;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.core.Module;
import dev.homeology.dinoworld.core.ModuleContext;
import dev.homeology.dinoworld.modules.notify.NotificationService;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.DinoInstanceService;
import dev.homeology.dinoworld.modules.zoo.EnclosureService;
import dev.homeology.dinoworld.modules.zoo.IssueDetector;

import java.time.Clock;
import java.time.Duration;
import java.util.List;

/**
 * Owns the staff system — catalogs, persistence, tick jobs, and slash
 * surface for hiring/firing the four NPC roles.
 *
 * <p>Module load order is alphabetical, so this module sees:
 * <ul>
 *   <li>{@code core} (V1–V4 migrations) — ✓ before us</li>
 *   <li>{@code notify} (NotificationService) — ✓ before us</li>
 *   <li>{@code players} (PlayerService) — ✓ before us</li>
 *   <li>{@code zoo} (DinoInstanceService, EnclosureService) — ⚠️ <em>after</em> us</li>
 * </ul>
 *
 * <p>So {@link #onLoad} only registers the things {@code zoo}'s onLoad
 * needs from us ({@link StaffEffectsService} for happiness/income/incubation
 * modifiers); we consume {@code zoo}'s services in {@link #onEnable},
 * which runs after every module's onLoad has completed.
 *
 * <p>Owns migration {@code staff/V1__staff_tables.sql}.
 */
public final class StaffModule implements Module {

	private StaffCatalog catalog;
	private StaffMemberService memberService;
	private StaffEffectsService effects;
	private AutoFeedTickService autoFeedTick;
	private StaffWagesTickService wagesTick;
	private StaffCommand staffCommand;
	private StaffComponentHandler handler;
	private ModuleContext ctx;

	@Override
	public String name() {
		return "staff";
	}

	@Override
	public void onLoad(ModuleContext ctx) {
		this.ctx = ctx;
		this.catalog = new StaffCatalog();
		ctx.services().register(StaffCatalog.class, catalog);

		this.memberService = new StaffMemberService(ctx.database().dataSource());
		ctx.services().register(StaffMemberService.class, memberService);

		this.effects = new StaffEffectsService(memberService, catalog);
		// Published so zoo's HappinessTickService, IncomeTickService and
		// EggService can consume staff effects without a hard import.
		ctx.services().register(StaffEffectsService.class, effects);
	}

	@Override
	public void onEnable() {
		// zoo + players + notify have all completed onLoad by now.
		PlayerService players = ctx.services().get(PlayerService.class);
		NotificationService notify = ctx.services().get(NotificationService.class);
		DinoInstanceService dinos = ctx.services().get(DinoInstanceService.class);
		EnclosureService enclosures = ctx.services().get(EnclosureService.class);

		// IssueDetector is registered in ZooModule.onLoad; tryGet keeps the
		// staff module independently loadable even if zoo is disabled.
		IssueDetector detector = ctx.services().tryGet(IssueDetector.class).orElse(null);

		this.autoFeedTick = new AutoFeedTickService(effects, memberService, dinos);
		this.wagesTick = new StaffWagesTickService(memberService, catalog, players, notify,
			detector, Clock.systemUTC());

		this.staffCommand = new StaffCommand(players, memberService, catalog, enclosures);
		this.handler = new StaffComponentHandler(players, memberService, catalog, enclosures);
		ctx.components().register(StaffComponentHandler.NAMESPACE, handler);

		// Hourly ticks. Wages run first by name (alphabetical inside the
		// scheduler is not guaranteed, but interval-aligned firings are
		// independent — wages and autofeed touch disjoint state).
		ctx.tickScheduler().register("staff.wages", Duration.ofHours(1), wagesTick::runOnce);
		ctx.tickScheduler().register("staff.autofeed", Duration.ofHours(1), autoFeedTick::runOnce);
	}

	@Override
	public List<Command> commands() {
		return staffCommand == null ? List.of() : List.of(staffCommand);
	}

	@Override
	public List<Object> listeners() {
		// StaffCommand is also a ListenerAdapter for staff_id/enclosure_id autocomplete.
		return staffCommand == null ? List.of() : List.of(staffCommand);
	}
}
