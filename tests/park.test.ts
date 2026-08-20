import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText, testRegistry } from './harness.js';
import { getOrCreateUser, buildLot, collectIncome, capHours, facilityBonusPct, LotLimitError, UnknownKindError, DuplicateFacilityError, upgradeLot, upgradeCostFor, BASE_LOT_SLOTS, breedingSlots } from '../src/modules/park/service.js';
import { incubatorSlots } from '../src/modules/hatchery/service.js';
import { renameDino } from '../src/modules/park/dinos.js';
import { InsufficientFundsError } from '../src/core/economy.js';
import { schema } from '../src/core/db/index.js';
import { parkModule } from '../src/modules/park/index.js';
import { dashboardPayload, animalsPayload, lotsPayload, PARK_HEADER_KEYS } from '../src/modules/park/embeds.js';
import { visitPayload } from '../src/modules/park/visit.js';
import { attendanceOf } from '../src/modules/park/attendance.js';
import { eventHeaderLine } from '../src/modules/world/embeds.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { FACILITIES } from '../src/data/facilities.js';
import { DECOR } from '../src/data/decor.js';
import { lotSlots } from '../src/data/progression.js';
import { allSpecies } from '../src/data/species/index.js';
import { recordSpeciesSeen } from '../src/core/species-seen.js';
import { rollSeason } from '../src/modules/daily/season.js';

const H = 3_600_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

// Direct insert, because buildLot refuses a duplicate facility — these rows simulate
// the pre-existing duplicates on a live DB that the fix deliberately does not migrate.
const seedLot = (over: Partial<typeof schema.lots.$inferInsert> = {}) =>
  ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'facility', kind: 'visitor_center', name: 'Visitor Center', ...over,
  }).returning().get();

describe('park service', () => {
  it('creates a user once with starting wallet', () => {
    const u1 = getOrCreateUser(ctx, 'u1', 'Reg');
    const u2 = getOrCreateUser(ctx, 'u1', 'Reg');
    expect(u1.cash).toBe(500);
    expect(u2.discordId).toBe('u1');
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(1);
  });

  it('builds lots up to the slot limit, charging cash', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 20_000 }, 'test:seed', 0);
    buildLot(ctx, 'u1', 'herbivore_paddock');     // 2,000
    buildLot(ctx, 'u1', 'visitor_center');        // 5,000
    buildLot(ctx, 'u1', 'food_court');            // 8,000
    expect(() => buildLot(ctx, 'u1', 'herbivore_paddock')).toThrow(LotLimitError);
    expect(BASE_LOT_SLOTS).toBe(3);
  });

  it('derives capHours and bonus from facilities', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 20_000 }, 'test:seed', 0);
    buildLot(ctx, 'u1', 'visitor_center');
    buildLot(ctx, 'u1', 'food_court');
    const lots = ctx.db.select().from(schema.lots).all();
    expect(capHours(lots)).toBe(8);               // VC level 1
    expect(facilityBonusPct(lots)).toBe(4);       // VC lvl1 0% + food court lvl1 4%
  });

  it('resolves duplicate facility rows to the best one, for cap and for income alike', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Level 2 first, not level 1: a level-1 Visitor Center contributes 0% income, which
    // would make the summing and max-per-kind answers identical and prove nothing.
    seedLot({ level: 2 });                                             // built first, the one find() returns
    seedLot({ level: 4 });                                             // the one actually upgraded
    seedLot({ type: 'facility', kind: 'food_court', name: 'Food Court', level: 2 });
    const lots = ctx.db.select().from(schema.lots).all();
    expect(capHours(lots)).toBe(20);                                   // capHours[3], not the lvl-2 row's 12
    expect(facilityBonusPct(lots)).toBe(23);                           // VC lvl4 15% + Food Court lvl2 8%,
                                                                       // not 5+15+8 summed across both VCs
  });

  it('keeps the no-facility defaults', () => {
    expect(capHours([])).toBe(8);
    expect(facilityBonusPct([])).toBe(0);
  });

  it('ignores paddock rows when resolving facilities', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    seedLot({ type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock', level: 4 });
    const lots = ctx.db.select().from(schema.lots).all();
    expect(capHours(lots)).toBe(8);
    expect(facilityBonusPct(lots)).toBe(0);
  });

  it('collectIncome pays integrated income and stamps lastCollectAt', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 2_000 }, 'test:seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops',
      hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    // 'palm_tree' is a real decor kind slug (biomeTags: ['forest']) matching
    // triceratops's own biome — decor is stored as kind slugs, never raw biome tags.
    ctx.db.update(schema.lots).set({ decor: ['palm_tree'] }).run();
    ctx.setNow(12 * H);
    const { amount } = collectIncome(ctx, 'u1');
    // no Visitor Center => 8h cap; window truncates to 0..8h of the 12h elapsed.
    // hunger 100->83.33% over 8h of the 48h drain; comfort 1.0->0.8333, mean 0.91667;
    // 60/hr * 0.91667 * 8h = 440 (same integral as the capped clock test).
    expect(amount).toBe(440);
    expect(collectIncome(ctx, 'u1').amount).toBe(0);  // idempotent within same instant
  });

  it('recomputes park rating after building a lot', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 20_000 }, 'test:seed', 0);
    const before = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(before.parkRating).toBe(0);
    buildLot(ctx, 'u1', 'herbivore_paddock');
    const after = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    // one level-1 lot => park term (1+0)/40; rating round(500 * 0.35 * 0.025) = 4.
    expect(after.parkRating).toBeGreaterThan(0);
    expect(after.ratingHighWater).toBeGreaterThan(0);
  });

  it('allows one facility of each kind and refuses a second, while paddocks still stack', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'test:seed', 0);
    buildLot(ctx, 'u1', 'visitor_center');
    expect(() => buildLot(ctx, 'u1', 'visitor_center')).toThrow(DuplicateFacilityError);
    buildLot(ctx, 'u1', 'herbivore_paddock');
    buildLot(ctx, 'u1', 'herbivore_paddock');                          // paddocks are capacity, not upgrades
    expect(ctx.db.select().from(schema.lots).all()).toHaveLength(3);
  });

  it('names the facility on the duplicate error and charges nothing', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'test:seed', 0);
    buildLot(ctx, 'u1', 'food_court');
    const before = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash;
    expect(() => buildLot(ctx, 'u1', 'food_court')).toThrow('Food Court');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(before);
    expect(ctx.db.select().from(schema.lots).all()).toHaveLength(1);
  });

  it('rolls back the charge when the build insert fails (proves buildLot atomicity)', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 20_000 }, 'test:seed', 0);
    const before = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(before.cash).toBe(20_500);                  // 500 starting + 20,000 seed

    // raw better-sqlite3 handle; drizzle exposes it as db.$client (same pattern as
    // the rollback test in tests/economy.test.ts)
    const raw = ctx.db.$client;
    raw.exec(`CREATE TRIGGER block_build BEFORE INSERT ON lots
              WHEN NEW.kind = 'herbivore_paddock'
              BEGIN SELECT RAISE(ABORT, 'forced'); END;`);

    // Without the Fix 1 transaction wrapper in buildLot, ctx.economy.apply's -2,000
    // charge commits on its own (EconomyService.apply opens its own transaction)
    // before the insert below ever runs — leaving cash at 18,500 despite the throw
    // and no lot ever being created. With the fix, the charge and the insert share
    // one outer transaction, so the failed insert rolls the charge back too.
    expect(() => buildLot(ctx, 'u1', 'herbivore_paddock')).toThrow();

    const after = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(after.cash).toBe(20_500);                   // unchanged from before the attempt
    expect(ctx.db.select().from(schema.lots).all()).toHaveLength(0);
  });
});

