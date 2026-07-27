import { describe, it, expect } from 'vitest';
import { MessageFlags, type ButtonInteraction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { battlesModule } from '../src/modules/battles/index.js';

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
  });
});
