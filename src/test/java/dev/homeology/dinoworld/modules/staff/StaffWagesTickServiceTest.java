package dev.homeology.dinoworld.modules.staff;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.notify.NotificationService;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.EnclosureService;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import net.dv8tion.jda.api.JDA;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/**
 * Integration tests for {@link StaffWagesTickService}.
 *
 * <p>Each scenario starts with a player at a known coin balance, hires
 * staff, runs one tick, and asserts the resulting balance + staff state +
 * ledger entries.
 */
class StaffWagesTickServiceTest {

	private static final Instant TICK_AT = Instant.parse("2026-05-08T10:00:00Z");
	private static final Clock CLOCK = Clock.fixed(TICK_AT, ZoneOffset.UTC);

	private HikariDataSource ds;
	private PlayerService players;
	private StaffMemberService staff;
	private StaffCatalog catalog;
	private NotificationService notify;
	private StaffWagesTickService wages;
	private long encId;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "notify", "players", "staff", "zoo"));

		players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");
		EnclosureService enclosures = new EnclosureService(ds);
		Enclosure e = enclosures.create(42L, "forest", 5, 1, "Home");
		encId = e.id();

		staff = new StaffMemberService(ds);
		catalog = new StaffCatalog();
		notify = new NotificationService(ds, mock(JDA.class));
		wages = new StaffWagesTickService(staff, catalog, players, notify, CLOCK);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void noStaffIsNoOp() {
		players.addCoins(42L, 1000L, "test", null);
		wages.runOnce();
		assertEquals(1000L, players.get(42L).orElseThrow().coins());
		assertEquals(0, ledgerCount(42L, "wages.tick"));
	}

	@Test
	void payNormallyWhenAfford() {
		players.addCoins(42L, 1000L, "test", null);
		staff.create(42L, "zookeeper", OptionalLong.of(encId)); // 40/hr
		wages.runOnce();
		assertEquals(960L, players.get(42L).orElseThrow().coins());
		assertEquals(1, ledgerCount(42L, "wages.tick"));
		assertEquals(1, staff.findByOwner(42L).size(), "staff still employed");
	}

	@Test
	void aggregatesAcrossRoster() {
		players.addCoins(42L, 1000L, "test", null);
		staff.create(42L, "zookeeper", OptionalLong.of(encId)); // 40
		staff.create(42L, "vet", OptionalLong.of(encId));        // 70
		wages.runOnce();
		assertEquals(890L, players.get(42L).orElseThrow().coins(), "1000 - (40+70) = 890");
		assertEquals(1, ledgerCount(42L, "wages.tick"));
	}

	@Test
	void underpaidFiresHighestWageFirst() {
		// Balance 50 — can't afford zookeeper(40) + vet(70) = 110 total.
		// Highest wage (vet, 70) fires first. Surviving wage = 40, balance OK.
		players.addCoins(42L, 50L, "test", null);
		staff.create(42L, "zookeeper", OptionalLong.of(encId));
		staff.create(42L, "vet", OptionalLong.of(encId));

		wages.runOnce();

		List<StaffMember> remaining = staff.findByOwner(42L);
		assertEquals(1, remaining.size(), "vet (highest wage) fired");
		assertEquals("zookeeper", remaining.get(0).roleId(), "zookeeper survives");
		assertEquals(10L, players.get(42L).orElseThrow().coins(), "50 - 40 = 10");
		assertEquals(1, ledgerCount(42L, "wages.unpaid:vet"));
		assertEquals(0, ledgerCount(42L, "wages.unpaid:zookeeper"));
	}

	@Test
	void underpaidWithMostRecentTieBreaker() {
		// Two zookeepers, same wage. Balance lets only one survive.
		// Tie-break: most-recent-hire fires first.
		players.addCoins(42L, 50L, "test", null);
		StaffMember older = staff.create(42L, "zookeeper", OptionalLong.of(encId));
		// Need to advance time so the second hire's hired_at differs.
		try { Thread.sleep(15); } catch (InterruptedException ignored) {}
		StaffMember newer = staff.create(42L, "zookeeper", OptionalLong.of(encId));

		wages.runOnce();

		List<StaffMember> remaining = staff.findByOwner(42L);
		assertEquals(1, remaining.size());
		assertEquals(older.id(), remaining.get(0).id(), "older hire is loyal");
		assertTrue(staff.findById(newer.id()).isEmpty(), "newer hire fired first");
	}

	@Test
	void cannotAffordEvenCheapest() {
		// Balance < cheapest single wage. Everyone should be fired.
		players.addCoins(42L, 5L, "test", null);
		staff.create(42L, "zookeeper", OptionalLong.of(encId)); // 40

		wages.runOnce();

		assertTrue(staff.findByOwner(42L).isEmpty(), "all fired");
		assertEquals(5L, players.get(42L).orElseThrow().coins(), "no debit when can't pay anyone");
		assertEquals(0, ledgerCount(42L, "wages.tick"));
		assertEquals(1, ledgerCount(42L, "wages.unpaid:zookeeper"));
	}

	@Test
	void zeroBalanceFiresEveryone() {
		players.addCoins(42L, 0L, "test", null);
		staff.create(42L, "zookeeper", OptionalLong.of(encId));
		staff.create(42L, "vet", OptionalLong.of(encId));

		wages.runOnce();

		assertTrue(staff.findByOwner(42L).isEmpty());
		assertEquals(0L, players.get(42L).orElseThrow().coins());
	}

	@Test
	void marksLastPaidAtOnSuccessfulPay() {
		players.addCoins(42L, 1000L, "test", null);
		StaffMember m = staff.create(42L, "zookeeper", OptionalLong.of(encId));

		wages.runOnce();

		StaffMember after = staff.findById(m.id()).orElseThrow();
		assertEquals(java.util.Optional.of(TICK_AT), after.lastPaidAt());
	}

	@Test
	void schedulesQuitDmsForFiredStaff() throws Exception {
		players.addCoins(42L, 5L, "test", null);
		staff.create(42L, "zookeeper", OptionalLong.of(encId));

		wages.runOnce();

		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM notification_queue WHERE user_id = ?")) {
			ps.setLong(1, 42L);
			try (ResultSet rs = ps.executeQuery()) {
				assertTrue(rs.next());
				assertEquals(1, rs.getInt(1), "DM scheduled for fired staff");
			}
		}
	}

	private int ledgerCount(long userId, String reason) {
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM coin_ledger WHERE user_id = ? AND reason = ?")) {
			ps.setLong(1, userId);
			ps.setString(2, reason);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getInt(1) : 0;
			}
		} catch (Exception e) {
			throw new RuntimeException(e);
		}
	}
}
