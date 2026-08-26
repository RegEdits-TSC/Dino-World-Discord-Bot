import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { dailyModule } from '../src/modules/daily/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { dayKeyUTC, DAY_MS } from '../src/core/clock.js';
import { QUESTS } from '../src/data/quests.js';
import { ACHIEVEMENTS, TIER_REWARDS, TIER_NAMES } from '../src/data/achievements.js';

type TestCtx = ReturnType<typeof makeCtx>;
type EmbedJson = { description?: string; fields?: Array<{ name: string; value: string }> };
type EmbedPayload = { embeds: Array<{ toJSON(): EmbedJson }>; flags?: number; files?: Array<{ name?: string | null }> };
type ButtonRow = { toJSON(): { components: Array<{ custom_id: string }> } };
type PagedPayload = EmbedPayload & { components: ButtonRow[]; attachments?: unknown[] };

const dailyCmd = dailyModule.commands.find((c) => c.data.name === 'daily')!;
const achievementsCmd = dailyModule.commands.find((c) => c.data.name === 'achievements')!;
const dailyBtn = dailyModule.components.find((c) => c.prefix === 'daily')!;
const achBtn = dailyModule.components.find((c) => c.prefix === 'ach')!;
const eggsDef = ACHIEVEMENTS.find((a) => a.id === 'eggs_hatched')!;
const explorerDef = ACHIEVEMENTS.find((a) => a.id === 'stages_first_cleared')!;

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

  it('attaches the daily banner asset', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const i = fakeCommand({ name: 'daily', user: 'u1' });
    await dailyCmd.execute(ctx, i.asChatInput());
    const files = (i.replies[0] as EmbedPayload).files!;
    expect(files).toHaveLength(1);
    // The banner is seeded on the viewer's Discord id, so this pins the face 'u1' gets.
    // The claim reply further down uses the same seed and lands on the same face.
    expect(files[0].name).toBe('daily-v3.webp');
  });

  it('falls back to placeholder text instead of throwing when every rolled quest\'s def has been retired', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    const dayKey = dayKeyUTC(ctx.now());
    for (let slot = 0; slot < 3; slot++) {
      ctx.db.insert(schema.dailyQuests)
        .values({ userId: 'u1', dayKey, slot, questId: `retired_${slot}`, baseline: 0, target: 10 })
        .run();
    }

    const i = fakeCommand({ name: 'daily', user: 'u1' });
    await expect(dailyCmd.execute(ctx, i.asChatInput())).resolves.not.toThrow();
    const embed = (i.replies[0] as EmbedPayload).embeds[0].toJSON();
    expect(embed.description).toBe('New quests at UTC midnight.');
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

  it('dresses the claim reply with the daily banner', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    await dailyCmd.execute(ctx, fakeCommand({ name: 'daily', user: 'u1' }).asChatInput());
    const rows = rowsFor(ctx, 'u1');
    const def = QUESTS.find((q) => q.id === rows[0].questId)!;
    track(ctx, 'u1', def.stat, rows[0].target);

    const btn = fakeButton({ customId: 'daily:claim:u1', user: 'u1' });
    await dailyBtn.execute(ctx, btn.asChatInput() as never);
    const payload = btn.replies[0] as EmbedPayload;
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('daily-v3.webp');
  });
});

describe('/achievements', () => {
  it('renders one field per track on page 1 with a progress bar and tier markers, plus a pageRow (12 tracks = 2 pages)', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    track(ctx, 'u1', 'eggs_hatched', 45); // clears bronze(10), short of silver(50)

    const i = fakeCommand({ name: 'achievements', user: 'u1' });
    await achievementsCmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as PagedPayload;
    const fields = payload.embeds[0].toJSON().fields!;
    expect(fields).toHaveLength(10);
    expect(fields[0].name).toBe(eggsDef.name);
    // nothing claimed yet => no medal glyphs; bar/fraction track toward the next uncrossed tier (silver, 50)
    expect(fields[0].value).toBe(`▰▰▰▰▱ 45/${eggsDef.tiers[1]}`);

    const pageButtons = payload.components[0].toJSON().components;
    expect(pageButtons[0].custom_id).toBe('ach:page:u1:0');
    expect(pageButtons[1].custom_id).toBe('ach:page:u1:2');
    const claimRow = payload.components[1].toJSON().components;
    expect(claimRow[0].custom_id).toBe('ach:claimall:u1');
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('achievements.webp');
  });

  it('shows claimed tier glyphs and MAXED once the stat has crossed every tier', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    track(ctx, 'u1', 'stages_first_cleared', explorerDef.tiers[3]);
    const claimBtn = fakeButton({ customId: 'ach:claimall:u1', user: 'u1' });
    await achBtn.execute(ctx, claimBtn.asChatInput() as never);

    const i = fakeCommand({ name: 'achievements', user: 'u1' });
    await achievementsCmd.execute(ctx, i.asChatInput());
    const fields = (i.replies[0] as EmbedPayload).embeds[0].toJSON().fields!;
    const line = fields.find((f) => f.name === explorerDef.name)!;
    expect(line.value).toBe('🥉🥈🥇🏆 MAXED');
  });
});

