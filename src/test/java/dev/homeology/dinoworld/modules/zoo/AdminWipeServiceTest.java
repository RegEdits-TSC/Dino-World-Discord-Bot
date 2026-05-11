package dev.homeology.dinoworld.modules.zoo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.players.missions.MissionProgressService;
import dev.homeology.dinoworld.modules.staff.StaffMemberService;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link AdminWipeService}.
 *
 * <p>Each scenario builds a populated park, runs the wipe/reset, and
 * asserts on per-table row counts plus the {@link AdminWipeService.WipeStats}
 * / {@link AdminWipeService.TycoonResetStats} return value. SQLite FK
 * enforcement (PRAGMA foreign_keys=ON) is implicit via Database.java's
 * connection-init pragma — these tests use a raw HikariDataSource so we
 * set it manually.
 */
class AdminWipeServiceTest {

	private HikariDataSource ds;
	private AdminWipeService wipe;
	private PlayerService players;
	private EggService eggs;
	private DinoInstanceService dinos;
	private EnclosureService enclosures;
	private StaffMemberService staff;
	private MissionProgressService missions;
	private DinoCatalog catalog;
	private RarityCatalog rarities;

	private static final Instant NOW = Instant.parse("2026-05-07T12:00:00Z");

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		cfg.setConnectionInitSql("PRAGMA foreign_keys=ON;");
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "notify", "staff", "zoo"));

		players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");
		players.addCoins(42L, 5000L, "test", null);

		rarities = new RarityCatalog();
		catalog = new DinoCatalog(rarities);
		dinos = new DinoInstanceService(ds);
		enclosures = new EnclosureService(ds);
		staff = new StaffMemberService(ds);
		missions = new MissionProgressService(ds);
		eggs = new EggService(ds, rarities, catalog, players, dinos, enclosures,
			pool -> pool.get(0),
			Clock.fixed(NOW.minus(Duration.ofHours(2)), ZoneOffset.UTC));

		wipe = new AdminWipeService(ds, players);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void wipePlayerRemovesEveryRow() throws Exception {
		// Populate: enclosure, hatched dino, pending egg, ledger row.
		Enclosure enc = enclosures.create(42L, "forest", 5, 5, "Home");
		dinos.create(42L, "velociraptor", OptionalLong.of(enc.id()), null);
		eggs.adminCreate(42L, "common", null, false);

		AdminWipeService.WipeStats stats = wipe.wipePlayer(42L);
		assertTrue(stats.playerExisted());
		assertEquals(1, stats.eggs());
		assertEquals(1, stats.dinos());
		assertEquals(1, stats.enclosures());
		assertTrue(stats.ledger() >= 1, "at least the addCoins test row");
		assertEquals(1, stats.player());

		// Every owner-keyed table is now empty for this user.
		assertEquals(0, count("egg_instance", "owner_user_id", 42L));
		assertEquals(0, count("dino_instance", "owner_user_id", 42L));
		assertEquals(0, count("enclosure", "owner_user_id", 42L));
		assertEquals(0, count("coin_ledger", "user_id", 42L));
		assertEquals(0, count("player", "user_id", 42L));
	}

	@Test
	void wipePlayerNoOpForUnknownUser() {
		AdminWipeService.WipeStats stats = wipe.wipePlayer(99_999L);
		assertEquals(0, stats.player());
		assertFalse(stats.playerExisted());
	}

	@Test
	void wipePlayerLeavesOtherUsersAlone() throws Exception {
		players.ensure(99L, "Bob");
		Enclosure encA = enclosures.create(42L, "forest", 5, 5, "A");
		Enclosure encB = enclosures.create(99L, "marine", 5, 5, "B");
		dinos.create(42L, "velociraptor", OptionalLong.of(encA.id()), null);
		dinos.create(99L, "mosasaurus", OptionalLong.of(encB.id()), null);

		wipe.wipePlayer(42L);

		assertEquals(0, count("dino_instance", "owner_user_id", 42L));
		assertEquals(1, count("dino_instance", "owner_user_id", 99L));
		assertEquals(0, count("enclosure", "owner_user_id", 42L));
		assertEquals(1, count("enclosure", "owner_user_id", 99L));
		assertEquals(1, count("player", "user_id", 99L));
	}

	@Test
	void resetTycoonKeepsPlayerRowAndZeroesEconomy() {
		Enclosure enc = enclosures.create(42L, "forest", 5, 5, "Home");
		dinos.create(42L, "velociraptor", OptionalLong.of(enc.id()), null);
		eggs.adminCreate(42L, "rare", null, false);
		players.addXp(42L, 500L);

		AdminWipeService.TycoonResetStats stats = wipe.resetTycoon(42L);
		assertEquals(1, stats.eggs());
		assertEquals(1, stats.dinos());
		assertEquals(1, stats.enclosures());
		assertTrue(stats.playerReset());

		var p = players.get(42L).orElseThrow();
		assertEquals(0L, p.coins());
		assertEquals(0L, p.xp());
		assertEquals(1, p.level());
		assertTrue(p.lastDaily().isEmpty());
	}

	@Test
	void resetTycoonOnUnknownUserIsHarmless() {
		AdminWipeService.TycoonResetStats stats = wipe.resetTycoon(99_999L);
		assertEquals(0, stats.eggs());
		assertEquals(0, stats.dinos());
		assertEquals(0, stats.enclosures());
		assertFalse(stats.playerReset());
	}

	@Test
	void resetTycoonPreservesCoinLedgerAuditTrail() throws Exception {
		long before = count("coin_ledger", "user_id", 42L);
		wipe.resetTycoon(42L);
		long after = count("coin_ledger", "user_id", 42L);
		assertEquals(before, after, "ledger should be untouched by tycoon reset");
	}

	// ─── staff orphan-leak regression ────────────────────────────────────

	@Test
	void wipePlayerClearsStaffMemberRoster() throws Exception {
		// Reproduces the bug where /admin reset player left staff_member
		// rows behind, so the next wages tick fired on orphaned staff and
		// DM'd a "X quit because wages weren't paid" notice the operator
		// expected to never see again.
		Enclosure enc = enclosures.create(42L, "forest", 5, 5, "Home");
		staff.create(42L, "zookeeper", OptionalLong.of(enc.id()));
		staff.create(42L, "vet", OptionalLong.of(enc.id()));
		staff.create(42L, "marketer", OptionalLong.empty());
		assertEquals(3, count("staff_member", "owner_user_id", 42L));

		AdminWipeService.WipeStats stats = wipe.wipePlayer(42L);
		assertEquals(3, stats.staff(), "wipe stats record the cleared staff count");
		assertEquals(0, count("staff_member", "owner_user_id", 42L),
			"every staff_member row for the wiped user is gone");
	}

	@Test
	void resetTycoonClearsStaffMemberRoster() throws Exception {
		// Same regression on the tycoon-only reset path.
		Enclosure enc = enclosures.create(42L, "forest", 5, 5, "Home");
		staff.create(42L, "zookeeper", OptionalLong.of(enc.id()));
		staff.create(42L, "scientist", OptionalLong.empty());
		assertEquals(2, count("staff_member", "owner_user_id", 42L));

		AdminWipeService.TycoonResetStats stats = wipe.resetTycoon(42L);
		assertEquals(2, stats.staff(), "reset stats record the cleared staff count");
		assertEquals(0, count("staff_member", "owner_user_id", 42L),
			"resetting tycoon state also clears the roster — otherwise the wages "
				+ "tick fires on orphaned staff and DMs the user");
	}

	@Test
	void wipePlayerInvalidatesPlayerServiceCache() {
		// Prime the cache, then wipe. PlayerService.get() must miss cache
		// and hit the DB (which now has no row), reporting empty. Without
		// the post-commit invalidate, the wages tick could see a stale
		// non-null Player and skip its "unknown player → bail" guard.
		players.get(42L); // populate cache
		wipe.wipePlayer(42L);
		assertTrue(players.get(42L).isEmpty(),
			"cache must not return a stale Player after the wipe");
	}

	@Test
	void resetTycoonInvalidatesPlayerServiceCache() {
		// Cached coins/xp from before the reset would otherwise survive
		// the SQL UPDATE — admin tooling bypasses PlayerService writes.
		players.get(42L); // 5000 coins from setUp
		wipe.resetTycoon(42L);
		assertEquals(0L, players.get(42L).orElseThrow().coins(),
			"reset zeroes coins and the next read must reflect that");
	}

	// ─── mission_progress orphan-leak regression ─────────────────────────

	@Test
	void wipePlayerClearsMissionProgress() throws Exception {
		// Reproduces the bug where /admin reset player left mission_progress
		// rows behind, so the player's tutorial still showed as completed
		// after a fresh start — defeating the whole point of the wipe.
		missions.markCompleted(42L, "tutorial.claim_first_daily");
		missions.markCompleted(42L, "tutorial.visit_shop");
		missions.markCompleted(42L, "tutorial.buy_first_egg");
		assertEquals(3, count("mission_progress", "user_id", 42L));

		AdminWipeService.WipeStats stats = wipe.wipePlayer(42L);
		assertEquals(3, stats.missions(), "wipe stats record the cleared mission count");
		assertEquals(0, count("mission_progress", "user_id", 42L),
			"every mission_progress row for the wiped user is gone");
	}

	@Test
	void resetTycoonClearsMissionProgress() throws Exception {
		// Same regression on the tycoon-only reset path — without this
		// the player runs through /daily again expecting a fresh tutorial
		// and gets no missions because they're all already marked done.
		missions.markCompleted(42L, "tutorial.claim_first_daily");
		missions.markCompleted(42L, "tutorial.visit_shop");

		AdminWipeService.TycoonResetStats stats = wipe.resetTycoon(42L);
		assertEquals(2, stats.missions(), "reset stats record the cleared mission count");
		assertEquals(0, count("mission_progress", "user_id", 42L),
			"resetting tycoon state also clears mission progress so the tutorial replays");
	}

	private long count(String table, String column, long value) throws Exception {
		try (Connection c = ds.getConnection();
		     PreparedStatement ps = c.prepareStatement(
			     "SELECT COUNT(*) FROM " + table + " WHERE " + column + " = ?")) {
			ps.setLong(1, value);
			try (ResultSet rs = ps.executeQuery()) {
				return rs.next() ? rs.getLong(1) : 0;
			}
		}
	}
}