describe('park module commands', () => {
  it('/park view returns a dashboard payload', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: unknown[]; components: unknown[] };
    expect(payload.embeds).toHaveLength(1);
    // Collect (row 1) plus the tab row Task 1 added (row 2) — was 1 before the tabs split.
    expect(payload.components).toHaveLength(2);
  });
  it('/build paddock reply hints at assigning a dino', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'herbivore_paddock' } });
    await parkModule.commands.find((c) => c.data.name === 'build')!.execute(ctx, i.asChatInput());
    expect((i.replies[0] as { content: string }).content).toContain('/dino assign');
  });
});

describe('/park subcommand dispatch', () => {
  it('rejects an unrecognised subcommand instead of rendering the dashboard', async () => {
    // Synthetic name: the harness skips builder lookup for a command name the module
    // registry does not know, which is exactly the deployed-but-unimplemented case this
    // guards — 'park' itself would reject 'sabotage' at fixture-build time since the real
    // builder only advertises view/rename/alerts.
    const i = fakeCommand({ name: 'zzz-test', sub: 'sabotage', user: 'u1' });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    const text = JSON.stringify(i.replies[0]);
    expect(text).not.toContain('Cash');            // not the dashboard
    expect(text.toLowerCase()).toContain('unknown');
  });

  it('still renders the dashboard for view', async () => {
    const i = fakeCommand({ name: 'zzz-test', sub: 'view', user: 'u1' });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('Cash');
  });
});

describe('Collect button', () => {
  it('shows a plain numeric label with the coin as a real emoji, not text', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 1234, {});
    const button = (p.components[0] as {
      toJSON(): { components: Array<{ label: string; emoji?: { name: string; animated: boolean } }> };
    }).toJSON().components[0];
    expect(button.label).toBe('Collect 1,234');
    // No app emoji map is loaded in tests, so this is the unicode fallback for dw_cash,
    // resolved by discord.js into the button's structured emoji field (not embedded in the label).
    expect(button.emoji).toEqual({ name: '💰', animated: false });
  });
});

describe('dashboard warnings', () => {
  it('adds a capped field when capped', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 480, { capped: true, dinoCount: 1 });
    const names = p.embeds[0].toJSON().fields!.map((f) => f.name);
    expect(names).toContain('⛔ Income capped');
  });
  it('no capped field otherwise', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 480, { dinoCount: 1 });
    const names = p.embeds[0].toJSON().fields!.map((f) => f.name);
    expect(names).not.toContain('⛔ Income capped');
  });
});

// The itemised at-risk/mismatch/escaped breakdown this block used to pin against
// dashboardPayload was retired by the Park tab rewrite: dashboardPayload now renders a
// single caller-supplied `attention` sum (see tests/park-tabs.test.ts, 'Park tab' >
// 'shows a compact attention marker'). The breakdown itself still exists — it moved onto
// animalsPayload's own "Needs attention" field, which lists issues as separate lines
// rather than folding a count into the Dinos field the way the old dashboard row did.
describe('animalsPayload attention breakdown', () => {
  it('shows the at-risk count in the needs-attention field', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 3, { atRisk: 2 });
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name.includes('Needs attention'))!;
    expect(field.value).toContain('2 at risk');
  });
  it('omits the warning at zero', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 3, {});
    expect(p.embeds[0].toJSON().fields!.some((f) => f.name.includes('Needs attention'))).toBe(false);
  });
});

describe('/park view attention marker', () => {
  // Regression test: index.ts used to sum escapedCount + atRiskCount + mismatchCount, but
  // at-risk and mismatch are independent predicates over the same non-escaped dinos, so one
  // dino can trip both — an off-diet paddock is paddockFit 0.5, which is exactly what drives
  // comfort down and pulls escapeAt into the warning window, so mismatched dinos are
  // disproportionately the at-risk ones. That summed three counts into "2 need attention"
  // for a park holding exactly one dino. attention must count DISTINCT dinos, never more
  // than dinoCount. The Animals tab's own itemised breakdown (Task 3) is a different,
  // correct use of summing separate counts — it lists issues, not dinos.
  it('a single mismatched, at-risk dino reads "1 need attention", never 2', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'test:seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.setNow(100 * H);
    // quetzalcoatlus is carnivore, placed in a herbivore paddock: paddockFit's off-diet
    // branch (0.5) applies regardless of decor. Fed to 100 and last fed 25h ago, with the
    // default drain rate, that paddockFit puts escapeAt exactly 7h out — inside the 12h
    // ESCAPE_WARN_MS window (at risk) and not yet escaped (escapedAt stays null).
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'quetzalcoatlus', lotId: lot.id, hunger: 100,
      lastFedAt: ctx.now() - 25 * H, hatchedAt: 0,
    }).run();
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, i.asChatInput());
    const fields = (i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }).embeds[0].toJSON().fields!;
    const field = fields.find((f) => f.name === '🦕 Dinos')!;
    // The exact string the builder emits today for count 1 — it has no singular/plural
    // branch, so this is genuinely "1 need attention", not "1 needs attention".
    expect(field.value).toBe('1 · ⚠️ 1 need attention');
  });
});

