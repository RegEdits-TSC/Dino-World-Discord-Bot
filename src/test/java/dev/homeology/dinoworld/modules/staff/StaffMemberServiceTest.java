package dev.homeology.dinoworld.modules.staff;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.homeology.dinoworld.cache.CacheManager;
import dev.homeology.dinoworld.database.MigrationRunner;
import dev.homeology.dinoworld.modules.players.PlayerService;
import dev.homeology.dinoworld.modules.zoo.EnclosureService;
import dev.homeology.dinoworld.modules.zoo.model.Enclosure;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for {@link StaffMemberService} — runs against a fresh
 * temp SQLite db with the production migrations applied.
 */
class StaffMemberServiceTest {

	private HikariDataSource ds;
	private StaffMemberService staff;
	private EnclosureService enclosures;
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
		enclosures = new EnclosureService(ds);
		Enclosure e = enclosures.create(42L, "forest", 5, 1, "Home");
		encId = e.id();
		staff = new StaffMemberService(ds);
	}

	@AfterEach
	void tearDown() {
		ds.close();
	}

	@Test
	void createEnclosureScope() {
		StaffMember m = staff.create(42L, "zookeeper", OptionalLong.of(encId));
		assertTrue(m.id() > 0);
		assertEquals(42L, m.ownerUserId());
		assertEquals("zookeeper", m.roleId());
		assertEquals(OptionalLong.of(encId), m.enclosureId());
		assertEquals(Optional.empty(), m.customName());
		assertEquals(Optional.empty(), m.lastPaidAt());
	}

	@Test
	void createGlobalScope() {
		StaffMember m = staff.create(42L, "scientist", OptionalLong.empty());
		assertTrue(m.enclosureId().isEmpty());
	}

	@Test
	void findByOwnerReturnsOnlyOwned() {
		PlayerService players2 = new PlayerService(ds, new CacheManager());
		players2.ensure(99L, "Bob");
		staff.create(42L, "zookeeper", OptionalLong.of(encId));
		staff.create(99L, "scientist", OptionalLong.empty());

		List<StaffMember> alice = staff.findByOwner(42L);
		assertEquals(1, alice.size());
		assertEquals("zookeeper", alice.get(0).roleId());

		List<StaffMember> bob = staff.findByOwner(99L);
		assertEquals(1, bob.size());
		assertEquals("scientist", bob.get(0).roleId());
	}

	@Test
	void findByEnclosureReturnsResidents() {
		Enclosure other = enclosures.create(42L, "desert", 3, 2, "Sand");
		staff.create(42L, "zookeeper", OptionalLong.of(encId));
		staff.create(42L, "vet", OptionalLong.of(encId));
		staff.create(42L, "zookeeper", OptionalLong.of(other.id()));

		assertEquals(2, staff.findByEnclosure(encId).size());
		assertEquals(1, staff.findByEnclosure(other.id()).size());
	}

	@Test
	void findGlobalByOwnerExcludesEnclosureBound() {
		staff.create(42L, "zookeeper", OptionalLong.of(encId));
		staff.create(42L, "scientist", OptionalLong.empty());
		staff.create(42L, "marketer", OptionalLong.empty());

		List<StaffMember> global = staff.findGlobalByOwner(42L);
		assertEquals(2, global.size());
		assertTrue(global.stream().allMatch(m -> m.enclosureId().isEmpty()));
	}

	@Test
	void countByOwnerAndRole() {
		staff.create(42L, "zookeeper", OptionalLong.of(encId));
		staff.create(42L, "zookeeper", OptionalLong.of(encId));
		staff.create(42L, "vet", OptionalLong.of(encId));

		assertEquals(2, staff.countByOwnerAndRole(42L, "zookeeper"));
		assertEquals(1, staff.countByOwnerAndRole(42L, "vet"));
		assertEquals(0, staff.countByOwnerAndRole(42L, "scientist"));
	}

	@Test
	void renameTrimsBlankToNull() {
		StaffMember m = staff.create(42L, "zookeeper", OptionalLong.of(encId));
		assertTrue(staff.rename(m.id(), "  Bob  "));
		assertEquals(Optional.of("Bob"), staff.findById(m.id()).orElseThrow().customName());

		assertTrue(staff.rename(m.id(), "  "));
		assertEquals(Optional.empty(), staff.findById(m.id()).orElseThrow().customName());
	}

	@Test
	void reassignUpdatesEnclosure() {
		StaffMember m = staff.create(42L, "zookeeper", OptionalLong.of(encId));
		Enclosure other = enclosures.create(42L, "desert", 3, 2, null);
		assertTrue(staff.reassign(m.id(), other.id()));
		assertEquals(OptionalLong.of(other.id()),
			staff.findById(m.id()).orElseThrow().enclosureId());
	}

	@Test
	void deleteRemovesRow() {
		StaffMember m = staff.create(42L, "zookeeper", OptionalLong.of(encId));
		assertTrue(staff.delete(m.id()));
		assertTrue(staff.findById(m.id()).isEmpty());
		assertFalse(staff.delete(m.id()), "second delete is a no-op");
	}
}
