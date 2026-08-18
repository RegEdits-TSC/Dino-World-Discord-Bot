import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { EmbedBuilder, ButtonInteraction } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { recomputeRating } from '../src/modules/park/rating.js';
import { attendanceOf } from '../src/modules/park/attendance.js';
import { InsufficientFundsError } from '../src/core/economy.js';
import { readStat } from '../src/core/stats.js';
import {
  buildAttraction, upgradeAttraction,
  UnknownAttractionError, AttractionLockedError,
  DuplicateAttractionError, AttractionMaxedError,
  claimableMilestones, claimMilestone, MilestoneUnavailableError, nextMilestone,
} from '../src/modules/guests/service.js';
import { guestsModule } from '../src/modules/guests/index.js';
import { ATTRACTIONS } from '../src/data/attractions.js';
import { ATTENDANCE_MILESTONES, ATTENDANCE_SPECIES_TARGET, ATTRACTION_DRAW_TARGET } from '../src/data/attendance.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

function rich(highWater = 0) {
  getOrCreateUser(ctx, 'u1', 'Reg');
  ctx.economy.apply('u1', { cash: 200_000_000 }, 'test:seed', 0);
  ctx.db.update(schema.users).set({ attendanceHighWater: highWater })
    .where(eq(schema.users.discordId, 'u1')).run();
}

