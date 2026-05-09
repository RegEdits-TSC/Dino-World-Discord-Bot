package dev.homeology.dinoworld.modules.players;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.core.Module;
import dev.homeology.dinoworld.core.ModuleContext;

import java.util.List;

/**
 * Owns the per-Discord-user game profile (coins, xp, level, last-seen) and
 * the append-only coin ledger.
 *
 * <p>Publishes a {@link PlayerService} into the
 * {@link dev.homeology.dinoworld.core.ServiceRegistry} during
 * {@link #onLoad}, so any later module — typically {@code zoo} — can mutate
 * a user's balance without importing this package directly.
 *
 * <p>Owns migration {@code players/V1__players.sql}, which creates the
 * {@code player} and {@code coin_ledger} tables.
 *
 * <p>Discovered via the SPI file at
 * {@code META-INF/services/dev.homeology.dinoworld.core.Module}. Loaded
 * after {@code core} and {@code notify} (alphabetical) so its services are
 * available to {@code zoo} when that module's {@code onEnable} runs.
 */
public final class PlayersModule implements Module {

	private LevelingService leveling;
	private PlayerService playerService;
	private ProfileCommand profileCommand;
	private DailyCommand dailyCommand;
	private RankCommand rankCommand;

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

		this.profileCommand = new ProfileCommand(playerService);
		this.dailyCommand = new DailyCommand(playerService);
		this.rankCommand = new RankCommand(playerService);
	}

	@Override
	public List<Command> commands() {
		return List.of(profileCommand, dailyCommand, rankCommand);
	}
}
