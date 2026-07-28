import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ButtonInteraction } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, capHours, facilityBonusPct } from '../src/modules/park/service.js';
import { parkModule } from '../src/modules/park/index.js';
import { hatcheryModule } from '../src/modules/hatchery/index.js';
import { careModule } from '../src/modules/care/index.js';
import { tradingModule } from '../src/modules/trading/index.js';
import { expeditionsModule } from '../src/modules/expeditions/index.js';
import { adminModule } from '../src/modules/admin/index.js';
import { settingsModule } from '../src/modules/settings/index.js';
import { eggHatchHandler, type Sender, type NotifyPayload } from '../src/core/notify.js';
import { accruedIncome, comfortAt, type ClockDino } from '../src/core/clock.js';
import { RARITY } from '../src/data/rarity.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { getSpecies } from '../src/data/species/index.js';
import { battlesModule } from '../src/modules/battles/index.js';
import { runFight, BattleError } from '../src/modules/battles/service.js';
import { chapterUnlocked, STAGES, type ProgressMap } from '../src/data/battle/chapters/index.js';
import { ENERGY_CAP, ENERGY_REGEN_MS } from '../src/data/battle/constants.js';

// This file is the regression net over six risky time/state couplings that
// per-command unit tests miss because they only ever exercise one command at
// a time. Each coupling only shows up when a SEQUENCE of commands share state
// across a time jump — see the comment on each `it` for the specific
// invariant it pins.

const H = 3_600_000;
const paddockKindFor = (diet: string) => Object.keys(PADDOCKS).find((k) => PADDOCKS[k].diet === diet)!;

// Method-shorthand `execute(...)` (not `execute: (...) => ...`) is checked
// bivariantly by TS regardless of strictFunctionTypes, so every module's
// concrete `execute(ctx: Ctx, i: ChatInputCommandInteraction)` structurally
// satisfies this looser shape without per-call-site casts.
type AnyModule = { commands: Array<{ data: { name: string }; execute(c: unknown, i: unknown): Promise<void> }> };
async function dispatch(ctx: unknown, module: AnyModule, name: string, opts: Parameters<typeof fakeCommand>[0]) {
  const i = fakeCommand(opts);
  await module.commands.find((c) => c.data.name === name)!.execute(ctx, i.asChatInput());
  return i;
}
async function click(ctx: unknown, module: { components: Array<{ prefix: string; execute(c: unknown, i: unknown): Promise<void> }> }, customId: string, user: string) {
  const b = fakeButton({ customId, user });
  await module.components.find((c) => c.prefix === customId.split(':')[0])!.execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
  return b;
}
// /feed replies carry an embed (carePayload), not a plain `content` string —
// replyText() only reads `.content`, so success replies need the description instead.
function embedText(r: unknown): string {
  const payload = r as { embeds?: Array<{ toJSON(): { description?: string } }> };
  return payload.embeds?.[0]?.toJSON().description ?? '';
}
// Notifications are NotifyPayloads since the Sender widening: the merged <@id>
// ping lives on `content`, the message body may live in an embed.
const notifyContent = (p: NotifyPayload): string => (typeof p === 'string' ? p : p.content ?? '');

