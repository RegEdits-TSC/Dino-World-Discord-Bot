package dev.homeology.dinoworld.modules.notify;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.database.MigrationRunner;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.entities.MessageEmbed;
import net.dv8tion.jda.api.utils.data.DataObject;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Instant;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/**
 * Persistence-side tests for {@link NotificationService}.
 *
 * <p>The async DM dispatch path requires a real JDA connection and is
 * covered by the manual end-to-end verification step (Discord test guild
 * + a /zoo button click). These tests pin the schedule/requeue contract
 * which is pure SQLite logic.
 */
class NotificationServiceTest {

	private HikariDataSource ds;
	private NotificationService svc;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "notify"));
		svc = new NotificationService(ds, mock(JDA.class));
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void scheduleWritesPendingRow() throws Exception {
		MessageEmbed embed = new EmbedBuilder().setTitle("Hello").setDescription("Body").build();
		long id = svc.schedule(42L, Instant.parse("2026-05-07T13:00:00Z"), embed);

		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement("""
			     SELECT user_id, due_at, payload_json, status, attempts FROM notification_queue WHERE id = ?
			     """)) {
			ps.setLong(1, id);
			try (ResultSet rs = ps.executeQuery()) {
				assertTrue(rs.next());
				assertEquals(42L, rs.getLong(1));
				assertEquals(Instant.parse("2026-05-07T13:00:00Z").toEpochMilli(), rs.getLong(2));
				assertEquals("pending", rs.getString(4));
				assertEquals(0, rs.getInt(5));

				// Round-trip the payload.
				DataObject data = DataObject.fromJson(rs.getString(3));
				MessageEmbed restored = EmbedBuilder.fromData(data).build();
				assertEquals("Hello", restored.getTitle());
				assertEquals("Body", restored.getDescription());
			}
		}
	}

	@Test
	void requeueOrphanedFlipsSendingBackToPending() throws Exception {
		MessageEmbed embed = new EmbedBuilder().setDescription("x").build();
		long id = svc.schedule(1L, Instant.now().minusSeconds(10), embed);

		// Simulate a crash mid-dispatch: row left in 'sending'.
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE notification_queue SET status = 'sending' WHERE id = ?")) {
			ps.setLong(1, id);
			ps.executeUpdate();
		}

		svc.requeueOrphaned();

		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT status FROM notification_queue WHERE id = ?")) {
			ps.setLong(1, id);
			try (ResultSet rs = ps.executeQuery()) {
				assertTrue(rs.next());
				assertEquals("pending", rs.getString(1));
			}
		}
	}

	@Test
	void requeueOrphanedLeavesSentAlone() throws Exception {
		MessageEmbed embed = new EmbedBuilder().setDescription("x").build();
		long id = svc.schedule(1L, Instant.now(), embed);
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "UPDATE notification_queue SET status = 'sent' WHERE id = ?")) {
			ps.setLong(1, id);
			ps.executeUpdate();
		}
		svc.requeueOrphaned();
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT status FROM notification_queue WHERE id = ?")) {
			ps.setLong(1, id);
			try (ResultSet rs = ps.executeQuery()) {
				assertTrue(rs.next());
				assertEquals("sent", rs.getString(1));
			}
		}
	}
}
