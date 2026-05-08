package dev.homeology.dinoworld.lifecycle;

import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.core.ModuleManager;
import dev.homeology.dinoworld.database.Database;
import dev.homeology.dinoworld.metrics.MetricsRegistry;
import dev.homeology.dinoworld.scheduler.TickScheduler;
import net.dv8tion.jda.api.JDA;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Centralizes the bot's teardown sequence so every shutdown path
 * (JVM hook, {@code /debug system shutdown}, {@code /debug system restart})
 * runs the same logic and exits with the right code.
 *
 * <p>Teardown order:
 * <ol>
 *   <li>{@link ModuleManager#disableAll()} — give modules a chance to clean
 *       up while JDA is still connected.</li>
 *   <li>{@link JDA#shutdown()} + {@code awaitShutdown(5s)} — let in-flight
 *       commands finish replying.</li>
 *   <li>{@link JDA#shutdownNow()} only if the await timed out.</li>
 *   <li>Stop the shared scheduler (and any other executors).</li>
 *   <li>{@link CacheManager} has nothing to release explicitly.</li>
 *   <li>{@link Database#close()} closes the Hikari pool.</li>
 *   <li>{@link MetricsRegistry#close()} unregisters the JMX GC listener.</li>
 *   <li>{@code System.exit(code)} — only when called via {@link #shutdown(int)}
 *       or {@link #restart()}; the JVM hook path skips it (the JVM is
 *       already on its way out).</li>
 * </ol>
 *
 * <p>All teardown methods are idempotent — a second call is a no-op.
 */
public final class LifecycleManager {

	private static final Logger log = LoggerFactory.getLogger(LifecycleManager.class);
	private static final Duration JDA_AWAIT = Duration.ofSeconds(5);

	private final ModuleManager modules;
	private final ExecutorService scheduler;
	private final ExecutorService commandExecutor;
	private final Database database;
	private final MetricsRegistry metrics;
	private final TickScheduler tickScheduler;
	/**
	 * JDA reference is set after JDA is built — null while bootstrap is mid-flight.
	 */
	private volatile JDA jda;
	private final AtomicBoolean tornDown = new AtomicBoolean(false);

	public LifecycleManager(ModuleManager modules,
	                        ExecutorService scheduler,
	                        ExecutorService commandExecutor,
	                        Database database,
	                        MetricsRegistry metrics,
	                        TickScheduler tickScheduler) {
		this.modules = modules;
		this.scheduler = scheduler;
		this.commandExecutor = commandExecutor;
		this.database = database;
		this.metrics = metrics;
		this.tickScheduler = tickScheduler;
	}

	/**
	 * Bind the JDA instance once it's been built.
	 */
	public void attachJda(JDA jda) {
		this.jda = jda;
	}

	/**
	 * Run teardown without exiting the JVM. Intended for the JVM shutdown hook.
	 */
	public void teardown() {
		if (!tornDown.compareAndSet(false, true)) return;

		log.info("Teardown: disabling modules...");
		try {
			modules.disableAll();
		} catch (Exception e) {
			log.warn("Module disable error", e);
		}

		if (jda != null) {
			log.info("Teardown: shutting down JDA...");
			try {
				jda.shutdown();
				if (!jda.awaitShutdown(JDA_AWAIT)) {
					log.warn("JDA did not shut down within {}; calling shutdownNow()", JDA_AWAIT);
					jda.shutdownNow();
				}
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				log.warn("Interrupted waiting for JDA shutdown", e);
				jda.shutdownNow();
			} catch (Exception e) {
				log.warn("JDA shutdown error", e);
			}
		}

		log.info("Teardown: cancelling tick jobs...");
		try {
			tickScheduler.shutdown();
		} catch (Exception e) {
			log.warn("TickScheduler shutdown error", e);
		}

		log.info("Teardown: stopping command executor...");
		commandExecutor.shutdown();
		try {
			if (!commandExecutor.awaitTermination(3, TimeUnit.SECONDS)) {
				commandExecutor.shutdownNow();
			}
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			commandExecutor.shutdownNow();
		}

		log.info("Teardown: stopping scheduler...");
		scheduler.shutdown();
		try {
			if (!scheduler.awaitTermination(2, TimeUnit.SECONDS)) {
				scheduler.shutdownNow();
			}
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			scheduler.shutdownNow();
		}

		log.info("Teardown: closing database...");
		try {
			database.close();
		} catch (Exception e) {
			log.warn("Database close error", e);
		}

		log.info("Teardown: closing metrics...");
		try {
			metrics.close();
		} catch (Exception e) {
			log.warn("Metrics close error", e);
		}

		log.info("Teardown complete.");
	}

	/**
	 * Run teardown, then {@link System#exit(int)} with {@link ExitCodes#OK}.
	 * Used by {@code /debug system shutdown}.
	 */
	public void shutdown(int exitCode) {
		// Run on a fresh thread so the calling JDA dispatcher can return;
		// otherwise we'd be shutting JDA down from inside its own thread.
		Thread t = new Thread(() -> {
			teardown();
			System.exit(exitCode);
		}, "dinoworld-shutdown");
		t.setDaemon(false);
		t.start();
	}

	/**
	 * Run teardown, then {@link System#exit(int)} with {@link ExitCodes#RESTART}.
	 * The supervisor (run.sh / systemd) restarts the JVM on this exit code.
	 */
	public void restart() {
		shutdown(ExitCodes.RESTART);
	}
}
