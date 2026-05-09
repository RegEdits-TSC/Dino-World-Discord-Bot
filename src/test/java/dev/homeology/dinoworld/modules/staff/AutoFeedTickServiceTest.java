package dev.homeology.dinoworld.modules.staff;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.DinoInstanceService;
import dev.homeology.dinoworld.modules.zoo.EnclosureService;
import dev.homeology.dinoworld.modules.zoo.model.DinoInstance;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link AutoFeedTickService}. Verifies that
 * Zookeepers reset happiness on the lowest-happiness dinos in their
 * assigned enclosure, bypassing the human-only feed cooldown.
 */
class AutoFeedTickServiceTest {

	private static final Instant TICK_AT = Instant.parse("2026-05-08T10:00:00Z");
	private static final Clock CLOCK = Clock.fixed(TICK_AT, ZoneOffset.UTC);

	private HikariDataSource ds;
	private DinoInstanceService dinos;
	private StaffMemberService staff;
	private AutoFeedTickService autoFeed;
	private long encId;

	@BeforeEach
	void setUp(@TempDir Path tmp) {
		HikariConfig cfg = new HikariConfig();
		cfg.setJdbcUrl("jdbc:sqlite:" + tmp.resolve("test.db"));
		cfg.setMaximumPoolSize(1);
		ds = new HikariDataSource(cfg);
		new MigrationRunner(ds).run(List.of("core", "players", "staff", "zoo"));

		PlayerService players = new PlayerService(ds, new CacheManager());
		players.ensure(42L, "Alice");
		EnclosureService enclosures = new EnclosureService(ds);
		Enclosure e = enclosures.create(42L, "forest", 10, 5, "Home");
		encId = e.id();

		dinos = new DinoInstanceService(ds);
		staff = new StaffMemberService(ds);
		StaffCatalog catalog = new StaffCatalog();
		StaffEffectsService effects = new StaffEffectsService(staff, catalog);
		autoFeed = new AutoFeedTickService(effects, staff, dinos, CLOCK);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void noOpWithoutZookeeper() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.of(encId), null);
		dinos.applyHappiness(d.id(), 30, Instant.now());

		autoFeed.runOnce();

		assertEquals(30, dinos.findById(d.id()).orElseThrow().happiness());
	}

	@Test
	void feedsLowestHappinessUpToCapacity() {
		// 3 dinos with happiness 80, 30, 50; capacity 5 — all fed.
		// But test that the order is "lowest first" — bring 7 dinos with
		// happiness 100, 90, 80, 70, 60, 50, 40 and verify only the lowest
		// 5 (40, 50, 60, 70, 80) get reset.
		long[] ids = new long[7];
		int[] starting = {100, 90, 80, 70, 60, 50, 40};
		for (int i = 0; i < ids.length; i++) {
			DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.of(encId), null);
			dinos.applyHappiness(d.id(), starting[i], Instant.now());
			ids[i] = d.id();
		}
		// One zookeeper → capacity 5
		staff.create(42L, "zookeeper", OptionalLong.of(encId));

		autoFeed.runOnce();

		// Top 2 (100, 90) untouched
		assertEquals(100, dinos.findById(ids[0]).orElseThrow().happiness());
		assertEquals(90, dinos.findById(ids[1]).orElseThrow().happiness());
		// Bottom 5 reset
		for (int i = 2; i < ids.length; i++) {
			assertEquals(100, dinos.findById(ids[i]).orElseThrow().happiness());
		}
	}

	@Test
	void multipleZookeepersStackCapacity() {
		// 11 dinos, all happiness 50. Two zookeepers → capacity 10.
		// Exactly 10 should be fed.
		long[] ids = new long[11];
		for (int i = 0; i < ids.length; i++) {
			DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.of(encId), null);
			dinos.applyHappiness(d.id(), 50, Instant.now());
			ids[i] = d.id();
		}
		staff.create(42L, "zookeeper", OptionalLong.of(encId));
		staff.create(42L, "zookeeper", OptionalLong.of(encId));

		autoFeed.runOnce();

		int fed = 0;
		for (long id : ids) {
			if (dinos.findById(id).orElseThrow().happiness() == 100) fed++;
		}
		assertEquals(10, fed);
	}

	@Test
	void ignoresDinosInOtherEnclosures() {
		EnclosureService enclosures = new EnclosureService(ds);
		Enclosure other = enclosures.create(42L, "desert", 5, 1, "Sand");

		DinoInstance inEnc = dinos.create(42L, "velociraptor", OptionalLong.of(encId), null);
		DinoInstance inOther = dinos.create(42L, "velociraptor", OptionalLong.of(other.id()), null);
		dinos.applyHappiness(inEnc.id(), 30, Instant.now());
		dinos.applyHappiness(inOther.id(), 30, Instant.now());

		staff.create(42L, "zookeeper", OptionalLong.of(encId));

		autoFeed.runOnce();

		assertEquals(100, dinos.findById(inEnc.id()).orElseThrow().happiness());
		assertEquals(30, dinos.findById(inOther.id()).orElseThrow().happiness(),
			"dino in other enclosure unaffected");
	}

	@Test
	void bypassesHumanFeedCooldown() {
		DinoInstance d = dinos.create(42L, "velociraptor", OptionalLong.of(encId), null);
		// Stamp last_fed_at as if a human just fed it; recordFed sets to 100
		// and stamps last_fed_at, simulating the cooldown.
		dinos.recordFed(d.id(), Instant.now());
		dinos.applyHappiness(d.id(), 30, Instant.now());

		staff.create(42L, "zookeeper", OptionalLong.of(encId));

		autoFeed.runOnce();

		// Even with last_fed_at recently stamped, auto-feed bypasses.
		assertEquals(100, dinos.findById(d.id()).orElseThrow().happiness());
	}

	@Test
	void emptyEnclosureIsHarmless() {
		staff.create(42L, "zookeeper", OptionalLong.of(encId));
		assertDoesNotThrow(() -> autoFeed.runOnce());
	}
}
