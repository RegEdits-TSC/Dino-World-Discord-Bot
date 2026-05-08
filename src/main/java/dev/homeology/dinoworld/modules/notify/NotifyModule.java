package dev.homeology.dinoworld.modules.notify;

import dev.homeology.dinoworld.core.Module;
import dev.homeology.dinoworld.core.ModuleContext;

import java.time.Duration;

/**
 * Hosts the {@link NotificationService} — the bot's only sanctioned way to
 * DM a user, immediate or scheduled.
 *
 * <p>Lifecycle:
 * <ul>
 *   <li>{@link #onLoad} constructs the service and publishes it into the
 *       {@link dev.homeology.dinoworld.core.ServiceRegistry}.</li>
 *   <li>{@link #onEnable} requeues orphan {@code sending} rows (left over
 *       from a crash mid-dispatch) and registers the
 *       {@code notify.dispatch} TickScheduler job at a 30-second cadence,
 *       which drains up to {@value #BATCH_SIZE} due rows per tick.</li>
 * </ul>
 *
 * <p>Owns migration {@code notify/V1__notifications.sql} (the
 * {@code notification_queue} table). Discovered via the SPI file in
 * {@code META-INF/services}. Loaded after {@code core} but before
 * {@code players} and {@code zoo} (alphabetical: c < n < p < z).
 */
public final class NotifyModule implements Module {

	/**
	 * How often the dispatcher tick fires.
	 */
	private static final Duration DISPATCH_INTERVAL = Duration.ofSeconds(30);

	/**
	 * Maximum rows drained per dispatch tick. Keeps each tick's work bounded.
	 */
	private static final int BATCH_SIZE = 50;

	private NotificationService service;
	private ModuleContext ctx;

	@Override
	public String name() {
		return "notify";
	}

	@Override
	public void onLoad(ModuleContext ctx) {
		this.ctx = ctx;
		this.service = new NotificationService(ctx.database().dataSource(), ctx.jda());
		ctx.services().register(NotificationService.class, service);
	}

	@Override
	public void onEnable() {
		service.requeueOrphaned();
		ctx.tickScheduler().register(
			"notify.dispatch",
			DISPATCH_INTERVAL,
			() -> service.dispatchDue(BATCH_SIZE));
	}
}
