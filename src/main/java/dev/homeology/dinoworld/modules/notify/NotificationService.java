package dev.homeology.dinoworld.modules.notify;

import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.entities.MessageEmbed;
import net.dv8tion.jda.api.entities.User;
import net.dv8tion.jda.api.utils.data.DataObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Schedule and deliver DMs to users.
 *
 * <p>Two entry points: {@link #dmNow(long, MessageEmbed)} for fire-and-forget
 * immediate sends, and {@link #schedule(long, Instant, MessageEmbed)} for
 * deferred delivery via the persistent queue. The persistent path survives
 * bot restarts: payload + due time live in {@code notification_queue}
 * (notify V1) and the {@code notify.dispatch} TickScheduler job drains
 * due rows every 30 seconds.
 *
 * <p>DM failure policy: drop + log. If the user has DMs disabled the row
 * is marked {@code failed} with the JDA error in {@code last_error}; no
 * retry, no channel fallback, no surfaced error to the user. Suitable for
 * non-critical notifications (egg hatched, daily reminder); not suitable
 * for confirmations the user must see.
 *
 * <p>Embeds are serialized via JDA's {@link DataObject} round-trip — the
 * exact same shape Discord's API accepts — so any embed feature that JDA
 * supports (fields, images, footers, timestamps) is preserved across the
 * persist/dispatch cycle.
 */
public final class NotificationService {

	private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

	private final DataSource dataSource;
	private final JDA jda;

	public NotificationService(DataSource dataSource, JDA jda) {
		this.dataSource = dataSource;
		this.jda = jda;
	}

	// ─── send-now ────────────────────────────────────────────────────────

	/**
	 * Send a DM immediately, fire-and-forget.
	 *
	 * <p>Failures (DMs disabled, blocked bot, transient API error) are logged
	 * at WARN level. The caller cannot detect failure — by design.
	 */
	public void dmNow(long userId, MessageEmbed embed) {
		jda.retrieveUserById(userId)
			.flatMap(User::openPrivateChannel)
			.flatMap(c -> c.sendMessageEmbeds(embed))
			.queue(
				ok -> {},
				err -> log.warn("dmNow failed for user={}: {}", userId, err.toString()));
	}

	// ─── schedule ────────────────────────────────────────────────────────

	/**
	 * Enqueue an embed for delivery at {@code dueAt}. Returns the queue row
	 * id so callers can correlate (e.g. cancel the row before it fires).
	 *
	 * @param userId Discord snowflake to DM
	 * @param dueAt  earliest delivery time; will be drained on the first
	 *               {@code notify.dispatch} tick at or after this instant
	 * @param embed  serializable via JDA's {@code MessageEmbed.toData()}
	 * @return primary key of the inserted row
	 */
	public long schedule(long userId, Instant dueAt, MessageEmbed embed) {
		String payload = embed.toData().toString();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "INSERT INTO notification_queue(user_id, due_at, payload_json) VALUES (?, ?, ?)",
			     Statement.RETURN_GENERATED_KEYS)) {
			ps.setLong(1, userId);
			ps.setLong(2, dueAt.toEpochMilli());
			ps.setString(3, payload);
			ps.executeUpdate();
			try (ResultSet rs = ps.getGeneratedKeys()) {
				if (rs.next()) return rs.getLong(1);
				throw new IllegalStateException("INSERT did not return a generated key");
			}
		} catch (SQLException e) {
			throw new IllegalStateException("notification_queue insert failed", e);
		}
	}

	// ─── dispatch (called by NotifyModule's tick handler) ───────────────

	/**
	 * Reset any rows left in {@code sending} from a previous run back to
	 * {@code pending}. Called once at module enable.
	 */
	public void requeueOrphaned() {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE notification_queue SET status = 'pending' WHERE status = 'sending'")) {
			int n = ps.executeUpdate();
			if (n > 0) log.info("Requeued {} stuck 'sending' notification(s) from previous run", n);
		} catch (SQLException e) {
			log.warn("notify requeueOrphaned failed: {}", e.toString());
		}
	}

	/**
	 * Pull up to {@code limit} due rows, mark them {@code sending}, and
	 * fire async DMs. Each row's status is finalized in the JDA callback
	 * (sent or failed). Safe to call from a TickScheduler handler.
	 */
	public void dispatchDue(int limit) {
		List<Pending> due = readDuePending(limit);
		if (due.isEmpty()) return;

		log.debug("notify.dispatch: {} due", due.size());
		for (Pending p : due) {
			markSending(p.id);
			try {
				DataObject data = DataObject.fromJson(p.payloadJson);
				MessageEmbed embed = EmbedBuilder.fromData(data).build();
				long id = p.id;
				long userId = p.userId;
				jda.retrieveUserById(userId)
					.flatMap(User::openPrivateChannel)
					.flatMap(c -> c.sendMessageEmbeds(embed))
					.queue(
						ok -> markSent(id),
						err -> markFailed(id, err.toString()));
			} catch (Exception e) {
				markFailed(p.id, "embed parse: " + e);
			}
		}
	}

	// ─── persistence helpers ─────────────────────────────────────────────

	private List<Pending> readDuePending(int limit) {
		long now = Instant.now().toEpochMilli();
		List<Pending> out = new ArrayList<>();
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     SELECT id, user_id, payload_json
			     FROM notification_queue
			     WHERE status = 'pending' AND due_at <= ?
			     ORDER BY due_at
			     LIMIT ?
			     """)) {
			ps.setLong(1, now);
			ps.setInt(2, limit);
			try (ResultSet rs = ps.executeQuery()) {
				while (rs.next()) {
					out.add(new Pending(rs.getLong(1), rs.getLong(2), rs.getString(3)));
				}
			}
		} catch (SQLException e) {
			log.warn("notify readDuePending failed: {}", e.toString());
		}
		return out;
	}

	private void markSending(long id) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE notification_queue SET status = 'sending', attempts = attempts + 1 WHERE id = ?")) {
			ps.setLong(1, id);
			ps.executeUpdate();
		} catch (SQLException e) {
			log.warn("notify markSending({}) failed: {}", id, e.toString());
		}
	}

	private void markSent(long id) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE notification_queue SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ?")) {
			ps.setLong(1, Instant.now().toEpochMilli());
			ps.setLong(2, id);
			ps.executeUpdate();
		} catch (SQLException e) {
			log.warn("notify markSent({}) failed: {}", id, e.toString());
		}
	}

	private void markFailed(long id, String error) {
		try (Connection c = dataSource.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE notification_queue SET status = 'failed', last_error = ? WHERE id = ?")) {
			ps.setString(1, error == null ? "" : (error.length() > 500 ? error.substring(0, 500) : error));
			ps.setLong(2, id);
			ps.executeUpdate();
		} catch (SQLException e) {
			log.warn("notify markFailed({}) failed: {}", id, e.toString());
		}
		log.info("notify {} failed: {}", id, error);
	}

	private record Pending(long id, long userId, String payloadJson) {
	}
}
