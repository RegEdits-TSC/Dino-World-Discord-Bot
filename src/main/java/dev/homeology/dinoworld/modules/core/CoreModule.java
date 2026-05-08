package dev.homeology.dinoworld.modules.core;

import dev.homeology.dinoworld.command.Command;
import dev.homeology.dinoworld.core.Module;
import dev.homeology.dinoworld.core.ModuleContext;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

/**
 * The always-on built-in module.
 *
 * <p>Ships the bot's foundational commands:
 * <ul>
 *   <li>{@code /ping} — public latency probe</li>
 *   <li>{@code /about} — public bot info (version, uptime, modules, JVM)</li>
 *   <li>{@code /help} — public command listing, hides developer-only commands
 *       from non-developers</li>
 *   <li>{@code /feedback} — public; DMs the developer with the user's message</li>
 *   <li>{@code /debug} — developer-only diagnostics and control</li>
 * </ul>
 *
 * <p>Owns the V1 (no-op), V2 (guild_settings), and V3 (feedback_log +
 * feedback_blacklist) migrations under {@code db/migrations/core/}.
 *
 * <p>Discovered via the {@code META-INF/services} SPI file, like every other
 * module.
 */
public final class CoreModule implements Module {

	/**
	 * Default backup directory; matches what {@code scripts/backup.sh} writes to.
	 */
	private static final Path DEFAULT_BACKUP_DIR = Paths.get("backups");

	private PingCommand ping;
	private AboutCommand about;
	private HelpCommand help;
	private FeedbackCommand feedback;
	private DebugCommand debug;

	@Override
	public String name() {
		return "core";
	}

	@Override
	public void onLoad(ModuleContext ctx) {
		FeedbackStore feedbackStore = new FeedbackStore(ctx.database().dataSource());
		this.ping = new PingCommand();
		this.about = new AboutCommand(ctx.startedAt(), ctx.modules());
		this.help = new HelpCommand(ctx.modules(), ctx.config());
		this.feedback = new FeedbackCommand(feedbackStore);
		this.debug = new DebugCommand(
			ctx.modules(),
			ctx.migrationRunner(),
			ctx.database(),
			ctx.cache(),
			ctx.lifecycle(),
			ctx.metrics(),
			feedbackStore,
			DEFAULT_BACKUP_DIR);
	}

	@Override
	public List<Command> commands() {
		return List.of(ping, about, help, feedback, debug);
	}

	@Override
	public List<Object> listeners() {
		// DebugCommand doubles as a listener for the <logger> autocomplete;
		// HelpCommand likewise serves the <command> autocomplete on /help.
		return List.of(debug, help);
	}
}