// Achievements, Attendance and Legacy all left the Park tab for good — all three move to
// the Prestige tab (Task 5): prestigePayload takes attendance?: number and renders the
// 🎡 Attendance field, same as it does for Achievements and Legacy. The blocks below are
// skipped and retargeted rather than deleted: the behaviour they pin still exists, it
// relocated.
//
// bumpLegacyBest's SIDE EFFECT is the one piece of this that still runs on THIS command
// path (see the comment at its call site in src/modules/park/index.ts), so that survives
// as its own regression test, separate from (and not skipped like) the retargeted blocks
// below.
describe('/park view legacy high-water wiring', () => {
  it('still bumps legacyRankBest on every view, even though Legacy no longer renders here', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    for (const s of allSpecies().slice(0, 15)) recordSpeciesSeen(ctx, 'u1', s.id);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.legacyRankBest).toBe(0);
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, i.asChatInput());
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.legacyRankBest).toBeGreaterThan(0);
  });
});

// Retargeted to prestigePayload in Task 5 — un-skip there.
describe.skip('dashboard achievements badge', () => {
  it('shows the earned tier count when greater than zero', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    // earnedTiers: 3 moves onto prestigePayload's own opts in Task 5 — dashboardPayload no
    // longer accepts it.
    const p = dashboardPayload(user, 0, {});
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name === '🏆 Achievements');
    expect(field).toBeTruthy();
    expect(field!.value).toContain('3');
  });
  it('omits the achievements field entirely at zero', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 0, {});
    const names = p.embeds[0].toJSON().fields!.map((f) => f.name);
    expect(names).not.toContain('🏆 Achievements');
  });
  it('also omits it when earnedTiers is left unset entirely', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 0);
    const names = p.embeds[0].toJSON().fields!.map((f) => f.name);
    expect(names).not.toContain('🏆 Achievements');
  });
});

// Retargeted to prestigePayload in Task 5 — un-skip there.
describe.skip('/park view achievements badge wiring', () => {
  it('passes earnedTierCount into the own-park dashboard', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.insert(schema.achievementClaims).values([
      { userId: 'u1', trackId: 'eggs_hatched', tier: 0, claimedAt: 0 },
      { userId: 'u1', trackId: 'eggs_hatched', tier: 1, claimedAt: 0 },
    ]).run();
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, i.asChatInput());
    const fields = (i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }).embeds[0].toJSON().fields!;
    const field = fields.find((f) => f.name === '🏆 Achievements')!;
    expect(field.value).toContain('2');
  });

  it('passes earnedTierCount into the read-only other-user dashboard', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'other', 'Other');
    ctx.db.insert(schema.achievementClaims).values([
      { userId: 'other', trackId: 'eggs_hatched', tier: 0, claimedAt: 0 },
    ]).run();
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1', options: { user: 'other' } });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, i.asChatInput());
    const fields = (i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }).embeds[0].toJSON().fields!;
    const field = fields.find((f) => f.name === '🏆 Achievements')!;
    expect(field.value).toContain('1');
  });
});

// Attendance lives on the Prestige tab, not Animals — prestigePayload takes
// attendance?: number and renders 🎡 Attendance; animalsPayload has no attendance option.
// Retargeted to prestigePayload in Task 5 — un-skip there.
describe.skip('/park view attendance wiring', () => {
  it('keys the attendance field to the right park on your own card and on a visited one', async () => {
    for (const id of ['u1', 'u2']) getOrCreateUser(ctx, id, id);
    ctx.economy.apply('u1', { cash: 50_000 }, 'test:seed', 0);
    ctx.economy.apply('u2', { cash: 50_000 }, 'test:seed', 0);
    const lot1 = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot1.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    // u2's own park gets a DIFFERENT distinct-species count (2, not 1) — attendance's
    // species term is what moves the figure here, so u1 and u2 must resolve to different
    // numbers or this test cannot tell a correctly-threaded value from a dropped
    // `attendance:` line (which renders the unconditional field at its `?? 0` default,
    // still matching /Attendance/) or a caller-identity mixup.
    const lot2 = buildLot(ctx, 'u2', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values([
      { userId: 'u2', lotId: lot2.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 },
      { userId: 'u2', lotId: lot2.id, speciesId: 'stegosaurus', hunger: 100, lastFedAt: 0, hatchedAt: 0 },
    ]).run();

    const u1Attendance = attendanceOf(ctx, 'u1').attendance;
    const u2Attendance = attendanceOf(ctx, 'u2').attendance;
    expect(u1Attendance).not.toBe(u2Attendance);   // sanity: equal values would prove nothing below

    const attendanceField = (replies: unknown[]) =>
      (replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> })
        .embeds[0].toJSON().fields!.find((f) => f.name === '🎡 Attendance')!;

    const own = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, own.asChatInput());
    expect(attendanceField(own.replies).value).toContain(u1Attendance.toLocaleString());

    // u2 (the viewer) visits u1's park (the target). The field must carry u1's number —
    // never u2's own — so a value threaded into one caller and forgotten (or mis-keyed)
    // in the other renders a card that disagrees with itself depending on who is looking.
    const visit = fakeCommand({ name: 'park', sub: 'view', user: 'u2', options: { user: { id: 'u1' } } });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, visit.asChatInput());
    const visitField = attendanceField(visit.replies);
    expect(visitField.value).toContain(u1Attendance.toLocaleString());
    expect(visitField.value).not.toContain(u2Attendance.toLocaleString());
  });
});

