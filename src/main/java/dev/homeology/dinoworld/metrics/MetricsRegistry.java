package dev.homeology.dinoworld.metrics;

import io.micrometer.core.instrument.*;
import io.micrometer.core.instrument.binder.jvm.JvmGcMetrics;
import io.micrometer.core.instrument.binder.jvm.JvmMemoryMetrics;
import io.micrometer.core.instrument.binder.jvm.JvmThreadMetrics;
import io.micrometer.core.instrument.binder.system.ProcessorMetrics;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

/**
 * In-process Micrometer registry for the bot's runtime metrics.
 *
 * <p>Backed by {@link SimpleMeterRegistry} — no external exporter, no HTTP
 * endpoint. Metrics are surfaced via {@code /debug metrics}; if a Prometheus
 * exporter is wired in later, only this class needs to change (replace the
 * registry implementation; instrumentation call sites are unaffected).
 *
 * <p>Standard meters bound at construction:
 * <ul>
 *   <li>{@code commands.invocations} (counter, tags: command, outcome)</li>
 *   <li>{@code commands.duration} (timer, tag: command)</li>
 *   <li>{@code commands.denied} (counter, tag: reason)</li>
 *   <li>{@code commands.rate_limited} (counter)</li>
 *   <li>JVM heap, GC, threads, and processor binders from
 *       {@code micrometer-core}</li>
 * </ul>
 */
public final class MetricsRegistry implements AutoCloseable {

	private final MeterRegistry registry;
	/**
	 * Held so we can unregister the JMX GC notification listener at teardown.
	 */
	private final JvmGcMetrics gcMetrics;

	public MetricsRegistry() {
		this.registry = new SimpleMeterRegistry();
		// Bind once at startup. Memory/thread/processor binders register meters
		// and need no cleanup; JvmGcMetrics installs a JMX NotificationListener
		// and must be closed on teardown to avoid leaking it across restarts.
		new JvmMemoryMetrics().bindTo(registry);
		this.gcMetrics = new JvmGcMetrics();
		gcMetrics.bindTo(registry);
		new JvmThreadMetrics().bindTo(registry);
		new ProcessorMetrics().bindTo(registry);
	}

	/**
	 * @return the underlying Micrometer registry
	 */
	public MeterRegistry registry() {
		return registry;
	}

	@Override
	public void close() {
		gcMetrics.close();
	}

	/**
	 * Record a command invocation with its outcome.
	 */
	public void recordInvocation(String command, String outcome) {
		Counter.builder("commands.invocations")
			.tags(Tags.of("command", command, "outcome", outcome))
			.register(registry)
			.increment();
	}

	/**
	 * Record the elapsed nanoseconds for a successful command body.
	 */
	public void recordDuration(String command, long elapsedNanos) {
		Timer.builder("commands.duration")
			.tag("command", command)
			.register(registry)
			.record(elapsedNanos, java.util.concurrent.TimeUnit.NANOSECONDS);
	}

	/**
	 * Record a command denial (permission, unknown, overload, etc.).
	 */
	public void recordDenied(String reason) {
		Counter.builder("commands.denied")
			.tag("reason", reason)
			.register(registry)
			.increment();
	}

	/**
	 * Record a rate-limit rejection.
	 */
	public void recordRateLimited() {
		Counter.builder("commands.rate_limited")
			.register(registry)
			.increment();
	}

	/**
	 * Build a stable tag list for cardinality-controlled metrics. Helper for
	 * callers building their own meters.
	 */
	public static Tags tags(String... pairs) {
		if ((pairs.length & 1) != 0) {
			throw new IllegalArgumentException("tags() requires an even number of arguments");
		}
		Tag[] arr = new Tag[pairs.length / 2];
		for (int i = 0; i < arr.length; i++) {
			arr[i] = Tag.of(pairs[2 * i], pairs[2 * i + 1]);
		}
		return Tags.of(arr);
	}
}