describe('journeys', () => {
  it('spine: /incubate → time → /hatch → crack → /dino assign → time → park:collect', async () => {
    const ctx = makeCtx(); ctx.setNow(1000);
    // Owner grants the raw materials through the admin command layer.
    await dispatch(ctx, adminModule, 'admin', {
      name: 'admin', sub: 'give', user: 'owner',
      options: { user: 'p1', 'egg-rarity': 'common', cash: 100_000 },
    });
    const egg = ctx.db.select().from(schema.eggs).all()[0];
    await dispatch(ctx, hatcheryModule, 'incubate', { name: 'incubate', user: 'p1', options: { egg: egg.id } });
    ctx.setNow(1000 + RARITY.common.incubationMs + 1);
    const hatch = await dispatch(ctx, hatcheryModule, 'hatch', { name: 'hatch', user: 'p1', options: { egg: egg.id } });
    expect(JSON.stringify(hatch.replies[0])).toContain(`hatch:crack:${egg.id}`);
    const crack = await click(ctx, hatcheryModule, `hatch:crack:${egg.id}`, 'p1');
    expect(replyText(crack.replies[0]) || JSON.stringify(crack.replies[0])).toBeTruthy();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    expect(dino).toBeTruthy();
    // hatchEgg (src/modules/hatchery/service.ts) sets hunger: 100, lastFedAt: ctx.now() —
    // the freshly hatched dino is already "fed", so no /feed dispatch is needed here.
    // Build a matching paddock and assign through the command layer.
    const diet = getSpecies(dino.speciesId).diet;
    await dispatch(ctx, parkModule, 'build', { name: 'build', user: 'p1', options: { kind: paddockKindFor(diet) } });
    const lot = ctx.db.select().from(schema.lots).all()[0];
    const assign = await dispatch(ctx, parkModule, 'dino', {
      name: 'dino', sub: 'assign', user: 'p1', options: { dino: dino.id, lot: lot.id },
    });
    expect(replyText(assign.replies[0])).toContain('Assigned');
    const collectFrom = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!.cash;
    ctx.setNow(ctx.now() + 2 * H);
    const collect = await click(ctx, parkModule, 'park:collect', 'p1');
    expect(replyText(collect.replies[0])).toContain('Collected');
    expect(ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!.cash)
      .toBeGreaterThan(collectFrom);
  });

  it('feed inside an uncollected window: collect pays exactly what the current formula integrates', async () => {
    // Pins coupling #1 (audit): collectIncome integrates [lastCollectAt, now] with the
    // dino's CURRENT hungerAtFed/lastFedAt — a feed mid-window retroactively reprices
    // the pre-feed segment. This is a characterization test of the shipped behavior;
    // if the formula is ever made feed-aware, this expectation changes deliberately.
    //
    // Window-arithmetic note (see task-8-report.md for the full derivation): setting
    // lastCollectAt=0 before the feed makes the collected window [0h, 8h-cap] sit
    // entirely BEFORE the feed instant (30h) — hunger back-extrapolates above 150,
    // comfortAt clamps it flat at 100, so a naive trapezoid coincidentally equals the
    // piecewise result and the knee guard can't fire. Fix: stamp lastCollectAt to 28h
    // AFTER the feed, so the collected window [28h, 35h] straddles the feed instant.
    const ctx = makeCtx(); ctx.setNow(0);
    await dispatch(ctx, adminModule, 'admin', {
      name: 'admin', sub: 'give', user: 'owner',
      options: { user: 'p1', 'dino-species': 'triceratops', cash: 100_000, 'food-item': 'royal_greens', 'food-qty': 50 },
    });
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    await dispatch(ctx, parkModule, 'build', { name: 'build', user: 'p1', options: { kind: paddockKindFor('herbivore') } });
    const lot = ctx.db.select().from(schema.lots).all()[0];
    await dispatch(ctx, parkModule, 'dino', { name: 'dino', sub: 'assign', user: 'p1', options: { dino: dino.id, lot: lot.id } });
    ctx.setNow(30 * H);   // hunger has drained well below 100
    const feed = await dispatch(ctx, careModule, 'feed', {
      name: 'feed', sub: 'one', user: 'p1', options: { dino: dino.id, food: 'royal_greens' },
    });
    expect(embedText(feed.replies[0])).toContain('Fed');
    // Stamp lastCollectAt AFTER the feed so the collected window straddles t=30h
    // instead of sitting entirely before it (see note above).
    ctx.db.update(schema.users).set({ lastCollectAt: 28 * H }).where(eq(schema.users.discordId, 'p1')).run();
    ctx.setNow(35 * H);
    // Expected: what the service formula computes from the POST-feed row over the
    // real collected window, using the real capHours/facilityBonusPct (not hardcoded).
    const row = ctx.db.select().from(schema.dinos).all()[0];
    const lotRow = ctx.db.select().from(schema.lots).all()[0];
    const lots = ctx.db.select().from(schema.lots).all();
    const clockDino: ClockDino = {
      species: getSpecies(row.speciesId), paddock: PADDOCKS[lotRow.kind], decor: lotRow.decor,
      hungerAtFed: row.hunger, lastFedAt: row.lastFedAt, escapedAt: row.escapedAt,
    };
    const user = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!;
    const expected = accruedIncome([clockDino], facilityBonusPct(lots), capHours(lots), user.lastCollectAt, ctx.now());
    const before = user.cash;
    const collect = await click(ctx, parkModule, 'park:collect', 'p1');
    expect(replyText(collect.replies[0])).toContain('Collected');
    const after = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!.cash;
    expect(after - before).toBe(expected);

    // Knee guard (coupling #2): a naive two-point trapezoid across a window that
    // STRADDLES the hunger-100 knee must NOT equal accruedIncome's piecewise result,
    // or a future "simplify the integration" refactor could silently drop the knee
    // and this test wouldn't catch it. The command-collect window [28h,35h] never
    // reaches the knee (knee = lastFedAt(30h) + (150-100)/100*48h = 54h), so the
    // guard uses a DIRECT window [52h, 60h] that brackets 54h — no command dispatch
    // needed, it pins accruedIncome's piecewise property against the same dino row.
    const windowStartH = 52; const windowEndH = 60;
    const piecewise = accruedIncome([clockDino], 0, 48, windowStartH * H, windowEndH * H);
    const naive = Math.floor(
      ((comfortAt(clockDino, windowStartH * H) + comfortAt(clockDino, windowEndH * H)) / 2)
      * (windowEndH - windowStartH) * RARITY[getSpecies(row.speciesId).rarity].incomePerHr);
    expect(naive).not.toBe(piecewise);
  });

  it('escape loop: starve → interaction settles → /rescue → feeding and earning resume', async () => {
    // Pins coupling #3 (audit): escapedAt is only STAMPED when some interaction calls
    // settleEscapes (e.g. /feed, /dino, /park) — it is not a live background clock.
    // /rescue must clear it and let /feed and park:collect work again immediately.
    const ctx = makeCtx(); ctx.setNow(0);
    await dispatch(ctx, adminModule, 'admin', {
      name: 'admin', sub: 'give', user: 'owner',
      options: { user: 'p1', 'dino-species': 'triceratops', cash: 100_000, 'food-item': 'ferns', 'food-qty': 50 },
    });
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    await dispatch(ctx, parkModule, 'build', { name: 'build', user: 'p1', options: { kind: paddockKindFor('herbivore') } });
    const lot = ctx.db.select().from(schema.lots).all()[0];
    await dispatch(ctx, parkModule, 'dino', { name: 'dino', sub: 'assign', user: 'p1', options: { dino: dino.id, lot: lot.id } });
    ctx.setNow(60 * H);   // far past escape (comfort floor + grace)
    const feedBlocked = await dispatch(ctx, careModule, 'feed', {
      name: 'feed', sub: 'one', user: 'p1', options: { dino: dino.id },
    });
    expect(replyText(feedBlocked.replies[0])).toContain('escaped');
    expect(ctx.db.select().from(schema.dinos).all()[0].escapedAt).not.toBeNull();
    const rescue = await dispatch(ctx, careModule, 'rescue', {
      name: 'rescue', user: 'p1', options: { dino: dino.id },
    });
    expect(replyText(rescue.replies[0])).toContain('Recaptured');
    const feedOk = await dispatch(ctx, careModule, 'feed', {
      name: 'feed', sub: 'one', user: 'p1', options: { dino: dino.id },
    });
    expect(embedText(feedOk.replies[0])).toContain('Fed');
    ctx.db.update(schema.users).set({ lastCollectAt: ctx.now() }).where(eq(schema.users.discordId, 'p1')).run();
    ctx.setNow(62 * H);
    const collect = await click(ctx, parkModule, 'park:collect', 'p1');
    expect(replyText(collect.replies[0])).toContain('Collected');
  });

  it('trade expiry: /trade offer → +25h → /trade accept fails expired and the dino unlocks', async () => {
    // Pins coupling #4 (audit): trade escrow (dino.locked) must be released by
    // expireStale even when nobody ever explicitly declines/cancels — expireStale
    // runs at the top of every /trade dispatch, so the accept path itself settles it.
    const ctx = makeCtx(); ctx.setNow(0);
    getOrCreateUser(ctx, 'a', 'a'); getOrCreateUser(ctx, 'b', 'b');
    ctx.db.update(schema.users).set({ parkRating: 200 }).run();   // both sides ≥ 2★ gate
    ctx.db.insert(schema.dinos).values({
      userId: 'a', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const offer = await dispatch(ctx, tradingModule, 'trade', {
      name: 'trade', sub: 'offer', user: 'a', options: { user: 'b', 'give-dinos': String(dino.id) },
    });
    const offerEmbed = (offer.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> }).embeds[0].toJSON();
    expect(offerEmbed.title).toContain('Trade');
    expect(ctx.db.select().from(schema.dinos).all()[0].locked).toBe(true);
    const trade = ctx.db.select().from(schema.trades).all()[0];
    ctx.setNow(25 * H);
    const accept = await dispatch(ctx, tradingModule, 'trade', {
      name: 'trade', sub: 'accept', user: 'b', options: { id: trade.id },
    });
    // expireStale runs at the top of the accept execute, so the status is already
    // 'expired' when the accept path evaluates — either rejection message is a
    // valid pin; the DB assertions below are the real invariant.
    expect(replyText(accept.replies[0])).toMatch(/expired|no longer open/);
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('expired');
    expect(ctx.db.select().from(schema.dinos).all()[0].locked).toBe(false);
    expect(ctx.db.select().from(schema.dinos).all()[0].userId).toBe('a');
  });

  it('notification chain: /settings channel → /incubate → tick → channel ping; hatched egg → no ping', async () => {
    // Pins coupling #5 (audit): the scheduler → handler → Sender chain end-to-end,
    // through the real /settings channel config and the real /incubate enqueue —
    // and the skip-guard that a timer whose referent (the egg) is already gone by
    // the time it fires must not notify (hatchEgg deletes the egg row on crack).
    const ctx = makeCtx(); ctx.setNow(0);
    const sent: Array<{ channelId: string; payload: NotifyPayload }> = [];
    const sender: Sender = {
      channelSend: async (channelId, payload) => { sent.push({ channelId, payload }); },
      dmSend: async () => { throw new Error('DM should not be used when the channel works'); },
    };
    ctx.scheduler.register('egg_hatch', eggHatchHandler(sender, ctx));
    await dispatch(ctx, settingsModule, 'settings', {
      name: 'settings', sub: 'channel', user: 'mod', guild: 'g1', options: { channel: 'notify-chan' },
    });
    await dispatch(ctx, adminModule, 'admin', {
      name: 'admin', sub: 'give', user: 'owner', options: { user: 'p1', 'egg-rarity': 'common' },
    });
    const egg = ctx.db.select().from(schema.eggs).all()[0];
    await dispatch(ctx, hatcheryModule, 'incubate', {
      name: 'incubate', user: 'p1', guild: 'g1', options: { egg: egg.id },
    });
    ctx.setNow(RARITY.common.incubationMs + 1);
    const fired = await ctx.scheduler.tick(ctx.now());
    expect(fired).toBe(1);
    expect(sent).toHaveLength(1);
    const notified = sent[0].payload as { embeds?: Array<{ toJSON(): { thumbnail?: { url: string } } }>; files?: Array<{ name?: string | null }> };
    expect(notified.embeds![0].toJSON().thumbnail?.url).toBe('attachment://common.png');
    expect(notified.files!.map((f) => f.name)).toContain('common.png');
    expect(sent[0].channelId).toBe('notify-chan');
    expect(notifyContent(sent[0].payload)).toContain('<@p1>');
    expect(JSON.stringify(sent[0].payload)).toContain('ready to hatch');
    // Skip-guard: an egg hatched before its timer fires must not ping.
    sent.length = 0;
    await dispatch(ctx, adminModule, 'admin', {
      name: 'admin', sub: 'give', user: 'owner', options: { user: 'p1', 'egg-rarity': 'common' },
    });
    const egg2 = ctx.db.select().from(schema.eggs).all().find((e) => e.incubationStartedAt === null)!;
    await dispatch(ctx, hatcheryModule, 'incubate', {
      name: 'incubate', user: 'p1', guild: 'g1', options: { egg: egg2.id },
    });
    ctx.setNow(ctx.now() + RARITY.common.incubationMs + 1);
    await dispatch(ctx, hatcheryModule, 'hatch', { name: 'hatch', user: 'p1', options: { egg: egg2.id } });
    await click(ctx, hatcheryModule, `hatch:crack:${egg2.id}`, 'p1');   // egg row deleted
    await ctx.scheduler.tick(ctx.now());
    expect(sent).toHaveLength(0);
  });

  it('rating: play raises ratingHighWater monotonically; locked site gate holds', async () => {
    // Pins coupling #6 (audit): ratingHighWater is a running max recomputed as a
    // side effect of ordinary play (build/assign/feed), NOT a value a player can set
    // directly — and it must never decrease even as live comfort decays, because it
    // gates lot slots / sites / shop / mythic eggs permanently once earned.
    const ctx = makeCtx(); ctx.setNow(0);
    await dispatch(ctx, adminModule, 'admin', {
      name: 'admin', sub: 'give', user: 'owner',
      options: { user: 'p1', 'dino-species': 'triceratops', cash: 500_000, 'food-item': 'ferns', 'food-qty': 99 },
    });
    const before = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!;
    expect(before.ratingHighWater).toBeGreaterThanOrEqual(0);
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    await dispatch(ctx, parkModule, 'build', { name: 'build', user: 'p1', options: { kind: paddockKindFor('herbivore') } });
    const lot = ctx.db.select().from(schema.lots).all()[0];
    await dispatch(ctx, parkModule, 'dino', { name: 'dino', sub: 'assign', user: 'p1', options: { dino: dino.id, lot: lot.id } });
    await dispatch(ctx, careModule, 'feed', { name: 'feed', sub: 'all', user: 'p1' });
    const played = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!;
    expect(played.ratingHighWater).toBeGreaterThan(0);
    // Monotonic: let comfort decay, trigger a recompute via another build; the
    // live rating may drop but the high water must not.
    ctx.setNow(40 * H);
    await dispatch(ctx, parkModule, 'build', { name: 'build', user: 'p1', options: { kind: paddockKindFor('carnivore') } });
    const decayed = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!;
    expect(decayed.ratingHighWater).toBeGreaterThanOrEqual(played.ratingHighWater);
    // Gate: volcano_core needs ★4.0 (unlock 400) — far above this park.
    expect(decayed.ratingHighWater).toBeLessThan(400);
    const gated = await dispatch(ctx, expeditionsModule, 'expedition', {
      name: 'expedition', sub: 'start', user: 'p1', options: { site: 'volcano_core' },
    });
    expect(replyText(gated.replies[0])).toContain('not unlocked');
  });

  it('battles: grant squad → ch.2 locked → clear ch.1 → boss egg → gates → energy drain/regen', async () => {
    const ctx = makeCtx(); ctx.setNow(1000);
    // Derived, not a hand-picked literal: ENERGY_CAP ticks of ENERGY_REGEN_MS
    // always reaches a full pool regardless of the starting level, so a
    // future regen rebalance can't silently invalidate a hardcoded "100min".
    const fullRegenMs = ENERGY_CAP * ENERGY_REGEN_MS;
    // Squad through the admin command layer; max battle level so chapter-1 wins are certain.
    for (const species of ['tyrannosaurus', 'triceratops', 'velociraptor']) {
      await dispatch(ctx, adminModule, 'admin', {
        name: 'admin', sub: 'give', user: 'owner',
        options: { user: 'p1', 'dino-species': species, cash: 1000 },
      });
    }
    const ids = ctx.db.select().from(schema.dinos).all().map((d) => d.id);
    expect(ids).toHaveLength(3);
    ctx.db.update(schema.dinos).set({ battleXp: 10_000 }).run();
    // Rating high-water clears amber_ridge's site gate (150) but not frozen_cliffs' (250).
    ctx.db.update(schema.users).set({ ratingHighWater: 150 }).where(eq(schema.users.discordId, 'p1')).run();

    // Chapters overview renders; page 2 (amber_ridge) reads locked — its boss precondition is unmet.
    const overview = await dispatch(ctx, battlesModule, 'battle', { name: 'battle', sub: 'chapters', user: 'p1' });
    expect(overview.replies.length).toBeGreaterThan(0);
    const page2 = await click(ctx, battlesModule, 'battle:chapter:p1:1', 'p1');
    expect(JSON.stringify(page2.replies[0])).toMatch(/🔒|[Ll]ocked/);

    // First fight through the command layer: exactly 4 cinematic frames (deferReply + 4 editReply).
    const before = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!;
    const fight = await dispatch(ctx, battlesModule, 'battle', {
      name: 'battle', sub: 'fight', user: 'p1',
      options: { stage: 'coastal_dig_1', dino1: ids[0], dino2: ids[1], dino3: ids[2] },
    });
    expect(fight.replies).toHaveLength(4);
    const prog1 = ctx.db.select().from(schema.battleProgress).all().find((r) => r.stageId === 'coastal_dig_1')!;
    expect(prog1.stars).toBeGreaterThanOrEqual(1);
    expect(prog1.firstClearedAt).not.toBeNull();
    expect(prog1.attempts).toBe(1);
    const afterWin = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!;
    expect(afterWin.cash).toBeGreaterThan(before.cash);                       // star-scaled reward paid
    expect(afterWin.shards).toBeGreaterThan(before.shards);                   // first-clear shards paid
    for (const d of ctx.db.select().from(schema.dinos).all()) expect(d.battleXp).toBeGreaterThan(10_000);

    // Replay: attempts increment, stars only move up, first-clear stamp and shards never repeat.
    ctx.setNow(ctx.now() + fullRegenMs);   // full energy again
    await dispatch(ctx, battlesModule, 'battle', {
      name: 'battle', sub: 'fight', user: 'p1',
      options: { stage: 'coastal_dig_1', dino1: ids[0], dino2: ids[1], dino3: ids[2] },
    });
    const prog2 = ctx.db.select().from(schema.battleProgress).all().find((r) => r.stageId === 'coastal_dig_1')!;
    expect(prog2.attempts).toBe(2);
    expect(prog2.stars).toBeGreaterThanOrEqual(prog1.stars);
    expect(prog2.firstClearedAt).toBe(prog1.firstClearedAt);
    expect(ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!.shards).toBe(afterWin.shards);

    // Grind to the boss through the service layer (same pipeline the command wraps).
    for (const stageId of ['coastal_dig_2', 'coastal_dig_3', 'coastal_dig_4', 'coastal_dig_boss']) {
      ctx.setNow(ctx.now() + fullRegenMs);   // regen to cap between fights
      const out = runFight(ctx, 'p1', stageId, ids);
      expect(out.won).toBe(true);
    }
    // Boss first clear inserted exactly one battle-sourced egg — not zero.
    // (Existence only: the boss has been fought exactly once so far, so this
    // alone can't distinguish a correct firstClear gate from one that would
    // drop an egg on every win. The replay right below is what proves that.)
    const bossEggs = ctx.db.select().from(schema.eggs).all().filter((e) => e.source === 'battle');
    expect(bossEggs).toHaveLength(1);

    // Refight coastal_dig_boss — already cleared — with a single fresh,
    // unleveled dino it cannot beat (lvl.1 common vs. the boss's lvl.4,
    // 2.5x-HP/1.2x-ATK rare): a genuine loss, a raw score STRICTLY LOWER
    // (0 stars) than the stored value (3, from the maxed-squad clear above).
    // One fight proves two things the maxed-squad replay on coastal_dig_1
    // above could not (that replay tied at 3 stars both times, and only hit
    // coastal_dig_1, never the boss stage):
    //   1. stars: Math.max(row.stars, stars) — the stored star count must
    //      hold at its earlier high, not get overwritten down to this run's
    //      lower score.
    //   2. the boss-egg insert is gated on firstClear, not "stage has a
    //      boss and I won (or even just fought) it" — a second clear of the
    //      SAME boss stage must never add a second egg.
    await dispatch(ctx, adminModule, 'admin', {
      name: 'admin', sub: 'give', user: 'owner',
      options: { user: 'p1', 'dino-species': 'compsognathus' },
    });
    const weakDinoId = ctx.db.select().from(schema.dinos).all().find((d) => d.speciesId === 'compsognathus')!.id;
    const bossProgBefore = ctx.db.select().from(schema.battleProgress).all().find((r) => r.stageId === 'coastal_dig_boss')!;
    const weakOutcome = runFight(ctx, 'p1', 'coastal_dig_boss', [weakDinoId]);
    expect(weakOutcome.won).toBe(false);                              // confirms this run really did score lower
    const bossProgAfter = ctx.db.select().from(schema.battleProgress).all().find((r) => r.stageId === 'coastal_dig_boss')!;
    expect(bossProgAfter.stars).toBe(bossProgBefore.stars);           // capped at the earlier max, not overwritten to 0
    expect(bossProgAfter.attempts).toBe(bossProgBefore.attempts + 1);
    expect(ctx.db.select().from(schema.eggs).all().filter((e) => e.source === 'battle')).toHaveLength(1);

    // Repeat a WIN on the same already-cleared boss (maxed squad — a
    // certain win). The loss above only proves the coarse mutation
    // `if (stage.boss && firstClear)` -> `if (stage.boss)`, which fires on
    // ANY fight, win or lose. It can't catch the narrower, more realistic
    // regression where the win-requirement survives but "not already
    // cleared" is dropped (e.g. `if (stage.boss && won)`, or
    // `firstClear = won`) — that only shows up on a repeat WIN, which
    // nothing before this point in the journey exercises.
    ctx.setNow(ctx.now() + fullRegenMs);   // boss costs 3; the losing replay above spent some of the pool
    const repeatWin = runFight(ctx, 'p1', 'coastal_dig_boss', ids);
    expect(repeatWin.won).toBe(true);
    expect(ctx.db.select().from(schema.eggs).all().filter((e) => e.source === 'battle')).toHaveLength(1);

    // Coverage gap: every existing /battle chapters + stage-autocomplete test
    // starts from a brand-new user (empty progress map, frontier chapter 1).
    // Re-drive the real command/button surface now that chapter 1 is actually
    // cleared and confirm the VIEW reflects it — not just the pure gate
    // function exercised below.
    const embedJson = (r: unknown) => (r as {
      embeds?: Array<{ toJSON(): { title?: string; description?: string; fields?: Array<{ name: string; value: string }> } }>;
    }).embeds?.[0]?.toJSON() ?? {};

    // Same page-2 (amber_ridge) request that read locked before chapter 1 was
    // cleared now reads unlocked: no chapter-lock title suffix, no locked blurb.
    const ch2 = embedJson((await click(ctx, battlesModule, 'battle:chapter:p1:1', 'p1')).replies[0]);
    expect(ch2.title).not.toMatch(/🔒/);
    expect(ch2.description).not.toMatch(/Locked — beat/);

    // Chapter 1's own page shows earned stars for every stage (all 5 cleared),
    // not the pre-clear '🔒' markers.
    const ch1 = embedJson((await click(ctx, battlesModule, 'battle:chapter:p1:0', 'p1')).replies[0]);
    const ch1Stages = ch1.fields?.find((f) => f.name === 'Stages')?.value ?? '';
    expect(ch1Stages).toContain('⭐');
    expect(ch1Stages).not.toContain('🔒');

    // Chapter 3 (frozen_cliffs) still reads locked through the real command
    // path — its own rating gate (250) is untouched at ratingHighWater 150.
    const ch3 = embedJson((await click(ctx, battlesModule, 'battle:chapter:p1:2', 'p1')).replies[0]);
    expect(ch3.title).toMatch(/🔒/);
    expect(ch3.description).toMatch(/Locked — beat/);

    // Gates: ch.2 unlocked; ch.3 locked by the RATING co-gate even with its boss precondition force-met.
    const progress: ProgressMap = new Map(ctx.db.select().from(schema.battleProgress).all()
      .map((r) => [r.stageId, { stars: r.stars, firstClearedAt: r.firstClearedAt }]));
    expect(chapterUnlocked('amber_ridge', progress, 150)).toBe(true);
    progress.set('amber_ridge_boss', { stars: 3, firstClearedAt: ctx.now() });
    expect(chapterUnlocked('frozen_cliffs', progress, 150)).toBe(false);      // 150 < unlockRating 250

    // Drain: refight coastal_dig_1 (cost 1) until the pool refuses.
    let threw: unknown = null;
    for (let n = 0; n < 20 && threw === null; n += 1) {
      try { runFight(ctx, 'p1', 'coastal_dig_1', [ids[0]]); } catch (e) { threw = e; }
    }
    expect(threw).toBeInstanceOf(BattleError);
    expect(ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!.energy).toBe(0);

    // Full regen: the next fight goes straight through from a full pool.
    ctx.setNow(ctx.now() + fullRegenMs);
    const refilled = runFight(ctx, 'p1', 'coastal_dig_1', [ids[0]]);
    expect(refilled.energyAfter).toBe(ENERGY_CAP - STAGES.get('coastal_dig_1')!.energyCost);
  });
});