// Retargeted to prestigePayload in Task 5 — un-skip there.
describe.skip('dashboard legacy rank', () => {
  it('shows the title and rank number when ranked', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    // legacyRank: { rank: 3, title: 'Curator', points: 65 } moves onto prestigePayload's
    // own opts in Task 5 — dashboardPayload no longer accepts it.
    const p = dashboardPayload(user, 0, {});
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name === '🏛️ Legacy');
    expect(field).toBeTruthy();
    expect(field!.value).toContain('Curator');
    expect(field!.value).toContain('3');           // rank number, not just the title
  });
  it('omits the field when unranked (explicit null and opts unset alike)', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    // legacyRank moved off dashboardPayload entirely in Task 5, so the loop's own opts
    // shape (`{ legacyRank: null } | {}`) no longer type-checks against it — replaced with
    // an equivalent `{}` for both iterations, since both cases assert the same "no Legacy
    // field" outcome that no longer depends on the opt at all.
    for (const opts of [{}, {}]) {
      const names = dashboardPayload(user, 0, opts).embeds[0].toJSON().fields!.map((f) => f.name);
      expect(names).not.toContain('🏛️ Legacy');
    }
  });
});

// Retargeted to prestigePayload in Task 5 — un-skip there.
describe.skip('/park view legacy rank wiring', () => {
  // allSpecies().slice(0, 15/35) seeds exactly the Groundskeeper/Keeper thresholds
  // (LEGACY_TIERS in src/modules/park/ranks.js) via species points alone — species alone
  // caps at allSpecies().length (52, tests/ranks.test.ts), which is why these two tests
  // stay within Groundskeeper/Keeper rather than reaching for a higher tier. u1 and u2
  // land on DIFFERENT titles on purpose: a title mismatch fails louder than a
  // missing-vs-present field would if the wrong id were ever passed at a call site.
  it('passes the viewer own rank into the own-park dashboard', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    for (const s of allSpecies().slice(0, 15)) recordSpeciesSeen(ctx, 'u1', s.id);   // Groundskeeper (rank 1)
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, i.asChatInput());
    const fields = (i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }).embeds[0].toJSON().fields!;
    const field = fields.find((f) => f.name === '🏛️ Legacy');
    expect(field).toBeTruthy();
    expect(field!.value).toContain('Groundskeeper');
  });

  it('shows the TARGET player rank when viewing another park, not the viewer own', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Other');
    for (const s of allSpecies().slice(0, 15)) recordSpeciesSeen(ctx, 'u1', s.id);   // Groundskeeper (rank 1)
    for (const s of allSpecies().slice(0, 35)) recordSpeciesSeen(ctx, 'u2', s.id);   // Keeper (rank 2)
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1', options: { user: { id: 'u2' } } });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, i.asChatInput());
    const fields = (i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }).embeds[0].toJSON().fields!;
    const field = fields.find((f) => f.name === '🏛️ Legacy');
    expect(field).toBeTruthy();
    expect(field!.value).toContain('Keeper');       // u2's rank
    expect(field!.value).not.toContain('Groundskeeper');   // never u1's (the viewer's) rank
  });
});

describe('/park view cap warning condition', () => {
  const viewFields = async () => {
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'park')!.execute(ctx, i.asChatInput());
    return (i.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string }> } }> }).embeds[0].toJSON().fields!.map((f) => f.name);
  };
  it('warns once pending income has saturated the cap window', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    ctx.setNow(9 * H); // past the default 8h cap, dino still earning (escape at 40h)
    expect(await viewFields()).toContain('⛔ Income capped');
  });
  it('does not warn when nothing is earning, however long you idle', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.setNow(9 * H); // same elapsed time, zero pending
    expect(await viewFields()).not.toContain('⛔ Income capped');
  });
});

describe('/dino list escape countdown', () => {
  it('warns only inside the ESCAPE_WARN_MS window', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const H = 3_600_000;
    ctx.setNow(100 * H);
    const esc = 40 * H; // escapeAt - lastFedAt for this species/paddock
    // escapes in 11h → inside the 12h window
    ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: ctx.now() - (esc - 11 * H), hatchedAt: 0 }).run();
    // escapes in 13h → outside
    ctx.db.insert(schema.dinos).values({ userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: ctx.now() - (esc - 13 * H), hatchedAt: 0 }).run();
    const i = fakeCommand({ name: 'dino', sub: 'list', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'dino')!.execute(ctx, i.asChatInput());
    const desc = (i.replies[0] as { embeds: Array<{ toJSON(): { description?: string } }> }).embeds[0].toJSON().description!;
    expect(desc.match(/⚠ escapes/g)).toHaveLength(1);
  });
});

// The food line moved off dashboardPayload's DB-driven render onto animalsPayload's own
// caller-supplied `foodLine` string — no call site builds that string from food_inventory
// yet (that wiring belongs to whichever task threads animalsPayload into /park view's own
// execute path), so what animalsPayload itself can be held to is that it renders whatever
// line it is given in the Food field, not the DB read that used to produce one.
describe('animalsPayload food line', () => {
  it('renders the caller-supplied food line in the Food field', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 0, { foodLine: '🌿 Ferns ×10\n🐟 Fish ×10' });
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name.includes('Food'))!;
    expect(field.value).toContain('🌿 Ferns ×10');
    expect(field.value).toContain('🐟 Fish ×10');
  });
});

describe('upgradeLot service', () => {
  it('charges and bumps the level', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const upgraded = upgradeLot(ctx, 'u1', lot.id);
    expect(upgraded.level).toBe(2);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBeLessThan(before);
  });
  it('throws LotLimitError at max level and UnknownKindError for missing/foreign lots', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 10_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    ctx.db.update(schema.lots).set({ level: 4 }).run();   // paddock max level
    expect(() => upgradeLot(ctx, 'u1', lot.id)).toThrow(LotLimitError);
    expect(() => upgradeLot(ctx, 'u1', 9999)).toThrow(UnknownKindError);
  });
  it('throws InsufficientFundsError when broke', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    expect(() => upgradeLot(ctx, 'u1', lot.id)).toThrow(InsufficientFundsError);
  });
});