describe('buildAttraction', () => {
  it('charges cash, inserts the row at level 1 and counts the stat', () => {
    rich();
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const def = buildAttraction(ctx, 'u1', 'picnic_lawn');

    expect(def.kind).toBe('picnic_lawn');
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before - ATTRACTIONS.picnic_lawn.buildCost);
    const rows = ctx.db.select().from(schema.attractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe(1);
    expect(readStat(ctx, 'u1', 'attractions_built')).toBe(1);
  });

  it('refuses an unknown kind', () => {
    rich();
    expect(() => buildAttraction(ctx, 'u1', 'no_such_kind')).toThrow(UnknownAttractionError);
  });

  it('refuses a kind whose unlock threshold the high-water has not reached', () => {
    rich(0);
    expect(() => buildAttraction(ctx, 'u1', 'gift_shop')).toThrow(AttractionLockedError);
  });

  it('refuses a second copy of the same kind', () => {
    rich(150);
    buildAttraction(ctx, 'u1', 'picnic_lawn');
    expect(() => buildAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(DuplicateAttractionError);
  });

  it('leaves no row behind when the charge fails', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');           // 500 starting cash, nowhere near enough
    expect(() => buildAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(InsufficientFundsError);
    expect(ctx.db.select().from(schema.attractions).all()).toHaveLength(0);
    expect(readStat(ctx, 'u1', 'attractions_built')).toBe(0);
  });
});

describe('upgradeAttraction', () => {
  it('charges the rung cost and raises the level', () => {
    rich();
    buildAttraction(ctx, 'u1', 'picnic_lawn');
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const { level } = upgradeAttraction(ctx, 'u1', 'picnic_lawn');

    expect(level).toBe(2);
    expect(ctx.db.select().from(schema.users).all()[0].cash)
      .toBe(before - ATTRACTIONS.picnic_lawn.upgradeCosts[0]);
  });

  it('refuses to upgrade past the top level', () => {
    rich();
    buildAttraction(ctx, 'u1', 'picnic_lawn');
    upgradeAttraction(ctx, 'u1', 'picnic_lawn');
    upgradeAttraction(ctx, 'u1', 'picnic_lawn');
    expect(() => upgradeAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(AttractionMaxedError);
  });

  it('refuses to upgrade something that was never built', () => {
    rich();
    expect(() => upgradeAttraction(ctx, 'u1', 'picnic_lawn')).toThrow(UnknownAttractionError);
  });
});

describe('milestones', () => {
  const first = ATTENDANCE_MILESTONES[0];

  it('offers nothing below the first threshold', () => {
    rich(0);
    expect(claimableMilestones(ctx, 'u1')).toEqual([]);
  });

  it('offers every crossed milestone and pays its reward', () => {
    rich(first.at);
    expect(claimableMilestones(ctx, 'u1').map((m) => m.at)).toEqual([first.at]);
    const before = ctx.db.select().from(schema.users).all()[0].cash;

    claimMilestone(ctx, 'u1', first.at);

    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(before + (first.reward.cash ?? 0));
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(1);
    expect(claimableMilestones(ctx, 'u1')).toEqual([]);
  });

  it('is idempotent — a second claim of the same milestone pays nothing', () => {
    rich(first.at);
    claimMilestone(ctx, 'u1', first.at);
    const after = ctx.db.select().from(schema.users).all()[0].cash;
    expect(() => claimMilestone(ctx, 'u1', first.at)).toThrow(MilestoneUnavailableError);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(after);
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(1);
  });

  it('refuses a milestone the high-water has not reached', () => {
    rich(first.at - 1);
    expect(() => claimMilestone(ctx, 'u1', first.at)).toThrow(MilestoneUnavailableError);
  });

  it('refuses a threshold that is not a milestone at all', () => {
    rich(999_999);
    expect(() => claimMilestone(ctx, 'u1', 12_345)).toThrow(MilestoneUnavailableError);
  });

  it('grants an egg when the milestone carries one', () => {
    const withEgg = ATTENDANCE_MILESTONES.find((m) => m.reward.egg)!;
    rich(withEgg.at);
    claimMilestone(ctx, 'u1', withEgg.at);
    const eggs = ctx.db.select().from(schema.eggs).all();
    expect(eggs).toHaveLength(1);
    expect(eggs[0].rarity).toBe(withEgg.reward.egg);
    expect(eggs[0].source).toBe('guests');
  });

  it('nextMilestone names the next genuinely-unclaimed rung even after live attendance falls below every already-claimed one', () => {
    // High-water 700 clears the first three milestones (200/400/700); claim all of them.
    rich(ATTENDANCE_MILESTONES[2].at);
    for (const m of ATTENDANCE_MILESTONES.slice(0, 3)) claimMilestone(ctx, 'u1', m.at);
    expect(claimableMilestones(ctx, 'u1')).toEqual([]);
    // No park at all was ever built — live attendance is 0, well below every claimed
    // rung. A next-milestone hint keyed on live attendance (att.attendance) rather than
    // the high-water/claimed-set would resolve back to the first, already-claimed
    // milestone here instead of the real next one.
    expect(attendanceOf(ctx, 'u1').attendance).toBe(0);

    expect(nextMilestone(ctx, 'u1')).toEqual(ATTENDANCE_MILESTONES[3]);
  });
});

const cmd = () => guestsModule.commands[0];
const comp = () => guestsModule.components[0];

describe('/guests', () => {
  it('view reports the resolved attendance figure and its three terms, keyed to the real values', async () => {
    rich(0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    // Sanity: none of the three terms sits at a round number here (one species, no
    // attractions, no Visitor Center) — if this fixture ever changed to hit 0 or a
    // formatting-coincidence value, the exact-match assertions below could pass without
    // actually proving the field is wired to the real number.
    const att = attendanceOf(ctx, 'u1');
    expect(att.distinctSpecies).toBe(1);
    expect(att.drawTotal).toBe(0);
    expect(att.vcLevel).toBe(0);

    const i = fakeCommand({ name: 'guests', sub: 'view', user: 'u1' });
    await cmd().execute(ctx, i.asChatInput());
    // guestsPayload is embed-based with no top-level `content`, so replyText (which
    // only ever reads `.content`) cannot see it — inspect the embed JSON instead, the
    // same idiom tests/duels.test.ts and tests/season-embeds.test.ts already use.
    const embed = (i.replies[0] as { embeds: EmbedBuilder[] }).embeds[0].toJSON();
    expect(embed.description).toContain(`**Attendance:** ${att.attendance.toLocaleString()}`);
    const fields = embed.fields!;
    expect(fields.find((f) => f.name === 'Variety')!.value)
      .toBe(`${att.distinctSpecies} / ${ATTENDANCE_SPECIES_TARGET} species`);
    expect(fields.find((f) => f.name === 'Attractions')!.value)
      .toBe(`${att.drawTotal} / ${ATTRACTION_DRAW_TARGET} draw`);
    expect(fields.find((f) => f.name === 'Visitor Center')!.value)
      .toBe(`Level ${att.vcLevel}`);
  });

  it('build charges the exact attraction cost and confirms it by name', async () => {
    rich(0);
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const i = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' } });
    await cmd().execute(ctx, i.asChatInput());

    expect(ctx.db.select().from(schema.users).all()[0].cash)
      .toBe(before - ATTRACTIONS.picnic_lawn.buildCost);
    const rows = ctx.db.select().from(schema.attractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe(1);
    const embed = (i.replies[0] as { embeds: EmbedBuilder[] }).embeds[0].toJSON();
    expect(embed.title).toContain(ATTRACTIONS.picnic_lawn.name);
  });

  it('build reports a locked kind ephemerally instead of throwing', async () => {
    rich(0);
    const i = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'grand_atrium' } });
    await cmd().execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toMatch(/not drawing enough guests|locked/i);
  });

  it('upgrades instead of rebuilding when the kind is already owned', async () => {
    rich(0);
    const first = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' } });
    await cmd().execute(ctx, first.asChatInput());
    const second = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' } });
    await cmd().execute(ctx, second.asChatInput());

    const rows = ctx.db.select().from(schema.attractions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe(2);
  });

  it('reports a maxed attraction ephemerally rather than charging again', async () => {
    rich(0);
    for (let n = 0; n < 3; n++) {
      await cmd().execute(ctx, fakeCommand({
        name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' },
      }).asChatInput());
    }
    const cashAtTop = ctx.db.select().from(schema.users).all()[0].cash;
    const i = fakeCommand({ name: 'guests', sub: 'build', user: 'u1', options: { attraction: 'picnic_lawn' } });
    await cmd().execute(ctx, i.asChatInput());

    expect(replyText(i.replies[0])).toMatch(/top level/i);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(cashAtTop);
  });

  it('refuses a claim button belonging to another player', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    const i = fakeButton({ customId: `guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`, user: 'u2' });
    await comp().execute(ctx, i.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(i.replies[0])).toMatch(/not your/i);
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(0);
  });

  it('refuses a stale claim button whose milestone is already claimed', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    claimMilestone(ctx, 'u1', ATTENDANCE_MILESTONES[0].at);
    const cashAfterFirstClaim = ctx.db.select().from(schema.users).all()[0].cash;
    const i = fakeButton({ customId: `guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`, user: 'u1' });
    await comp().execute(ctx, i.asInteraction() as unknown as ButtonInteraction);
    expect(ctx.db.select().from(schema.attendanceClaims).all()).toHaveLength(1);
    expect(replyText(i.replies[0])).toMatch(/no longer available/i);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBe(cashAfterFirstClaim);
  });

  it('reports an unrecognised subcommand ephemerally instead of falling through to view', async () => {
    // The real /guests builder only ever defines view/build/claim, so fakeCommand
    // would throw "has no subcommand 'bogus'" if the command name it looks up
    // (testRegistry.findCommand) resolves to the real builder — builderSpec's own
    // fixture-typo guard. A command name the registry doesn't know about (the same
    // "synthetic command" escape hatch router.test.ts uses) makes builderSpec return
    // null and skip that validation entirely; execute() itself never reads
    // i.commandName, only i.options.getSubcommand(), so this still exercises the
    // guestsModule command's own default arm with a value its real builder could
    // never actually produce.
    const i = fakeCommand({ name: 'not-a-real-command', sub: 'bogus', user: 'u1' });
    await cmd().execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toBe('Unknown /guests subcommand.');
  });

  it('claim subcommand offers a reached-and-unclaimed milestone with a button', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    const i = fakeCommand({ name: 'guests', sub: 'claim', user: 'u1' });
    await cmd().execute(ctx, i.asChatInput());
    const reply = i.replies[0] as { embeds: EmbedBuilder[]; components?: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }> };
    expect(JSON.stringify(reply.embeds[0].toJSON())).toContain(ATTENDANCE_MILESTONES[0].name);
    expect(reply.components).toHaveLength(1);
    expect(reply.components![0].toJSON().components[0].custom_id)
      .toBe(`guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`);
  });

  it('view produces a claim button once a milestone is reached', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    const i = fakeCommand({ name: 'guests', sub: 'view', user: 'u1' });
    await cmd().execute(ctx, i.asChatInput());
    const reply = i.replies[0] as { components?: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }> };
    expect(reply.components).toHaveLength(1);
    expect(reply.components![0].toJSON().components[0].custom_id)
      .toBe(`guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`);
  });

  it('a successful claim pays the reward, records the claim and re-renders the message', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const i = fakeButton({ customId: `guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`, user: 'u1' });
    await comp().execute(ctx, i.asInteraction() as unknown as ButtonInteraction);

    const claims = ctx.db.select().from(schema.attendanceClaims).all();
    expect(claims).toHaveLength(1);
    expect(claims[0].milestone).toBe(ATTENDANCE_MILESTONES[0].at);
    expect(ctx.db.select().from(schema.users).all()[0].cash)
      .toBe(before + (ATTENDANCE_MILESTONES[0].reward.cash ?? 0));
    // i.update, not i.reply — the message the button was on advances in place.
    expect(i.replies).toHaveLength(1);
    const embed = (i.replies[0] as { embeds: EmbedBuilder[] }).embeds[0].toJSON();
    expect(JSON.stringify(embed)).toMatch(/attendance/i);
  });

  it('view never restamps the live park rating, so reading the screen cannot revoke /trade', async () => {
    // No rich(): this fixture is about parkRating, not cash. Eight herbivore species in
    // one L1 herbivore paddock, all fed at t=0 — parkRaw 1, collection weight 22/190,
    // comfort 0.75 (correct diet, no decor).
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 500_000 }, 'test:seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const species = [
      'triceratops', 'stegosaurus', 'parasaurolophus', 'iguanodon',
      'ankylosaurus', 'brachiosaurus', 'gallimimus', 'maiasaura',
    ];
    ctx.db.insert(schema.dinos).values(species.map((speciesId) => ({
      userId: 'u1', lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }))).run();
    // Stamp the rating once at full comfort, exactly as a real build/feed/assign would.
    recomputeRating(ctx, 'u1');
    const before = ctx.db.select().from(schema.users).all()[0].parkRating;
    expect(before).toBe(243);

    // 20h of hunger drain: comfort has fallen to 58.33% of its fed value, but escapeAt
    // for this fixture is 40h, so nothing has escaped and the ONLY term that moved is
    // comfort. That isolates the defect from the escaped-dino one.
    ctx.setNow(20 * 3_600_000);

    const i = fakeCommand({ name: 'guests', sub: 'view', user: 'u1' });
    await cmd().execute(ctx, i.asChatInput());

    // The whole point: a read path may not move the column liveRating() checks against
    // TRADE_MIN_RATING at both createTrade and acceptTrade.
    expect(ctx.db.select().from(schema.users).all()[0].parkRating).toBe(before);
    expect(i.replies).toHaveLength(1);   // and the screen still rendered

    // Not vacuous: a recompute at this same instant genuinely lowers the stored value by
    // 79 points (0.79 star). If this line ever stops dropping, the assertion above has
    // stopped proving anything and the fixture needs rebuilding, not the assertion.
    expect(recomputeRating(ctx, 'u1').rating).toBe(164);
  });

  it('claim stamps the attendance high-water before it reads it, so a pre-migration account is not locked out of its rewards — and view never does', async () => {
    // No rich() here — attendanceHighWater is left at its migration default of 0, the
    // same starting point as every account that existed before this column shipped.
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 500_000 }, 'test:seed', 0);
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    const species = [
      'triceratops', 'stegosaurus', 'parasaurolophus', 'iguanodon', 'ankylosaurus',
      'brachiosaurus', 'gallimimus', 'maiasaura', 'massospondylus', 'ouranosaurus',
    ];
    ctx.db.insert(schema.dinos).values(species.map((speciesId) => ({
      userId: 'u1', lotId: lot.id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }))).run();
    const liveAttendance = attendanceOf(ctx, 'u1').attendance;
    // Sanity: the fixture must actually clear the first milestone, or a stale
    // high-water of 0 and a correctly-stamped one would both fail to offer a claim
    // button and this test could pass for the wrong reason.
    expect(liveAttendance).toBeGreaterThanOrEqual(ATTENDANCE_MILESTONES[0].at);
    expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(0);

    // view writes nothing at all — not the rating, and not the high-water either.
    const viewI = fakeCommand({ name: 'guests', sub: 'view', user: 'u1' });
    await cmd().execute(ctx, viewI.asChatInput());
    expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(0);

    // claim leads directly to a payout, so it stamps first and then reads.
    const i = fakeCommand({ name: 'guests', sub: 'claim', user: 'u1' });
    await cmd().execute(ctx, i.asChatInput());

    expect(ctx.db.select().from(schema.users).all()[0].attendanceHighWater).toBe(liveAttendance);
    const reply = i.replies[0] as { embeds: EmbedBuilder[]; components?: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }> };
    expect(reply.components).toHaveLength(1);
    expect(reply.components![0].toJSON().components[0].custom_id)
      .toBe(`guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`);
  });

  it('every /guests surface ships the guests banner and its file together', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    for (const sub of ['view', 'build', 'claim'] as const) {
      const i = fakeCommand({
        name: 'guests', sub, user: 'u1',
        options: sub === 'build' ? { attraction: 'picnic_lawn' } : {},
      });
      await cmd().execute(ctx, i.asChatInput());
      const payload = i.replies[0] as { embeds: EmbedBuilder[]; files?: Array<{ name?: string | null }> };
      expect(payload.embeds[0].toJSON().image?.url, sub).toBe('attachment://guests.webp');
      // toEqual on the whole list, not toContain: attach() APPENDS, so a second slot
      // wired later would show up here rather than hiding behind a membership check.
      expect(payload.files!.map((f) => f.name), sub).toEqual(['guests.webp']);
    }
  });

  // An i.update carrying `files` REPLACES the message's whole attachment set. The claim
  // handler re-renders through guestsPayload, so the banner has to be re-attached on the
  // post-claim render or the message the player just used loses the image it had — a
  // silent regression with no error anywhere, and one no existing test could see, since
  // this module shipped no art before and nothing asserted files/attachments on this path.
  it('the claim re-render carries the banner again rather than blanking the message art', async () => {
    rich(ATTENDANCE_MILESTONES[0].at);
    const i = fakeButton({ customId: `guests:claim:u1:${ATTENDANCE_MILESTONES[0].at}`, user: 'u1' });
    await comp().execute(ctx, i.asInteraction() as unknown as ButtonInteraction);
    const update = i.replies[0] as { embeds: EmbedBuilder[]; files?: Array<{ name?: string | null }> };
    expect(update.embeds[0].toJSON().image?.url).toBe('attachment://guests.webp');
    expect(update.files!.map((f) => f.name)).toEqual(['guests.webp']);
    // And NEVER a hand-set attachments key. The fightFrames rule (attachments: []
    // mandatory and unconditional) exists because one MessagePayload object reaches two
    // send sites and each must shed the other's set; this payload is built fresh by
    // guestsPayload and sent exactly once, so the replacement set is already identical.
    expect('attachments' in update).toBe(false);
  });
});
