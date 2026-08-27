import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { routeInteraction } from '../src/core/router.js';
import { ModuleRegistry } from '../src/core/modules.js';
import type { CommandDef, ComponentDef } from '../src/core/modules.js';
import { makeCtx, fakeCommand, fakeButton, fakeAutocomplete, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { dayKeyUTC } from '../src/core/clock.js';
import { track } from '../src/core/stats.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { rollDailyQuests, questProgress } from '../src/modules/daily/service.js';
import { seasonBadges } from '../src/modules/daily/season.js';
import { dailyRouterHooks } from '../src/modules/daily/hooks.js';

function sc(name: string) {
  return new SlashCommandBuilder().setName(name).setDescription('x');
}

function regWith(commands: CommandDef[], components: ComponentDef[] = []): ModuleRegistry {
  return new ModuleRegistry([{ name: 'm', commands, components }], { m: true });
}

// Directly insert a daily_quests row for today, bypassing rollDailyQuests entirely.
// This is how most cases below control exactly which quest is "on the board" and
// what its target is, without depending on the random per-user/day board — the
// pre/post-roll timing tests below are the only two that need the real roll.
function seedRow(ctx: ReturnType<typeof makeCtx>, userId: string, slot: number, questId: string, baseline: number, target: number) {
  return ctx.db.insert(schema.dailyQuests)
    .values({ userId, dayKey: dayKeyUTC(ctx.now()), slot, questId, baseline, target })
    .returning().get();
}

// The board rolled for a user/day is a deterministic hash of `${userId}:${dayKey}`
// (see rollDailyQuests in src/modules/daily/service.ts, hashSeed in src/core/rolls.ts)
// — there's no public way to force a specific quest onto it. To test the pre/post-dispatch roll TIMING
// (not just that rows appear), find a userId whose day-0 board actually happens to
// include an 'eggs_hatched' quest (hatch_1 or hatch_3), the stat every synthetic
// command below tracks.
function findHatchSeedUser(): string {
  for (let n = 0; n < 300; n++) {
    const uid = `seed-${n}`;
    const probe = makeCtx();
    probe.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    rollDailyQuests(probe, uid);
    const rows = probe.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, uid)).all();
    if (rows.some((r) => r.questId === 'hatch_1' || r.questId === 'hatch_3')) return uid;
  }
  throw new Error('no seed found with an eggs_hatched quest in range');
}

const HATCH_SEED_USER = findHatchSeedUser();

const playCmd: CommandDef = {
  data: sc('play'),
  async execute(ctx, i) { track(ctx, i.user.id, 'eggs_hatched', 1); await i.reply('ok'); },
};
const noreplyCmd: CommandDef = {
  data: sc('noreply'),
  async execute(ctx, i) { track(ctx, i.user.id, 'eggs_hatched', 1); },
};
const newUserCmd: CommandDef = {
  data: sc('newuser'),
  async execute(ctx, i) {
    getOrCreateUser(ctx, i.user.id, i.user.displayName);
    track(ctx, i.user.id, 'eggs_hatched', 1);
    await i.reply('ok');
  },
};
const playBothCmd: CommandDef = {
  data: sc('playboth'),
  async execute(ctx, i) {
    track(ctx, i.user.id, 'battles_fought', 1);
    track(ctx, i.user.id, 'battles_won', 1);
    await i.reply('ok');
  },
};
// Same NAME as the real /daily command, but a synthetic module the harness's real
// builder registry doesn't know about — pins that the hint exemption keys off the
// dispatched command's name, not off which module actually owns it.
const dailySyntheticCmd: CommandDef = {
  data: sc('daily'),
  async execute(ctx, i) { track(ctx, i.user.id, 'eggs_hatched', 1); await i.reply('ok'); },
};