describe('upgradeCostFor', () => {
  it('matches the facility table for every kind and level', () => {
    for (const f of Object.values(FACILITIES)) {
      for (let level = 1; level < f.maxLevel; level++) {
        expect(upgradeCostFor(f.kind, level), `${f.kind} L${level}`).toBe(f.upgradeCosts[level - 1]);
      }
    }
  });
  it('prices a paddock off its build cost', () => {
    expect(upgradeCostFor('herbivore_paddock', 1)).toBe(5_000);
    expect(upgradeCostFor('herbivore_paddock', 3)).toBe(31_250);
  });
  it('charges exactly what it quotes', () => {
    // getOrCreateUser must run before seedLot: lots.userId has a FK on users.discordId
    // (see createDb's foreign_keys = ON), so seeding the lot first throws a constraint
    // error that has nothing to do with upgradeCostFor — every other seedLot call in this
    // file creates the user first for the same reason.
    getOrCreateUser(ctx, 'u1', 'Reg');
    const lot = seedLot({ type: 'paddock', kind: 'herbivore_paddock', name: 'Pen', level: 1 });
    const quoted = upgradeCostFor('herbivore_paddock', 1);
    ctx.db.update(schema.users).set({ cash: quoted }).where(eq(schema.users.discordId, 'u1')).run();
    upgradeLot(ctx, 'u1', lot.id);
    // Exact-charge check: if upgradeLot ever drifted from upgradeCostFor's quote, cash would
    // land above or below 0 instead of landing exactly on it.
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.cash).toBe(0);
  });
});

describe('/upgrade, /decorate, /park rename, /dino unassign, park:collect', () => {
  it('/upgrade execute success and each error reply', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    const cmd = parkModule.commands.find((c) => c.data.name === 'upgrade')!;
    const okI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: lot.id } });
    await cmd.execute(ctx, okI.asChatInput());
    expect(replyText(okI.replies[0])).toContain('level 2');
    const noneI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: 9999 } });
    await cmd.execute(ctx, noneI.asChatInput());
    expect(replyText(noneI.replies[0])).toContain('No such lot');
    ctx.db.update(schema.lots).set({ level: 4 }).run();
    const maxI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: lot.id } });
    await cmd.execute(ctx, maxI.asChatInput());
    expect(replyText(maxI.replies[0])).toContain('max level');
  });
  it('/upgrade execute quotes the price on the insufficient-funds reply', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);   // herbivore_paddock, level 1
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    const cmd = parkModule.commands.find((c) => c.data.name === 'upgrade')!;
    const brokeI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: lot.id } });
    await cmd.execute(ctx, brokeI.asChatInput());
    // Exact, not toContain('5,000'): that substring is satisfied by '15,000' and by
    // '5,000,000' just as happily. herbivore_paddock L1 -> L2 is round(2,000 x 2.5) = 5,000
    // (upgradeCostFor), and the whole point of the quote is that the FIGURE is right.
    expect(replyText(brokeI.replies[0])).toBe('Not enough cash — that upgrade costs 5,000.');
  });
  it('/decorate execute adds decor', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    const item = Object.keys(DECOR)[0];
    const cmd = parkModule.commands.find((c) => c.data.name === 'decorate')!;
    const i = fakeCommand({ name: 'decorate', user: 'u1', options: { lot: lot.id, item } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Decoration added');
    expect(ctx.db.select().from(schema.lots).all()[0].decor).toContain(DECOR[item].kind ?? item);
  });
  it('/park rename updates parkName', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = parkModule.commands.find((c) => c.data.name === 'park')!;
    const i = fakeCommand({ name: 'park', sub: 'rename', user: 'u1', options: { name: 'Raptor Ranch' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Raptor Ranch');
    expect(ctx.db.select().from(schema.users).all()[0].parkName).toBe('Raptor Ranch');
  });
  it('/park rename defangs a masked link in both the stored name and the confirmation', async () => {
    // parkName reaches landmarkPayload's public embed DESCRIPTION on /park landmark,
    // where `[text](url)` renders as a masked link with arbitrary visible text.
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = parkModule.commands.find((c) => c.data.name === 'park')!;
    const i = fakeCommand({ name: 'park', sub: 'rename', user: 'u1', options: { name: '[Free Nitro](https://evil.tld)' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toBe('Park renamed to **[Free Nitro] (https://evil.tld)**.');
    expect(ctx.db.select().from(schema.users).all()[0].parkName).toBe('[Free Nitro] (https://evil.tld)');
  });
  it('/park rename leaves ordinary brackets and parentheses alone', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = parkModule.commands.find((c) => c.data.name === 'park')!;
    const plain = 'Rex Land [big] (fun) ( [';
    const i = fakeCommand({ name: 'park', sub: 'rename', user: 'u1', options: { name: plain } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toBe(`Park renamed to **${plain}**.`);
    expect(ctx.db.select().from(schema.users).all()[0].parkName).toBe(plain);
  });
  it('/build maps LotLimitError and InsufficientFundsError to ephemeral replies', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 10_000_000 }).run();
    const kind = Object.keys(PADDOCKS)[0];
    for (let n = 0; n < 3; n++) buildLot(ctx, 'u1', kind);   // base slots = 3
    // Guard: recomputeRating after 3 builds must not have raised the slot cap.
    expect(lotSlots(ctx.db.select().from(schema.users).all()[0].ratingHighWater)).toBe(3);
    const cmd = parkModule.commands.find((c) => c.data.name === 'build')!;
    const full = fakeCommand({ name: 'build', user: 'u1', options: { kind } });
    await cmd.execute(ctx, full.asChatInput());
    expect(replyText(full.replies[0])).toContain('All lots full');
    ctx.db.delete(schema.lots).run();
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    const broke = fakeCommand({ name: 'build', user: 'u1', options: { kind } });
    await cmd.execute(ctx, broke.asChatInput());
    expect(replyText(broke.replies[0])).toContain('Not enough cash');
  });
  it('/build maps DuplicateFacilityError to an ephemeral reply naming the facility', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    buildLot(ctx, 'u1', 'visitor_center');
    const cmd = parkModule.commands.find((c) => c.data.name === 'build')!;
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'visitor_center' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toBe('You already have a Visitor Center — upgrade it instead.');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
});

describe('gene lab', () => {
  it('grants no breeding slots without one', () => {
    expect(breedingSlots([])).toBe(0);
  });

  it('grants 1/2/3 slots by level', () => {
    const lot = (level: number) => ([{ id: 1, userId: 'u', type: 'facility', kind: 'gene_lab', name: 'Gene Lab', level, decor: [] }] as never);
    expect(breedingSlots(lot(1))).toBe(1);
    expect(breedingSlots(lot(2))).toBe(2);
    expect(breedingSlots(lot(3))).toBe(3);
  });

  it('adds no income bonus', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { cash: 100_000 }, 'test', 0);
    buildLot(ctx, 'u1', 'gene_lab');
    const lots = ctx.db.select().from(schema.lots).all();
    expect(facilityBonusPct(lots)).toBe(0);
  });

  it('allows only one per park', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { cash: 100_000 }, 'test', 0);
    buildLot(ctx, 'u1', 'gene_lab');
    expect(() => buildLot(ctx, 'u1', 'gene_lab')).toThrow(DuplicateFacilityError);
  });

  // Task 12 shipped dw_lot_genelab.svg and its EMOJI_FALLBACK entry, so emojiTag()
  // now resolves to the 🧬 unicode fallback even in tests (no map loaded). This pins
  // the lot row's format now that the emoji is live, replacing the Task 7 interim
  // assertion that pinned the plain-text degrade while the SVG was pending.
  //
  // The lots list itself (and with it, this row format) moved off dashboardPayload
  // entirely onto the Lots tab's lotsPayload, which reuses the same module-level
  // LOT_EMOJI map — retargeted here rather than dropped.
  it('renders with its 🧬 emoji in the Built field', () => {
    const ctx = makeCtx({ nowMs: 0 });
    const user = getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { cash: 100_000 }, 'test', 0);
    const lot = buildLot(ctx, 'u1', 'gene_lab');
    const lots = ctx.db.select().from(schema.lots).all();
    const p = lotsPayload(user, lots, lotSlots(user.ratingHighWater));
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name.includes('Built'))!;
    expect(field.value).toBe(`#${lot.id} 🧬 Gene Lab (lvl 1)`);
  });
});

