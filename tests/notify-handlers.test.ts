import { describe, it, expect } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { eggHatchHandler, breedingReadyHandler, expeditionReturnHandler, clientSender, type Sender, type NotifyPayload } from '../src/core/notify.js';

function capture() {
  const dms: NotifyPayload[] = [];
  const sender: Sender = {
    channelSend: async () => { throw new Error('no channel configured in these tests'); },
    dmSend: async (_userId, payload) => { dms.push(payload); },
  };
  return { dms, sender };
}

const embedJson = (p: NotifyPayload | undefined) =>
  (p as { embeds?: Array<{ toJSON(): { title?: string; description?: string; image?: { url: string }; thumbnail?: { url: string } } }> })
    ?.embeds?.[0].toJSON() ?? {};
const fileNames = (p: NotifyPayload | undefined) =>
  ((p as { files?: Array<{ name?: string | null }> })?.files ?? []).map((f) => f.name);

describe('scheduler notification handlers', () => {
  it('eggHatchHandler notifies for a live egg and skips a deleted one', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'rare', source: 'shop', obtainedAt: 0 }).returning().get();
    const { dms, sender } = capture();
    const handler = eggHatchHandler(sender, ctx);
    await handler({ userId: 'u1', refId: egg.id, originGuildId: null });
    expect(dms).toHaveLength(1);
    expect(embedJson(dms[0]).description).toContain('rare egg is ready to hatch');
    // Attach-all-or-nothing: the thumbnail URL and its file ride the same payload.
    // Seeded on the egg's row id, so this is egg #1's face rather than the base.
    // The variant is deterministic — the same id always resolves here.
    expect(embedJson(dms[0]).thumbnail?.url).toBe('attachment://rare-v4.webp');
    expect(fileNames(dms[0])).toContain('rare-v4.webp');
    ctx.db.delete(schema.eggs).run();
    await handler({ userId: 'u1', refId: egg.id, originGuildId: null });
    expect(dms).toHaveLength(1);   // skip-guard: no ping for a consumed egg
  });
  it('eggHatchHandler still notifies as plain text when the rarity has no art on disk', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    // No 'no-such-rarity.webp' ships (or ever will) — this exercises assetImage's
    // null-degrade path the way tests/images.test.ts does at the function level,
    // but here through the handler that actually wires it into a payload.
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'no-such-rarity' as never, source: 'shop', obtainedAt: 0 }).returning().get();
    const { dms, sender } = capture();
    const handler = eggHatchHandler(sender, ctx);
    await handler({ userId: 'u1', refId: egg.id, originGuildId: null });
    expect(dms).toHaveLength(1);
    expect(embedJson(dms[0]).description).toContain('no-such-rarity egg is ready to hatch');
    expect(embedJson(dms[0]).thumbnail).toBeUndefined();
    expect((dms[0] as { files?: unknown }).files).toBeUndefined();
  });
  it('expeditionReturnHandler notifies unclaimed and skips claimed', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const exp = ctx.db.insert(schema.expeditions)
      .values({ userId: 'u1', siteId: 'coastal_dig', departedAt: 0, returnsAt: 1 }).returning().get();
    const { dms, sender } = capture();
    const handler = expeditionReturnHandler(sender, ctx);
    await handler({ userId: 'u1', refId: exp.id, originGuildId: null });
    expect(dms).toHaveLength(1);
    expect(embedJson(dms[0]).title).toContain('has returned');
    // The banner is seeded on t.userId ('u1' here), but coastal_dig-banner hashes to
    // index 0 for 'u1' and index 0 IS the base file, so this literal is unchanged —
    // see 'the expedition-return notification's banner is seeded on the addressee'
    // below for an assertion that actually moves with the seed.
    expect(embedJson(dms[0]).image?.url).toBe('attachment://coastal_dig-banner.webp');
    expect(fileNames(dms[0])).toContain('coastal_dig-banner.webp');
    ctx.db.update(schema.expeditions).set({ claimedAt: 2 }).run();
    await handler({ userId: 'u1', refId: exp.id, originGuildId: null });
    expect(dms).toHaveLength(1);
  });
  it('handlers never throw, even when delivery fails', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const hostile: Sender = {
      channelSend: async () => { throw new Error('x'); },
      dmSend: async () => { throw new Error('y'); },
    };
    await expect(eggHatchHandler(hostile, ctx)({ userId: 'u1', refId: egg.id, originGuildId: null }))
      .resolves.toBeUndefined();
  });
});

