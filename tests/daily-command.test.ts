import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { dailyModule } from '../src/modules/daily/index.js';
import { track } from '../src/core/stats.js';
import { dayKeyUTC, DAY_MS } from '../src/core/clock.js';
import { QUESTS } from '../src/data/quests.js';

type TestCtx = ReturnType<typeof makeCtx>;
type EmbedJson = { description?: string; fields?: Array<{ name: string; value: string }> };
type EmbedPayload = { embeds: Array<{ toJSON(): EmbedJson }>; flags?: number; files?: Array<{ name?: string | null }> };

const dailyCmd = dailyModule.commands.find((c) => c.data.name === 'daily')!;
const achievementsCmd = dailyModule.commands.find((c) => c.data.name === 'achievements')!;
const dailyBtn = dailyModule.components.find((c) => c.prefix === 'daily')!;

function rowsFor(ctx: TestCtx, userId: string) {
  return ctx.db.select().from(schema.dailyQuests)
    .where(and(eq(schema.dailyQuests.userId, userId), eq(schema.dailyQuests.dayKey, dayKeyUTC(ctx.now()))))
    .all();
}

function txRows(ctx: TestCtx, userId: string, reason?: string) {
  const rows = ctx.db.select().from(schema.txLog).where(eq(schema.txLog.userId, userId)).all();
  return reason ? rows.filter((r) => r.reason === reason) : rows;
}

describe('/daily hub', () => {
  it('rolls quests on first open, renders 3 quest lines plus a streak field, and replies public (no ephemeral flag)', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const i = fakeCommand({ name: 'daily', user: 'u1' });
    await dailyCmd.execute(ctx, i.asChatInput());

    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description!.split('\n')).toHaveLength(3);
    expect(embed.fields).toHaveLength(1);
    expect(embed.fields![0].name).toMatch(/Streak: 0 day/);
    expect(embed.fields![0].value).toBe('Next chest at day 3.');
    expect(payload.flags).toBeUndefined();
    expect(rowsFor(ctx, 'u1')).toHaveLength(3);
  });

  it('is idempotent on a second open the same day', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    await dailyCmd.execute(ctx, fakeCommand({ name: 'daily', user: 'u1' }).asChatInput());
    const first = rowsFor(ctx, 'u1').map((r) => r.questId);
    await dailyCmd.execute(ctx, fakeCommand({ name: 'daily', user: 'u1' }).asChatInput());
    expect(rowsFor(ctx, 'u1').map((r) => r.questId)).toEqual(first);
  });

  it('renders a checkmark for a completed quest and a bar for a partial one', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    await dailyCmd.execute(ctx, fakeCommand({ name: 'daily', user: 'u1' }).asChatInput());
    const rows = rowsFor(ctx, 'u1');
    const def = QUESTS.find((q) => q.id === rows[0].questId)!;
    track(ctx, 'u1', def.stat, rows[0].target);

    const i2 = fakeCommand({ name: 'daily', user: 'u1' });
    await dailyCmd.execute(ctx, i2.asChatInput());
    const embed = (i2.replies[0] as EmbedPayload).embeds[0].toJSON();
    const lines = embed.description!.split('\n');
    expect(lines[0]).toBe(`✅ ${def.description}`);
    expect(lines.slice(1).some((l) => l.includes('▱▱▱▱▱') && l.includes('0/'))).toBe(true);
  });

  it('ships no files key when the daily banner asset is absent', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const i = fakeCommand({ name: 'daily', user: 'u1' });
    await dailyCmd.execute(ctx, i.asChatInput());
    expect((i.replies[0] as EmbedPayload).files).toBeUndefined();
  });
});