describe('renameDino', () => {
  it('sets and clears a nickname', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();

    renameDino(ctx, 'u1', d.id, 'Sharpwing');
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBe('Sharpwing');

    renameDino(ctx, 'u1', d.id, null);
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBeNull();
  });

  it('rejects a nickname over 32 characters', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    expect(() => renameDino(ctx, 'u1', d.id, 'x'.repeat(33))).toThrow(/32/);
  });

  it('refuses a dino you do not own', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    expect(() => renameDino(ctx, 'u1', 999, 'x')).toThrow(/own/);
  });

  it('refuses a dino that exists but belongs to another user, and never touches its row', () => {
    // Distinct from the previous case: dinoId 999 above never exists at all, so a lookup
    // that drops the userId filter would still hit the `!dino` branch and pass by accident.
    // This dino is real — owned by u2 — so only an actual ownership check can catch it.
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    getOrCreateUser(ctx, 'u2', 'u2');
    const theirs = ctx.db.insert(schema.dinos).values({
      userId: 'u2', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    expect(() => renameDino(ctx, 'u1', theirs.id, 'Stolen')).toThrow(/own/);
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBeNull();
  });

  it('trims surrounding whitespace and clears when the trimmed result is empty', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();

    renameDino(ctx, 'u1', d.id, '  Rex  ');
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBe('Rex');

    renameDino(ctx, 'u1', d.id, '   ');
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBeNull();
  });

  it('defangs a masked link, keeping the text the player typed readable', () => {
    // A nickname reaches PUBLIC battle embeds, whose description renders `[text](url)` as a
    // clickable link with arbitrary visible text. `allowedMentions: { parse: [] }` kills
    // pings client-wide; it does nothing about markdown.
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();

    renameDino(ctx, 'u1', d.id, '[Free Nitro](https://x.tld)');
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBe('[Free Nitro] (https://x.tld)');
  });

  it('leaves ordinary brackets and parentheses alone', () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();

    const plain = 'Rex [big] (fast) ( [';
    renameDino(ctx, 'u1', d.id, plain);
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBe(plain);
  });

  it('checks the length AFTER defanging, so what is stored is never over the cap', () => {
    // 32 characters in, 33 out — defanging only ever lengthens, so a guard that ran first
    // would no longer govern what actually reaches the column.
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();

    expect(() => renameDino(ctx, 'u1', d.id, `${'x'.repeat(30)}](`)).toThrow(/32/);
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBeNull();
  });
});

describe('/dino rename subcommand', () => {
  it('sets a nickname and confirms it in the reply', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const cmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'rename', user: 'u1', options: { dino: d.id, nickname: 'Sharpwing' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Sharpwing');
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBe('Sharpwing');
  });

  it('clears a nickname when left blank', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', nickname: 'Sharpwing', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const cmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'rename', user: 'u1', options: { dino: d.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('cleared');
    expect(ctx.db.select().from(schema.dinos).all()[0].nickname).toBeNull();
  });

  it('replies ephemerally with the ownership error for a foreign dino', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'rename', user: 'u1', options: { dino: 999, nickname: 'Nope' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('do not own');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('replies ephemerally when the nickname is over 32 characters', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const cmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'rename', user: 'u1', options: { dino: d.id, nickname: 'x'.repeat(33) } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('32');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('defangs a masked link in the confirmation echo', async () => {
    // The confirmation is a NON-EPHEMERAL, bot-authored message, so `[text](url)` in it
    // renders as a real masked link — unlike a masked link typed by a player, which
    // Discord does not render in user message content.
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const cmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'rename', user: 'u1', options: { dino: d.id, nickname: '[Free Nitro](https://evil.tld)' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toBe('🦕 Renamed to **[Free Nitro] (https://evil.tld)**.');
  });

  it('echoes ordinary brackets and parentheses unchanged', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const d = ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
    }).returning().get();
    const cmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const plain = 'Rex [big] (fast) ( [';
    const i = fakeCommand({ name: 'dino', sub: 'rename', user: 'u1', options: { dino: d.id, nickname: plain } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toBe(`🦕 Renamed to **${plain}**.`);
  });
});

describe('/dino list shows nickname and trait marks', () => {
  it('titles the row with the nickname and appends one-line trait marks', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', lastFedAt: 0, hatchedAt: 0,
      nickname: 'Sharpwing', traits: ['gluttonous', 'glass_cannon'],
    }).run();
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'velociraptor', lastFedAt: 0, hatchedAt: 0,
    }).run();
    const i = fakeCommand({ name: 'dino', sub: 'list', user: 'u1' });
    await parkModule.commands.find((c) => c.data.name === 'dino')!.execute(ctx, i.asChatInput());
    const desc = (i.replies[0] as { embeds: Array<{ toJSON(): { description?: string } }> }).embeds[0].toJSON().description!;
    const lines = desc.split('\n');

    const namedRow = lines.find((l) => l.includes('Sharpwing'))!;
    expect(namedRow).toContain('Sharpwing (Triceratops)');
    expect(namedRow).toContain('Gluttonous');
    expect(namedRow).toContain('Glass Cannon');
    // one line per dino — the compact inline form, never traitLines()'s per-trait blurb block
    expect(namedRow.split('\n')).toHaveLength(1);

    const unnamedRow = lines.find((l) => l.includes('Velociraptor'))!;
    expect(unnamedRow).not.toContain('(');   // no nickname => bare species name, no parens
    expect(unnamedRow).not.toMatch(/ — $/);  // no traits => no dangling separator
  });
});

