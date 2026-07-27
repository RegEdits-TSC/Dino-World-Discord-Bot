import { describe, it, expect, vi } from 'vitest';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { fightFrames } from '../src/modules/battles/embeds.js';
import { battlesModule } from '../src/modules/battles/index.js';

// fightFrames is a pass-through spy by default (calls the real implementation),
// so every other test in this file is unaffected. Only the render-failure test
// below overrides a single call via mockImplementationOnce.
vi.mock('../src/modules/battles/embeds.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/battles/embeds.js')>();
  return { ...actual, fightFrames: vi.fn(actual.fightFrames) };
});

const battleCmd = battlesModule.commands[0];
const battleButtons = battlesModule.components[0];

function seedFighter(ctx: ReturnType<typeof makeCtx>, userId = 'u1'): number {
  getOrCreateUser(ctx, userId, userId);
  ctx.db.insert(schema.dinos).values({
    userId, speciesId: 'tyrannosaurus', lastFedAt: ctx.now(), hatchedAt: ctx.now(),
  }).run();
  const rows = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
  return rows[rows.length - 1].id;
}

describe('/battle fight cinematic', () => {
  it('plays exactly 1 defer + 4 editReply frames (instant sleep)', async () => {
    const ctx = makeCtx();
    const dino = seedFighter(ctx);
    const fake = fakeCommand({ name: 'battle', sub: 'fight', user: 'u1',
      options: { stage: 'coastal_dig_1', dino1: dino } });
    await battleCmd.execute(ctx, fake.asChatInput());
    expect(fake.deferOpts).toHaveLength(1);
    expect(fake.replies).toHaveLength(4);   // every payload auto-validated by the harness
  });
  it('frames 2-4 never carry a files/attachments key (would clear F1\'s uploads on edit)', async () => {
    const ctx = makeCtx();
    const dino = seedFighter(ctx);
    const fake = fakeCommand({ name: 'battle', sub: 'fight', user: 'u1',
      options: { stage: 'coastal_dig_1', dino1: dino } });
    await battleCmd.execute(ctx, fake.asChatInput());
    for (const frame of fake.replies.slice(1)) {
      expect(frame).not.toHaveProperty('files');
      expect(frame).not.toHaveProperty('attachments');
    }
  });
  it('rejects ephemerally with no defer when energy is empty', async () => {
    const ctx = makeCtx({ nowMs: 1_000_000 });
    const dino = seedFighter(ctx);
    ctx.db.update(schema.users).set({ energy: 0, energyUpdatedAt: ctx.now() })
      .where(eq(schema.users.discordId, 'u1')).run();
    const fake = fakeCommand({ name: 'battle', sub: 'fight', user: 'u1',
      options: { stage: 'coastal_dig_1', dino1: dino } });
    await battleCmd.execute(ctx, fake.asChatInput());
    expect(fake.deferOpts).toHaveLength(0);
    expect(fake.replies).toHaveLength(1);
    expect((fake.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
});

const flush = () => new Promise<void>((r) => setImmediate(r));
function gatedCtx() {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const ctx = makeCtx({ sleep: () => gate });
  return { ctx, release };
}
function firstButtonId(frame: unknown): string {
  const row = (frame as { components: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }> }).components[0];
  return row.toJSON().components[0].custom_id;
}

describe('battle buttons', () => {
  it('skip: wrong user is rejected ephemerally; owner jumps to F4 and the loop short-circuits', async () => {
    const { ctx, release } = gatedCtx();
    const dino = seedFighter(ctx);
    const fake = fakeCommand({ name: 'battle', sub: 'fight', user: 'u1',
      options: { stage: 'coastal_dig_1', dino1: dino } });
    const playing = battleCmd.execute(ctx, fake.asChatInput());
    await flush();
    expect(fake.replies).toHaveLength(1);            // F1 posted, loop parked on sleep
    const skipId = firstButtonId(fake.replies[0]);
    expect(skipId).toMatch(/^battle:skip:u1:/);

    const intruder = fakeButton({ customId: skipId, user: 'u2' });
    await battleButtons.execute(ctx, intruder.asInteraction() as unknown as ButtonInteraction);
    expect((intruder.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);

    const owner = fakeButton({ customId: skipId, user: 'u1' });
    await battleButtons.execute(ctx, owner.asInteraction() as unknown as ButtonInteraction);
    expect(owner.replies).toHaveLength(1);           // i.update(final)
    expect(firstButtonId(owner.replies[0])).toMatch(/^battle:again:u1:coastal_dig_1$/);

    release();
    await playing;
    expect(fake.replies).toHaveLength(1);            // no F2-F4 edits after skip
  });
  it('again: re-runs the full fight on the same message via deferUpdate', async () => {
    const ctx = makeCtx();
    const dino = seedFighter(ctx);
    const fake = fakeCommand({ name: 'battle', sub: 'fight', user: 'u1',
      options: { stage: 'coastal_dig_1', dino1: dino } });
    await battleCmd.execute(ctx, fake.asChatInput());
    const again = fakeButton({ customId: 'battle:again:u1:coastal_dig_1', user: 'u1' });
    await battleButtons.execute(ctx, again.asInteraction() as unknown as ButtonInteraction);
    expect(again.deferOpts).toHaveLength(1);         // deferUpdate, not a fresh reply
    expect(again.replies).toHaveLength(4);           // full 4-frame replay
  });
  it('again: respects the energy gate with an ephemeral rejection', async () => {
    const ctx = makeCtx({ nowMs: 1_000_000 });
    const dino = seedFighter(ctx);
    const fake = fakeCommand({ name: 'battle', sub: 'fight', user: 'u1',
      options: { stage: 'coastal_dig_1', dino1: dino } });
    await battleCmd.execute(ctx, fake.asChatInput());
    ctx.db.update(schema.users).set({ energy: 0, energyUpdatedAt: ctx.now() })
      .where(eq(schema.users.discordId, 'u1')).run();
    const again = fakeButton({ customId: 'battle:again:u1:coastal_dig_1', user: 'u1' });
    await battleButtons.execute(ctx, again.asInteraction() as unknown as ButtonInteraction);
    expect(again.deferOpts).toHaveLength(0);
    expect(again.replies).toHaveLength(1);
    expect((again.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    // Pin the actual reason: this must be runFight's energy rejection, not the
    // identically-shaped "that battle expired" lastSquads-miss message — the
    // shape alone can't distinguish the two, so this test needs the content.
    expect(replyText(again.replies[0])).toMatch(/energy/i);
  });
  it('skip: a forged customId cannot hijack another user\'s live presentation', async () => {
    // The customId's owner segment is attacker-controlled (u1 can craft any
    // customId naming themselves as owner). If the presentation id it points
    // at happens to be live for a DIFFERENT user (pid reuse after a restart,
    // modeled here as a forged customId referencing a real concurrent pid),
    // the handler must check the record's own stored owner, not just the
    // customId, before mutating or exposing it.
    const { ctx, release } = gatedCtx();
    const dinoU2 = seedFighter(ctx, 'u2');
    const fakeU2 = fakeCommand({ name: 'battle', sub: 'fight', user: 'u2',
      options: { stage: 'coastal_dig_1', dino1: dinoU2 } });
    const playingU2 = battleCmd.execute(ctx, fakeU2.asChatInput());
    await flush();
    expect(fakeU2.replies).toHaveLength(1);           // u2's F1 posted, loop parked on sleep
    const u2SkipId = firstButtonId(fakeU2.replies[0]);
    const pid = u2SkipId.split(':')[3];
    const forged = `battle:skip:u1:${pid}`;            // owner segment forged to u1; pid is u2's

    const attacker = fakeButton({ customId: forged, user: 'u1' });
    await battleButtons.execute(ctx, attacker.asInteraction() as unknown as ButtonInteraction);
    // The customId-owner check passes (u1 clicked, u1 is named), but the
    // record belongs to u2 — treated as stale/foreign: cosmetic no-op only.
    expect(attacker.deferOpts).toHaveLength(1);
    expect(attacker.replies).toHaveLength(0);

    release();
    await playingU2;
    // u2's cinematic must complete undisturbed — the forged click must not
    // have flipped u2's entry.skipped.
    expect(fakeU2.replies).toHaveLength(4);
  });
  it('render failure after the commit is disclosed honestly, not as "nothing was charged"', async () => {
    const ctx = makeCtx();
    const dino = seedFighter(ctx);
    const fake = fakeCommand({ name: 'battle', sub: 'fight', user: 'u1',
      options: { stage: 'coastal_dig_1', dino1: dino } });
    vi.mocked(fightFrames).mockImplementationOnce(() => { throw new Error('render boom'); });

    await battleCmd.execute(ctx, fake.asChatInput());

    expect(fake.deferOpts).toHaveLength(1);            // still deferred first
    expect(fake.replies).toHaveLength(1);              // the honest fallback message
    expect(replyText(fake.replies[0])).toMatch(/already resolved/i);
    expect(replyText(fake.replies[0])).not.toMatch(/nothing was charged/i);

    // runFight committed before fightFrames ever ran — the render failure
    // must not roll any of that back.
    const progress = ctx.db.select().from(schema.battleProgress)
      .where(and(eq(schema.battleProgress.userId, 'u1'), eq(schema.battleProgress.stageId, 'coastal_dig_1')))
      .get();
    expect(progress).toBeTruthy();
    expect(progress!.attempts).toBe(1);
  });
});