const customIds = (p: NotifyPayload | undefined) =>
  ((p as { components?: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }> })?.components ?? [])
    .flatMap((r) => r.toJSON().components.map((c) => c.custom_id));

describe('notification handler buttons', () => {
  it('the egg-ready notification carries a Hatch button pointed at the existing handler', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'rare', source: 'shop', obtainedAt: 0 }).returning().get();
    const { dms, sender } = capture();
    await eggHatchHandler(sender, ctx)({ userId: 'u1', refId: egg.id, originGuildId: null });
    expect(customIds(dms[0])).toEqual([`hatch:crack:${egg.id}`]);
  });

  it('the breeding-complete notification carries a Claim button', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const b = ctx.db.insert(schema.breedings).values({
      userId: 'u1', parentA: 1, parentB: 2, rarity: 'common', startedAt: 0, readyAt: 0,
    }).returning().get();
    const { dms, sender } = capture();
    await breedingReadyHandler(sender, ctx)({ userId: 'u1', refId: b.id, originGuildId: null });
    expect(customIds(dms[0])).toEqual([`breed:claim:${b.id}`]);
    // ...and the Gene Lab banner, seeded on the player the DM is addressed to. This is the
    // only assertion covering that call site's seed argument: /breed's own screens are
    // pinned separately in tests/genelab-module.test.ts and would not notice this one going.
    expect(fileNames(dms[0])).toContain('gene_lab-v2.webp');
  });

  it('the expedition-return notification carries a Claim button', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const exp = ctx.db.insert(schema.expeditions).values({
      userId: 'u1', siteId: 'coastal_dig', departedAt: 0, returnsAt: 0,
    }).returning().get();
    const { dms, sender } = capture();
    await expeditionReturnHandler(sender, ctx)({ userId: 'u1', refId: exp.id, originGuildId: null });
    expect(customIds(dms[0])).toEqual(['exp:claim:u1']);
  });

  it('the expedition-return notification\'s banner is seeded on the addressee, not fixed to the base face', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u2', lastCollectAt: 0, createdAt: 0 }).run();
    const exp = ctx.db.insert(schema.expeditions).values({
      userId: 'u2', siteId: 'coastal_dig', departedAt: 0, returnsAt: 0,
    }).returning().get();
    const { dms, sender } = capture();
    await expeditionReturnHandler(sender, ctx)({ userId: 'u2', refId: exp.id, originGuildId: null });
    // 'u2' hashes coastal_dig-banner to -v2, unlike 'u1' above — this is the pin that
    // actually goes red if the seed argument at the call site is removed.
    expect(embedJson(dms[0]).image?.url).toBe('attachment://coastal_dig-banner-v2.webp');
    expect(fileNames(dms[0])).toContain('coastal_dig-banner-v2.webp');
  });
});

describe('clientSender', () => {
  it('sends to a text channel and rejects non-sendable channels', async () => {
    const sent: unknown[] = [];
    const fakeClient = {
      channels: { fetch: async () => ({ isTextBased: () => true, send: async (p: unknown) => { sent.push(p); } }) },
      users: { fetch: async () => ({ send: async (p: unknown) => { sent.push(`dm:${String(p)}`); } }) },
    };
    const s = clientSender(fakeClient as never);
    await s.channelSend('c1', 'hello');
    expect(sent).toEqual(['hello']);
    await s.dmSend('u1', 'direct');
    expect(sent).toEqual(['hello', 'dm:direct']);
    const badClient = { channels: { fetch: async () => ({ isTextBased: () => false }) } };
    await expect(clientSender(badClient as never).channelSend('c1', 'x')).rejects.toThrow('not sendable');
  });
  it('passes an object payload straight through to channel.send and user.send', async () => {
    const sent: unknown[] = [];
    const fakeClient = {
      channels: { fetch: async () => ({ isTextBased: () => true, send: async (p: unknown) => { sent.push(p); } }) },
      users: { fetch: async () => ({ send: async (p: unknown) => { sent.push(p); } }) },
    };
    const s = clientSender(fakeClient as never);
    const embed = new EmbedBuilder().setTitle('t');
    await s.channelSend('c1', { content: '<@u1>', embeds: [embed] });
    await s.dmSend('u1', { embeds: [embed] });
    expect(sent).toEqual([{ content: '<@u1>', embeds: [embed] }, { embeds: [embed] }]);
  });
});