describe('/park alerts', () => {
  it('/park alerts off then on toggles the per-user flag', async () => {
    getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = parkModule.commands.find((c) => c.data.name === 'park')!;

    const off = fakeCommand({ name: 'park', sub: 'alerts', user: 'u1', options: { state: 'off' } });
    await cmd.execute(ctx, off.asChatInput());
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(false);
    expect(replyText(off.replies[0])).toContain('Park alerts are **off**');
    expect(replyText(off.replies[0])).toContain('Duel results are muted too');

    const on = fakeCommand({ name: 'park', sub: 'alerts', user: 'u1', options: { state: 'on' } });
    await cmd.execute(ctx, on.asChatInput());
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(true);
    expect(replyText(on.replies[0])).toContain('Park alerts are **on**');
  });

  it('/park alerts does NOT fall through to the dashboard view path', async () => {
    // /park dispatches on `=== 'rename'` and treats everything else as view. Without an
    // explicit alerts branch this subcommand silently renders the park dashboard and
    // reports success — the failure this test exists to catch.
    getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = parkModule.commands.find((c) => c.data.name === 'park')!;
    const i = fakeCommand({ name: 'park', sub: 'alerts', user: 'u1', options: { state: 'off' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(i.deferOpts).toHaveLength(0);              // the view path always defers
    expect(i.replies).toHaveLength(1);
    expect(replyText(i.replies[0])).toContain('Park alerts are **off**');
  });
});

describe('/dino list full page stays within Discord embed limits', () => {
  it('renders 10 dinos each with 2 traits and a 32-char nickname without tripping validateMessagePayload', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.economy.apply('u1', { cash: 1_000_000 }, 'test', 0);
    // quetzalcoatlus is a carnivore (and, at 14 chars, ties for the longest species name)
    // placed in a herbivore paddock — the habitat-mismatch suffix pads every row further.
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    for (let n = 0; n < 10; n++) {
      ctx.db.insert(schema.dinos).values({
        userId: 'u1', speciesId: 'quetzalcoatlus', lotId: lot.id, hunger: 100,
        lastFedAt: 0, hatchedAt: 0,
        nickname: `Nickname-Number-${n}-XXXXXXXXXXXXXXX`.slice(0, 32),
        traits: ['gluttonous', 'glass_cannon'],   // longest names in two distinct domains
      }).run();
    }
    const i = fakeCommand({ name: 'dino', sub: 'list', user: 'u1' });
    // fakeCommand's reply() runs validateMessagePayload internally (see tests/harness.ts) —
    // reaching the assertions below already proves the payload cleared Discord's real limits.
    await parkModule.commands.find((c) => c.data.name === 'dino')!.execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; description?: string; footer?: { text: string } } }>;
    }).embeds[0].toJSON();
    const rows = embed.description!.split('\n');
    expect(rows).toHaveLength(10);
    const longestRow = Math.max(...rows.map((r) => r.length));
    const totalEmbedText = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0);
    // Measured on this fixture: description 1,280 chars, combined embed text 1,301, longest
    // single row 128 chars — well under both limits that actually apply to this payload
    // (description <= 4096, combined embed text <= 6000; there is no per-field 1024 cap in
    // play here, since this embed carries one description, not fields).
    expect(embed.description!.length).toBeLessThanOrEqual(4096);
    expect(totalEmbedText).toBeLessThanOrEqual(6000);
    expect(longestRow).toBeLessThan(300);
  });
});

describe('dashboard showcase', () => {
  const fieldsOf = (p: { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }) =>
    p.embeds[0].toJSON().fields!;

  it('renders the motto under the world-event header, not instead of it', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 0, { motto: 'Where the big ones live' });
    const desc = p.embeds[0].toJSON().description!;
    const lines = desc.split('\n');
    // Fixed values used verbatim (no `now`), so opts.now defaults to 0 (dashboardPayload's
    // own `?? 0`) — matches eventHeaderLine(0, PARK_HEADER_KEYS) exactly.
    expect(lines).toHaveLength(2);
    // Pins ORDER, not just presence: a regression that composes [motto, header] instead of
    // [header, motto] would still be 2 lines containing the motto text, and would pass a
    // toContain-only check undetected.
    expect(lines[0]).toBe(eventHeaderLine(0, PARK_HEADER_KEYS));
    expect(lines[1]).toContain('Where the big ones live');
  });

  it('omits the motto line entirely when there is none', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 0, {});
    const lines = p.embeds[0].toJSON().description!.split('\n');
    expect(lines).toHaveLength(1);
    // Not just length 1: a regression that drops the header on the no-motto path
    // (`.setDescription(opts.motto ? line : '')`) also yields `''.split('\n') === ['']`,
    // a length-1 array — this line distinguishes "header correctly shown" from "header
    // silently dropped, empty description."
    expect(lines[0]).toBe(eventHeaderLine(0, PARK_HEADER_KEYS));
  });

  it('names the featured dino and attaches its archetype art as the thumbnail', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 1, {
      featured: { name: 'Trixie', speciesId: 'triceratops', archetype: 'tank', diet: 'herbivore' },
    });
    expect(fieldsOf(p).find((f) => f.name === '🦖 Featured')!.value).toBe('Trixie');
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://tank-herbivore.webp');
    // Two files now: the roster banner plus the featured dino. Was 1 when this field
    // lived on the single dashboard card.
    expect(p.files).toHaveLength(2);
  });

  it('ships only the roster banner and no Featured field when nothing is featured', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 1, {});
    expect(fieldsOf(p).some((f) => f.name === '🦖 Featured')).toBe(false);
    // attach() on a null ref is a total no-op, so the banner is the only entry — the
    // "never an empty array" distinction other test files pin still holds.
    expect(p.files).toHaveLength(1);
    expect(p.files![0].name).toBe('dino_roster.webp');
  });
});