describe('dailyRouterHooks', () => {
  it('pre-dispatch roll counts the days first action toward its own quest', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: HATCH_SEED_USER, lastCollectAt: 0, createdAt: 0 }).run();
    const registry = regWith([playCmd]);
    await routeInteraction(ctx, registry, fakeCommand({ name: 'play', user: HATCH_SEED_USER }).asInteraction(), dailyRouterHooks);

    const rows = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, HATCH_SEED_USER)).all();
    expect(rows.length).toBeGreaterThan(0);
    const hatchView = questProgress(ctx, HATCH_SEED_USER).find((v) => v.def.stat === 'eggs_hatched');
    expect(hatchView).toBeDefined();
    // Roll happened BEFORE dispatch: baseline snapshotted the stat at 0, so the
    // command's own track() counts toward the quest it just rolled.
    expect(hatchView!.row.baseline).toBe(0);
    expect(hatchView!.progress).toBe(1);
  });

  it('post-dispatch roll covers a brand-new user; their first action does not count toward its own quest', async () => {
    const ctx = makeCtx();
    // Deliberately no users row yet — the pre-dispatch roll must no-op.
    const registry = regWith([newUserCmd]);
    await routeInteraction(ctx, registry, fakeCommand({ name: 'newuser', user: HATCH_SEED_USER }).asInteraction(), dailyRouterHooks);

    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, HATCH_SEED_USER)).all()).toHaveLength(1);
    const rows = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, HATCH_SEED_USER)).all();
    expect(rows.length).toBeGreaterThan(0);
    const hatchView = questProgress(ctx, HATCH_SEED_USER).find((v) => v.def.stat === 'eggs_hatched');
    expect(hatchView).toBeDefined();
    // Post-dispatch roll ran AFTER getOrCreateUser + track(), so the baseline
    // already reflects the action — it is accepted as not counting.
    expect(hatchView!.row.baseline).toBe(1);
    expect(hatchView!.progress).toBe(0);
  });

  it('a completed quest produces one ephemeral followUp naming /daily, and stamps the row; a repeat completion does not re-notify', async () => {
    const ctx = makeCtx();
    const uid = 'hint-user';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    const seeded = seedRow(ctx, uid, 0, 'hatch_1', 0, 1);
    const registry = regWith([playCmd]);

    const i1 = fakeCommand({ name: 'play', user: uid });
    await routeInteraction(ctx, registry, i1.asInteraction(), dailyRouterHooks);
    expect(i1.replies).toHaveLength(2);
    expect(replyText(i1.replies[1])).toContain('/daily');
    const row1 = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.id, seeded.id)).get()!;
    expect(row1.notifiedAt).toBe(ctx.now());

    const i2 = fakeCommand({ name: 'play', user: uid });
    await routeInteraction(ctx, registry, i2.asInteraction(), dailyRouterHooks);
    expect(i2.replies).toHaveLength(1); // no second followUp
  });

  it('one action crossing two quests produces exactly one followUp and stamps both rows', async () => {
    const ctx = makeCtx();
    const uid = 'cross-user';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    seedRow(ctx, uid, 0, 'fight_5', 0, 1);
    seedRow(ctx, uid, 1, 'win_3', 0, 1);
    const registry = regWith([playBothCmd]);

    const i = fakeCommand({ name: 'playboth', user: uid });
    await routeInteraction(ctx, registry, i.asInteraction(), dailyRouterHooks);
    expect(i.replies).toHaveLength(2); // own reply + exactly one combined followUp
    expect(replyText(i.replies[1])).toContain('/daily');

    const rows = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, uid)).all();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.notifiedAt).toBe(ctx.now());
  });

  it('a command named daily never triggers the hint, even completing a quest', async () => {
    const ctx = makeCtx();
    const uid = 'daily-cmd-user';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    seedRow(ctx, uid, 0, 'hatch_1', 0, 1);
    const registry = regWith([dailySyntheticCmd]);

    const i = fakeCommand({ name: 'daily', user: uid });
    await routeInteraction(ctx, registry, i.asInteraction(), dailyRouterHooks);
    expect(i.replies).toHaveLength(1);
    const view = questProgress(ctx, uid).find((v) => v.def.stat === 'eggs_hatched')!;
    expect(view.complete).toBe(true);
    expect(view.row.notifiedAt).toBeNull();
  });

  it('a command named achievements never triggers the hint, even completing a quest', async () => {
    const ctx = makeCtx();
    const uid = 'achievements-cmd-user';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    seedRow(ctx, uid, 0, 'hatch_1', 0, 1);
    const achievementsSyntheticCmd: CommandDef = {
      data: sc('achievements'),
      async execute(ctx2, i) { track(ctx2, i.user.id, 'eggs_hatched', 1); await i.reply('ok'); },
    };
    const registry = regWith([achievementsSyntheticCmd]);

    const i = fakeCommand({ name: 'achievements', user: uid });
    await routeInteraction(ctx, registry, i.asInteraction(), dailyRouterHooks);
    expect(i.replies).toHaveLength(1);
  });

  it('a button under the ach prefix never triggers the hint', async () => {
    const ctx = makeCtx();
    const uid = 'u1';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    seedRow(ctx, uid, 0, 'hatch_1', 0, 1);
    const achComponent: ComponentDef = {
      prefix: 'ach',
      async execute(ctx2, i) { track(ctx2, i.user.id, 'eggs_hatched', 1); await i.update({ content: 'x' }); },
    };
    const registry = regWith([], [achComponent]);

    const b = fakeButton({ customId: 'ach:page:u1:2', user: uid });
    await routeInteraction(ctx, registry, b.asInteraction(), dailyRouterHooks);
    expect(b.replies).toHaveLength(1);
  });

  it('a button under the daily prefix never triggers the hint', async () => {
    const ctx = makeCtx();
    const uid = 'u2';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    seedRow(ctx, uid, 0, 'hatch_1', 0, 1);
    const dailyComponent: ComponentDef = {
      prefix: 'daily',
      async execute(ctx2, i) { track(ctx2, i.user.id, 'eggs_hatched', 1); await i.update({ content: 'x' }); },
    };
    const registry = regWith([], [dailyComponent]);

    const b = fakeButton({ customId: 'daily:claim:u2', user: uid });
    await routeInteraction(ctx, registry, b.asInteraction(), dailyRouterHooks);
    expect(b.replies).toHaveLength(1);
  });

  it('a command that completes a quest without replying leaves the hint owed for the next command', async () => {
    const ctx = makeCtx();
    const uid = 'noreply-user';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    const seeded = seedRow(ctx, uid, 0, 'hatch_1', 0, 1);
    const registry = regWith([noreplyCmd, playCmd]);

    const i1 = fakeCommand({ name: 'noreply', user: uid });
    await routeInteraction(ctx, registry, i1.asInteraction(), dailyRouterHooks);
    expect(i1.replies).toHaveLength(0);
    let row = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.id, seeded.id)).get()!;
    expect(row.notifiedAt).toBeNull();

    const i2 = fakeCommand({ name: 'play', user: uid });
    await routeInteraction(ctx, registry, i2.asInteraction(), dailyRouterHooks);
    expect(i2.replies).toHaveLength(2);
    expect(replyText(i2.replies[1])).toContain('/daily');
    row = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.id, seeded.id)).get()!;
    expect(row.notifiedAt).toBe(ctx.now());
  });

  it('does not stamp notifiedAt if the followUp send itself fails, leaving the hint owed', async () => {
    const ctx = makeCtx();
    const uid = 'follow-fail-user';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    const seeded = seedRow(ctx, uid, 0, 'hatch_1', 0, 1);
    const registry = regWith([playCmd]);

    const fi = fakeCommand({ name: 'play', user: uid });
    const interaction = fi.asInteraction() as unknown as { followUp(payload: unknown): Promise<void> };
    interaction.followUp = async () => { throw new Error('discord unavailable'); };
    await expect(routeInteraction(ctx, registry, fi.asInteraction(), dailyRouterHooks)).resolves.toBeUndefined();

    expect(fi.replies).toHaveLength(1); // only the command's own reply; the failed followUp never landed
    const row = ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.id, seeded.id)).get()!;
    expect(row.notifiedAt).toBeNull();
  });

  it('autocomplete interactions never roll or hint', async () => {
    const ctx = makeCtx();
    const registry = regWith([{
      data: sc('ac2'),
      async execute() { /* unused */ },
      async autocomplete(_ctx, i) { await i.respond([]); },
    }]);
    const i = fakeAutocomplete({ name: 'ac2', user: 'autouser', focused: { name: 'q', value: '' } });
    await routeInteraction(ctx, registry, i.asInteraction(), dailyRouterHooks);
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.dailyQuests).all()).toHaveLength(0);
  });

  it('a claimed quest never re-triggers the hint even if it still reads as complete', async () => {
    const ctx = makeCtx();
    const uid = 'claimed-user';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    ctx.db.insert(schema.dailyQuests).values({
      userId: uid, dayKey: dayKeyUTC(ctx.now()), slot: 0, questId: 'hatch_1',
      baseline: 0, target: 1, claimedAt: ctx.now(),
    }).run();
    const registry = regWith([playCmd]);

    const i = fakeCommand({ name: 'play', user: uid });
    await routeInteraction(ctx, registry, i.asInteraction(), dailyRouterHooks);
    expect(i.replies).toHaveLength(1);
  });

  // Distinguishes the badge stamp's placement from the daily-quest hint's exemptions,
  // which govern completely different concerns: EXEMPT_COMMANDS/EXEMPT_PREFIXES silence a
  // hint about a screen the player is already on, and have nothing to do with the season
  // track. A command named 'daily' is exempt from the hint but must still cross the
  // capstone and stamp the badge in the very same dispatch.
  it('a command named daily still stamps the season badge on crossing, even though it is hint-exempt', async () => {
    const ctx = makeCtx();
    const uid = 'season-badge-daily-cmd-user';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    const dailyCapstoneCmd: CommandDef = {
      data: sc('daily'),
      async execute(ctx2, i) {
        track(ctx2, i.user.id, 'expeditions_claimed', 50);   // 250
        track(ctx2, i.user.id, 'battles_fought', 1000);      // +250 = 500
        track(ctx2, i.user.id, 'eggs_hatched', 75);           // +225 = 725
        track(ctx2, i.user.id, 'dinos_fed', 360);             // +120 = 845 >= 800
        await i.reply('ok');
      },
    };
    const registry = regWith([dailyCapstoneCmd]);

    await routeInteraction(ctx, registry, fakeCommand({ name: 'daily', user: uid }).asInteraction(), dailyRouterHooks);

    expect(seasonBadges(ctx, uid).count).toBe(1);
  });

  it('routeInteraction with no hooks argument still works and neither rolls nor hints (back-compat)', async () => {
    const ctx = makeCtx();
    const uid = 'no-hooks-user';
    ctx.db.insert(schema.users).values({ discordId: uid, lastCollectAt: 0, createdAt: 0 }).run();
    const registry = regWith([playCmd]);

    const i = fakeCommand({ name: 'play', user: uid });
    await routeInteraction(ctx, registry, i.asInteraction());
    expect(i.replies).toHaveLength(1);
    expect(ctx.db.select().from(schema.dailyQuests).where(eq(schema.dailyQuests.userId, uid)).all()).toHaveLength(0);
  });
});
