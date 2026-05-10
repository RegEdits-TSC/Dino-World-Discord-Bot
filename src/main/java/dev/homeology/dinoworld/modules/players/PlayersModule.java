package dev.homeology.dinoworld.modules.players;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.core.Module;
import dev.homeology.dinoworld.core.ModuleContext;
import dev.homeology.dinoworld.modules.players.missions.MissionAwarder;
import dev.homeology.dinoworld.modules.players.missions.MissionCatalog;
import dev.homeology.dinoworld.modules.players.missions.MissionProgressService;

import java.util.List;

/**
 * Owns the per-Discord-user game profile (coins, xp, level, last-seen),
 * the append-only coin ledger, and the tutorial / mission system.
 *
 * <p>Publishes a {@link PlayerService} into the
 * {@link dev.homeology.dinoworld.core.ServiceRegistry} during
 * {@link #onLoad}, so any later module — typically {@code zoo} — can mutate
 * a user's balance without importing this package directly.
 *
 * <p>Also publishes a {@link MissionAwarder} so the slash-command router
 * can run a post-execution awarder pass without an explicit dependency
 * on this module — see {@code CommandRouter.runMissionHook}.
 *
 * <p>Owns migrations {@code players/V1__players.sql} (player + coin_ledger
 * tables) and {@code players/V2__mission_progress.sql}.
 *
 * <p>Discovered via the SPI file at
 * {@code META-INF/services/dev.homeology.dinoworld.core.Module}. Loaded
 * after {@code core} and {@code notify} (alphabetical) so its services are
 * available to {@code zoo} when that module's {@code onEnable} runs.
 */
public final class PlayersModule implements Module {

	private LevelingService leveling;
	private PlayerService playerService;
	private MissionCatalog missionCatalog;
	private MissionProgressService missionProgress;
	private MissionAwarder missionAwarder;
	private ProfileCommand profileCommand;
	private DailyCommand dailyCommand;
	private RankCommand rankCommand;
	private MissionsCommand missionsCommand;

	@Override
	public String name() {
		return "players";
	}

	@Override
	public void onLoad(ModuleContext ctx) {
		this.leveling = new LevelingService();
		ctx.services().register(LevelingService.class, leveling);

		this.playerService = new PlayerService(ctx.database().dataSource(), ctx.cache(), leveling);
		ctx.services().register(PlayerService.class, playerService);

		// Missions: catalog loads from YAML at startup; progress + awarder
		// hang off the same DataSource. Awarder is published into the
		// service registry so CommandRouter (built later in Bootstrap) can
		// pull it without an explicit module dependency.
		this.missionCatalog = new MissionCatalog();
		ctx.services().register(MissionCatalog.class, missionCatalog);
		this.missionProgress = new MissionProgressService(ctx.database().dataSource());
		ctx.services().register(MissionProgressService.class, missionProgress);
		this.missionAwarder = new MissionAwarder(
			ctx.database().dataSource(), missionCatalog, missionProgress, playerService);
		ctx.services().register(MissionAwarder.class, missionAwarder);

		this.profileCommand = new ProfileCommand(playerService);
		this.dailyCommand = new DailyCommand(playerService);
		this.rankCommand = new RankCommand(playerService);
		this.missionsCommand = new MissionsCommand(playerService, missionCatalog, missionProgress);
	}

	@Override
	public List<Command> commands() {
		return List.of(profileCommand, dailyCommand, rankCommand, missionsCommand);
	}
}
