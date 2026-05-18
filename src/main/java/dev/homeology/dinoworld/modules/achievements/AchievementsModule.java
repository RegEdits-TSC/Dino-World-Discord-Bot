package dev.homeology.dinoworld.modules.achievements;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.core.Module;
import dev.homeology.dinoworld.core.ModuleContext;
import dev.homeology.dinoworld.modules.notify.NotificationService;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.players.missions.MissionCatalog;
import dev.homeology.dinoworld.modules.players.missions.MissionProgressService;
import dev.homeology.dinoworld.modules.zoo.DinoCatalog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * Auto-unlock achievement system: ~25 one-shot milestones with cosmetic
 * titles and small coin/XP rewards. Mirrors the missions module — YAML
 * catalog, INSERT-on-trigger progress DAO, post-command awarder hook —
 * but the unlock list is broader (covers level, dino state, coin
 * milestones, rarities, traits, tutorial completion).
 *
 * <p>Cross-module wiring is deferred to {@link #onEnable()} because
 * achievements sorts alphabetically before {@code players} — none of the
 * services we depend on ({@code PlayerService}, {@code DinoCatalog},
 * {@code MissionCatalog}, {@code NotificationService}) are in the
 * registry at {@code onLoad} time. The lifecycle contract guarantees
 * every module's {@code onLoad} completes before any {@code onEnable}
 * fires, so by the time we wire the awarder, every dependency is
 * registered.
 *
 * <p>Owns migration {@code achievements/V1__achievements.sql} and
 * ships the players-module migration {@code V4__equipped_title.sql}
 * (the column lives on the player table because it's per-user UI state,
 * not achievement state).
 */
public final class AchievementsModule implements Module {

	private static final Logger log = LoggerFactory.getLogger(AchievementsModule.class);

	private ModuleContext ctx;
	private AchievementCatalog catalog;
	private AchievementProgressService progress;
	private AchievementAwarder awarder;
	private AchievementsCommand command;

	@Override
	public String name() {
		return "achievements";
	}

	@Override
	public void onLoad(ModuleContext ctx) {
		this.ctx = ctx;
		this.catalog = new AchievementCatalog();
		ctx.services().register(AchievementCatalog.class, catalog);
		this.progress = new AchievementProgressService(ctx.database().dataSource());
		ctx.services().register(AchievementProgressService.class, progress);
	}

	@Override
	public void onEnable() {
		PlayerService players = ctx.services().get(PlayerService.class);
		DinoCatalog dinos = ctx.services().get(DinoCatalog.class);
		MissionCatalog missions = ctx.services().get(MissionCatalog.class);
		MissionProgressService missionProgress = ctx.services().get(MissionProgressService.class);
		// Notify module is optional — DM unlocks just become a no-op if it's disabled.
		NotificationService notifications = ctx.services()
			.tryGet(NotificationService.class).orElse(null);

		this.awarder = new AchievementAwarder(
			ctx.database().dataSource(), catalog, progress, players,
			dinos, missions, missionProgress, notifications);
		ctx.services().register(AchievementAwarder.class, awarder);

		this.command = new AchievementsCommand(players, catalog, progress);

		log.info("Achievements ready: {} catalog entries, notify={}",
			catalog.size(), notifications != null ? "on" : "off");
	}

	@Override
	public List<Command> commands() {
		return command == null ? List.of() : List.of(command);
	}

	@Override
	public List<Object> listeners() {
		return command == null ? List.of() : List.of(command);
	}
}