describe('/daily claim button', () => {
  it('rejects a click from another user, ephemeral, with no writes', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    await dailyCmd.execute(ctx, fakeCommand({ name: 'daily', user: 'u1' }).asChatInput());

    const btn = fakeButton({ customId: 'daily:claim:u1', user: 'u2' });
    await dailyBtn.execute(ctx, btn.asChatInput() as never);
    expect(replyText(btn.replies[0])).toMatch(/not your/i);
    expect((btn.replies[0] as { flags?: number }).flags).toBeDefined();
    expect(txRows(ctx, 'u1')).toHaveLength(0);
  });

  it('replies "nothing to claim" ephemeral when nothing is complete, with no tx_log rows', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    await dailyCmd.execute(ctx, fakeCommand({ name: 'daily', user: 'u1' }).asChatInput());

    const btn = fakeButton({ customId: 'daily:claim:u1', user: 'u1' });
    await dailyBtn.execute(ctx, btn.asChatInput() as never);
    expect(replyText(btn.replies[0])).toBe('Nothing to claim — quests reset at UTC midnight.');
    expect((btn.replies[0] as { flags?: number }).flags).toBeDefined();
    expect(txRows(ctx, 'u1')).toHaveLength(0);
  });

  it('pays an itemized ephemeral reply for a completed quest', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    await dailyCmd.execute(ctx, fakeCommand({ name: 'daily', user: 'u1' }).asChatInput());
    const rows = rowsFor(ctx, 'u1');
    const def = QUESTS.find((q) => q.id === rows[0].questId)!;
    track(ctx, 'u1', def.stat, rows[0].target);

    const btn = fakeButton({ customId: 'daily:claim:u1', user: 'u1' });
    await dailyBtn.execute(ctx, btn.asChatInput() as never);
    const payload = btn.replies[0] as EmbedPayload;
    expect(payload.flags).toBeDefined();
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain(def.description);
    const rewardsField = embed.fields!.find((f) => f.name === 'Rewards')!;
    expect(rewardsField.value).toContain(def.rewards.cash.toLocaleString('en-US'));

    const claimedRow = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.id, rows[0].id)).get()!;
    expect(claimedRow.claimedAt).not.toBeNull();
    // The cash/shards row (foodId null), not a food-reward row — the picked def
    // may or may not also pay food, which would add a second quest:daily row.
    expect(txRows(ctx, 'u1', 'quest:daily').filter((r) => r.foodId === null)).toHaveLength(1);
  });

  it('shows a chest line on the claim that crosses the 3-day streak milestone', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    let lastPayload: EmbedPayload | undefined;
    // Starts at 1*DAY_MS, not 0: lastQuestClaimAt's "never claimed" sentinel is literal 0
    // (NOT NULL DEFAULT 0), which a first claim at real epoch ms 0 would collide with —
    // mirrors the same gotcha documented in tests/daily-claim.test.ts.
    for (let day = 1; day <= 3; day++) {
      ctx.setNow(day * DAY_MS);
      await dailyCmd.execute(ctx, fakeCommand({ name: 'daily', user: 'u1' }).asChatInput());
      const rows = rowsFor(ctx, 'u1');
      const def = QUESTS.find((q) => q.id === rows[0].questId)!;
      track(ctx, 'u1', def.stat, rows[0].target);
      const btn = fakeButton({ customId: 'daily:claim:u1', user: 'u1' });
      await dailyBtn.execute(ctx, btn.asChatInput() as never);
      lastPayload = btn.replies[0] as EmbedPayload;
    }
    const chestField = lastPayload!.embeds[0].toJSON().fields!.find((f) => f.name === 'Chest!');
    expect(chestField).toBeTruthy();
    expect(chestField!.value).toContain('3-day chest');
  });

  it('acknowledges an unknown action without replying (deferUpdate)', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const btn = fakeButton({ customId: 'daily:bogus:u1', user: 'u1' });
    await dailyBtn.execute(ctx, btn.asChatInput() as never);
    expect(btn.deferOpts).toHaveLength(1);
    expect(btn.replies).toHaveLength(0);
  });
});

describe('/achievements (interim handler)', () => {
  it('replies ephemeral with 12 lines', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const i = fakeCommand({ name: 'achievements', user: 'u1' });
    await achievementsCmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { content: string; flags?: number };
    expect(payload.flags).toBeDefined();
    expect(payload.content.split('\n')).toHaveLength(12);
  });
});
