package dev.homeology.dinoworld.command;

import dev.homeology.dinoworld.config.AppConfig;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.entities.Activity;
import net.dv8tion.jda.api.entities.Guild;
import net.dv8tion.jda.api.interactions.commands.build.SlashCommandData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.List;
import java.util.Properties;

/**
 * One-shot startup task: syncs slash commands with Discord and applies the
 * configured presence.
 *
 * <p>Called explicitly from {@link dev.homeology.dinoworld.Bootstrap} after
 * {@code jda.awaitReady()} returns. Previously this was a {@code ReadyEvent}
 * listener, but module {@code onEnable} can run long enough (e.g. when
 * {@link dev.homeology.dinoworld.scheduler.TickScheduler} back-fills missed
 * ticks across a multi-hour outage) that the listener was attached AFTER
 * the gateway had already fired its single {@code ReadyEvent}, silently
 * skipping every sync. Switching to an explicit call from Bootstrap makes
 * the order deterministic regardless of how slow {@code enableAll} gets.
 *
 * <p>Sync strategy: a SHA-256 hash of the desired command set's serialized
 * JSON (via {@link SlashCommandData#toData()}) is computed at startup,
 * compared against the hash persisted in {@code data/.commands.sync}, and
 * the update REST call only fires when they differ. Any change — a new
 * command, a removed command, a renamed option, an edited description, an
 * added choice — alters the hash and triggers a push, so feature work
 * always deploys without manual intervention. After a successful push the
 * file is updated with the new hash so the next start sees the cache
 * coherent again.
 *
 * <p>The persisted file holds one entry per sync scope: {@code global} and
 * {@code guild.<id>} keys, so global vs dev-guild registrations are
 * tracked independently.
 *
 * <p>Safety: if the desired list is empty, the registry refuses to push.
 * Pushing an empty list to Discord wipes every previously-registered
 * command, which is almost never what we want.
 */
public final class CommandRegistry {

	private static final Logger log = LoggerFactory.getLogger(CommandRegistry.class);
	private static final Path SYNC_FILE = Paths.get("data", ".commands.sync");

	private final List<Command> commands;
	private final AppConfig config;

	public CommandRegistry(List<Command> commands, AppConfig config) {
		this.commands = List.copyOf(commands);
		this.config = config;
	}

	/**
	 * Apply presence and sync the slash command set with Discord. Caller
	 * must ensure {@code jda} has reached {@link JDA.Status#CONNECTED}
	 * (typically via {@link JDA#awaitReady()}) before calling.
	 */
	public void sync(JDA jda) {
		applyPresence(jda);

		if (commands.isEmpty()) {
			log.error("No commands assembled -- refusing to push to Discord (would wipe globals).");
			return;
		}

		List<SlashCommandData> desired = commands.stream()
			.map(Command::slashData)
			.toList();
		String desiredHash = hash(desired);

		Long devGuildId = config.devGuildId();
		if (devGuildId != null) {
			Guild guild = jda.getGuildById(devGuildId);
			if (guild == null) {
				log.error("DEV_GUILD_ID={} but the bot is not in that guild -- commands NOT registered.", devGuildId);
				return;
			}
			syncGuild(guild, desired, desiredHash);
		} else {
			syncGlobal(jda, desired, desiredHash);
		}
	}

	private void applyPresence(JDA jda) {
		AppConfig.ActivityType type = config.activityType();
		String text = config.activityText();
		if (type == AppConfig.ActivityType.NONE || text == null || text.isBlank()) {
			log.debug("No presence configured (BOT_ACTIVITY_TYPE=NONE or empty text)");
			return;
		}
		Activity activity = switch (type) {
			case PLAYING -> Activity.playing(text);
			case WATCHING -> Activity.watching(text);
			case LISTENING -> Activity.listening(text);
			case COMPETING -> Activity.competing(text);
			// unreachable, handled above
			default -> throw new IllegalStateException("Unexpected value: " + type);
		};
		jda.getPresence().setActivity(activity);
		log.info("Presence set: {} {}", type, text);
	}

	private static void syncGlobal(JDA jda, List<SlashCommandData> desired, String desiredHash) {
		String key = "global";
		if (matchesStoredHash(key, desiredHash)) {
			log.info("Global slash command set unchanged (hash={}) -- skipping push ({} commands).",
				desiredHash.substring(0, 12), desired.size());
			return;
		}
		log.info("Pushing {} global slash commands (new hash {}).",
			desired.size(), desiredHash.substring(0, 12));
		jda.updateCommands().addCommands(desired).queue(
			ok -> {
				storeHash(key, desiredHash);
				log.info("Global slash command push complete.");
			},
			err -> log.error("Global slash command push failed", err));
	}

	private static void syncGuild(Guild guild, List<SlashCommandData> desired, String desiredHash) {
		String key = "guild." + guild.getId();
		if (matchesStoredHash(key, desiredHash)) {
			log.info("Guild '{}' slash command set unchanged (hash={}) -- skipping push ({} commands).",
				guild.getName(), desiredHash.substring(0, 12), desired.size());
			return;
		}
		log.info("Pushing {} slash commands to guild '{}' (new hash {}).",
			desired.size(), guild.getName(), desiredHash.substring(0, 12));
		guild.updateCommands().addCommands(desired).queue(
			ok -> {
				storeHash(key, desiredHash);
				log.info("Guild slash command push complete.");
			},
			err -> log.error("Guild slash command push failed", err));
	}

	// ─── hash + persistence ──────────────────────────────────────────────

	/**
	 * Stable SHA-256 over the desired command set. Sorted by command name
	 * so the hash is deterministic regardless of module discovery order.
	 */
	private static String hash(List<SlashCommandData> commands) {
		StringBuilder concatenated = new StringBuilder();
		commands.stream()
			.sorted(Comparator.comparing(SlashCommandData::getName))
			.forEach(c -> concatenated.append(c.toData()).append('\n'));
		try {
			MessageDigest md = MessageDigest.getInstance("SHA-256");
			byte[] digest = md.digest(concatenated.toString().getBytes(StandardCharsets.UTF_8));
			StringBuilder hex = new StringBuilder(digest.length * 2);
			for (byte b : digest) hex.append(String.format("%02x", b));
			return hex.toString();
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException("SHA-256 not available", e);
		}
	}

	private static boolean matchesStoredHash(String key, String desired) {
		Properties p = readSyncFile();
		return desired.equals(p.getProperty(key));
	}

	private static void storeHash(String key, String hash) {
		Properties p = readSyncFile();
		p.setProperty(key, hash);
		try {
			Files.createDirectories(SYNC_FILE.getParent());
			try (var out = Files.newBufferedWriter(SYNC_FILE, StandardCharsets.UTF_8)) {
				p.store(out, "Dino-World command sync hashes -- safe to delete to force re-push.");
			}
		} catch (IOException e) {
			// Don't fail the bot over a cache write -- next start will re-push.
			log.warn("Could not write {}: {}. Next start will push commands again.",
				SYNC_FILE, e.toString());
		}
	}

	private static Properties readSyncFile() {
		Properties p = new Properties();
		if (!Files.exists(SYNC_FILE)) return p;
		try (var in = Files.newBufferedReader(SYNC_FILE, StandardCharsets.UTF_8)) {
			p.load(in);
		} catch (IOException e) {
			log.warn("Could not read {}: {}. Treating as empty (will push).", SYNC_FILE, e.toString());
		}
		return p;
	}
}