describe('facility level arrays are bounds-guarded', () => {
  // A level above maxLevel is not reachable through upgradeLot, but it IS reachable on a
  // live database: nothing constrains lots.level, and a future maxLevel bump that forgets
  // to extend an array produces the same read. Every one of these resolves to the TOP
  // defined entry — the safe direction — rather than undefined.
  it('capHours clamps instead of returning NaN', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    seedLot({ kind: 'visitor_center', name: 'Visitor Center', level: 9 });
    const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all();
    expect(capHours(lots)).toBe(24);
  });
  it('breedingSlots clamps instead of returning undefined', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    seedLot({ kind: 'gene_lab', name: 'Gene Lab', level: 9 });
    const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all();
    expect(breedingSlots(lots)).toBe(3);
  });
  it('incubatorSlots clamps instead of returning undefined', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    seedLot({ kind: 'hatchery_lab', name: 'Hatchery Lab', level: 9 });
    const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all();
    expect(incubatorSlots(lots)).toBe(5);
  });
  // The fourth per-level array, and the one that kept its own inline `?? 0` after the other
  // three were routed through levelValue. It could not produce NaN, so the risk was smaller
  // — but the semantics differed: an over-range level silently ZEROED that facility's whole
  // contribution instead of clamping to the top entry. Food Court is the discriminating
  // fixture because its top bonus is nonzero (12%), so 0 and 12 are distinguishable.
  it('facilityBonusPct clamps to the top bonus instead of dropping the facility to 0%', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    seedLot({ kind: 'food_court', name: 'Food Court', level: 9 });
    const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all();
    expect(facilityBonusPct(lots)).toBe(12);
  });
  // No absent-facility case here: capHours([]) === 8, breedingSlots([]) === 0, and
  // incubatorSlots([]) === 1 are already pinned by 'keeps the no-facility defaults'
  // (this file), 'grants no breeding slots without one' (this file, gene lab describe),
  // and tests/hatchery.test.ts's slot-limit tests, respectively — the level<=0 branch of
  // levelValue is unchanged from the pre-fix code, so a fourth copy here would not
  // discriminate this task's fix from the old implementation.
});

// Retargeted to prestigePayload in Task 5 — un-skip there.
describe.skip('season badge on the park card', () => {
  it('shows the count and the latest season number', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    // seasonBadges: { count: 2, latest: 691 } moves onto prestigePayload's own opts in
    // Task 5 — dashboardPayload no longer accepts it.
    const json = dashboardPayload(user, 0, {}).embeds[0].toJSON();
    const field = json.fields!.find((f) => f.name === '🎖️ Seasons')!;
    expect(field.value).toContain('2');
    expect(field.value).toContain('Season 2');   // 691 - SEASON_EPOCH + 1
    expect(field.inline).toBe(true);
  });

  it('is omitted at zero badges', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const json = dashboardPayload(user, 0, {}).embeds[0].toJSON();
    expect(json.fields!.map((f) => f.name)).not.toContain('🎖️ Seasons');
  });

  it('is omitted when the opt is unset', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const json = dashboardPayload(user, 0, {}).embeds[0].toJSON();
    expect(json.fields!.map((f) => f.name)).not.toContain('🎖️ Seasons');
  });
});

// Retargeted to prestigePayload in Task 5 — un-skip there.
describe.skip('season badge wiring', () => {
  it('/park view shows the viewer’s own badges', async () => {
    ctx.setNow(690 * 30 * 86_400_000);   // SEASON_EPOCH is 690
    getOrCreateUser(ctx, 'u1', 'U1');
    rollSeason(ctx, 'u1');
    ctx.db.update(schema.seasonProgress).set({ badgeAt: ctx.now() })
      .where(eq(schema.seasonProgress.userId, 'u1')).run();
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await testRegistry.findCommand('park')!.execute(ctx, i.asChatInput());
    expect(JSON.stringify(i.replies[0])).toContain('🎖️ Seasons');
  });

  it('a visited park shows the TARGET’s badges, not the viewer’s', async () => {
    ctx.setNow(690 * 30 * 86_400_000);   // SEASON_EPOCH is 690
    getOrCreateUser(ctx, 'u1', 'U1');
    getOrCreateUser(ctx, 'u2', 'U2');
    rollSeason(ctx, 'u2');
    ctx.db.update(schema.seasonProgress).set({ badgeAt: ctx.now() })
      .where(eq(schema.seasonProgress.userId, 'u2')).run();
    const payload = (await visitPayload(ctx, 'u2'))!;
    const json = payload.embeds[0].toJSON();
    expect(json.fields!.map((f) => f.name)).toContain('🎖️ Seasons');
    // And rendering another player's card must not have stamped anything for them.
    expect(ctx.db.select().from(schema.seasonProgress)
      .where(eq(schema.seasonProgress.userId, 'u1')).all()).toHaveLength(0);
  });
});

describe('park component handler default arm', () => {
  it('acknowledges an unrecognised park action instead of timing out', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:notathing:u1', user: 'u1' });
    const comp = parkModule.components.find((c) => c.prefix === 'park')!;
    await comp.execute(ctx, b.asInteraction() as never);
    // deferUpdate, not deferReply: deferReply posts a public "thinking…" placeholder
    // that never resolves when the handler goes on to do nothing.
    expect(b.deferOpts).toEqual([{ kind: 'update' }]);
    expect(b.replies).toEqual([]);
  });

  it('still dispatches the actions it does know', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:collect', user: 'u1' });
    const comp = parkModule.components.find((c) => c.prefix === 'park')!;
    await comp.execute(ctx, b.asInteraction() as never);
    expect(b.replies).toHaveLength(1);
    expect(b.deferOpts).toEqual([]);
  });
});