describe('ach:page button', () => {
  it('rebuilds the requested page for the owner, with attachments cleared', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    await achievementsCmd.execute(ctx, fakeCommand({ name: 'achievements', user: 'u1' }).asChatInput());

    const btn = fakeButton({ customId: 'ach:page:u1:2', user: 'u1' });
    await achBtn.execute(ctx, btn.asChatInput() as never);
    const payload = btn.replies[0] as PagedPayload;
    const fields = payload.embeds[0].toJSON().fields!;
    expect(fields).toHaveLength(2);
    expect(fields[0].name).toBe(ACHIEVEMENTS[10].name);
    expect(fields[1].name).toBe(ACHIEVEMENTS[11].name);
    // Matches the /dino list precedent: the page flip re-renders a fresh payload, and the
    // explicit empty attachments array is what sheds page 1's (would-be) banner upload.
    expect(payload.attachments).toEqual([]);
  });

  it('clamps an out-of-range page back into range', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const btn = fakeButton({ customId: 'ach:page:u1:99', user: 'u1' });
    await achBtn.execute(ctx, btn.asChatInput() as never);
    const fields = (btn.replies[0] as EmbedPayload).embeds[0].toJSON().fields!;
    expect(fields).toHaveLength(2); // clamped to the last real page (2 of 2)
  });

  it('rejects another user\'s click, ephemeral, with no reply carrying page data', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const btn = fakeButton({ customId: 'ach:page:u1:2', user: 'u2' });
    await achBtn.execute(ctx, btn.asChatInput() as never);
    expect(replyText(btn.replies[0])).toMatch(/not your/i);
    expect((btn.replies[0] as { flags?: number }).flags).toBeDefined();
  });
});

describe('ach:claimall button', () => {
  it('rejects another user\'s click, ephemeral, with no writes', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    track(ctx, 'u1', 'stages_first_cleared', explorerDef.tiers[3]);
    const btn = fakeButton({ customId: 'ach:claimall:u1', user: 'u2' });
    await achBtn.execute(ctx, btn.asChatInput() as never);
    expect(replyText(btn.replies[0])).toMatch(/not your/i);
    expect((btn.replies[0] as { flags?: number }).flags).toBeDefined();
    expect(txRows(ctx, 'u1', 'quest:achievements')).toHaveLength(0);
    expect(ctx.db.select().from(schema.achievementClaims).where(eq(schema.achievementClaims.userId, 'u1')).all()).toHaveLength(0);
  });

  it('replies "Nothing to claim yet." ephemeral when nothing is claimable', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const btn = fakeButton({ customId: 'ach:claimall:u1', user: 'u1' });
    await achBtn.execute(ctx, btn.asChatInput() as never);
    expect(replyText(btn.replies[0])).toBe('Nothing to claim yet.');
    expect((btn.replies[0] as { flags?: number }).flags).toBeDefined();
  });

  it('pays every claimable tier in one transaction and lists them', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    track(ctx, 'u1', 'stages_first_cleared', explorerDef.tiers[3]);
    const btn = fakeButton({ customId: 'ach:claimall:u1', user: 'u1' });
    await achBtn.execute(ctx, btn.asChatInput() as never);
    const payload = btn.replies[0] as EmbedPayload;
    expect(payload.flags).toBeDefined();
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain(explorerDef.name);
    for (const name of TIER_NAMES) expect(embed.description).toContain(name);

    const totalCash = TIER_REWARDS.reduce((s, r) => s + r.cash, 0);
    const totalShards = TIER_REWARDS.reduce((s, r) => s + r.shards, 0);
    const rewardsField = embed.fields!.find((f) => f.name === 'Rewards')!;
    expect(rewardsField.value).toContain(`${totalCash.toLocaleString('en-US')} cash`);
    expect(rewardsField.value).toContain(`${totalShards} shards`);

    expect(txRows(ctx, 'u1', 'quest:achievements')).toHaveLength(1);
    expect(ctx.db.select().from(schema.achievementClaims).where(eq(schema.achievementClaims.userId, 'u1')).all()).toHaveLength(4);
  });

  it('acknowledges an unknown ach action without replying (deferUpdate)', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const btn = fakeButton({ customId: 'ach:bogus:u1', user: 'u1' });
    await achBtn.execute(ctx, btn.asChatInput() as never);
    expect(btn.deferOpts).toHaveLength(1);
    expect(btn.replies).toHaveLength(0);
  });

  it('dresses the claim-all reply with the achievements banner', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'u1');
    track(ctx, 'u1', 'stages_first_cleared', explorerDef.tiers[3]);
    const btn = fakeButton({ customId: 'ach:claimall:u1', user: 'u1' });
    await achBtn.execute(ctx, btn.asChatInput() as never);
    const payload = btn.replies[0] as EmbedPayload;
    expect(payload.files).toHaveLength(1);
    expect(payload.files![0].name).toBe('achievements.webp');
  });
});
