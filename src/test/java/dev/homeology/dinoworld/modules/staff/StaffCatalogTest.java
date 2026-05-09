package dev.homeology.dinoworld.modules.staff;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Smoke tests for the shipped {@code data/staff/roles.yaml} — verifies all
 * four roles load with the expected scope, costs, and effect types.
 */
class StaffCatalogTest {

	@Test
	void allFourRolesLoaded() {
		StaffCatalog catalog = new StaffCatalog();
		assertEquals(4, catalog.size());
		assertTrue(catalog.byId("zookeeper").isPresent());
		assertTrue(catalog.byId("vet").isPresent());
		assertTrue(catalog.byId("scientist").isPresent());
		assertTrue(catalog.byId("marketer").isPresent());
	}

	@Test
	void zookeeperHasAutoFeedEffect() {
		StaffCatalog catalog = new StaffCatalog();
		StaffRole r = catalog.require("zookeeper");
		assertEquals(StaffRole.Scope.ENCLOSURE, r.scope());
		assertEquals(2000L, r.hireCost());
		assertEquals(40L, r.wagePerHour());
		assertEquals(5, r.unlockLevel());
		assertEquals(6, r.maxOwned());
		assertInstanceOf(StaffEffect.AutoFeed.class, r.effect());
		assertEquals(5, ((StaffEffect.AutoFeed) r.effect()).capacity());
	}

	@Test
	void vetHasDecayReduceEffect() {
		StaffCatalog catalog = new StaffCatalog();
		StaffRole r = catalog.require("vet");
		assertEquals(StaffRole.Scope.ENCLOSURE, r.scope());
		assertInstanceOf(StaffEffect.DecayReduce.class, r.effect());
		assertEquals(0.5, ((StaffEffect.DecayReduce) r.effect()).multiplier(), 1e-9);
	}

	@Test
	void scientistHasIncubationSpeedEffect() {
		StaffCatalog catalog = new StaffCatalog();
		StaffRole r = catalog.require("scientist");
		assertEquals(StaffRole.Scope.GLOBAL, r.scope());
		assertInstanceOf(StaffEffect.IncubationSpeed.class, r.effect());
		StaffEffect.IncubationSpeed is = (StaffEffect.IncubationSpeed) r.effect();
		assertEquals(0.75, is.perUnitMultiplier(), 1e-9);
		assertEquals(0.5, is.floor(), 1e-9);
	}

	@Test
	void marketerHasIncomeMultiplierEffect() {
		StaffCatalog catalog = new StaffCatalog();
		StaffRole r = catalog.require("marketer");
		assertEquals(StaffRole.Scope.GLOBAL, r.scope());
		assertInstanceOf(StaffEffect.IncomeMultiplier.class, r.effect());
		StaffEffect.IncomeMultiplier im = (StaffEffect.IncomeMultiplier) r.effect();
		assertEquals(0.15, im.perUnitBonus(), 1e-9);
		assertEquals(1.45, im.cap(), 1e-9);
	}

	@Test
	void reassignFeeReadFromYaml() {
		StaffCatalog catalog = new StaffCatalog();
		assertEquals(500L, catalog.reassignFee());
	}

	@Test
	void allReturnsAllRolesInDeclarationOrder() {
		StaffCatalog catalog = new StaffCatalog();
		List<StaffRole> all = catalog.all();
		assertEquals(4, all.size());
		// Order in YAML: zookeeper, vet, scientist, marketer
		assertEquals("zookeeper", all.get(0).id());
		assertEquals("vet", all.get(1).id());
		assertEquals("scientist", all.get(2).id());
		assertEquals("marketer", all.get(3).id());
	}
}
