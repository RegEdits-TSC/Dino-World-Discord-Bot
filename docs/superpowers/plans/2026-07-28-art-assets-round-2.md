# Art Assets Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every remaining art gap in the bot — ship the four battle boss portraits, rebuild the park map PNG on real materials instead of flat fills and stock unicode glyphs, and give the bare high-traffic surfaces art of their own.

**Architecture:** Four independently shippable waves. Wave 1 rewires art already on disk into surfaces that never referenced it and widens the `notify.ts` `Sender` contract from strings to message payloads so passive notifications can carry embeds. Wave 2 drops in the four boss portraits against prompts that already exist — no code change. Wave 3 introduces `src/core/render/art.ts`, which decodes park art once at worker startup and hands it to a `renderParkPng` that **stays synchronous**, with every missing asset falling back to today's `fillRect`/glyph path. Wave 4 generates the new banners and promotes the content-only replies that will carry them into embeds.

**Tech Stack:** TypeScript ESM (NodeNext), discord.js v14, `@napi-rs/canvas`, drizzle + better-sqlite3 (synchronous), vitest, Higgsfield Nano Banana Pro via MCP for image generation.

## Global Constraints

- **ESM NodeNext:** every relative import carries a `.js` extension, including in tests.
- **Time and randomness** come from `ctx.now()` / `ctx.rng()`, never `Date.now()` / `Math.random()`.
- **DB access is synchronous** drizzle/better-sqlite3 (`.get()`/`.all()`/`.run()`) — never awaited.
- **Absent art is never an error.** `assetImage` returns `null` for a missing file and the embed renders without the image; `ParkArt` fields are `null` and the renderer falls back. Every task must preserve this.
- **`renderParkPng` stays synchronous.** `@napi-rs/canvas` decodes PNG asynchronously (setting `Image.src` from PNG bytes and drawing in the same tick silently yields a blank canvas, with no error) but decodes SVG synchronously. All PNG decoding happens in `loadParkArt()` at worker startup; SVG may be decoded inline.
- **Never call `emojiTag` in a module-level constant**, and never put a custom emoji tag in an autocomplete label.
- **Never pass `rarityEmoji(...)` to `ButtonBuilder.setEmoji`** — it throws rather than degrading when no emoji map is loaded.
- **`tests/emoji-assets.test.ts` rejects any PNG whose opaque pixels are more than 2% pure `#000000`** (`MAX_BLACK_SHARE`). Author the six dino-chip SVG outlines in dark brown `#2b1d10`, never `#000000`.
- **resvg gotcha:** `<ellipse fill="url(#gradient)">` with default `objectBoundingBox` gradientUnits renders solid black — use `gradientUnits="userSpaceOnUse"` with `y1 = cy - ry` and `y2 = cy + ry`.
- **`npm run build` does not typecheck tests.** Run `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) before every commit that touches `tests/` or `scripts/`.
- **`npm run deploy-commands` is NOT required in any wave** — no command builder changes. `npm run build-emojis` + `npm run deploy-emojis` are required in Wave 3 for the six new icons.
- **Attribution:** every commit message, PR body, code comment, and doc line is authored by the user — no `Co-Authored-By` trailer, no "generated with" footer, no tool or third-party attribution of any kind.
- **Paths below are placeholders**, not literal locations: `<repo>` is this checkout's root and `<scratchpad>` is any working directory outside it. Substitute your own; nothing under `<scratchpad>` is ever committed.


## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `src/core/render/art.ts` | Owns every park art asset: decodes PNGs asynchronously once, SVGs synchronously on demand, exposes `ParkArt` / `EMPTY_ART` / `loadParkArt` / `loadSvgImage`. The only place in the renderer that touches the filesystem for art. |
| `scripts/fit-art.mjs` | One-shot post-processing for generated art: defringe-and-fit for transparent assets, scale-and-center-crop to 1536×1024 for banners. Shared by Waves 2–4 so each asset task is a one-line invocation. |
| `assets/emojis/svg/dw_dino_<rarity>.svg` × 6 | Hand-authored rarity dino chips. Feed both the park renderer (read as SVG, sync) and the Discord app-emoji set. |
| `assets/images/park/{ground,plate-paddock,plate-facility}.png` | Park materials. Not routed through `assetImage` — they never become Discord attachments. |
| `assets/images/hatch/<rarity>-crack.png` × 6 | Hatch-reveal art, one per rarity. |
| `assets/images/battles/boss-<siteId>-portrait.png` × 4 | Boss portraits for fight frames F3/F4. |
| `assets/images/banners/{battle_victory,battle_defeat,collect,rescue,dino_roster,eggs_incubator,sell}.png` | New embed banners. |

**Modified**

| Path | Change |
|---|---|
| `src/core/notify.ts` | `Sender` widens from `string` to `NotifyPayload`; gains `withMention`. |
| `src/core/render/draw.ts` | Drawing calls swap flat fills and glyph runs for `drawImage`; `renderParkPng` gains an optional `art` parameter and stays synchronous. |
| `src/core/render/worker.ts` | Top-level-awaits `loadParkArt()` before serving its first render. |
| `src/core/images.ts` | `kind` union gains `'hatch'`. |
| `src/modules/battles/embeds.ts` | F4 re-attaches the outcome banner and sheds the chapter banner; chapter list gains a thumbnail. |
| `src/modules/{park,hatchery,shop,care,trading,expeditions,help}/…` | Content-only replies promoted to embeds carrying art. |
| `src/data/render-icons.ts` | Keeps its palettes and glyph maps as the fallback path; gains the dino-chip fallback table. |
| `scripts/test-live.ts` | Gallery grows to cover every new payload — the only real check on image work. |
| `CLAUDE.md`, `docs/assets/prompts.md` | Invariants and generation prompts kept in sync, per repo convention. |

---

## Wave 1 — Rewires and the notify payload contract

### Task 1: notify payload contract — `NotifyPayload`, `withMention`, `Sender` widening

**Files:**
- Modify: `src/core/notify.ts:1-38`
- Modify: `CLAUDE.md:42` (append a bullet after the `assetImage` bullet)
- Test: `tests/notify.test.ts` (rewrite the fake, add 4 cases)
- Test: `tests/notify-handlers.test.ts:6-13` (fake type only)
- Test: `tests/journeys.test.ts:14,50-53,221-225,240-243` (fake type + read helper)

**Interfaces:**
- Consumes: nothing (first task of the wave)
- Produces: `export type NotifyPayload = string | { content?: string; embeds?: EmbedBuilder[]; files?: AttachmentBuilder[] }`; `export interface Sender { channelSend(channelId: string, payload: NotifyPayload): Promise<void>; dmSend(userId: string, payload: NotifyPayload): Promise<void> }`; `export function withMention(userId: string, payload: NotifyPayload): NotifyPayload`; `export function deliverNotification(sender: Sender, ctx: Ctx, userId: string, originGuildId: string | null, payload: NotifyPayload): Promise<void>`; `export function clientSender(client: Client): Sender`. `Ctx.notify(userId, originGuildId, message: string)` is deliberately UNCHANGED — a string is a valid `NotifyPayload`, so `src/index.ts:23` still typechecks.

- [ ] **Step 1: Write the failing test**

Replace the whole of `tests/notify.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { makeCtx } from './harness.js';
import { deliverNotification, withMention, type Sender, type NotifyPayload } from '../src/core/notify.js';
import { schema } from '../src/core/db/index.js';

const mkSender = (opts: { channelFails?: boolean; dmFails?: boolean } = {}): Sender & { calls: string[]; payloads: NotifyPayload[] } => {
  const calls: string[] = [];
  const payloads: NotifyPayload[] = [];
  return { calls, payloads,
    async channelSend(c, p) { calls.push(`channel:${c}`); payloads.push(p); if (opts.channelFails) throw new Error('x'); },
    async dmSend(u, p) { calls.push(`dm:${u}`); payloads.push(p); if (opts.dmFails) throw new Error('x'); } };
};
const contentOf = (p: NotifyPayload | undefined): string =>
  typeof p === 'string' ? p : p?.content ?? '';

describe('deliverNotification', () => {
  it('uses the configured guild channel when set', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g1', notifyChannelId: 'c1' }).run();
    const s = mkSender();
    await deliverNotification(s, ctx, 'u1', 'g1', 'hi');
    expect(s.calls).toEqual(['channel:c1']);
  });
  it('falls back to DM when no channel configured', async () => {
    const ctx = makeCtx(); const s = mkSender();
    await deliverNotification(s, ctx, 'u1', 'g1', 'hi');
    expect(s.calls).toEqual(['dm:u1']);
  });
  it('falls back to DM when the channel throws, then silent when DM throws (never throws)', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g1', notifyChannelId: 'c1' }).run();
    const s = mkSender({ channelFails: true, dmFails: true });
    await deliverNotification(s, ctx, 'u1', 'g1', 'hi');
    expect(s.calls).toEqual(['channel:c1', 'dm:u1']);
  });
});

describe('withMention', () => {
  it('merges the ping into content for all three payload shapes', () => {
    expect(contentOf(withMention('u1', 'hi'))).toBe('<@u1> hi');
    expect(contentOf(withMention('u1', { content: 'hi' }))).toBe('<@u1> hi');
    const embedOnly = withMention('u1', { embeds: [new EmbedBuilder().setTitle('t')] });
    expect(contentOf(embedOnly)).toBe('<@u1>');
    expect((embedOnly as { embeds?: EmbedBuilder[] }).embeds).toHaveLength(1);
  });
});

describe('notification payloads', () => {
  it('the channel path mentions the user and passes embeds/files through untouched', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g1', notifyChannelId: 'c1' }).run();
    const s = mkSender();
    const embed = new EmbedBuilder().setTitle('Egg ready');
    const file = new AttachmentBuilder(Buffer.from('x'), { name: 'common.png' });
    await deliverNotification(s, ctx, 'u1', 'g1', { content: 'ready!', embeds: [embed], files: [file] });
    const p = s.payloads[0] as { content?: string; embeds?: EmbedBuilder[]; files?: AttachmentBuilder[] };
    expect(p.content).toBe('<@u1> ready!');
    expect(p.embeds?.[0]).toBe(embed);
    expect(p.files?.[0]).toBe(file);
  });
  it('the DM path delivers the payload unmentioned', async () => {
    // A <@id> inside a DM is noise — the mention is a channel-path-only concern.
    const ctx = makeCtx(); const s = mkSender();
    const embed = new EmbedBuilder().setTitle('Egg ready');
    await deliverNotification(s, ctx, 'u1', 'g1', { content: 'ready!', embeds: [embed] });
    expect(s.calls).toEqual(['dm:u1']);
    const p = s.payloads[0] as { content?: string; embeds?: EmbedBuilder[] };
    expect(p.content).toBe('ready!');
    expect(p.embeds?.[0]).toBe(embed);
  });
  it('an object payload survives the channel to DM fallback, mentioned only on the channel', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.guildSettings).values({ guildId: 'g1', notifyChannelId: 'c1' }).run();
    const s = mkSender({ channelFails: true });
    await deliverNotification(s, ctx, 'u1', 'g1', { content: 'ready!' });
    expect(s.calls).toEqual(['channel:c1', 'dm:u1']);
    expect(contentOf(s.payloads[0])).toBe('<@u1> ready!');
    expect(contentOf(s.payloads[1])).toBe('ready!');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notify.test.ts -t "merges the ping into content for all three payload shapes"`
Expected: FAIL — the file cannot even load: `SyntaxError: The requested module '../src/core/notify.js' does not provide an export named 'withMention'`

- [ ] **Step 3: Write the implementation**

Replace `src/core/notify.ts:1-38` (imports through `clientSender`; the two handlers at the bottom stay as they are for now):

```ts
import { eq } from 'drizzle-orm';
import type { Client, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { schema } from './db/index.js';
import type { Ctx } from './context.js';
import { logger } from './logger.js';
import { EXPEDITION_SITES } from '../data/sites.js';

// What a passive notification can carry. A bare string stays legal, so
// Ctx.notify's `message: string` and every one of its call sites are unaffected.
export type NotifyPayload = string | { content?: string; embeds?: EmbedBuilder[]; files?: AttachmentBuilder[] };

// Minimal send surface so tests can pass a fake.
export interface Sender {
  channelSend(channelId: string, payload: NotifyPayload): Promise<void>;
  dmSend(userId: string, payload: NotifyPayload): Promise<void>;
}

// Channel deliveries must ping the player; DMs must not. Always returns an
// object so callers can read `.content` without re-narrowing the union.
export function withMention(userId: string, payload: NotifyPayload): NotifyPayload {
  const mention = `<@${userId}>`;
  if (typeof payload === 'string') return { content: `${mention} ${payload}` };
  return { ...payload, content: payload.content ? `${mention} ${payload.content}` : mention };
}

export async function deliverNotification(sender: Sender, ctx: Ctx, userId: string, originGuildId: string | null, payload: NotifyPayload): Promise<void> {
  try {
    if (originGuildId) {
      const gs = ctx.db.select().from(schema.guildSettings).where(eq(schema.guildSettings.guildId, originGuildId)).get();
      if (gs?.notifyChannelId) {
        try { await sender.channelSend(gs.notifyChannelId, withMention(userId, payload)); return; }
        catch (e) { logger.warn({ err: e, guild: originGuildId }, 'notify channel send failed'); }
      }
    }
    try { await sender.dmSend(userId, payload); return; }
    catch (e) { logger.warn({ err: e, userId }, 'notify DM failed'); }
    // silent
  } catch (e) { logger.warn({ err: e, userId }, 'notify delivery failed'); }
}

export function clientSender(client: Client): Sender {
  return {
    async channelSend(channelId, payload) {
      const ch = await client.channels.fetch(channelId);
      if (ch && ch.isTextBased() && 'send' in ch) await (ch as { send(p: NotifyPayload): Promise<unknown> }).send(payload);
      else throw new Error('channel not sendable');
    },
    async dmSend(userId, payload) { const u = await client.users.fetch(userId); await u.send(payload); },
  };
}
```

Then fix the two other hand-rolled `Sender` fakes so `npm run typecheck` stays green.

`tests/notify-handlers.test.ts:4-13` becomes:

```ts
import { eggHatchHandler, expeditionReturnHandler, clientSender, type Sender, type NotifyPayload } from '../src/core/notify.js';

function capture() {
  const dms: NotifyPayload[] = [];
  const sender: Sender = {
    channelSend: async () => { throw new Error('no channel configured in these tests'); },
    dmSend: async (_userId, payload) => { dms.push(payload); },
  };
  return { dms, sender };
}
```

`tests/journeys.test.ts:14` becomes `import { eggHatchHandler, type Sender, type NotifyPayload } from '../src/core/notify.js';`, add this helper beside `embedText` (after line 53):

```ts
// Notifications are NotifyPayloads since the Sender widening: the merged <@id>
// ping lives on `content`, the message body may live in an embed.
const notifyContent = (p: NotifyPayload): string => (typeof p === 'string' ? p : p.content ?? '');
```

and rewrite lines 221-225 and 242-243:

```ts
    const sent: Array<{ channelId: string; payload: NotifyPayload }> = [];
    const sender: Sender = {
      channelSend: async (channelId, payload) => { sent.push({ channelId, payload }); },
      dmSend: async () => { throw new Error('DM should not be used when the channel works'); },
    };
```

```ts
    expect(notifyContent(sent[0].payload)).toContain('<@p1>');
    expect(JSON.stringify(sent[0].payload)).toContain('ready to hatch');
```

Finally append after `CLAUDE.md:42`:

```md
- Passive notifications carry a `NotifyPayload` (`src/core/notify.ts`):
  `string | { content?, embeds?, files? }`. `Ctx.notify`'s third argument stays
  `message: string` on purpose — a string is a valid payload, so every call site
  keeps working and the `ctx.notifications` fake in `tests/harness.ts` is
  untouched. `deliverNotification` merges the `<@id>` ping through `withMention`
  on the CHANNEL path only; DMs go out unmentioned. `Sender` fakes are
  hand-rolled per test file (`tests/notify.test.ts`,
  `tests/notify-handlers.test.ts`, `tests/journeys.test.ts`), not in the harness
  — and only `npm run typecheck` catches a stale one.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notify.test.ts -t "merges the ping into content for all three payload shapes"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck
npx vitest run tests/notify.test.ts tests/notify-handlers.test.ts tests/journeys.test.ts
git add src/core/notify.ts tests/notify.test.ts tests/notify-handlers.test.ts tests/journeys.test.ts CLAUDE.md
git commit -m "feat(notify): carry embeds and files in passive notifications"
```

---

### Task 2: scheduler notification handlers gain art

**Files:**
- Modify: `src/core/notify.ts:40-57` (both handlers) and its import line
- Test: `tests/notify-handlers.test.ts:15-73`
- Test: `tests/journeys.test.ts:240-243` (add the art pin to the notification chain)

**Interfaces:**
- Consumes: `NotifyPayload`, `Sender`, `deliverNotification(sender, ctx, userId, originGuildId, payload: NotifyPayload)` from Task 1; `assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles', name: string): ImageRef | null` from `src/core/images.ts`
- Produces: `eggHatchHandler(sender, ctx)` and `expeditionReturnHandler(sender, ctx)` unchanged in signature; both now deliver `{ embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }` instead of a string

- [ ] **Step 1: Write the failing test**

Replace `tests/notify-handlers.test.ts:15-73` (keep lines 1-13 from Task 1):

```ts
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
    expect(embedJson(dms[0]).thumbnail?.url).toBe('attachment://rare.png');
    expect(fileNames(dms[0])).toContain('rare.png');
    ctx.db.delete(schema.eggs).run();
    await handler({ userId: 'u1', refId: egg.id, originGuildId: null });
    expect(dms).toHaveLength(1);   // skip-guard: no ping for a consumed egg
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
    expect(embedJson(dms[0]).image?.url).toBe('attachment://coastal_dig-banner.png');
    expect(fileNames(dms[0])).toContain('coastal_dig-banner.png');
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
```

Add `import { EmbedBuilder } from 'discord.js';` to the top of that file, and add the art pin to `tests/journeys.test.ts` right after line 243:

```ts
    const notified = sent[0].payload as { embeds?: Array<{ toJSON(): { thumbnail?: { url: string } } }>; files?: Array<{ name?: string | null }> };
    expect(notified.embeds![0].toJSON().thumbnail?.url).toBe('attachment://common.png');
    expect(notified.files!.map((f) => f.name)).toContain('common.png');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/notify-handlers.test.ts -t "eggHatchHandler notifies for a live egg and skips a deleted one"`
Expected: FAIL with `expected undefined to contain 'rare egg is ready to hatch'` — the handler still delivers a plain string, so `embedJson()` returns `{}`

- [ ] **Step 3: Write the implementation**

Change the `src/core/notify.ts` import block to pull `EmbedBuilder` in as a value and add `assetImage`:

```ts
import { EmbedBuilder } from 'discord.js';
import type { Client, AttachmentBuilder } from 'discord.js';
import { assetImage } from './images.js';
```

Replace both handlers (`src/core/notify.ts:40-57`):

```ts
export function eggHatchHandler(sender: Sender, ctx: Ctx) {
  return async (t: { userId: string; refId: number; originGuildId: string | null }) => {
    try {
      const egg = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.id, t.refId)).get();
      if (!egg) return;   // already hatched/removed
      const embed = new EmbedBuilder().setColor(0xf1c40f)
        .setTitle('🥚 Egg ready')
        .setDescription(`Your ${egg.rarity} egg is ready to hatch! Use \`/hatch egg:${egg.id}\`.`);
      const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
      const img = assetImage('eggs', egg.rarity);
      if (img) { embed.setThumbnail(img.url); payload.files = [img.file]; }
      await deliverNotification(sender, ctx, t.userId, t.originGuildId, payload);
    } catch (e) { logger.warn({ err: e }, 'notify handler failed'); }
  };
}
export function expeditionReturnHandler(sender: Sender, ctx: Ctx) {
  return async (t: { userId: string; refId: number; originGuildId: string | null }) => {
    try {
      const exp = ctx.db.select().from(schema.expeditions).where(eq(schema.expeditions.id, t.refId)).get();
      if (!exp || exp.claimedAt) return;
      const site = EXPEDITION_SITES[exp.siteId];
      const embed = new EmbedBuilder().setColor(0xe8590c)
        .setTitle(`🧭 ${site.name} — your expedition has returned!`)
        .setDescription('Use `/expedition claim` to collect the egg, cash, and food.');
      const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
      const banner = assetImage('sites', `${exp.siteId}-banner`);
      if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
      await deliverNotification(sender, ctx, t.userId, t.originGuildId, payload);
    } catch (e) { logger.warn({ err: e }, 'notify handler failed'); }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/notify-handlers.test.ts tests/journeys.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/core/notify.ts tests/notify-handlers.test.ts tests/journeys.test.ts
git commit -m "feat(notify): illustrate egg-hatch and expedition-return pings"
```

---

### Task 3: `/incubate` promoted to an embed carrying `eggs/<rarity>.png`

**Files:**
- Modify: `src/modules/hatchery/index.ts:1-11` (imports) and `:26-32` (the `incubate` execute)
- Modify: `scripts/test-live.ts:80` (seed a spare egg) and `:125` (new gallery case)
- Test: `tests/hatchery.test.ts:168-179`

**Interfaces:**
- Consumes: `assetImage('eggs', rarity)`; `RARITY_COLOR: Record<string, number>` from `src/modules/hatchery/embeds.ts`; `rarityEmoji(rarity)` from `src/core/emojis.ts`
- Produces: nothing new — `/incubate`'s reply shape changes from `{ content }` to `{ embeds, files? }`

- [ ] **Step 1: Write the failing test**

Replace `tests/hatchery.test.ts:169-179`:

```ts
  it('incubates and replies with an illustrated ready-timestamp embed, enqueues egg_hatch timer', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'incubate')!;
    const i = fakeCommand({ name: 'incubate', user: 'u1', guild: 'g1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; description?: string; thumbnail?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toContain('Incubating your common egg');
    expect(embed.description).toContain('<t:');   // relative ready stamp survives the promotion
    // Attach-all-or-nothing: a thumbnail URL with no matching file renders broken.
    expect(embed.thumbnail?.url).toBe('attachment://common.png');
    expect(payload.files!.map((f) => f.name)).toContain('common.png');
    const timer = ctx.db.select().from(schema.timers).all().find((t) => t.kind === 'egg_hatch');
    expect(timer?.refId).toBe(egg.id);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hatchery.test.ts -t "incubates and replies with an illustrated ready-timestamp embed"`
Expected: FAIL with `TypeError: Cannot read properties of undefined (reading '0')` — the reply is still `{ content }`, so `payload.embeds` is undefined

- [ ] **Step 3: Write the implementation**

Extend the `src/modules/hatchery/index.ts` imports:

```ts
import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import { preHatchPayload, revealPayload, eggListPayload, RARITY_COLOR } from './embeds.js';
import { assetImage } from '../../core/images.js';
import { rarityEmoji } from '../../core/emojis.js';
```

Replace `src/modules/hatchery/index.ts:26-32` (the `incubate` execute body):

```ts
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const egg = incubateEgg(ctx, i.user.id, i.options.getInteger('egg', true), i.guildId);
          const embed = new EmbedBuilder().setColor(RARITY_COLOR[egg.rarity] ?? 0x95a5a6)
            .setTitle(`🥚 Incubating your ${rarityEmoji(egg.rarity)}${egg.rarity} egg`)
            .setDescription(`Ready <t:${Math.floor(egg.hatchesAt! / 1000)}:R> — then run \`/hatch egg:${egg.id}\`.`);
          const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
          const img = assetImage('eggs', egg.rarity);
          if (img) { embed.setThumbnail(img.url); payload.files = [img.file]; }
          await i.reply(payload);
        } catch (e) { if (e instanceof HatcheryError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      },
```

In `scripts/test-live.ts`, insert directly after line 80 (`// force-ready for /hatch`):

```ts
// Inserted AFTER the force-ready update above so this one stays un-incubated for
// the /incubate case, which runs after hatch:crack frees the single incubator slot.
const spareEgg = ctx.db.insert(schema.eggs).values({ userId: P1, rarity: 'epic', source: 'shop', obtainedAt: ctx.now() }).returning().get();
```

and insert this gallery case directly after the `hatch:crack — reveal` case (line 125):

```ts
  { title: '/incubate — timer started', run: () => slash('hatchery', 'incubate', { name: 'incubate', user: P1, options: { egg: spareEgg.id } }) },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hatchery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/index.ts tests/hatchery.test.ts scripts/test-live.ts
git commit -m "feat(hatchery): promote /incubate to an illustrated embed"
```

---

### Task 4: `/shop food` confirmation promoted to an embed carrying `banners/shop_food_market.png`

**Files:**
- Modify: `src/modules/shop/index.ts:71-74`
- Test: `tests/shop.test.ts:110-117`

**Interfaces:**
- Consumes: `assetImage('banners', 'shop_food_market')` — the same asset `/shop view` already attaches at `src/modules/shop/index.ts:56-57`
- Produces: nothing new — `/shop food`'s success reply becomes `{ embeds, files? }`

- [ ] **Step 1: Write the failing test**

Replace `tests/shop.test.ts:110-117`:

```ts
  it('/shop food execute buys units and replies with an illustrated total', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = shopModule.commands.find((c) => c.data.name === 'shop')!;
    const i = fakeCommand({ name: 'shop', sub: 'food', user: 'u1', options: { item: 'ferns', units: 10 } });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; description?: string; image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toContain('Bought 10× Ferns');
    expect(embed.description).toContain('100 cash');
    expect(embed.image?.url).toBe('attachment://shop_food_market.png');
    expect(payload.files!.map((f) => f.name)).toContain('shop_food_market.png');
    expect(ctx.economy.getFoodInventory('u1').ferns).toBe(20);   // 10 starter + 10 bought
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shop.test.ts -t "/shop food execute buys units and replies with an illustrated total"`
Expected: FAIL with `TypeError: Cannot read properties of undefined (reading '0')` — the reply is still `{ content }`

- [ ] **Step 3: Write the implementation**

Replace `src/modules/shop/index.ts:71-74` (the `else` arm of the `/shop` subcommand switch):

```ts
          } else {
            const units = i.options.getInteger('units', true);
            const { food, total } = buyFood(ctx, i.user.id, i.options.getString('item', true), units);
            const foodEmbed = new EmbedBuilder().setColor(0x3ba55c)
              .setTitle(`${emojiTag(food.emoji)} Bought ${units}× ${food.name}`)
              .setDescription(`Paid ${total.toLocaleString()} cash — fills hunger to ${food.fillTo}. Serve it with \`/feed all\`.`);
            const foodPayload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [foodEmbed] };
            const foodShopBanner = assetImage('banners', 'shop_food_market');
            if (foodShopBanner) { foodEmbed.setImage(foodShopBanner.url); foodPayload.files = [foodShopBanner.file]; }
            await i.reply(foodPayload);
          }
```

No import changes are needed — `EmbedBuilder`, `AttachmentBuilder`, `assetImage` and `emojiTag` are already imported in this file. `scripts/test-live.ts` already has a `/shop food — purchase` case (line 127), so the gallery picks this up with no edit.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shop.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/shop/index.ts tests/shop.test.ts
git commit -m "feat(shop): promote the /shop food confirmation to an embed"
```

---

### Task 5: `/expedition claim` appends the site thumbnail beside the banner

**Files:**
- Modify: `src/modules/expeditions/index.ts:77-80`
- Modify: `CLAUDE.md` (append the two-assets-in-one-payload bullet after the Task 1 notify bullet)
- Modify: `scripts/test-live.ts:130` (new gallery case after `/expedition status`)
- Test: `tests/expeditions.test.ts:67-75`

**Interfaces:**
- Consumes: `assetImage('sites', \`${siteId}-banner\`)` and `assetImage('sites', \`${siteId}-thumb\`)` — both already ship for all four sites
- Produces: the append idiom `payload.files = [...(payload.files ?? []), img.file]` as the repo-wide rule for a second asset in one payload

- [ ] **Step 1: Write the failing test**

Replace `tests/expeditions.test.ts:67-75`:

```ts
  it('/expedition claim ships the site banner AND thumb together', async () => {
    // Two assets in one payload: the second assetImage must APPEND. A plain
    // `payload.files = [thumb.file]` drops the banner and leaves the embed's
    // image pointing at an attachment:// URL that was never uploaded.
    ctx.economy.apply('u1', { cash: 1_000 }, 'seed', 0);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 16 * 60_000);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; image?: { url: string }; thumbnail?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toBe('🧭 🐚 Coastal Dig — returned!');
    expect(embed.image?.url).toBe('attachment://coastal_dig-banner.png');
    expect(embed.thumbnail?.url).toBe('attachment://coastal_dig-thumb.png');
    const names = payload.files!.map((f) => f.name);
    expect(names).toContain('coastal_dig-banner.png');
    expect(names).toContain('coastal_dig-thumb.png');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/expeditions.test.ts -t "/expedition claim ships the site banner AND thumb together"`
Expected: FAIL with `expected undefined to be 'attachment://coastal_dig-thumb.png'`

- [ ] **Step 3: Write the implementation**

Replace `src/modules/expeditions/index.ts:77-80`:

```ts
            const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
            const banner = assetImage('sites', `${site.id}-banner`);
            if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
            // APPEND, never re-assign: a second `payload.files = [...]` would drop
            // the banner and leave a dangling attachment:// URL in the embed.
            const thumb = assetImage('sites', `${site.id}-thumb`);
            if (thumb) { embed.setThumbnail(thumb.url); payload.files = [...(payload.files ?? []), thumb.file]; }
            await i.reply(payload);
```

Append to `CLAUDE.md` after the notify bullet added in Task 1:

```md
- Two assets in one payload: the SECOND `assetImage` must APPEND
  (`payload.files = [...(payload.files ?? []), img.file]`), never re-assign — a
  plain assignment drops the first file and leaves a dangling `attachment://`
  URL that Discord renders as a broken image. Attachment names are basenames
  only (`src/core/images.ts:20-23`), so the two assets need distinct file names
  (`<site>-banner.png` vs `<site>-thumb.png` is safe). Live call sites:
  `/shop view`, `/expedition claim`, `/battle chapters`.
```

Insert this gallery case in `scripts/test-live.ts` directly after the `/expedition status — digging` case (line 130), so the status case still shows a live countdown:

```ts
  { title: '/expedition claim — returned loot', run: () => {
      ctx.db.update(schema.expeditions).set({ returnsAt: ctx.now() - 1 }).run();   // force the seeded dig home
      return slash('expeditions', 'expedition', { name: 'expedition', sub: 'claim', user: P1 });
    } },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/expeditions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/expeditions/index.ts tests/expeditions.test.ts scripts/test-live.ts CLAUDE.md
git commit -m "feat(expeditions): add the site thumbnail to /expedition claim"
```

---

### Task 6: `/battle chapters` appends the chapter thumbnail

**Files:**
- Modify: `src/modules/battles/embeds.ts:136-140` (`chaptersPayload` only — `fightFrames` is untouched in this wave)
- Test: `tests/battles-embeds.test.ts:119-149`

**Interfaces:**
- Consumes: the `chapterId === siteId` invariant (`src/data/battle/chapters/`, enforced by `tests/battle-content.test.ts`), `assetImage('sites', …)`, and the append idiom from Task 5
- Produces: `chaptersPayload(userId, chapterIndex, view): FramePayload` unchanged in signature; now carries both `<chapterId>-banner.png` and `<chapterId>-thumb.png`

- [ ] **Step 1: Write the failing test**

Add to `tests/battles-embeds.test.ts` inside `describe('chaptersPayload', …)`, after the `page 0` case:

```ts
  it('carries the chapter banner AND thumb — both referenced, both uploaded', () => {
    // chapterId === siteId, so both site assets are legal here. This pins the
    // append: assigning payload.files twice would drop the banner file while the
    // embed still points at attachment://coastal_dig-banner.png.
    const p = chaptersPayload('u1', 0, baseView());
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://coastal_dig-banner.png');
    expect(embed.thumbnail?.url).toBe('attachment://coastal_dig-thumb.png');
    const names = p.files!.map((f) => f.name);
    expect(names).toContain('coastal_dig-banner.png');
    expect(names).toContain('coastal_dig-thumb.png');
    expect(names).toHaveLength(2);   // nothing uploaded that the embed does not reference
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/battles-embeds.test.ts -t "carries the chapter banner AND thumb"`
Expected: FAIL with `expected undefined to be 'attachment://coastal_dig-thumb.png'`

- [ ] **Step 3: Write the implementation**

Replace `src/modules/battles/embeds.ts:136-140` (leave `fightFrames` alone — its F1-only file contract changes in Wave 4, not here):

```ts
  const payload: FramePayload = { embeds: [embed], components: [nav] };
  // chapterId === siteId invariant (content test) makes the site art legal here.
  const banner = assetImage('sites', `${ch.id}-banner`);
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  // APPEND — a second assignment would drop the banner file.
  const thumb = assetImage('sites', `${ch.id}-thumb`);
  if (thumb) { embed.setThumbnail(thumb.url); payload.files = [...(payload.files ?? []), thumb.file]; }
  return payload;
}
```

`scripts/test-live.ts` already has a `/battle chapters — campaign overview` case (line 136); no gallery edit needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/battles-embeds.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/battles/embeds.ts tests/battles-embeds.test.ts
git commit -m "feat(battles): add the chapter thumbnail to /battle chapters"
```

---

### Task 7: `/trade offer` and `/trade accept` promoted to embeds carrying `banners/trading.png`

**Files:**
- Modify: `src/modules/trading/index.ts:117-127`
- Modify: `scripts/test-live.ts:133` (two new gallery cases after `/trade list`)
- Test: `tests/trading.test.ts:192-200` (rewrite) plus one new case
- Test: `tests/journeys.test.ts:199`

**Interfaces:**
- Consumes: `assetImage('banners', 'trading')` — the same asset `tradeListPayload` already attaches at `src/modules/trading/index.ts:62-63`
- Produces: `/trade offer` replies `{ content: '<@target>', embeds, files? }` — the recipient mention MUST stay in `content` (a mention inside an embed does not ping). `ctx.notify` call sites keep sending plain strings.

- [ ] **Step 1: Write the failing test**

Replace `tests/trading.test.ts:192-200`:

```ts
  it('/trade offer with give-food and give-food-qty creates a typed-food trade', async () => {
    ctx.economy.apply('a', { foods: { fish: 10 } }, 'seed', 0);
    const i = fakeCommand({ name: 'trade', sub: 'offer', user: 'a',
      options: { user: 'b', 'give-food': 'fish', 'give-food-qty': 10 } });
    await tradingModule.commands[0].execute(ctx, i.asChatInput());
    const t = ctx.db.select().from(schema.trades).where(eq(schema.trades.fromUser, 'a')).get()!;
    expect(t.offer.foods).toEqual({ fish: 10 });
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { description?: string } }> }).embeds[0].toJSON();
    expect(embed.description).toContain('10 Fish');
  });
  it('/trade offer keeps the recipient ping in content and ships the trading banner', async () => {
    // The mention must NOT move into the embed — Discord does not ping from embed
    // text, and this reply is the counterparty's only in-channel signal.
    ctx.economy.apply('a', { foods: { fish: 10 } }, 'seed', 0);
    const i = fakeCommand({ name: 'trade', sub: 'offer', user: 'a',
      options: { user: 'b', 'give-food': 'fish', 'give-food-qty': 10 } });
    await tradingModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      content?: string;
      embeds: Array<{ toJSON(): { image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    expect(payload.content).toContain('<@b>');
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://trading.png');
    expect(payload.files!.map((f) => f.name)).toContain('trading.png');
  });
  it('/trade accept replies with an illustrated completion embed', async () => {
    ctx.economy.apply('a', { cash: 1_000 }, 'seed', 0);
    const t = createTrade(ctx, 'a', 'b', { ...empty, cash: 100 }, empty);
    const i = fakeCommand({ name: 'trade', sub: 'accept', user: 'b', guild: 'g1', options: { id: t.id } });
    await tradingModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { title?: string; image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    expect(payload.embeds[0].toJSON().title).toContain(`Trade #${t.id} completed`);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://trading.png');
    expect(payload.files!.map((f) => f.name)).toContain('trading.png');
  });
```

Replace `tests/journeys.test.ts:199`:

```ts
    const offerEmbed = (offer.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> }).embeds[0].toJSON();
    expect(offerEmbed.title).toContain('Trade');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/trading.test.ts -t "/trade offer keeps the recipient ping in content and ships the trading banner"`
Expected: FAIL with `TypeError: Cannot read properties of undefined (reading '0')` — the offer reply is still `{ content }` with no `embeds`

- [ ] **Step 3: Write the implementation**

Replace `src/modules/trading/index.ts:117-127`:

```ts
            const t = createTrade(ctx, i.user.id, target.id, offer, request);
            const offerEmbed = new EmbedBuilder().setColor(0x5865F2)
              .setTitle(`🤝 Trade #${t.id} sent`)
              .setDescription([
                `You give: ${summarize(offer, emojiTag)}`,
                `You want: ${summarize(request, emojiTag)}`,
                `They run \`/trade accept id:${t.id}\`.`,
              ].join('\n'));
            // The ping stays in `content`: a mention inside an embed does not notify.
            const offerPayload: { content: string; embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } =
              { content: `<@${target.id}>`, embeds: [offerEmbed] };
            const offerBanner = assetImage('banners', 'trading');
            if (offerBanner) { offerEmbed.setImage(offerBanner.url); offerPayload.files = [offerBanner.file]; }
            await i.reply(offerPayload);
            // originGuildId is the acting user's guild, so delivery falls back to DM when the counterparty isn't in that guild's notify channel.
            await ctx.notify(target.id, i.guildId,
              `📨 Trade #${t.id} from **${i.user.displayName}** — they give ${summarize(offer, emojiTag)}, they want ${summarize(request, emojiTag)}. Run \`/trade accept id:${t.id}\`.`);
          } else if (sub === 'list') {
            await i.reply(tradeListPayload(ctx, i.user.id, 1));
          } else if (sub === 'accept') {
            const t = acceptTrade(ctx, i.user.id, i.options.getInteger('id', true));
            const acceptEmbed = new EmbedBuilder().setColor(0x2ecc71)
              .setTitle(`✅ Trade #${t.id} completed!`)
              .setDescription('Everything has changed hands — check `/dino list`, `/eggs`, or `/park view`.');
            const acceptPayload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [acceptEmbed] };
            const acceptBanner = assetImage('banners', 'trading');
            if (acceptBanner) { acceptEmbed.setImage(acceptBanner.url); acceptPayload.files = [acceptBanner.file]; }
            await i.reply(acceptPayload);
            await ctx.notify(t.fromUser, i.guildId, `✅ **${i.user.displayName}** accepted your trade #${t.id}!`);
```

Insert these two gallery cases in `scripts/test-live.ts` directly after the `/trade list — pending trades` case (line 133):

```ts
  { title: '/trade offer — new offer', run: () => {
      // hatchEgg/claimExpedition above run recomputeRating, which can drop parkRating
      // below TRADE_MIN_RATING — same restore the seed does at the top of this file.
      ctx.db.update(schema.users).set({ parkRating: 200 }).run();
      return slash('trading', 'trade', { name: 'trade', sub: 'offer', user: P1, options: { user: P2, 'give-cash': 250, 'want-cash': 100 } });
    } },
  { title: '/trade accept — completed', run: () => {
      const pending = ctx.db.select().from(schema.trades).all()
        .filter((t) => t.toUser === P2 && t.status === 'pending').sort((x, y) => y.id - x.id);
      return slash('trading', 'trade', { name: 'trade', sub: 'accept', user: P2, options: { id: pending[0].id } });
    } },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/trading.test.ts tests/journeys.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/index.ts tests/trading.test.ts tests/journeys.test.ts scripts/test-live.ts
git commit -m "feat(trading): promote /trade offer and /trade accept to embeds"
```

---

### Task 8: `/help topic:<t>` gains art, including the park canvas render

**Files:**
- Modify: `src/modules/help/index.ts:1-5` (imports + `HELP_TOPICS` value type), `:5-66` (art descriptors), `:75-81` (topic branch)
- Modify: `CLAUDE.md` (append the lazy-art-descriptor bullet)
- Modify: `scripts/test-live.ts:121` (three new gallery cases)
- Test: `tests/help.test.ts`

**Interfaces:**
- Consumes: `assetImage(kind, name)`; `renderPark(snapshot)` from `src/core/render/client.ts`; `buildParkSnapshot(ctx, userId)` from `src/modules/park/snapshot.ts`; `withParkImage<T extends { embeds: EmbedBuilder[] }>(payload, png)` from `src/modules/park/embeds.ts`
- Produces: `export const HELP_TOPICS: Record<string, { title: string; body: string; art?: { kind: 'eggs' | 'sites' | 'banners'; name: string } }>` — a LAZY descriptor, never a built `ImageRef`. Topic KEYS are unchanged, so the `/help` builder is unchanged and `npm run deploy-commands` is not required.

- [ ] **Step 1: Write the failing test**

Append to `tests/help.test.ts` inside `describe('/help', …)`:

```ts
  it('every topic that declares art ships the image and its file together', async () => {
    for (const [topic, t] of Object.entries(HELP_TOPICS)) {
      if (!t.art) continue;
      const i = fakeCommand({ name: 'help', user: 'u1', options: { topic } });
      await helpModule.commands[0].execute(ctx, i.asChatInput());
      const payload = i.replies[0] as {
        embeds: Array<{ toJSON(): { image?: { url: string } } }>;
        files?: Array<{ name?: string | null }>;
      };
      expect(payload.embeds[0].toJSON().image?.url, topic).toBe(`attachment://${t.art.name}.png`);
      expect(payload.files!.map((f) => f.name), topic).toContain(`${t.art.name}.png`);
    }
  });
  it('the park topic defers and still renders one embed when the map render fails', async () => {
    // 'no-park' has no user row, so buildParkSnapshot throws inside the try —
    // /help must never create rows, and must never die on a render failure.
    const i = fakeCommand({ name: 'help', user: 'no-park', options: { topic: 'park' } });
    await helpModule.commands[0].execute(ctx, i.asChatInput());
    expect(i.deferOpts).toHaveLength(1);
    const reply = i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> };
    expect(reply.embeds).toHaveLength(1);
    expect(reply.embeds[0].toJSON().title).toBe(HELP_TOPICS.park.title);
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(0);
  });
```

Add `import { schema } from '../src/core/db/index.js';` to the top of `tests/help.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/help.test.ts -t "every topic that declares art ships the image and its file together"`
Expected: FAIL with `TypeError: Cannot read properties of undefined (reading 'map')` — no topic declares `art` yet, so the loop body never runs and… run it and confirm the actual first failure is `expected undefined to be 'attachment://help.png'` on the `getting-started` topic once `art` exists; before the type change the loop `continue`s on every topic and the SECOND test fails first with `expected 0 to have length 1` (no `deferReply`). Use the park-topic name in this step's command if the art loop reports a vacuous pass: `npx vitest run tests/help.test.ts -t "the park topic defers"` → FAIL with `expected [] to have a length of 1 but got +0`.

- [ ] **Step 3: Write the implementation**

Replace `src/modules/help/index.ts:1-5` (imports and the `HELP_TOPICS` declaration head):

```ts
import { SlashCommandBuilder, EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';
import { assetImage } from '../../core/images.js';
import { renderPark } from '../../core/render/client.js';
import { buildParkSnapshot } from '../park/snapshot.js';
import { withParkImage } from '../park/embeds.js';

// Art is a LAZY descriptor, never a built ImageRef: assetImage returns a fresh
// AttachmentBuilder per call and this map is module-level.
interface HelpTopic { title: string; body: string; art?: { kind: 'eggs' | 'sites' | 'banners'; name: string } }

export const HELP_TOPICS: Record<string, HelpTopic> = {
```

Add the `art` field to each topic value (keys and bodies unchanged — only the closing `}` of each entry gains a field):

```ts
  'getting-started': { …, art: { kind: 'banners', name: 'help' } },
  park: { … },                                                        // no art: the canvas render is its illustration
  eggs: { …, art: { kind: 'eggs', name: 'rare' } },
  expeditions: { …, art: { kind: 'sites', name: 'coastal_dig-banner' } },
  shop: { …, art: { kind: 'banners', name: 'shop_food_market' } },
  care: { …, art: { kind: 'banners', name: 'care' } },
  trading: { …, art: { kind: 'banners', name: 'trading' } },
  ranks: { …, art: { kind: 'banners', name: 'leaderboards' } },
  battles: { …, art: { kind: 'sites', name: 'coastal_dig-banner' } },   // chapter 1
```

Replace `src/modules/help/index.ts:75-81` (the topic branch of `execute`):

```ts
      async execute(ctx, i) {
        const topic = i.options.getString('topic');
        if (topic && HELP_TOPICS[topic]) {
          const t = HELP_TOPICS[topic];
          const embed = new EmbedBuilder().setTitle(t.title).setDescription(t.body).setColor(0x5865F2);
          const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
          if (t.art) {
            const img = assetImage(t.art.kind, t.art.name);
            if (img) { embed.setImage(img.url); payload.files = [img.file]; }
          }
          if (topic === 'park') {
            // The park topic illustrates itself with the reader's own map: a worker
            // render, so defer first and degrade to the text-only embed on any
            // failure (including "this reader has no park row yet").
            await i.deferReply();
            let png: Buffer | undefined;
            try { png = await renderPark(buildParkSnapshot(ctx, i.user.id)); } catch { png = undefined; }
            await i.editReply(png ? withParkImage(payload, png) : payload);
            return;
          }
          await i.reply(payload);
          return;
        }
```

Append to `CLAUDE.md`:

```md
- `HELP_TOPICS` (`src/modules/help/index.ts`) stores a LAZY art descriptor
  (`art?: { kind, name }`), never a built `ImageRef` — `assetImage` returns a
  fresh `AttachmentBuilder` per call and the map is module-level (same class of
  mistake as calling `emojiTag` in a module constant). The `park` topic has no
  descriptor: it defers and renders the reader's own map, degrading to a
  text-only embed when `buildParkSnapshot`/`renderPark` throws. Adding or
  removing a topic KEY changes the `/help` builder choices and forces
  `npm run deploy-commands`; adding a field to the value type does not.
```

Insert three gallery cases in `scripts/test-live.ts` directly after the `/help — overview` case (line 121):

```ts
  { title: '/help topic:park — own-park canvas render', run: () => slash('help', 'help', { name: 'help', user: P1, options: { topic: 'park' } }) },
  { title: '/help topic:eggs — egg art', run: () => slash('help', 'help', { name: 'help', user: P1, options: { topic: 'eggs' } }) },
  { title: '/help topic:battles — chapter banner', run: () => slash('help', 'help', { name: 'help', user: P1, options: { topic: 'battles' } }) },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/help.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
npm run typecheck
npm test
git add src/modules/help/index.ts tests/help.test.ts scripts/test-live.ts CLAUDE.md
git commit -m "feat(help): illustrate every /help topic"
```

After this commit the wave is code-complete. Run `npm run test:live` (needs `TEST_CHANNEL_ID`) and review the gallery for the seven promoted surfaces — bare-attachment and broken-image regressions have no offline coverage. `npm run deploy-commands` is NOT required: no command builder changed in this wave.

---

## Wave 2 — Battle boss portraits

### Task 9: Retire the destructive portrait fixture in `tests/battles-embeds.test.ts`

**Files:**
- Modify: `tests/battles-embeds.test.ts:1-17` (imports + stub/cleanup block)
- Modify: `tests/battles-embeds.test.ts:85-98` (null-degrade case)
- Test: `tests/battles-embeds.test.ts`

**Interfaces:**
- Consumes: `fightFrames(outcome: FightOutcome, skipRow: (idx: number) => ActionRowBuilder<ButtonBuilder> | null): FramePayload[]` (`src/modules/battles/embeds.ts`), `assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles', name: string): ImageRef | null` (`src/core/images.ts`), `validateMessagePayload(payload, source)` (`tests/lib/discord-limits.ts`)
- Produces: `const art = vi.hoisted(() => ({ portraits: true }))` toggle plus the partial `vi.mock('../src/core/images.js', …)` in `tests/battles-embeds.test.ts` — the only fixture for `fightFrames`' portrait-absent branch from this wave on. No `src/` change.

- [ ] **Step 1: Write the failing test**

Replace lines 1-17 of `tests/battles-embeds.test.ts` with the block below — this deletes the `writeFileSync`/`rmSync` fixture that fabricates a 4-byte file at the real committed asset path, and keeps the `bossId` const the thumbnail assertions use:

```ts
import { describe, it, expect } from 'vitest';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fightFrames, chaptersPayload, energyLine, type ChaptersView } from '../src/modules/battles/embeds.js';
import type { FightOutcome } from '../src/modules/battles/service.js';
import type { BeatSummary } from '../src/data/battle/resolve.js';
import { STAGES, type ProgressMap } from '../src/data/battle/chapters/index.js';
import { ENERGY_REGEN_MS } from '../src/data/battle/constants.js';
import { validateMessagePayload } from './lib/discord-limits.js';

const bossId = STAGES.get('coastal_dig_boss')!.boss!.bossId;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/battles-embeds.test.ts -t "boss stages thumbnail the portrait"`
Expected: FAIL with `expected undefined to be 'attachment://boss-coastal_dig-portrait.png'` — nothing supplies the portrait now that the stub is gone.

- [ ] **Step 3: Write the implementation**

Insert the mock immediately above `const bossId = …` (it must be `vi.hoisted`, because `vi.mock` factories are hoisted above module-level declarations):

```ts
import { describe, it, expect, vi } from 'vitest';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// Portrait presence is mocked, never staged on disk. vitest runs test FILES in
// parallel forks, so a writeFileSync/rmSync fixture on a committed asset path
// (this file used to stub the coastal portrait) can be observed — or deleted —
// by another file mid-run. `portraits: false` is also the only fixture left for
// the null-degrade branch: every boss stage ships a portrait now.
const art = vi.hoisted(() => ({ portraits: true }));
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return {
    ...actual,
    assetImage: (kind: Parameters<typeof actual.assetImage>[0], name: string) => {
      if (kind !== 'battles') return actual.assetImage(kind, name);   // chapter banners stay real
      if (!art.portraits) return null;
      const fileName = `${name}.png`;
      return { file: new AttachmentBuilder(Buffer.from('portrait'), { name: fileName }), url: `attachment://${fileName}` };
    },
  };
});
```

and rewrite the degrade case (old lines 85-98) to drive the branch off the toggle instead of off an absent file:

```ts
  it('boss stage with no portrait art degrades cleanly: no thumbnail anywhere, no portrait file, banner still ships', () => {
    // No boss stage lacks committed art any more, so the absent-art branch is
    // pinned by forcing assetImage('battles', …) to null — the project rule is
    // that missing art degrades, never throws.
    const noPortraitBossId = STAGES.get('amber_ridge_boss')!.boss!.bossId;
    art.portraits = false;
    try {
      const frames = fightFrames(
        makeOutcome({ stageId: 'amber_ridge_boss', bossEgg: { rarity: 'epic' } }), skipStub);
      expect(frames).toHaveLength(4);
      for (const f of frames) validateMessagePayload(f, 'frame-no-portrait');
      for (const f of frames) expect(f.embeds[0].toJSON().thumbnail).toBeUndefined();
      expect(frames[0].files?.map((f) => f.name)).not.toContain(`${noPortraitBossId}-portrait.png`);
      expect(frames[0].files?.map((f) => f.name)).toContain('amber_ridge-banner.png');   // chapter banner still ships
    } finally {
      art.portraits = true;
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/battles-embeds.test.ts`
Expected: PASS — all 9 cases green, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add tests/battles-embeds.test.ts
git commit -m "test(battles): mock portrait art instead of stubbing a committed asset path"
```

---

### Task 10: Generate the `coastal_dig` reference portrait

**Files:**
- Create: `assets/images/battles/boss-coastal_dig-portrait.png`
- Create: `<scratchpad>/fit-portrait.mjs`
- Modify: `tests/images.test.ts:1-7` (imports), append `describe('boss portrait art')`
- Modify: `CLAUDE.md:117-120`
- Modify: `docs/assets/prompts.md:362-364`
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: `assetImage('battles', `${bossId}-portrait`)`, `BossDef.bossId` from `src/data/battle/chapters/coastal_dig.ts` (`'boss-coastal_dig'`)
- Produces: `assets/images/battles/boss-coastal_dig-portrait.png` (1024×1024, transparent); `expectTransparentPortrait(bossId: string): Promise<void>` in `tests/images.test.ts` — Wave 4 reuses this corner-alpha idiom for the hatch cracks

- [ ] **Step 1: Write the failing test**

Change line 2 of `tests/images.test.ts` to `import { createCanvas, Image } from '@napi-rs/canvas';`, then append:

```ts
// A re-export that bakes the flat light-gray studio background back in passes
// any size-only check and then reads as a gray card in dark mode, so corners
// are asserted transparent, not just the dimensions. These are the only
// committed images used as an embed thumbnail over the viewer's theme.
async function expectTransparentPortrait(bossId: string): Promise<void> {
  expect(assetImage('battles', `${bossId}-portrait`), bossId).not.toBeNull();
  const img = new Image();
  img.src = readFileSync(resolve(process.cwd(), 'assets/images/battles', `${bossId}-portrait.png`));
  await img.decode();   // PNG decode is async — drawing without it silently yields a blank canvas
  expect(img.width, bossId).toBe(1024);
  expect(img.height, bossId).toBe(1024);
  const canvas = createCanvas(1024, 1024);
  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0);
  const corners: Array<[number, number]> = [[0, 0], [1023, 0], [0, 1023], [1023, 1023]];
  for (const [x, y] of corners) {
    expect(c.getImageData(x, y, 1, 1).data[3], `${bossId} corner ${x},${y}`).toBe(0);
  }
}

describe('boss portrait art', () => {
  it('boss-coastal_dig is a 1024×1024 transparent cutout', () => expectTransparentPortrait('boss-coastal_dig'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "boss-coastal_dig is a 1024×1024 transparent cutout"`
Expected: FAIL with `expected null not to be null: boss-coastal_dig` (no file under `assets/images/battles/` except `.gitkeep`).

- [ ] **Step 3: Write the implementation**

Generate with `mcp__claude_ai_Higgsfield__generate_image`, model `nano_banana_pro`, prompt copied verbatim from `docs/assets/prompts.md` ("boss-coastal_dig — Old Riptooth (reference portrait)"):

```json
{"params":{"model":"nano_banana_pro","aspect_ratio":"1:1","count":1,
"prompt":"A fierce cartoon Baryonyx boss portrait, head and shoulders in three-quarter view, long crocodile-like snout with a jagged toothy snarl, teal-and-sand scales with a wet glossy sea-spray sheen and a ragged old scar across the snout. The dinosaur fills almost the entire square frame with a small even margin. Plain flat light-gray studio background, no scenery, no ground shadow. No glow, rays, embers, sparkles, or light effects extending beyond the dinosaur silhouette; glowing details may appear only on the surfaces themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no human characters, no UI elements."}}
```

Poll with `mcp__claude_ai_Higgsfield__job_status` (`{"jobId":"<generate job_id>","sync":true}`). **Keep this raw job_id** — Task 11's three edits reference it, not the cutout. Then cut out with `mcp__claude_ai_Higgsfield__remove_background`: `{"params":{"media_id":"<generate job_id>","media_type":"image"}}`, poll again, and download the result:

```powershell
$scratch = "<scratchpad>"
Invoke-WebRequest -Uri "<remove_background result url>" -OutFile "$scratch\boss-coastal_dig-cutout.png"
```

Write the defringe + fit pass to `<scratchpad>/fit-portrait.mjs` (`createRequire` because the scratchpad sits outside the repo's `node_modules` resolution root):

```js
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire('<repo>/package.json');
const { createCanvas, Image } = require('@napi-rs/canvas');

const SIZE = 1024, MARGIN = 24;
const [, , inPath, outPath] = process.argv;

const img = new Image();
img.src = readFileSync(inPath);
await img.decode();
const w = img.width, h = img.height;
const src = createCanvas(w, h);
const sctx = src.getContext('2d');
sctx.drawImage(img, 0, 0);
const id = sctx.getImageData(0, 0, w, h);
const px = id.data;
const idx = (x, y) => (y * w + x) * 4;
const N = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// (1) keep only the largest connected region — matting leaves speckle islands.
const label = new Int32Array(w * h).fill(-1);
let best = { id: -1, size: 0 }, next = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (px[idx(x, y) + 3] < 16 || label[y * w + x] !== -1) continue;
  const cur = next++; let size = 0; const stack = [x, y];
  label[y * w + x] = cur;
  while (stack.length) {
    const cy = stack.pop(), cx = stack.pop(); size++;
    for (const [dx, dy] of N) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (label[ny * w + nx] !== -1 || px[idx(nx, ny) + 3] < 16) continue;
      label[ny * w + nx] = cur; stack.push(nx, ny);
    }
  }
  if (size > best.size) best = { id: cur, size };
}
for (let i = 0; i < w * h; i++) if (label[i] !== best.id) px[i * 4 + 3] = 0;

// (2)+(3) luminance peel then a 2px shave: the light-gray studio background
// leaves a pale rim where the dinosaur's dark outline should have been.
const light = (i) => {
  const r = px[i], g = px[i + 1], b = px[i + 2];
  return (r + g + b) / 3 > 150 && Math.max(r, g, b) - Math.min(r, g, b) < 40;
};
const peel = (test) => {
  const doomed = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = idx(x, y);
    if (px[i + 3] === 0) continue;
    let edge = false;
    for (const [dx, dy] of N) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || px[idx(nx, ny) + 3] === 0) { edge = true; break; }
    }
    if (edge && test(i)) doomed.push(i);
  }
  for (const i of doomed) px[i + 3] = 0;
  return doomed.length;
};
for (let pass = 0; pass < 6; pass++) if (peel(light) === 0) break;
for (let pass = 0; pass < 2; pass++) peel(() => true);
sctx.putImageData(id, 0, 0);

// (4) fit + center on the whole silhouette bbox (no egg axis to bias toward).
let x0 = w, y0 = h, x1 = -1, y1 = -1;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[idx(x, y) + 3] > 0) {
  if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
}
const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const scale = Math.min((SIZE - MARGIN * 2) / bw, (SIZE - MARGIN * 2) / bh);
const out = createCanvas(SIZE, SIZE);
const octx = out.getContext('2d');
octx.drawImage(src, x0, y0, bw, bh, (SIZE - bw * scale) / 2, (SIZE - bh * scale) / 2, bw * scale, bh * scale);
writeFileSync(outPath, out.toBuffer('image/png'));

// verify: every border pixel transparent, which is what the vitest gate asserts.
const chk = octx.getImageData(0, 0, SIZE, SIZE).data;
for (let k = 0; k < SIZE; k++) {
  const edges = [k * 4, ((SIZE - 1) * SIZE + k) * 4, (k * SIZE) * 4, (k * SIZE + SIZE - 1) * 4];
  for (const e of edges) if (chk[e + 3] !== 0) throw new Error(`opaque border pixel at ${e / 4}`);
}
console.log(`${outPath}: source ${bw}x${bh} -> 1024x1024 @ ${scale.toFixed(3)}`);
```

Run it into place:

```powershell
node "$scratch\fit-portrait.mjs" "$scratch\boss-coastal_dig-cutout.png" "<repo>\assets\images\battles\boss-coastal_dig-portrait.png"
```

Then update the two docs the drop makes stale. `docs/assets/prompts.md:362-364` — replace `Post-process each with `remove_background` plus the defringe + fit pass described in the Egg rarities section.` with:

```md
Post-process each
with `remove_background` plus the defringe + fit pass described in the Egg
rarities section, with one difference: portraits fit and center on the **whole
silhouette bbox** (there is no egg axis to bias toward), 24px margin on a
1024×1024 transparent canvas.
```

`CLAUDE.md:117-120` — replace the sentence beginning `` `assets/images/battles/` ships empty (`.gitkeep` only) by design: … `` with:

```md
  mid-cinematic, and no offline test catches it. `assets/images/battles/`
  ships committed boss portraits (`boss-<siteId>-portrait.png`, 1024×1024
  transparent cutouts pinned by `tests/images.test.ts`); `assetImage`'s
  null-degrade still holds, so the campaign stays fully playable if any of them
  is removed. Never stage a test fixture inside `assets/images/` — vitest runs
  test files in parallel forks, so a `writeFileSync`/`rmSync` on a committed
  asset path can be observed (or deleted) by another file mid-run;
  `tests/battles-embeds.test.ts` mocks `assetImage` instead.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts -t "boss-coastal_dig is a 1024×1024 transparent cutout"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add assets/images/battles/boss-coastal_dig-portrait.png tests/images.test.ts CLAUDE.md docs/assets/prompts.md
git commit -m "feat(art): ship the coastal_dig boss portrait"
```

---

### Task 11: Generate the three edit portraits from the coastal reference

**Files:**
- Create: `assets/images/battles/boss-amber_ridge-portrait.png`
- Create: `assets/images/battles/boss-frozen_cliffs-portrait.png`
- Create: `assets/images/battles/boss-volcano_core-portrait.png`
- Modify: `tests/images.test.ts` (imports + `describe('boss portrait art')`)
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: `expectTransparentPortrait(bossId: string): Promise<void>` (Task 10), `CAMPAIGN: ChapterDef[]` from `src/data/battle/chapters/index.js`
- Produces: the complete four-file set under `assets/images/battles/`; `const PORTRAIT_BOSS_IDS: string[]` in `tests/images.test.ts`

- [ ] **Step 1: Write the failing test**

Add `import { CAMPAIGN } from '../src/data/battle/chapters/index.js';` after the `assetImage` import in `tests/images.test.ts`, and replace the single-case `describe('boss portrait art')` from Task 10 with the CAMPAIGN-driven set (ids come from the chapter data, which `tests/battle-content.test.ts` already pins, so a renamed boss can never silently orphan its art):

```ts
const PORTRAIT_BOSS_IDS = CAMPAIGN.map((c) => c.stages[4].boss!.bossId);

describe('boss portrait art', () => {
  it.each(PORTRAIT_BOSS_IDS)('%s is a 1024×1024 transparent cutout', (bossId) => expectTransparentPortrait(bossId));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "is a 1024×1024 transparent cutout"`
Expected: FAIL — 1 passed (`boss-coastal_dig`), 3 failed with `expected null not to be null: boss-amber_ridge` / `boss-frozen_cliffs` / `boss-volcano_core`.

- [ ] **Step 3: Write the implementation**

Three `mcp__claude_ai_Higgsfield__generate_image` calls, each an edit of the **raw** coastal generation (`medias[].role: "image"`, `value` = the coastal generate job_id from Task 10 — never the background-removed cutout, and never chained off each other):

```json
{"params":{"model":"nano_banana_pro","aspect_ratio":"1:1","count":1,
"medias":[{"role":"image","value":"<coastal generate job_id>"}],
"prompt":"Keep the exact same head-and-shoulders boss portrait: same pose, same framing, same plain flat light-gray studio background. Change the dinosaur to a battle-scarred cartoon Allosaurus with honey-orange and sandstone-brown scales, twin brow horns, an amber-gold eye, and warm sunset-toned glossy highlights. No glow, rays, embers, sparkles, or light effects extending beyond the dinosaur silhouette; glowing details may appear only on the surfaces themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no human characters, no UI elements."}}
```

```json
{"params":{"model":"nano_banana_pro","aspect_ratio":"1:1","count":1,
"medias":[{"role":"image","value":"<coastal generate job_id>"}],
"prompt":"Keep the exact same head-and-shoulders boss portrait: same pose, same framing, same plain flat light-gray studio background. Change the dinosaur to a towering cartoon Quetzalcoatlus with pale ice-blue and white plumage, a long crested head, frost sheen gleaming on the beak surface, and one folded wing shoulder visible. No glow, rays, embers, sparkles, or light effects extending beyond the dinosaur silhouette; glowing details may appear only on the surfaces themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no human characters, no UI elements."}}
```

```json
{"params":{"model":"nano_banana_pro","aspect_ratio":"1:1","count":1,
"medias":[{"role":"image","value":"<coastal generate job_id>"}],
"prompt":"Keep the exact same head-and-shoulders boss portrait: same pose, same framing, same plain flat light-gray studio background. Change the dinosaur to a colossal cartoon Tyrannosaurus with jet-black obsidian-dark scales veined by glowing orange lava-crack markings on the scale surfaces only, an ember-orange eye, and a roaring open jaw. No glow, rays, embers, sparkles, or light effects extending beyond the dinosaur silhouette; glowing details may appear only on the surfaces themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no human characters, no UI elements."}}
```

For each: poll `mcp__claude_ai_Higgsfield__job_status` (`sync: true`), then `mcp__claude_ai_Higgsfield__remove_background` (`{"params":{"media_id":"<that edit's job_id>","media_type":"image"}}`), poll, download, and run the same fit pass:

```powershell
$scratch = "<scratchpad>"
$repo = "<repo>"
foreach ($id in @('amber_ridge','frozen_cliffs','volcano_core')) {
  node "$scratch\fit-portrait.mjs" "$scratch\boss-$id-cutout.png" "$repo\assets\images\battles\boss-$id-portrait.png"
}
```

Note: `tests/emoji-assets.test.ts`'s 2% pure-black guard scans `assets/emojis/png/**` only — the jet-black volcano portrait is not subject to it, and the guard must not be widened to `assets/images/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npm test`
Expected: PASS — all four `boss-* is a 1024×1024 transparent cutout` cases green and the full offline suite green.

- [ ] **Step 5: Commit**

```bash
git add assets/images/battles/boss-amber_ridge-portrait.png assets/images/battles/boss-frozen_cliffs-portrait.png assets/images/battles/boss-volcano_core-portrait.png tests/images.test.ts
git commit -m "feat(art): ship the amber_ridge, frozen_cliffs and volcano_core boss portraits"
```

---

### Task 12: Put a second boss portrait in the live payload gallery

**Files:**
- Modify: `scripts/test-live.ts:97-99` (battles progress seed)
- Modify: `scripts/test-live.ts:138` (append a case)
- Test: `scripts/test-live.ts` via `npm run test:live` (needs `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DATABASE_PATH`, `OWNER_ID`, `DEV_GUILD_ID`, `TEST_CHANNEL_ID` in `.env`)

**Interfaces:**
- Consumes: `assets/images/battles/boss-amber_ridge-portrait.png` (Task 11), `runFight` via the `battles` module's `/battle fight` handler, `stageUnlocked` / `chapterUnlocked` gates in `src/data/battle/chapters/index.ts`
- Produces: gallery coverage of a second portrait; the seeded `amber_ridge_1..4` progress rows other live cases inherit

- [ ] **Step 1: Write the failing test**

Append one case to `cases` in `scripts/test-live.ts`, immediately after the `coastal_dig_boss` case at line 138 (order is load-bearing — see Step 3):

```ts
  { title: '/battle fight — amber_ridge boss: second portrait (edit off the coastal reference)', run: () => slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'amber_ridge_boss', dino1: b1.id, dino2: b2.id, dino3: b3.id } }) },
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:live`
Expected: FAIL cosmetically — the new case posts the single line `Clear the previous stage first.` into `TEST_CHANNEL_ID` instead of four cinematic frames (`stageUnlocked('amber_ridge_boss')` needs `amber_ridge_4` cleared). The console summary still counts it `ok`, because a rejection is a captured reply: the gallery is the gate here, not the exit code.

- [ ] **Step 3: Write the implementation**

Extend the progress seed loop at `scripts/test-live.ts:97-99`:

```ts
// amber_ridge_1..4 are seeded so the amber boss case has a stage gate to pass;
// its CHAPTER gate (coastal_dig_boss first-cleared) is left to the coastal boss
// case that runs earlier in `cases` — that keeps /battle chapters posting the
// chapter-1 page with later chapters locked, which is what the overview should
// show in the gallery. coastal_dig_boss is deliberately NOT seeded: the case
// above it is a FIRST clear and needs the egg line on F4.
for (const stageId of ['coastal_dig_1', 'coastal_dig_2', 'coastal_dig_3', 'coastal_dig_4',
  'amber_ridge_1', 'amber_ridge_2', 'amber_ridge_3', 'amber_ridge_4']) {
  ctx.db.insert(schema.battleProgress).values({ userId: P1, stageId, stars: 3, firstClearedAt: ctx.now(), attempts: 1 }).run();
}
```

Energy budget stays inside the cap: `coastal_dig_1` (⚡1) + `coastal_dig_boss` (⚡3) + `amber_ridge_boss` (⚡3) = 7 of `ENERGY_CAP` 10.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:live`
Expected: PASS — summary `N ok, 0 failed`, and in `TEST_CHANNEL_ID` the amber case posts four frames whose F1 carries both `amber_ridge-banner.png` and `boss-amber_ridge-portrait.png`, with the Ridgeback Alpha portrait reading as the same set as Old Riptooth. Reviewer caveat: the sweep posts each frame as its own REST message and only F1 carries files, so F2–F4 render with no image/thumbnail in the gallery — that is a sweep artifact, not a regression, and must not be "fixed" by attaching files to frames 2–4.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-live.ts
git commit -m "test(live): fight the amber_ridge boss so a second portrait reaches the gallery"
```

---

## Wave 3 — Park map, Direction A

### Task 13: Rarity dino chip icons (6 SVGs + fallback table)

**Files:**
- Create: `assets/emojis/svg/dw_dino_common.svg`
- Create: `assets/emojis/svg/dw_dino_uncommon.svg`
- Create: `assets/emojis/svg/dw_dino_rare.svg`
- Create: `assets/emojis/svg/dw_dino_epic.svg`
- Create: `assets/emojis/svg/dw_dino_legendary.svg`
- Create: `assets/emojis/svg/dw_dino_mythic.svg`
- Create: `assets/emojis/png/dw_dino_*.png` (6, written by `npm run build-emojis`)
- Modify: `src/core/emojis.ts:7-18`
- Test: `tests/emojis.test.ts:37-46`, `tests/emoji-assets.test.ts:100-105`, `tests/emoji-assets.test.ts:116-120`

**Interfaces:**
- Consumes: nothing from earlier waves.
- Produces: six committed SVG basenames `dw_dino_common` … `dw_dino_mythic` under `assets/emojis/svg/`, and six new `EMOJI_FALLBACK` keys of the same names (`dw_dino_common|uncommon|rare|epic` → `'🦕'`, `dw_dino_legendary|mythic` → `'🦖'`). Task 14's `loadParkArt` reads these exact filenames.

- [ ] **Step 1: Write the failing test**

Replace the 27-name assertion in `tests/emojis.test.ts:37-46` with the 33-name one:

```ts
  it('fallback table covers exactly the 33 spec names', () => {
    expect(Object.keys(EMOJI_FALLBACK).sort()).toEqual([
      'dw_alert', 'dw_cash',
      'dw_dino_common', 'dw_dino_epic', 'dw_dino_legendary', 'dw_dino_mythic', 'dw_dino_rare', 'dw_dino_uncommon',
      'dw_ferns', 'dw_fish', 'dw_food', 'dw_fruit_basket', 'dw_goat', 'dw_hunger',
      'dw_lot_carnivore', 'dw_lot_food_court', 'dw_lot_hatchery', 'dw_lot_herbivore', 'dw_lot_visitor',
      'dw_prime_steak',
      'dw_rarity_common', 'dw_rarity_epic', 'dw_rarity_legendary', 'dw_rarity_mythic', 'dw_rarity_rare', 'dw_rarity_uncommon',
      'dw_royal_greens', 'dw_shard', 'dw_site_amber_ridge', 'dw_site_coastal_dig', 'dw_site_frozen_cliffs', 'dw_site_volcano_core',
      'dw_star',
    ]);
  });
```

Retitle the stale parity test in `tests/emoji-assets.test.ts:101` (`'svg files exactly match the 21 fallback-table names'` → `'svg files exactly match the 33 fallback-table names'`), and add a name-parity case after the `dw_rarity_*` block at `tests/emoji-assets.test.ts:116-120`:

```ts
  // The park renderer draws these chips from their SVG source (loadParkArt), so a missing file is a
  // silently degraded park tile rather than a crash — this is the only thing that fails loudly.
  it('every rarity has a dw_dino_* SVG', () => {
    for (const r of Object.keys(RARITY)) {
      expect(svgNames, `missing SVG dw_dino_${r}`).toContain(`dw_dino_${r}`);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/emojis.test.ts tests/emoji-assets.test.ts -t "spec names"`
Expected: FAIL with `AssertionError: expected [ 'dw_alert', 'dw_cash', …27 items ] to deeply equal [ 'dw_alert', 'dw_cash', 'dw_dino_common', …33 items ]`

- [ ] **Step 3: Write the implementation**

`assets/emojis/svg/dw_dino_common.svg` (sauropod silhouette; gradient stays on the `<rect>` — `<ellipse fill="url(#g)">` renders solid black under resvg, and every silhouette is `#2b1d10`, never `#000000`, to stay under `MAX_BLACK_SHARE`):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9ced3"/><stop offset="1" stop-color="#7d838a"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#41464c" stroke-width="3"/>
  <path d="M19 40 Q13 36 12 29" fill="none" stroke="#2b1d10" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="30" cy="40" rx="13" ry="7" fill="#2b1d10"/>
  <path d="M36 37 Q44 33 45 23" fill="none" stroke="#2b1d10" stroke-width="5" stroke-linecap="round"/>
  <circle cx="46" cy="21" r="4" fill="#2b1d10"/>
  <rect x="23" y="45" width="5" height="8" rx="2" fill="#2b1d10"/>
  <rect x="33" y="45" width="5" height="8" rx="2" fill="#2b1d10"/>
  <ellipse cx="21" cy="13" rx="10" ry="4" fill="#ffffff" opacity="0.3" transform="rotate(-12 21 13)"/>
</svg>
```

`assets/emojis/svg/dw_dino_uncommon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd992"/><stop offset="1" stop-color="#3d8f40"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#1e4a20" stroke-width="3"/>
  <path d="M19 40 Q13 36 12 29" fill="none" stroke="#2b1d10" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="30" cy="40" rx="13" ry="7" fill="#2b1d10"/>
  <path d="M36 37 Q44 33 45 23" fill="none" stroke="#2b1d10" stroke-width="5" stroke-linecap="round"/>
  <circle cx="46" cy="21" r="4" fill="#2b1d10"/>
  <rect x="23" y="45" width="5" height="8" rx="2" fill="#2b1d10"/>
  <rect x="33" y="45" width="5" height="8" rx="2" fill="#2b1d10"/>
  <ellipse cx="21" cy="13" rx="10" ry="4" fill="#ffffff" opacity="0.3" transform="rotate(-12 21 13)"/>
</svg>
```

`assets/emojis/svg/dw_dino_rare.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec4f0"/><stop offset="1" stop-color="#2b6cb0"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#173a5e" stroke-width="3"/>
  <path d="M19 40 Q13 36 12 29" fill="none" stroke="#2b1d10" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="30" cy="40" rx="13" ry="7" fill="#2b1d10"/>
  <path d="M36 37 Q44 33 45 23" fill="none" stroke="#2b1d10" stroke-width="5" stroke-linecap="round"/>
  <circle cx="46" cy="21" r="4" fill="#2b1d10"/>
  <rect x="23" y="45" width="5" height="8" rx="2" fill="#2b1d10"/>
  <rect x="33" y="45" width="5" height="8" rx="2" fill="#2b1d10"/>
  <ellipse cx="21" cy="13" rx="10" ry="4" fill="#ffffff" opacity="0.3" transform="rotate(-12 21 13)"/>
</svg>
```

`assets/emojis/svg/dw_dino_epic.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c393e8"/><stop offset="1" stop-color="#7238a8"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#3d1a5e" stroke-width="3"/>
  <path d="M19 40 Q13 36 12 29" fill="none" stroke="#2b1d10" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="30" cy="40" rx="13" ry="7" fill="#2b1d10"/>
  <path d="M36 37 Q44 33 45 23" fill="none" stroke="#2b1d10" stroke-width="5" stroke-linecap="round"/>
  <circle cx="46" cy="21" r="4" fill="#2b1d10"/>
  <rect x="23" y="45" width="5" height="8" rx="2" fill="#2b1d10"/>
  <rect x="33" y="45" width="5" height="8" rx="2" fill="#2b1d10"/>
  <ellipse cx="21" cy="13" rx="10" ry="4" fill="#ffffff" opacity="0.3" transform="rotate(-12 21 13)"/>
</svg>
```

`assets/emojis/svg/dw_dino_legendary.svg` (theropod silhouette, mirroring `dinoGlyph`'s apex split):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5c46a"/><stop offset="1" stop-color="#b06f14"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#6b430a" stroke-width="3"/>
  <path d="M19 35 Q13 31 12 24" fill="none" stroke="#2b1d10" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="30" cy="36" rx="12" ry="8" fill="#2b1d10"/>
  <path d="M36 31 Q40 26 44 25" fill="none" stroke="#2b1d10" stroke-width="6" stroke-linecap="round"/>
  <polygon points="41 21 53 22 53 29 42 30" fill="#2b1d10"/>
  <rect x="24" y="42" width="5" height="10" rx="2" fill="#2b1d10"/>
  <rect x="34" y="42" width="5" height="10" rx="2" fill="#2b1d10"/>
  <ellipse cx="21" cy="13" rx="10" ry="4" fill="#ffffff" opacity="0.3" transform="rotate(-12 21 13)"/>
</svg>
```

`assets/emojis/svg/dw_dino_mythic.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eda2f2"/><stop offset="1" stop-color="#a127a8"/></linearGradient></defs>
  <rect x="5" y="5" width="54" height="54" rx="14" fill="url(#g)" stroke="#5e1462" stroke-width="3"/>
  <path d="M19 35 Q13 31 12 24" fill="none" stroke="#2b1d10" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="30" cy="36" rx="12" ry="8" fill="#2b1d10"/>
  <path d="M36 31 Q40 26 44 25" fill="none" stroke="#2b1d10" stroke-width="6" stroke-linecap="round"/>
  <polygon points="41 21 53 22 53 29 42 30" fill="#2b1d10"/>
  <rect x="24" y="42" width="5" height="10" rx="2" fill="#2b1d10"/>
  <rect x="34" y="42" width="5" height="10" rx="2" fill="#2b1d10"/>
  <ellipse cx="21" cy="13" rx="10" ry="4" fill="#ffffff" opacity="0.3" transform="rotate(-12 21 13)"/>
</svg>
```

`src/core/emojis.ts:7-18` — add the six fallbacks (the park renderer reads the SVGs directly, so these exist for text embeds and the app-emoji deploy only; never build a module-level `emojiTag` constant from them, never put them in an autocomplete label, and never pass them to `ButtonBuilder.setEmoji`):

```ts
export const EMOJI_FALLBACK: Record<string, string> = {
  dw_cash: '💰', dw_food: '🍖', dw_shard: '💎',
  dw_rarity_common: '', dw_rarity_uncommon: '', dw_rarity_rare: '',
  dw_rarity_epic: '', dw_rarity_legendary: '', dw_rarity_mythic: '',
  dw_star: '⭐', dw_alert: '🚨', dw_hunger: '⚠',
  dw_site_volcano_core: '🌋', dw_site_coastal_dig: '🐚',
  dw_site_amber_ridge: '🟠', dw_site_frozen_cliffs: '❄️',
  dw_lot_carnivore: '🦖', dw_lot_herbivore: '🦕', dw_lot_food_court: '🍔',
  dw_lot_hatchery: '🥚', dw_lot_visitor: '🏛️',
  dw_dino_common: '🦕', dw_dino_uncommon: '🦕', dw_dino_rare: '🦕',
  dw_dino_epic: '🦕', dw_dino_legendary: '🦖', dw_dino_mythic: '🦖',
  dw_ferns: '🌿', dw_fruit_basket: '🍎', dw_royal_greens: '🥬',
  dw_fish: '🐟', dw_goat: '🍖', dw_prime_steak: '🥩',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build-emojis && npx vitest run tests/emojis.test.ts tests/emoji-assets.test.ts`
Expected: PASS (39 `it.each` PNG-sibling cases now, including the six new chips, each under `MAX_BLACK_SHARE` with transparent corners)

- [ ] **Step 5: Commit**

```bash
git add assets/emojis/svg/dw_dino_common.svg assets/emojis/svg/dw_dino_uncommon.svg assets/emojis/svg/dw_dino_rare.svg assets/emojis/svg/dw_dino_epic.svg assets/emojis/svg/dw_dino_legendary.svg assets/emojis/svg/dw_dino_mythic.svg
git add assets/emojis/png/dw_dino_common.png assets/emojis/png/dw_dino_uncommon.png assets/emojis/png/dw_dino_rare.png assets/emojis/png/dw_dino_epic.png assets/emojis/png/dw_dino_legendary.png assets/emojis/png/dw_dino_mythic.png
git add src/core/emojis.ts tests/emojis.test.ts tests/emoji-assets.test.ts
# build-emojis rewrites every PNG; discard byte churn on the 27 pre-existing ones
git checkout -- assets/emojis/png
git commit -m "feat(emojis): add six rarity dino chip icons"
```

---

### Task 14: Park art loader (`src/core/render/art.ts`)

**Files:**
- Create: `src/core/render/art.ts`
- Test: `tests/render-art.test.ts`

**Interfaces:**
- Consumes: `assets/emojis/svg/dw_dino_<rarity>.svg` (Task 13); the five pre-existing `assets/emojis/svg/dw_lot_*.svg`; `RARITY` from `src/data/rarity.ts`; `Rarity` from `src/data/types.ts`.
- Produces: `interface ParkArt { ground: Image | null; platePaddock: Image | null; plateFacility: Image | null; lotIcons: Record<string, Image | null>; dinoChips: Record<Rarity, Image | null> }`, `const EMPTY_ART: ParkArt`, `function loadParkArt(): Promise<ParkArt>`, `function loadSvgImage(absPath: string): Image | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EMPTY_ART, loadParkArt, loadSvgImage } from '../src/core/render/art.js';
import { RARITY } from '../src/data/rarity.js';
import type { Rarity } from '../src/data/types.js';

describe('EMPTY_ART', () => {
  it('is exhaustive over every rarity with all-null entries', () => {
    expect(EMPTY_ART.ground).toBeNull();
    expect(EMPTY_ART.platePaddock).toBeNull();
    expect(EMPTY_ART.plateFacility).toBeNull();
    expect(EMPTY_ART.lotIcons).toEqual({});
    // `Record<Rarity, …>` is only honest if every key is actually present: a `{}` cast would let a
    // future rarity read back `undefined` and hit `drawImage(undefined)`, which throws inside the
    // render and costs that user the whole park image.
    for (const r of Object.keys(RARITY) as Rarity[]) {
      expect(Object.hasOwn(EMPTY_ART.dinoChips, r), `dinoChips missing key ${r}`).toBe(true);
      expect(EMPTY_ART.dinoChips[r]).toBeNull();
    }
  });
});

describe('loadSvgImage', () => {
  it('decodes a committed SVG with no await, and returns null for a missing file', () => {
    const img = loadSvgImage(resolve(process.cwd(), 'assets/emojis/svg/dw_cash.svg'));
    expect(img).not.toBeNull();
    expect(img!.width).toBeGreaterThan(0);
    expect(loadSvgImage(resolve(process.cwd(), 'assets/emojis/svg/dw_not_a_real_icon.svg'))).toBeNull();
  });
});

describe('loadParkArt', () => {
  it('loads every lot icon and dino chip, and leaves unknown lot kinds unmapped', async () => {
    const art = await loadParkArt();
    for (const kind of ['carnivore_paddock', 'herbivore_paddock', 'food_court', 'hatchery_lab', 'visitor_center']) {
      expect(art.lotIcons[kind], `no icon loaded for lot kind ${kind}`).not.toBeNull();
      expect(art.lotIcons[kind]!.width).toBeGreaterThan(0);
    }
    // hatchery_lab -> dw_lot_hatchery and visitor_center -> dw_lot_visitor defeat any prefix rule,
    // so the mapping is explicit; a kind with no entry must read back undefined and fall through to
    // lotIcon()'s 🏢/🌿 glyph rather than resolving to some near-miss file.
    expect(art.lotIcons['not_a_real_kind']).toBeUndefined();
    for (const r of Object.keys(RARITY) as Rarity[]) {
      expect(art.dinoChips[r], `no dino chip loaded for ${r}`).not.toBeNull();
    }
  });

  it('resolves with all-null art instead of rejecting when nothing is on disk', async () => {
    // Every read is relative to process.cwd(), so an empty temp cwd reproduces a deploy that shipped
    // without assets/. Rejection is the failure mode that matters: worker.ts top-level-awaits this,
    // and a rejected module boot fires client.ts's 'error' handler, which terminates and nulls the
    // worker — every later /park view silently loses its image and respawns another doomed worker.
    // (vitest's default `forks` pool runs this file in a child process, where process.chdir exists.)
    const cwd = process.cwd();
    process.chdir(mkdtempSync(join(tmpdir(), 'dw-park-art-')));
    try {
      const art = await loadParkArt();
      expect(art.ground).toBeNull();
      expect(art.platePaddock).toBeNull();
      expect(art.plateFacility).toBeNull();
      expect(art.lotIcons['carnivore_paddock']).toBeNull();
      expect(art.dinoChips.mythic).toBeNull();
    } finally {
      process.chdir(cwd);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render-art.test.ts`
Expected: FAIL with `Error: Failed to resolve import "../src/core/render/art.js" from "tests/render-art.test.ts". Does the file exist?`

- [ ] **Step 3: Write the implementation**

```ts
import { Image } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RARITY } from '../../data/rarity.js';
import type { Rarity } from '../../data/types.js';

export interface ParkArt {
  ground: Image | null;
  platePaddock: Image | null;
  plateFacility: Image | null;
  lotIcons: Record<string, Image | null>;
  dinoChips: Record<Rarity, Image | null>;
}

// Lot kind -> SVG basename. Not mechanical: hatchery_lab -> dw_lot_hatchery and
// visitor_center -> dw_lot_visitor defeat any prefix/suffix rule. Kinds absent
// here stay unmapped on purpose, so drawTile falls back to lotIcon()'s glyph.
const LOT_ICON_SVG: Record<string, string> = {
  carnivore_paddock: 'dw_lot_carnivore',
  herbivore_paddock: 'dw_lot_herbivore',
  food_court: 'dw_lot_food_court',
  hatchery_lab: 'dw_lot_hatchery',
  visitor_center: 'dw_lot_visitor',
};

function nullChips(): Record<Rarity, Image | null> {
  return { common: null, uncommon: null, rare: null, epic: null, legendary: null, mythic: null };
}

export const EMPTY_ART: ParkArt = {
  ground: null, platePaddock: null, plateFacility: null,
  lotIcons: {}, dinoChips: nullChips(),
};

// SVG only. @napi-rs/canvas decodes SVG buffers synchronously, so there is nothing to await — which
// is what lets the synchronous renderer draw these. A PNG through this path would silently draw a
// blank rectangle with no error (see CLAUDE.md); use loadPngImage for rasters.
export function loadSvgImage(absPath: string): Image | null {
  try {
    const img = new Image();
    img.src = readFileSync(absPath);
    return img;
  } catch { return null; }
}

async function loadPngImage(absPath: string): Promise<Image | null> {
  try {
    const img = new Image();
    img.src = readFileSync(absPath);
    await img.decode();
    return img;
  } catch { return null; }
}

// Never rejects: each read has its own catch so one missing file cannot sink its siblings, and the
// whole call is the worker's top-level await — a rejection there permanently costs /park view its
// image (client.ts terminates and nulls the worker, then respawns another doomed one).
export async function loadParkArt(): Promise<ParkArt> {
  const png = (name: string) => loadPngImage(resolve(process.cwd(), 'assets/images/park', name));
  const svg = (name: string) => loadSvgImage(resolve(process.cwd(), 'assets/emojis/svg', `${name}.svg`));

  const [ground, platePaddock, plateFacility] = await Promise.all([
    png('ground.png'), png('plate-paddock.png'), png('plate-facility.png'),
  ]);

  const lotIcons: Record<string, Image | null> = {};
  for (const [kind, file] of Object.entries(LOT_ICON_SVG)) lotIcons[kind] = svg(file);

  const dinoChips = nullChips();
  for (const r of Object.keys(RARITY) as Rarity[]) dinoChips[r] = svg(`dw_dino_${r}`);

  return { ground, platePaddock, plateFacility, lotIcons, dinoChips };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render-art.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/render/art.ts tests/render-art.test.ts
git commit -m "feat(render): load park art with null-degrading decoders"
```

---

### Task 15: Draw park art in `draw.ts`

**Files:**
- Modify: `src/core/render/draw.ts:1-5`, `src/core/render/draw.ts:78-104`, `src/core/render/draw.ts:113-143`
- Test: `tests/render-draw.test.ts`

**Interfaces:**
- Consumes: `EMPTY_ART`, `type ParkArt` from `src/core/render/art.js` (Task 14).
- Produces: `export function renderParkPng(snap: ParkSnapshot, art: ParkArt = EMPTY_ART): Buffer` — still synchronous, still byte-identical to today when `art` is all-null. `protocol.ts`'s `render` default parameter keeps working unchanged.

- [ ] **Step 1: Write the failing test**

Add the import to `tests/render-draw.test.ts:1-4` and append the block below to the existing `describe('renderParkPng', …)`:

```ts
import { EMPTY_ART, type ParkArt } from '../src/core/render/art.js';

  // Stub art is built from tiny SVG buffers, not PNGs: SVG decodes synchronously in @napi-rs/canvas,
  // so a stub can feed the synchronous renderer with no await, while a PNG stub would draw blank and
  // this test would "pass" for the wrong reason. Each slot gets a pure unmistakable hue so a sampled
  // pixel names exactly which art slot drew it — the same reasoning as the coin test above: a loose
  // color threshold cannot distinguish drawn art from the emoji glyph it is supposed to have replaced.
  function svgStub(color: string, w: number, h: number): Image {
    const img = new Image();
    img.src = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="${color}"/></svg>`,
    );
    return img;
  }

  const stubArt: ParkArt = {
    ground: svgStub('#0000ff', 120, 80),
    platePaddock: svgStub('#ff00ff', 270, 150),
    plateFacility: svgStub('#ff8800', 270, 150),
    lotIcons: { carnivore_paddock: svgStub('#00ffff', 64, 64), hatchery_lab: svgStub('#00ffff', 64, 64) },
    dinoChips: { common: null, uncommon: null, rare: null, epic: null, legendary: svgStub('#ffff00', 64, 64), mythic: null },
  };

  async function sampler(png: Buffer): Promise<(x: number, y: number) => number[]> {
    const img = new Image();
    img.src = png;
    await img.decode();          // PNG decode is async — skipping this yields a blank canvas
    const canvas = createCanvas(img.width, img.height);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    return (x, y) => Array.from(c.getImageData(x, y, 1, 1).data).slice(0, 3);
  }

  // The fallback pin. Asserted in-process rather than against a committed golden hash: the output is
  // byte-deterministic within and across processes, but a hash would break on any @napi-rs/canvas or
  // Noto font bump that has nothing to do with this change.
  it('an all-null ParkArt renders byte-for-byte what the no-art call renders', () => {
    expect(renderParkPng(sample, EMPTY_ART).equals(renderParkPng(sample))).toBe(true);
  });

  it('draws ground, both plates, the lot icon and the dino chip in place of the flat fills and glyphs', async () => {
    // Coordinates derive from draw.ts's own constants: tile 0 sits at (PAD, HEADER_H + PAD) = (20, 84),
    // TILE_W/TILE_H = 270×150, GAP = 16 so tile 1 starts at x = 306. The lot icon box is
    // (x+14, y+42-30+3) 30², and the first dino chip box is (x+16, y+100-28+3) 28².
    const at = await sampler(renderParkPng(sample, stubArt));
    expect(at(10, 240)).toEqual([0, 0, 255]);      // ground, in the left margin below the header
    expect(at(10, 10)).toEqual([35, 74, 30]);      // header bar (#234a1e) still painted over the ground
    expect(at(260, 210)).toEqual([255, 0, 255]);   // paddock plate, clear of icon, text, dinos and decor
    expect(at(546, 210)).toEqual([255, 136, 0]);   // facility plate on tile 1
    expect(at(49, 114)).toEqual([0, 255, 255]);    // lot icon replaced the 🦖 glyph run
    expect(at(50, 173)).toEqual([255, 255, 0]);    // legendary dino chip replaced the 🦖 glyph run
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render-draw.test.ts -t "draws ground, both plates"`
Expected: FAIL with `AssertionError: expected [ 53, 107, 44 ] to deeply equal [ 0, 0, 255 ]` (the second argument is ignored, so the flat `#356b2c` grass is still drawn)

- [ ] **Step 3: Write the implementation**

`src/core/render/draw.ts:1-5` — add the art import:

```ts
import { createCanvas, GlobalFonts, Image, type SKRSContext2D } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { ParkSnapshot, SnapshotLot } from '../../modules/park/snapshot.js';
import { lotIcon, tilePalette, dinoGlyph, RARITY_COLOR } from '../../data/render-icons.js';
import { EMPTY_ART, type ParkArt } from './art.js';
```

Replace `drawTile` (`src/core/render/draw.ts:78-104`) and add `drawGround` above it:

```ts
// Cover-scale, never tile: the canvas height grows with the row count, so the backdrop is scaled to
// cover and center-cropped on every render. A null ground keeps the original flat grass fill.
function drawGround(c: SKRSContext2D, img: Image | null, w: number, h: number): void {
  if (!img) { c.fillStyle = '#356b2c'; c.fillRect(0, 0, w, h); return; }
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawTile(c: SKRSContext2D, lot: SnapshotLot, x: number, y: number, art: ParkArt): void {
  const pal = tilePalette(lot.type);
  const plate = lot.type === 'facility' ? art.plateFacility : art.platePaddock;
  if (plate) {
    // Plates are authored at exactly TILE_W×TILE_H, so they draw 1:1 — clipped to the same rounded
    // rect the flat fill uses, because an opaque rectangular raster would otherwise square off the
    // corners. save/restore is mandatory: clip() mutates canvas state for every later draw.
    c.save();
    rrect(c, x, y, TILE_W, TILE_H, 12); c.clip();
    c.drawImage(plate, x, y, TILE_W, TILE_H);
    c.restore();
  } else {
    rrect(c, x, y, TILE_W, TILE_H, 12); c.fillStyle = pal.fill; c.fill();
    c.lineWidth = 3; c.strokeStyle = pal.border; rrect(c, x, y, TILE_W, TILE_H, 12); c.stroke();
  }

  // Icons draw on the same baseline convention as iconImageValue (`y - size + 3`), so swapping art in
  // does not shift the text beside it. Never call drawImage with a null Image — it throws, and a throw
  // here becomes { ok: false } from handleRenderRequest, costing the user the whole park image.
  const icon = art.lotIcons[lot.kind];
  if (icon) c.drawImage(icon, x + 14, y + 42 - 30 + 3, 30, 30);
  else { c.font = `30px "${EMOJI}"`; c.fillText(lotIcon(lot.type, lot.kind), x + 14, y + 42); }

  c.fillStyle = pal.text;
  c.font = `18px "${SANS}"`; c.fillText(trunc(c, lot.name, TILE_W - 72), x + 54, y + 34);
  c.font = `13px "${SANS}"`; c.fillText(`Lv ${lot.level}`, x + 54, y + 54);

  let dx = x + 16; const dy = y + 100;
  for (const d of lot.dinos.slice(0, 6)) {
    const chip = art.dinoChips[d.rarity];
    if (chip) c.drawImage(chip, dx, dy - 28 + 3, 28, 28);
    else { c.font = `28px "${EMOJI}"`; c.fillText(dinoGlyph(d.rarity), dx, dy); }
    c.fillStyle = RARITY_COLOR[d.rarity];
    c.beginPath(); c.arc(dx + 14, dy + 10, 4, 0, Math.PI * 2); c.fill();
    dx += 34;
  }
  if (lot.dinos.length > 6) {
    c.font = `14px "${SANS}"`; c.fillStyle = pal.text; c.fillText(`+${lot.dinos.length - 6}`, dx, dy);
  }
  if (lot.dinos.some((d) => d.escaped)) {
    c.font = `20px "${EMOJI}"`; c.fillText('🚨', x + TILE_W - 34, y + 34);
  }
  for (let k = 0; k < Math.min(lot.decorCount, 5); k++) {
    c.fillStyle = '#2f6b2a'; c.beginPath(); c.arc(x + 18 + k * 12, y + TILE_H - 14, 4, 0, Math.PI * 2); c.fill();
  }
}
```

Replace the signature, the background fill and the tile call in `renderParkPng` (`src/core/render/draw.ts:113`, `:121`, `:136`):

```ts
export function renderParkPng(snap: ParkSnapshot, art: ParkArt = EMPTY_ART): Buffer {
  ensureFonts();
  const hasBuild = snap.lots.length < snap.lotCap;
  const cellCount = snap.lots.length + (hasBuild ? 1 : 0);
  const dims = gridDims(cellCount);
  const canvas = createCanvas(dims.width, dims.height);
  const c = canvas.getContext('2d');

  drawGround(c, art.ground, dims.width, dims.height);                          // grass or ground art
  c.fillStyle = '#234a1e'; c.fillRect(0, 0, dims.width, HEADER_H);             // header bar, always over the ground

  c.fillStyle = '#ffffff';
  c.font = `24px "${SANS}"`; c.fillText(trunc(c, snap.parkName, dims.width * 0.42), PAD, 40);
  let sx = dims.width * 0.46;
  sx = iconValue(c, sx, 40, '⭐', (snap.parkRating / 100).toFixed(1), 22) + 18;
  const cashIcon = hudCashIcon();
  sx = (cashIcon
    ? iconImageValue(c, sx, 40, cashIcon, snap.cash.toLocaleString(), 22)
    : iconValue(c, sx, 40, '💰', snap.cash.toLocaleString(), 22)) + 18;
  iconValue(c, sx, 40, '🦕', dinoStatText(snap.dinoCount, snap.escapedCount), 22);

  for (let idx = 0; idx < snap.lots.length; idx++) {
    const col = idx % COLS, row = Math.floor(idx / COLS);
    drawTile(c, snap.lots[idx], PAD + col * (TILE_W + GAP), HEADER_H + PAD + row * (TILE_H + GAP), art);
  }
  if (hasBuild) {
    const idx = snap.lots.length, col = idx % COLS, row = Math.floor(idx / COLS);
    drawBuildSlot(c, PAD + col * (TILE_W + GAP), HEADER_H + PAD + row * (TILE_H + GAP));
  }
  return canvas.toBuffer('image/png');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render-draw.test.ts tests/render-worker.test.ts tests/render-icons.test.ts`
Expected: PASS (including the pre-existing single-argument `renderParkPng(sample)` cases and the coin-artwork HUD test)

- [ ] **Step 5: Commit**

```bash
git add src/core/render/draw.ts tests/render-draw.test.ts
git commit -m "feat(render): draw park ground, plates, lot icons and dino chips"
```

---

### Task 16: Worker preloads the park art

**Files:**
- Modify: `src/core/render/worker.ts:1-9`
- Test: `tests/render-worker.test.ts`

**Interfaces:**
- Consumes: `loadParkArt`, `EMPTY_ART` (Task 14); `renderParkPng(snap, art)` (Task 15); `handleRenderRequest(req, render)` from `src/core/render/protocol.js` (unchanged — do NOT add `art` to `RenderRequest`; a canvas `Image` is not structured-cloneable and art never crosses `postMessage`).
- Produces: no exports — the worker entry now boots with `const art = await loadParkArt().catch(() => EMPTY_ART);` and renders through `(snap) => renderParkPng(snap, art)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/render-worker.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainThread } from 'node:worker_threads';

describe('worker entry', () => {
  // Vitest's default `forks` pool runs each test file in a child PROCESS, where `parentPort` is null,
  // so importing the worker entry registers no listener — it only executes the module's top-level
  // await. Under a `threads` pool that would not hold (the import would hijack vitest's own message
  // port), so the boot pin is skipped there rather than corrupting the run.
  it.skipIf(!isMainThread)('boots: its top-level art preload resolves and never rejects', async () => {
    await expect(import('../src/core/render/worker.js')).resolves.toBeDefined();
  });

  // A booted module alone does not prove the art is used, and the wiring cannot be observed from the
  // main thread (the entry exports nothing and only reacts to a real MessagePort). These two source
  // assertions pin the parts with the worst failure modes: a preload without `.catch` turns one bad
  // asset into a permanently image-less /park view, and a render call without `art` silently renders
  // the flat fallback forever while every other test stays green.
  it('preloads the art with a never-reject guard and passes it into every render', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/core/render/worker.ts'), 'utf8');
    expect(src).toMatch(/await\s+loadParkArt\(\)\.catch\(/);
    expect(src).toMatch(/renderParkPng\(\s*\w+\s*,\s*art\s*\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render-worker.test.ts -t "preloads the art"`
Expected: FAIL with `AssertionError: expected "import { parentPort } from 'node:worker_threads';…" to match /await\s+loadParkArt\(\)\.catch\(/`

- [ ] **Step 3: Write the implementation**

```ts
import { parentPort } from 'node:worker_threads';
import { handleRenderRequest, type RenderRequest } from './protocol.js';
import { renderParkPng } from './draw.js';
import { EMPTY_ART, loadParkArt } from './art.js';

// Preloaded once, before the first message is handled. Two rules are load-bearing here:
// 1. This must never reject. A rejected top-level await surfaces as the worker's 'error' event, and
//    client.ts terminates + nulls the worker on that — so every later render respawns a worker that
//    dies the same way and /park view silently degrades to a text-only embed forever. loadParkArt
//    already catches per asset; the .catch here is belt and braces.
// 2. Art stays worker-side. It never rides on a RenderRequest — a canvas Image is not
//    structured-cloneable, and decoding it once per render would defeat the preload anyway.
// Messages posted before this resolves are buffered by the MessagePort and delivered once the
// listener attaches, so the await costs the first render latency, never a lost request.
const art = await loadParkArt().catch(() => EMPTY_ART);

// One message in, one message out. The id lets the client ignore replies for a
// request it already abandoned (e.g. after a timeout), so a stale reply can never
// resolve a newer request on the reused worker.
parentPort?.on('message', (req: RenderRequest) => {
  parentPort!.postMessage(handleRenderRequest(req, (snap) => renderParkPng(snap, art)));
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/render-worker.test.ts tests/render-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/render/worker.ts tests/render-worker.test.ts
git commit -m "feat(render): preload park art in the render worker"
```

---

### Task 17: Generate the three park rasters

**Files:**
- Create: `assets/images/park/ground.png`
- Create: `assets/images/park/plate-paddock.png`
- Create: `assets/images/park/plate-facility.png`
- Modify: `docs/assets/prompts.md:27-33` (File targets), new `## Park map` section
- Test: `tests/park-art-assets.test.ts`

**Interfaces:**
- Consumes: `loadParkArt`'s hardcoded filenames `assets/images/park/{ground,plate-paddock,plate-facility}.png` (Task 14).
- Produces: the three committed rasters. Park art is deliberately NOT routed through `assetImage` — it is decoded into canvas `Image`s and never leaves the renderer.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Image } from '@napi-rs/canvas';

const PARK_DIR = resolve(process.cwd(), 'assets/images/park');

// PNG decode is async in @napi-rs/canvas: an un-awaited decode reports the right width/height while
// the pixels are still blank, so dimension checks alone would pass on a truncated download.
async function decodePng(png: Buffer): Promise<Image> {
  const i = new Image();
  i.src = png;
  await i.decode();
  return i;
}

describe('park map art', () => {
  it('ground.png decodes and is wider than tall (it is cover-scaled to the canvas, never tiled)', async () => {
    const img = await decodePng(readFileSync(resolve(PARK_DIR, 'ground.png')));
    expect(img.width).toBeGreaterThan(0);
    expect(img.width / img.height).toBeGreaterThan(1);
  });

  // Plates draw 1:1 at TILE_W×TILE_H (draw.ts). Committing them at exactly that size is what keeps a
  // square generation from being silently squashed to 1.8:1 in the tile — the one plate defect that
  // renders "successfully" and looks wrong.
  it.each(['plate-paddock.png', 'plate-facility.png'])('%s decodes at the 270×150 tile size', async (f) => {
    const img = await decodePng(readFileSync(resolve(PARK_DIR, f)));
    expect(img.width).toBe(270);
    expect(img.height).toBe(150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/park-art-assets.test.ts`
Expected: FAIL with `Error: ENOENT: no such file or directory, open '…\assets\images\park\ground.png'`

- [ ] **Step 3: Write the implementation**

First append this section to `docs/assets/prompts.md` (before `## Emoji icons`), and add the three rows to the File targets table at `docs/assets/prompts.md:29-32`:

```markdown
| `assets/images/park/ground.png` | 1200×800 (3:2) | `/park view` canvas backdrop, cover-scaled |
| `assets/images/park/plate-paddock.png` | 270×150 | `/park view` paddock tile plate |
| `assets/images/park/plate-facility.png` | 270×150 | `/park view` facility tile plate |

## Park map

Three opaque rasters drawn by the park renderer (`src/core/render/draw.ts`)
through `loadParkArt` (`src/core/render/art.ts`) — never through `assetImage`,
which returns Discord attachments; these are decoded into canvas `Image`s and
never leave the renderer. All three are optional: a missing or undecodable file
degrades that one element back to the flat fill it replaced.

**Workflow (reference chain):** generate the ground first at 3:2. Generate the
paddock plate as an image-edit of the approved ground so the two materials share
a light direction, then the facility plate as an image-edit of the approved
paddock plate so the two plates match shape for shape. No background removal —
these are opaque. Post-process each with a cover-crop fit to the size in the
File targets table.

**park/ground** — deliberately not a seamless tile: diffusion models do not
reliably close tile edges, and a single cover-scaled backdrop has no seams to
close.

> A top-down view of lush jungle-park ground filling the whole frame: mown
> green grass with subtle mowing bands, a few scattered fern fronds and small
> pebbles, faint dirt patches worn into the turf, no single focal point and
> nothing large enough to dominate the frame. Even flat lighting, no strong
> cast shadows. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

**park/plate-paddock** (generated with the ground attached as the `image`
reference):

> A single rectangular game-UI plate for a dinosaur paddock: a warm sandy-tan
> dirt enclosure floor framed by a rough-hewn wooden fence border on all four
> sides, corner posts, a calm untextured center area with no detail so text
> can sit on it legibly. Even flat lighting, no cast shadows. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, clean
> cel shading with smooth gradients, polished game-asset look. No text, no
> characters, no UI elements.

**park/plate-facility** (generated with the paddock plate attached as the
`image` reference):

> Keep the exact same rectangular plate shape, same size, same border
> thickness, same calm untextured center area, same flat lighting. Change the
> material to a cool blue-gray steel and glass facility floor with riveted
> metal edging instead of wood. Glossy cartoon mobile-game art style, bold
> dark outlines, vibrant saturated colors, clean cel shading with smooth
> gradients, polished game-asset look. No text, no characters, no UI elements.
```

Then generate, in this order (each call is `mcp__claude_ai_Higgsfield__generate_image`; poll with `mcp__claude_ai_Higgsfield__job_status` using `sync: true` and keep each returned `jobId`, which is what the next call passes as its `medias[].value`):

1. Ground — `params: { "model": "nano_banana_pro", "aspect_ratio": "3:2", "prompt": "A top-down view of lush jungle-park ground filling the whole frame: mown green grass with subtle mowing bands, a few scattered fern fronds and small pebbles, faint dirt patches worn into the turf, no single focal point and nothing large enough to dominate the frame. Even flat lighting, no strong cast shadows. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements." }`
2. Paddock plate — `params: { "model": "nano_banana_pro", "aspect_ratio": "16:9", "medias": [{ "role": "image", "value": "<ground jobId>" }], "prompt": "A single rectangular game-UI plate for a dinosaur paddock: a warm sandy-tan dirt enclosure floor framed by a rough-hewn wooden fence border on all four sides, corner posts, a calm untextured center area with no detail so text can sit on it legibly. Even flat lighting, no cast shadows. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements." }`
3. Facility plate — `params: { "model": "nano_banana_pro", "aspect_ratio": "16:9", "medias": [{ "role": "image", "value": "<paddock plate jobId>" }], "prompt": "Keep the exact same rectangular plate shape, same size, same border thickness, same calm untextured center area, same flat lighting. Change the material to a cool blue-gray steel and glass facility floor with riveted metal edging instead of wood. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements." }`

No `remove_background` / defringe pass: all three are opaque backdrops, not cutouts.

Write the cover-crop fit script to the scratchpad as `fit-park-art.ts`:

```ts
import { createCanvas, Image } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';

// Cover-crop a downloaded generation to an exact size. PNG decode is asynchronous in
// @napi-rs/canvas: drawing without the await writes a fully blank file, with no error.
async function fit(src: string, dst: string, w: number, h: number): Promise<void> {
  const img = new Image();
  img.src = readFileSync(src);
  await img.decode();
  const canvas = createCanvas(w, h);
  const c = canvas.getContext('2d');
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  writeFileSync(dst, canvas.toBuffer('image/png'));
}

await fit(process.argv[2], process.argv[3], Number(process.argv[4]), Number(process.argv[5]));
```

Then download and fit (Git Bash):

```bash
SCRATCH="<scratchpad>"
mkdir -p "<repo>/assets/images/park"
curl -L -o "$SCRATCH/raw-ground.png" "<ground result url>"
curl -L -o "$SCRATCH/raw-plate-paddock.png" "<paddock plate result url>"
curl -L -o "$SCRATCH/raw-plate-facility.png" "<facility plate result url>"
cd "<repo>"
npx tsx "$SCRATCH/fit-park-art.ts" "$SCRATCH/raw-ground.png" assets/images/park/ground.png 1200 800
npx tsx "$SCRATCH/fit-park-art.ts" "$SCRATCH/raw-plate-paddock.png" assets/images/park/plate-paddock.png 270 150
npx tsx "$SCRATCH/fit-park-art.ts" "$SCRATCH/raw-plate-facility.png" assets/images/park/plate-facility.png 270 150
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/park-art-assets.test.ts tests/render-art.test.ts`
Expected: PASS (`loadParkArt` now returns non-null `ground` / `platePaddock` / `plateFacility`, and its all-null temp-cwd case still holds)

- [ ] **Step 5: Commit**

```bash
git add assets/images/park/ground.png assets/images/park/plate-paddock.png assets/images/park/plate-facility.png
git add docs/assets/prompts.md tests/park-art-assets.test.ts
git commit -m "feat(assets): add park ground and tile plate art"
```

---

### Task 18: Docs track the park art pipeline

**Files:**
- Modify: `docs/ops.md:55`, `docs/ops.md:65-76`
- Modify: `docs/assets/prompts.md:405-409`
- Modify: `CLAUDE.md:73-78`
- Test: `tests/docs-assets.test.ts`

**Interfaces:**
- Consumes: the committed SVG set from Task 13 and the park raster paths from Task 17.
- Produces: nothing importable — a machine gate (`tests/docs-assets.test.ts`) that pins every emoji count quoted in the docs to the number of committed SVGs, so the count cannot go stale again.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svgCount = readdirSync(resolve(process.cwd(), 'assets/emojis/svg')).filter((f) => f.endsWith('.svg')).length;
const ops = readFileSync(resolve(process.cwd(), 'docs/ops.md'), 'utf8');
const prompts = readFileSync(resolve(process.cwd(), 'docs/assets/prompts.md'), 'utf8');

describe('docs track the committed assets', () => {
  // The operator docs quoted "21 emojis" while 27 were committed, because nothing checked. The count
  // matters operationally: deploy-emojis is the only irreversible live write in the deploy, and the
  // runbook uses this number to tell the operator what a lost manifest.json would recreate.
  it('every emoji count quoted in the docs equals the number of committed SVGs', () => {
    const quoted = [...ops.matchAll(/(\d+)\s+(?:custom |application )?emojis/g), ...prompts.matchAll(/(\d+)\s+(?:custom |application )?emojis/g)]
      .map((m) => Number(m[1]));
    expect(quoted.length, 'no emoji count found in the docs — did the wording change?').toBeGreaterThan(0);
    for (const n of quoted) expect(n).toBe(svgCount);
  });

  it('prompts.md carries a regeneration target for every generated park raster', () => {
    for (const f of ['park/ground.png', 'park/plate-paddock.png', 'park/plate-facility.png']) {
      expect(prompts, `prompts.md is missing the regeneration target ${f}`).toContain(f);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs-assets.test.ts`
Expected: FAIL with `AssertionError: expected 21 to be 33` (the ops.md runbook and prompts.md still quote the pre-existing stale count)

- [ ] **Step 3: Write the implementation**

`docs/ops.md:55` — replace both `21`s in that sentence:

```markdown
   This uploads the 33 custom emojis to the bot's Discord application and writes `assets/emojis/manifest.json` (emoji name → sha256 of the uploaded PNG). **Commit that file right away.** If it goes missing, the next `deploy-emojis` run sees every hash as changed and deletes + recreates all 33 emojis with new snowflake IDs — every message already posted with an old `<:dw_cash:ID>` tag then renders as a broken emoji, silently and with no way to recover it by rerunning. This is the only irreversible live write in the deploy; run it once, after the code is built, before starting the bot.
```

`docs/ops.md:65-76` — replace the Park rendering paragraph:

```markdown
### Park rendering

`/park view` renders a PNG park map in a worker thread using `@napi-rs/canvas`
(native, prebuilt binaries — no system libraries to install). Fonts are bundled
at `assets/fonts/` (Noto Sans + Noto Color Emoji), the map backdrop and the two
tile plates come from `assets/images/park/`, the HUD coin plus the lot and
rarity dino icons are drawn straight from `assets/emojis/svg/*.svg`, and embed
art (egg icons, site thumbnails, banners) lives under `assets/images/` — all
four directories must ship with the deploy. They are read relative to the
process working directory, so run the bot from the repo root (the systemd unit
already sets `WorkingDirectory`). The render worker preloads the park art once
at startup, which delays the first render only; every asset is individually
optional, and a missing or undecodable file degrades that one element back to a
flat fill or a unicode glyph rather than failing. If rendering fails or exceeds
~3s, `/park view` automatically falls back to the text-only embed — the command
never fails because of the renderer.
```

`docs/assets/prompts.md:405-409`:

```markdown
## Emoji icons

The 33 application emojis in `assets/emojis/` are **not** generated — they are
hand-authored SVG rendered by `npm run build-emojis`. That set includes the six
`dw_dino_<rarity>` chips and the five `dw_lot_*` icons the park renderer reads
as SVG at draw time. See the emoji bullets in the repo `CLAUDE.md` for the
pipeline and its two rendering gotchas.
```

`CLAUDE.md:73-78` — replace the PNG/SVG asymmetry bullet:

```markdown
- `@napi-rs/canvas` decodes **PNG** buffers asynchronously — setting `Image.src`
  from PNG bytes and drawing in the same tick silently yields a blank canvas,
  with no error. Always `await img.decode()` before drawing a PNG. **SVG**
  buffers decode synchronously, which is why `renderSvg` needs no await and why
  every icon the park renderer draws (HUD coin, lot icons, rarity dino chips) is
  read from `assets/emojis/svg/*.svg` rather than a PNG. That asymmetry is what
  splits `src/core/render/art.ts` in two: `loadSvgImage` is synchronous, the
  three `assets/images/park/*.png` rasters are `await img.decode()`d inside
  `loadParkArt`, and `renderParkPng(snap, art = EMPTY_ART)` **stays
  synchronous** — never move a PNG decode into it. `worker.ts` top-level-awaits
  `loadParkArt().catch(() => EMPTY_ART)`: `loadParkArt` must never reject and
  the `.catch` is belt-and-braces, because a rejected worker module boot fires
  `client.ts`'s `error` handler, which terminates and nulls the worker — every
  later `/park view` then silently loses its image and respawns another doomed
  worker. Art never crosses `postMessage` (a canvas `Image` is not
  structured-cloneable), `drawImage(null)` throws so every art site needs its
  own non-null guard, and each `null` falls back to the flat fill / emoji glyph
  in `src/data/render-icons.ts` — that file is the live fallback path, not dead
  code.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs-assets.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/ops.md docs/assets/prompts.md CLAUDE.md tests/docs-assets.test.ts
git commit -m "docs: record the park art pipeline and correct the emoji count"
```

---

### Task 19: End-to-end pin and wave gates

**Files:**
- Test: `tests/render-park-art.test.ts`

**Interfaces:**
- Consumes: `loadParkArt` (Task 14), `renderParkPng(snap, art)` (Task 15), the committed rasters (Task 17), `PADDOCK_PALETTE` from `src/data/render-icons.js`.
- Produces: nothing importable — the regression pin that the committed art actually reaches the canvas, closing the gap where every unit test passes while the renderer draws flat fills.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createCanvas, Image } from '@napi-rs/canvas';
import { renderParkPng } from '../src/core/render/draw.js';
import { loadParkArt } from '../src/core/render/art.js';
import { PADDOCK_PALETTE } from '../src/data/render-icons.js';
import type { ParkSnapshot } from '../src/modules/park/snapshot.js';

const sample: ParkSnapshot = {
  parkName: 'Jurassic Cove', cash: 12400, parkRating: 420, dinoCount: 3, escapedCount: 1, lotCap: 5,
  lots: [
    { id: 1, type: 'paddock', kind: 'carnivore_paddock', name: 'T-Rex Pen', level: 3, decorCount: 2,
      dinos: [
        { speciesId: 'tyrannosaurus', rarity: 'legendary', escaped: false },
        { speciesId: 'tyrannosaurus', rarity: 'legendary', escaped: true },
      ] },
    { id: 2, type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab With A Very Long Name', level: 2, decorCount: 0, dinos: [] },
  ],
};

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('park render with the committed art', () => {
  // Every other test in this wave proves a piece in isolation: art.ts loads files, draw.ts draws
  // whatever ParkArt it is handed, the worker passes one in. None of them fails if the real assets go
  // missing from the repo or the loader's filenames drift — the renderer would just keep drawing the
  // flat fallback, green all the way. This walks the whole path with the real files on disk.
  it('paints the ground raster and the paddock plate, not the flat fills', async () => {
    const art = await loadParkArt();
    expect(art.ground, 'assets/images/park/ground.png missing or undecodable').not.toBeNull();
    expect(art.platePaddock, 'assets/images/park/plate-paddock.png missing or undecodable').not.toBeNull();

    const png = renderParkPng(sample, art);
    const img = new Image();
    img.src = png;
    await img.decode();
    const canvas = createCanvas(img.width, img.height);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    const at = (x: number, y: number) => Array.from(c.getImageData(x, y, 1, 1).data).slice(0, 3);

    // (10, 240) is the left margin below the header, which the flat path fills with exactly #356b2c;
    // (260, 210) is inside tile 0, clear of the icon, name, level, dino chips, escape alert and decor
    // dots, which the flat path fills with exactly PADDOCK_PALETTE.fill.
    expect(at(10, 240)).not.toEqual(rgb('#356b2c'));
    expect(at(260, 210)).not.toEqual(rgb(PADDOCK_PALETTE.fill));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `git stash push assets/images/park && npx vitest run tests/render-park-art.test.ts; git stash pop`
Expected: FAIL with `AssertionError: assets/images/park/ground.png missing or undecodable: expected null not to be null` (proving the pin actually fails when the art is absent, rather than passing vacuously)

- [ ] **Step 3: Write the implementation**

No production code changes — the pin closes over work already shipped in Tasks 9, 10 and 12. Verify the wired path end to end from the same entry point the bot uses:

```bash
node --experimental-strip-types -e "1" >/dev/null 2>&1
npx tsx scripts/render-smoke.mjs
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run && npm run test:live`
Expected: PASS — typecheck clean (tests and scripts included), the whole vitest suite green, and the live gallery posts the new park map to `TEST_CHANNEL_ID`. Review the gallery for the one thing no offline test can catch: tile name/level text (`#3a2f16` on the paddock plate, `#12303f` on the facility plate) must stay legible on the new plate materials, and the HUD must still read against the ground.

- [ ] **Step 5: Commit**

```bash
git add tests/render-park-art.test.ts
git commit -m "test(render): pin that committed park art reaches the canvas"
# Operator, after merge: run `npm run deploy-emojis` (uploads the 6 new dw_dino_* chips) and commit
# the updated assets/emojis/manifest.json immediately — it gains 6 rows. `npm run deploy-commands` is
# not required in this wave: no command builder changed.
```

---

## Wave 4 — New banners and embed promotions

### Task 20: `assetImage` gains the `hatch` kind

**Files:**
- Modify: `src/core/images.ts:19`
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: `assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles', name: string): ImageRef | null` (current signature)
- Produces: `assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch', name: string): ImageRef | null`

- [ ] **Step 1: Write the failing test**

Add this `it` to the existing `describe('assetImage')` block in `tests/images.test.ts`, directly after the `accepts the battles kind…` case (line 36):

```ts
  it('accepts the hatch kind and null-degrades when absent', () => {
    expect(assetImage('hatch', 'no-such-crack')).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: FAIL with `tests/images.test.ts(37,25): error TS2345: Argument of type '"hatch"' is not assignable to parameter of type '"eggs" | "sites" | "banners" | "battles"'.`

- [ ] **Step 3: Write the implementation**

Replace line 19 of `src/core/images.ts`:

```ts
export function assetImage(kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch', name: string): ImageRef | null {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts -t "accepts the hatch kind and null-degrades when absent"`
Expected: PASS

- [ ] **Step 5: Verify the typecheck gate is clean**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/core/images.ts tests/images.test.ts
git commit -m "feat(images): accept the hatch asset kind"
```

---

### Task 21: Hatch crack art — 6 transparent PNGs, post-processing script, prompts

**Files:**
- Create: `assets/images/hatch/common-crack.png`, `assets/images/hatch/uncommon-crack.png`, `assets/images/hatch/rare-crack.png`, `assets/images/hatch/epic-crack.png`, `assets/images/hatch/legendary-crack.png`, `assets/images/hatch/mythic-crack.png`
- Create: `scripts/fit-art.mjs`
- Modify: `docs/assets/prompts.md`
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: `assetImage('hatch', '<rarity>-crack')` from Task 20
- Produces: `scripts/fit-art.mjs` CLI — `node scripts/fit-art.mjs banner <src> <dest>` (1536×1024 cover-crop) and `node scripts/fit-art.mjs cutout <src> <dest>` (1024×1024 defringed transparent fit); six `assets/images/hatch/<rarity>-crack.png` files

- [ ] **Step 1: Write the failing test**

Append to `tests/images.test.ts` (and extend the top import to `import { Image, createCanvas } from '@napi-rs/canvas';`):

```ts
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;

describe('hatch crack art', () => {
  // 1024×1024 transparent, same square as the eggs they are edited from — NOT
  // banner-sized, so they never belong in the BANNERS size loop above.
  it.each(RARITIES)('%s-crack ships at 1024x1024 with transparent corners', async (rarity) => {
    const ref = assetImage('hatch', `${rarity}-crack`);
    expect(ref, rarity).not.toBeNull();
    expect(ref!.url).toBe(`attachment://${rarity}-crack.png`);
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/hatch', `${rarity}-crack.png`));
    await img.decode();
    expect(img.width).toBe(1024);
    expect(img.height).toBe(1024);
    const canvas = createCanvas(img.width, img.height);
    const c2d = canvas.getContext('2d');
    c2d.drawImage(img, 0, 0);
    const px = c2d.getImageData(0, 0, img.width, img.height).data;
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]] as const) {
      expect(px[(y * img.width + x) * 4 + 3], `corner ${x},${y}`).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "ships at 1024x1024 with transparent corners"`
Expected: FAIL with `expected null not to be null` (6 failing cases — `assets/images/hatch/` does not exist yet)

- [ ] **Step 3: Write the post-processing script**

Create `scripts/fit-art.mjs`:

```js
// Post-processing for generated art (see docs/assets/prompts.md).
//   node scripts/fit-art.mjs banner <src> <dest>   -> 1536x1024, cover-scaled, center-cropped
//   node scripts/fit-art.mjs cutout <src> <dest>   -> 1024x1024 transparent, defringed and centered
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, Image } from '@napi-rs/canvas';

const [mode, src, dest] = process.argv.slice(2);
if (!['banner', 'cutout'].includes(mode) || !src || !dest) {
  console.error('usage: node scripts/fit-art.mjs <banner|cutout> <src.png> <dest.png>');
  process.exit(2);
}

const img = new Image();
img.src = readFileSync(src);
await img.decode();

if (mode === 'banner') {
  const W = 1536, H = 1024;
  const scale = Math.max(W / img.width, H / img.height);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const canvas = createCanvas(W, H);
  canvas.getContext('2d').drawImage(img, Math.round((W - w) / 2), Math.round((H - h) / 2), w, h);
  writeFileSync(dest, canvas.toBuffer('image/png'));
  console.log(`banner ${dest} ${W}x${H} (source ${img.width}x${img.height})`);
  process.exit(0);
}

// cutout runs AFTER remove_background. The studio backdrop is light gray, so the
// matte leaves a light rim where the art's dark outline should be — peel it.
const w = img.width, h = img.height;
const work = createCanvas(w, h);
const wctx = work.getContext('2d');
wctx.drawImage(img, 0, 0);
const data = wctx.getImageData(0, 0, w, h);
const px = data.data;
const at = (x, y) => (y * w + x) * 4;
for (let i = 3; i < px.length; i += 4) if (px[i] < 32) px[i] = 0;
for (let pass = 0; pass < 3; pass++) {
  const doomed = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      if (px[i + 3] === 0) continue;
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1
        || px[at(x - 1, y) + 3] === 0 || px[at(x + 1, y) + 3] === 0
        || px[at(x, y - 1) + 3] === 0 || px[at(x, y + 1) + 3] === 0;
      if (!edge) continue;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum > 180 && Math.max(r, g, b) - Math.min(r, g, b) < 40) doomed.push(i + 3);
    }
  }
  if (!doomed.length) break;
  for (const a of doomed) px[a] = 0;
}
wctx.putImageData(data, 0, 0);
let x0 = w, y0 = h, x1 = -1, y1 = -1;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    if (px[at(x, y) + 3] === 0) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
}
if (x1 < 0) { console.error('cutout: image is fully transparent'); process.exit(1); }
const S = 1024, bw = x1 - x0 + 1, bh = y1 - y0 + 1;
const scale = Math.min((S * 0.94) / bw, (S * 0.94) / bh);
const out = createCanvas(S, S);
out.getContext('2d').drawImage(work, x0, y0, bw, bh,
  (S - bw * scale) / 2, (S - bh * scale) / 2, bw * scale, bh * scale);
writeFileSync(dest, out.toBuffer('image/png'));
console.log(`cutout ${dest} ${S}x${S} (opaque bbox ${bw}x${bh})`);
```

- [ ] **Step 4: Write the prompts into `docs/assets/prompts.md`**

Insert this section immediately before the `## Emoji icons` heading (currently line 405):

```md
## Hatch cracks

Six mid-burst variants of the egg icons, shown on the `hatch:crack` reveal so
the player sees the same egg they were shown a second earlier, now open.

| File | Size | Use |
|---|---|---|
| `assets/images/hatch/<rarity>-crack.png` | 1024×1024, transparent | `hatch:crack` reveal embed image |

`<rarity>` is one of `common`, `uncommon`, `rare`, `epic`, `legendary`,
`mythic`.

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the egg/nest silhouette — off-silhouette glow survives background
removal as floating islands or a light halo on transparency. Emissive detail is
allowed only ON surfaces. Every prompt carries this rule verbatim.

**Workflow (reference chain):** each crack is generated with its OWN
`assets/images/eggs/<rarity>.png` attached as the `image` reference (Nano Banana
Pro, `medias` role `image`) — never from another crack — so the shell design and
nest match the egg the player was just shown. Post-process each with
`remove_background`, then `node scripts/fit-art.mjs cutout <src> <dest>`.

**Prompt (identical for all six; only the attached reference changes):**

> Keep the exact same cartoon dinosaur egg and the exact same woven twig nest:
> same shell design, same colors, same size, same position, same framing, same
> plain flat light-gray studio background. Change only the state: the shell is
> now split wide open across the upper half, jagged shell fragments falling
> away and resting in the nest, the interior dark and empty. No glow, rays,
> embers, sparkles, or light effects extending beyond the egg or the nest;
> glowing details may appear only on the surfaces themselves. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.
```

- [ ] **Step 5: Upload the six egg references to Higgsfield**

For each rarity: call `mcp__claude_ai_Higgsfield__media_upload` with `filename: "<rarity>.png"`, `content_type: "image/png"`; PUT the bytes, then confirm:

```bash
curl -s -X PUT --upload-file "<repo>/assets/images/eggs/common.png" "<upload_url>"
```

Then call `mcp__claude_ai_Higgsfield__media_confirm` for each upload and record the six `media_id`s.

- [ ] **Step 6: Generate the six crack images**

Call `mcp__claude_ai_Higgsfield__generate_image` once per rarity with:

```json
{"params": {"model": "nano_banana_pro", "aspect_ratio": "1:1", "count": 1,
  "medias": [{"role": "image", "value": "<media_id of eggs/<rarity>.png>"}],
  "prompt": "Keep the exact same cartoon dinosaur egg and the exact same woven twig nest: same shell design, same colors, same size, same position, same framing, same plain flat light-gray studio background. Change only the state: the shell is now split wide open across the upper half, jagged shell fragments falling away and resting in the nest, the interior dark and empty. No glow, rays, embers, sparkles, or light effects extending beyond the egg or the nest; glowing details may appear only on the surfaces themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements."}}
```

Poll each with `mcp__claude_ai_Higgsfield__job_status` and record the six completed `job_id`s.

- [ ] **Step 7: Remove backgrounds**

Call `mcp__claude_ai_Higgsfield__remove_background` once per crack with `{"params": {"media_id": "<crack job_id>", "media_type": "image"}}`, then `mcp__claude_ai_Higgsfield__job_status` for each result URL.

- [ ] **Step 8: Download and fit the six cutouts**

```bash
mkdir -p "$TEMP/dw-art-round2" "<repo>/assets/images/hatch"
for r in common uncommon rare epic legendary mythic; do
  curl -sL "<no-bg url for $r>" -o "$TEMP/dw-art-round2/$r-crack-raw.png"
  node "<repo>/scripts/fit-art.mjs" cutout \
    "$TEMP/dw-art-round2/$r-crack-raw.png" \
    "<repo>/assets/images/hatch/$r-crack.png"
done
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts -t "ships at 1024x1024 with transparent corners"`
Expected: PASS (6 cases)

- [ ] **Step 10: Commit**

```bash
git add assets/images/hatch scripts/fit-art.mjs docs/assets/prompts.md tests/images.test.ts
git commit -m "feat(art): add six hatch crack images and the art fit script"
```

---

### Task 22: `revealPayload` shows the rarity crack image

**Files:**
- Modify: `src/modules/hatchery/embeds.ts:30-42`
- Test: `tests/hatchery.test.ts:86-90`

**Interfaces:**
- Consumes: `assetImage('hatch', '<rarity>-crack')`, `assets/images/hatch/*.png` (Task 21)
- Produces: `revealPayload(species: Species): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files: AttachmentBuilder[]; attachments: AttachmentBuilder[] }`

- [ ] **Step 1: Write the failing test**

Replace the `revealPayload clears attachments…` test in `tests/hatchery.test.ts` (lines 86-90) with:

```ts
  it('revealPayload swaps the intact egg for the rarity crack and keeps attachments cleared', () => {
    // attachments: [] is load-bearing — discord.js pushes the new descriptors into
    // the array we pass, so the pre-hatch egg upload is dropped and only the crack
    // survives on the edited message.
    const p = revealPayload(getSpecies('velociraptor'));   // rare
    expect(p.embeds[0].toJSON().image?.url).toBe('attachment://rare-crack.png');
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack.png']);
    expect(p.attachments).toEqual([]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hatchery.test.ts -t "revealPayload swaps the intact egg"`
Expected: FAIL with `expected undefined to be 'attachment://rare-crack.png'`

- [ ] **Step 3: Write the implementation**

Replace `revealPayload` in `src/modules/hatchery/embeds.ts` (lines 30-42):

```ts
export function revealPayload(species: Species) {
  const stats = RARITY[species.rarity];
  const embed = new EmbedBuilder().setColor(RARITY_COLOR[species.rarity] ?? 0x95a5a6)
    .setTitle(`✨ ${rarityEmoji(species.rarity)}${species.rarity.toUpperCase()} — ${species.name}!`)
    .setDescription(species.flavor)
    .addFields(
      { name: 'Diet', value: species.diet, inline: true },
      { name: 'Biome', value: species.biomeTags.join(', '), inline: true },
      { name: 'Income/hr', value: String(stats.incomePerHr), inline: true },
    );
  embed.setFooter({ text: 'Next: /dino assign — unassigned dinos earn nothing.' });
  const payload: {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[];
    files: AttachmentBuilder[]; attachments: AttachmentBuilder[];
  } = { embeds: [embed], components: [], files: [], attachments: [] };
  // attachments: [] stays even with a file present — discord.js pushes the new
  // descriptors into it, so the pre-hatch egg upload is dropped and the crack kept.
  const crack = assetImage('hatch', `${species.rarity}-crack`);
  if (crack) { embed.setImage(crack.url); payload.files = [crack.file]; }
  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hatchery.test.ts -t "revealPayload swaps the intact egg"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/embeds.ts tests/hatchery.test.ts
git commit -m "feat(hatchery): show the rarity crack image on the hatch reveal"
```

---

### Task 23: Battle victory and defeat banners

**Files:**
- Create: `assets/images/banners/battle_victory.png`, `assets/images/banners/battle_defeat.png`
- Modify: `docs/assets/prompts.md:229-243`
- Test: `tests/images.test.ts:7,27-33`

**Interfaces:**
- Consumes: `node scripts/fit-art.mjs banner <src> <dest>` (Task 21)
- Produces: `assetImage('banners', 'battle_victory' | 'battle_defeat')` resolves non-null

- [ ] **Step 1: Write the failing test**

In `tests/images.test.ts`, replace line 7 and the `ships all five banner images` title (line 27):

```ts
const BANNERS = ['trading', 'leaderboards', 'help', 'care', 'care_neglect', 'shop_food_market',
  'battle_victory', 'battle_defeat'];
```

```ts
  it('ships every banner image listed in BANNERS', () => {
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "ships every banner image listed in BANNERS"`
Expected: FAIL with `expected null not to be null: battle_victory`

- [ ] **Step 3: Write the prompts into `docs/assets/prompts.md`**

Add two rows to the Embed banners table (after line 243):

```md
| `assets/images/banners/battle_victory.png` | 1536×1024 | `/battle fight` F4 image, win |
| `assets/images/banners/battle_defeat.png` | 1536×1024 | `/battle fight` F4 image, loss |
```

And append these subsections at the end of the Embed banners section (after the `shop_food_market` block, before the `---` on line 336):

```md
**Battle victory (`battle_victory.png`):**

> A wide cartoon scene of a dinosaur park arena after a won battle: a proud
> victorious green cartoon dinosaur standing tall on a rocky outcrop with its
> head raised, banners and pennants flying on tall poles behind it, scattered
> broken wooden barricades on the sand floor, warm golden late-afternoon light
> breaking through dust in the air, triumphant and bright. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no human characters, no UI elements.

**Battle defeat (`battle_defeat.png`):**

Generated with `battle_victory.png` attached as the `image` reference, the same
`care` / `care_neglect` pairing — regenerate it the same way or the two moods
stop reading as one arena.

> Keep the exact same cartoon arena scene: same rocky outcrop, same banner
> poles, same barricades, same camera framing and composition. Change only the
> mood to defeat: the dinosaur now stands with its head lowered and shoulders
> dropped, the banners are torn and drooping, dust hangs heavy. Overcast grey
> light with muted desaturated colors and long dull shadows instead of golden
> sun. Glossy cartoon mobile-game art style, bold dark outlines, clean cel
> shading with smooth gradients, polished game-asset look. No text, no human
> characters, no UI elements.
```

- [ ] **Step 4: Generate the victory banner**

Call `mcp__claude_ai_Higgsfield__generate_image`:

```json
{"params": {"model": "nano_banana_pro", "aspect_ratio": "3:2", "count": 1,
  "prompt": "A wide cartoon scene of a dinosaur park arena after a won battle: a proud victorious green cartoon dinosaur standing tall on a rocky outcrop with its head raised, banners and pennants flying on tall poles behind it, scattered broken wooden barricades on the sand floor, warm golden late-afternoon light breaking through dust in the air, triumphant and bright. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no human characters, no UI elements."}}
```

Poll `mcp__claude_ai_Higgsfield__job_status` and record the victory `job_id` and result URL.

- [ ] **Step 5: Generate the defeat banner as an edit of victory**

```json
{"params": {"model": "nano_banana_pro", "aspect_ratio": "3:2", "count": 1,
  "medias": [{"role": "image", "value": "<victory job_id>"}],
  "prompt": "Keep the exact same cartoon arena scene: same rocky outcrop, same banner poles, same barricades, same camera framing and composition. Change only the mood to defeat: the dinosaur now stands with its head lowered and shoulders dropped, the banners are torn and drooping, dust hangs heavy. Overcast grey light with muted desaturated colors and long dull shadows instead of golden sun. Glossy cartoon mobile-game art style, bold dark outlines, clean cel shading with smooth gradients, polished game-asset look. No text, no human characters, no UI elements."}}
```

- [ ] **Step 6: Download and fit both banners**

```bash
mkdir -p "$TEMP/dw-art-round2"
curl -sL "<victory url>" -o "$TEMP/dw-art-round2/battle_victory-raw.png"
curl -sL "<defeat url>"  -o "$TEMP/dw-art-round2/battle_defeat-raw.png"
for b in battle_victory battle_defeat; do
  node "<repo>/scripts/fit-art.mjs" banner \
    "$TEMP/dw-art-round2/$b-raw.png" \
    "<repo>/assets/images/banners/$b.png"
done
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts`
Expected: PASS (including the `%s is 1536×1024` case for both new banners)

- [ ] **Step 8: Commit**

```bash
git add assets/images/banners/battle_victory.png assets/images/banners/battle_defeat.png docs/assets/prompts.md tests/images.test.ts
git commit -m "feat(art): add battle victory and defeat banners"
```

---

### Task 24: F4 re-attaches the outcome banner and sheds the chapter banner

**Files:**
- Modify: `src/modules/battles/embeds.ts:10-14,40-51,92-102`
- Test: `tests/battles-embeds.test.ts:37-45,72-84`
- Test: `tests/battles-module.test.ts:40-50`

**Interfaces:**
- Consumes: `assetImage('banners', 'battle_victory' | 'battle_defeat')` (Task 23); `FightOutcome.won: boolean`
- Produces: `FramePayload { embeds; components; files?: AttachmentBuilder[]; attachments?: AttachmentBuilder[] }`; contract — files attach on F1 and F4 only, F4 always carries `attachments: []`

- [ ] **Step 1: Write the failing frame-contract test**

Add to `tests/battles-embeds.test.ts` inside `describe('fightFrames')`:

```ts
  it('frame contract: every referenced attachment is live on that frame, and no frame uploads what it never references', () => {
    const frames = fightFrames(makeOutcome({ stageId: 'coastal_dig_boss', bossEgg: { rarity: 'rare' } }), skipStub);
    // Mirrors discord.js MessagePayload: a payload carrying `files` (or an explicit
    // `attachments` array) REPLACES the message's whole attachment set; a payload
    // carrying neither leaves the previous uploads in place.
    let live: string[] = [];
    frames.forEach((frame, idx) => {
      const own = (frame.files ?? []).map((f) => f.name!);
      live = frame.files || frame.attachments ? own : [...live, ...own];
      const json = frame.embeds[0].toJSON();
      const referenced = [json.image?.url, json.thumbnail?.url]
        .filter((u): u is string => typeof u === 'string')
        .map((u) => u.replace('attachment://', ''));
      for (const r of referenced) expect(live, `frame ${idx + 1} references ${r}`).toContain(r);
      for (const n of own) expect(referenced, `frame ${idx + 1} uploads ${n}`).toContain(n);
    });
    // F4 dropped the chapter banner it no longer references.
    expect(live).toEqual(['battle_victory.png', `${bossId}-portrait.png`]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/battles-embeds.test.ts -t "frame contract"`
Expected: FAIL with `frame 4 references battle_victory.png` — actual `live` is `['coastal_dig-banner.png', 'boss-coastal_dig-portrait.png']` and the F4 embed still points at the chapter banner

- [ ] **Step 3: Write the implementation**

In `src/modules/battles/embeds.ts`, widen `FramePayload` (lines 10-14):

```ts
export interface FramePayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
  attachments?: AttachmentBuilder[];
}
```

Add the outcome banner next to the other lookups (after line 41) and rewrite the comment above `dress` (lines 43-46):

```ts
  const outcomeBanner = assetImage('banners', outcome.won ? 'battle_victory' : 'battle_defeat');

  // Files attach on F1 and F4 only, and each attaching frame uploads exactly the
  // files its embed references. F2/F3 carry no files/attachments key at all, so
  // F1's uploads survive and their attachment:// URLs keep resolving. F4 replaces
  // the set (see below) — never add a file here that no frame references, it
  // renders as a bare attachment card under the message.
```

Replace the F4 block (lines 92-102):

```ts
  const f4Embed = new EmbedBuilder()
    .setColor(outcome.won ? 0x2ecc71 : 0xe74c3c)
    .setTitle(outcome.won ? `🏆 Victory — ${stage.name}` : `💀 Defeat — ${stage.name}`)
    .setDescription(`${starGlyphs(outcome.stars)} · ${outcome.result.rounds} round(s)`)
    .addFields(
      { name: 'Rewards', value: lines.join('\n') },
      { name: 'Energy', value: energyLine(outcome.energyAfter, outcome.energyUpdatedAtMs) },
    );
  // Deliberately NOT dress()ed: F4 shows the outcome banner, not the chapter one.
  if (outcomeBanner) f4Embed.setImage(outcomeBanner.url);
  if (portrait) f4Embed.setThumbnail(portrait.url);
  // attachments: [] is unconditional. discord.js pushes F4's own descriptors into
  // it, so the chapter banner is dropped from the message either way — including
  // the no-art case, where F4 has no files and would otherwise strand F1's upload
  // as a bare attachment card. Same payload is replayed by the skip button.
  const f4: FramePayload = { embeds: [f4Embed], components: [], attachments: [] };
  const f4Files = [outcomeBanner?.file, portrait?.file].filter((f): f is AttachmentBuilder => f != null);
  if (f4Files.length) f4.files = f4Files;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/battles-embeds.test.ts -t "frame contract"`
Expected: PASS

- [ ] **Step 5: Update the two existing frame-attachment assertions**

In `tests/battles-embeds.test.ts` replace lines 37-45:

```ts
  it('returns 4 valid frames; files attach on F1 and F4 only', () => {
    const frames = fightFrames(makeOutcome(), skipStub);
    expect(frames).toHaveLength(4);
    for (const f of frames) validateMessagePayload(f, 'frame');
    expect(frames[0].files?.length).toBeGreaterThan(0);   // coastal_dig banner ships
    expect(frames[1].files).toBeUndefined();
    expect(frames[2].files).toBeUndefined();
    expect(frames[3].files?.map((f) => f.name)).toEqual(['battle_victory.png']);
    expect(frames[3].attachments).toEqual([]);
    expect(frames[3].embeds[0].toJSON().image?.url).toBe('attachment://battle_victory.png');
  });
```

and the title plus F4 wiring at lines 72-78:

```ts
  it('boss stages thumbnail the portrait on F3 and F4; normal stages never do', () => {
    const boss = fightFrames(makeOutcome({ stageId: 'coastal_dig_boss', bossEgg: { rarity: 'rare' } }), skipStub);
    expect(boss[2].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.png`);
    expect(boss[3].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.png`);
    expect(boss[0].files?.map((f) => f.name)).toContain(`${bossId}-portrait.png`);
    expect(boss[3].files?.map((f) => f.name)).toContain(`${bossId}-portrait.png`);   // re-uploaded, not re-referenced
    expect(boss[1].files).toBeUndefined();
```

- [ ] **Step 6: Run the whole embeds suite**

Run: `npx vitest run tests/battles-embeds.test.ts`
Expected: PASS (all cases, including the amber_ridge no-portrait degrade test)

- [ ] **Step 7: Update the module-level frame assertion**

Replace `tests/battles-module.test.ts` lines 40-50:

```ts
  it('files attach on F1 and F4 only; F4 uploads exactly what its embed references', async () => {
    const ctx = makeCtx();
    const dino = seedFighter(ctx);
    const fake = fakeCommand({ name: 'battle', sub: 'fight', user: 'u1',
      options: { stage: 'coastal_dig_1', dino1: dino } });
    await battleCmd.execute(ctx, fake.asChatInput());
    for (const frame of fake.replies.slice(1, 3)) {
      expect(frame).not.toHaveProperty('files');       // would clear F1's uploads on edit
      expect(frame).not.toHaveProperty('attachments');
    }
    const f4 = fake.replies[3] as {
      files?: Array<{ name: string | null }>; attachments?: unknown[];
      embeds: Array<{ toJSON(): { image?: { url: string } } }>;
    };
    expect(f4.attachments).toEqual([]);                // drops F1's chapter banner
    expect(f4.files).toHaveLength(1);
    expect(f4.files![0].name).toMatch(/^battle_(victory|defeat)\.png$/);
    expect(f4.embeds[0].toJSON().image?.url).toBe(`attachment://${f4.files![0].name}`);
  });
```

- [ ] **Step 8: Run the module suite**

Run: `npx vitest run tests/battles-module.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/modules/battles/embeds.ts tests/battles-embeds.test.ts tests/battles-module.test.ts
git commit -m "feat(battles): show the outcome banner on the final fight frame"
```

---

### Task 25: Collect and rescue banners

**Files:**
- Create: `assets/images/banners/collect.png`, `assets/images/banners/rescue.png`
- Modify: `docs/assets/prompts.md` (Embed banners table + prompt subsections)
- Test: `tests/images.test.ts:7`

**Interfaces:**
- Consumes: `node scripts/fit-art.mjs banner <src> <dest>` (Task 21)
- Produces: `assetImage('banners', 'collect' | 'rescue')` resolves non-null

- [ ] **Step 1: Write the failing test**

In `tests/images.test.ts`, extend the `BANNERS` array:

```ts
const BANNERS = ['trading', 'leaderboards', 'help', 'care', 'care_neglect', 'shop_food_market',
  'battle_victory', 'battle_defeat', 'collect', 'rescue'];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "ships every banner image listed in BANNERS"`
Expected: FAIL with `expected null not to be null: collect`

- [ ] **Step 3: Write the prompts into `docs/assets/prompts.md`**

Add two rows to the Embed banners table:

```md
| `assets/images/banners/collect.png` | 1536×1024 | `park:collect` reply embed image |
| `assets/images/banners/rescue.png` | 1536×1024 | `/rescue` success embed image |
```

And append the two prompt subsections at the end of the Embed banners section:

```md
**Collect (`collect.png`):**

> A wide cartoon scene of a dinosaur park ticket booth at closing time: an
> open cash box on a wooden counter overflowing with gold coins and banknotes,
> stacks of coins beside it, a small chalkboard sign and a coil of ticket
> stubs, lush ferns and a park path behind, warm cheerful afternoon daylight.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no human characters, no UI elements.

**Rescue (`rescue.png`):**

> A wide cartoon scene of a dinosaur recapture in a park at dusk: a broken
> section of tall wire perimeter fence with the gap being closed by a wooden
> barricade, a small worried green cartoon dinosaur being coaxed back toward
> the enclosure along a rope-marked path, a parked park jeep with its headlamp
> on and a net beside it, jungle treeline and deep blue evening sky behind.
> Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated
> colors, strong glossy highlights, clean cel shading with smooth gradients,
> polished game-asset look. No text, no human characters, no UI elements.
```

- [ ] **Step 4: Generate both banners**

Call `mcp__claude_ai_Higgsfield__generate_image` twice (independent, no reference chain), with `{"params": {"model": "nano_banana_pro", "aspect_ratio": "3:2", "count": 1, "prompt": "<the collect prompt verbatim from Step 3>"}}` and again with the rescue prompt. Poll each with `mcp__claude_ai_Higgsfield__job_status` and record the result URLs.

- [ ] **Step 5: Download and fit both banners**

```bash
mkdir -p "$TEMP/dw-art-round2"
curl -sL "<collect url>" -o "$TEMP/dw-art-round2/collect-raw.png"
curl -sL "<rescue url>"  -o "$TEMP/dw-art-round2/rescue-raw.png"
for b in collect rescue; do
  node "<repo>/scripts/fit-art.mjs" banner \
    "$TEMP/dw-art-round2/$b-raw.png" \
    "<repo>/assets/images/banners/$b.png"
done
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add assets/images/banners/collect.png assets/images/banners/rescue.png docs/assets/prompts.md tests/images.test.ts
git commit -m "feat(art): add collect and rescue banners"
```

---

### Task 26: `park:collect` becomes an embed with the collect banner

**Files:**
- Modify: `src/modules/park/index.ts:1-24,251-256`
- Test: `tests/dinos.test.ts:182-198`
- Test: `tests/journeys.test.ts:85,133,182`

**Interfaces:**
- Consumes: `assetImage('banners', 'collect')` (Task 25)
- Produces: `collectPayload(amount: number): { embeds: EmbedBuilder[]; files?: AttachmentBuilder[]; flags: MessageFlags.Ephemeral }` (module-private)

- [ ] **Step 1: Write the failing test**

Replace the `park:collect button collects for the clicker…` test in `tests/dinos.test.ts` (lines 182-198):

```ts
  it('park:collect button replies with the collect banner embed, then the empty branch', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', 'herbivore_paddock');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, lotId: lot.id,
    }).run();
    ctx.db.update(schema.users).set({ lastCollectAt: 0 }).run();
    ctx.setNow(2 * 3_600_000);
    const comp = parkModule.components.find((c) => c.prefix === 'park')!;
    const b1 = fakeButton({ customId: 'park:collect', user: 'u1' });
    await comp.execute(ctx, b1.asInteraction() as unknown as ButtonInteraction);
    const first = b1.replies[0] as CollectPayload;
    expect(first.embeds[0].toJSON().description).toContain('Collected');
    expect(first.embeds[0].toJSON().image?.url).toBe('attachment://collect.png');
    expect(first.files!.map((f) => f.name)).toEqual(['collect.png']);
    expect(first.flags).toBe(MessageFlags.Ephemeral);   // stays private
    const b2 = fakeButton({ customId: 'park:collect', user: 'u1' });
    await comp.execute(ctx, b2.asInteraction() as unknown as ButtonInteraction);
    const second = b2.replies[0] as CollectPayload;
    expect(second.embeds[0].toJSON().description).toContain('Nothing to collect');
    expect(second.files!.map((f) => f.name)).toEqual(['collect.png']);
  });
```

Add above `describe('dino assignment')` in the same file:

```ts
type CollectPayload = {
  embeds: Array<{ toJSON(): { description?: string; image?: { url: string } } }>;
  files?: Array<{ name: string | null }>;
  flags?: number;
};
```

and extend the discord.js import on line 2 to `import { MessageFlags, type ButtonInteraction } from 'discord.js';`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dinos.test.ts -t "park:collect button replies with the collect banner embed"`
Expected: FAIL with `Cannot read properties of undefined (reading '0')` — the reply is still `{ content, flags }` with no `embeds`

- [ ] **Step 3: Write the implementation**

In `src/modules/park/index.ts`, add to the imports:

```ts
import { assetImage } from '../../core/images.js';
import type { AttachmentBuilder } from 'discord.js';
```

Add above `dinoListPayload` (line 26):

```ts
// emojiTag is resolved per call, never at module scope — the app-emoji map only
// loads after client ready.
function collectPayload(amount: number) {
  const embed = new EmbedBuilder().setColor(0x3ba55c)
    .setTitle(`${emojiTag('dw_cash')} Park income`)
    .setDescription(amount > 0
      ? `Collected **${amount.toLocaleString()}** cash.`
      : 'Nothing to collect yet — give your dinos time to earn.');
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[]; flags: MessageFlags.Ephemeral } =
    { embeds: [embed], flags: MessageFlags.Ephemeral };
  const banner = assetImage('banners', 'collect');
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  return payload;
}
```

Replace line 254 in the `park:collect` branch:

```ts
          await i.reply(collectPayload(amount));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dinos.test.ts -t "park:collect button replies with the collect banner embed"`
Expected: PASS

- [ ] **Step 5: Update the three journey assertions**

In `tests/journeys.test.ts`, replace all three occurrences (lines 85, 133, 182) of

```ts
    expect(replyText(collect.replies[0])).toContain('Collected');
```

with

```ts
    expect(embedText(collect.replies[0])).toContain('Collected');
```

- [ ] **Step 6: Run the journey suite**

Run: `npx vitest run tests/journeys.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/park/index.ts tests/dinos.test.ts tests/journeys.test.ts
git commit -m "feat(park): promote park:collect to a banner embed"
```

---

### Task 27: `/rescue` becomes an embed with the rescue banner

**Files:**
- Modify: `src/modules/care/index.ts:18-29,110-111`
- Test: `tests/care.test.ts:188-198`
- Test: `tests/journeys.test.ts:174`

**Interfaces:**
- Consumes: `assetImage('banners', 'rescue')` (Task 25)
- Produces: `rescuePayload(speciesName: string, fee: number): { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }` (module-private)

- [ ] **Step 1: Write the failing test**

Replace the `recaptures an escaped dino for the fee` test body in `tests/care.test.ts` (lines 188-198):

```ts
  it('recaptures an escaped dino for the fee, replying with the rescue banner embed', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, escapedAt: 100,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: dino.id } });
    await rescueCmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as CarePayload;
    expect(payload.embeds[0].toJSON().description).toContain('Recaptured');
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://rescue.png');
    expect(payload.files!.map((f) => f.name)).toEqual(['rescue.png']);
    expect(ctx.db.select().from(schema.dinos).all()[0].escapedAt).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/care.test.ts -t "recaptures an escaped dino for the fee"`
Expected: FAIL with `Cannot read properties of undefined (reading '0')` — the reply is still `{ content }`

- [ ] **Step 3: Write the implementation**

In `src/modules/care/index.ts`, add after `carePayload` (line 29):

```ts
// /rescue success carries the rescue banner; the two failure branches stay
// content-only ephemerals (care.test.ts pins them via replyText).
function rescuePayload(speciesName: string, fee: number) {
  const embed = new EmbedBuilder().setTitle('🪝 Rescue').setColor(0x3ba55c)
    .setDescription(`Recaptured your ${speciesName} for ${fee.toLocaleString()} cash.`);
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  const banner = assetImage('banners', 'rescue');
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  return payload;
}
```

Replace line 111:

```ts
          await i.reply(rescuePayload(species.name, fee));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/care.test.ts`
Expected: PASS (including the two unchanged ephemeral error branches)

- [ ] **Step 5: Update the journey assertion**

In `tests/journeys.test.ts`, replace line 174:

```ts
    expect(embedText(rescue.replies[0])).toContain('Recaptured');
```

- [ ] **Step 6: Run the journey suite**

Run: `npx vitest run tests/journeys.test.ts -t "escape loop"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/care/index.ts tests/care.test.ts tests/journeys.test.ts
git commit -m "feat(care): promote /rescue success to a banner embed"
```

---

### Task 28: Roster, incubator, and sell banners

**Files:**
- Create: `assets/images/banners/dino_roster.png`, `assets/images/banners/eggs_incubator.png`, `assets/images/banners/sell.png`
- Modify: `docs/assets/prompts.md` (Embed banners table + prompt subsections)
- Test: `tests/images.test.ts:7`

**Interfaces:**
- Consumes: `node scripts/fit-art.mjs banner <src> <dest>` (Task 21)
- Produces: `assetImage('banners', 'dino_roster' | 'eggs_incubator' | 'sell')` resolves non-null

- [ ] **Step 1: Write the failing test**

In `tests/images.test.ts`, extend `BANNERS` to its final form:

```ts
const BANNERS = ['trading', 'leaderboards', 'help', 'care', 'care_neglect', 'shop_food_market',
  'battle_victory', 'battle_defeat', 'collect', 'rescue', 'dino_roster', 'eggs_incubator', 'sell'];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "ships every banner image listed in BANNERS"`
Expected: FAIL with `expected null not to be null: dino_roster`

- [ ] **Step 3: Write the prompts into `docs/assets/prompts.md`**

Add three rows to the Embed banners table:

```md
| `assets/images/banners/dino_roster.png` | 1536×1024 | `/dino list` embed image |
| `assets/images/banners/eggs_incubator.png` | 1536×1024 | `/eggs` embed image |
| `assets/images/banners/sell.png` | 1536×1024 | `/sell` confirmation prompt embed image |
```

And append the three prompt subsections at the end of the Embed banners section:

```md
**Dino roster (`dino_roster.png`):**

> A wide cartoon scene of a dinosaur park roster board area: a row of five
> different friendly cartoon dinosaurs of assorted colors and sizes standing
> side by side along a wooden fence line as if lined up for a headcount, a
> long-necked sauropod, a horned ceratopsian, a plated stegosaur, a small
> theropod and a crested hadrosaur, lush ferns and palms behind, bright
> cheerful morning daylight. Glossy cartoon mobile-game art style, bold dark
> outlines, vibrant saturated colors, strong glossy highlights, clean cel
> shading with smooth gradients, polished game-asset look. No text, no human
> characters, no UI elements.

**Eggs incubator (`eggs_incubator.png`):**

> A wide cartoon scene of a dinosaur park hatchery incubation room: a curved
> bank of warm glass incubator domes on a steel bench, each holding a single
> speckled egg nested in straw, soft amber heat lamps overhead, coiled hoses
> and a temperature dial on the wall, dark room lit warmly from the domes
> themselves. Glossy cartoon mobile-game art style, bold dark outlines,
> vibrant saturated colors, strong glossy highlights, clean cel shading with
> smooth gradients, polished game-asset look. No text, no human characters, no
> UI elements.

**Sell (`sell.png`):**

> A wide cartoon scene of a prehistoric park buyer's stall: a heavy wooden
> counter with a brass weighing scale, an open ledger, a leather coin pouch
> spilling gold, and an empty transport crate with its lid propped open and
> straw inside, a dirt path and jungle ferns behind, warm late-afternoon
> daylight. Glossy cartoon mobile-game art style, bold dark outlines, vibrant
> saturated colors, strong glossy highlights, clean cel shading with smooth
> gradients, polished game-asset look. No text, no human characters, no UI
> elements.
```

- [ ] **Step 4: Generate the three banners**

Call `mcp__claude_ai_Higgsfield__generate_image` three times (all independent), each with `{"params": {"model": "nano_banana_pro", "aspect_ratio": "3:2", "count": 1, "prompt": "<the matching prompt verbatim from Step 3>"}}`. Poll each with `mcp__claude_ai_Higgsfield__job_status` and record the result URLs.

- [ ] **Step 5: Download and fit the three banners**

```bash
mkdir -p "$TEMP/dw-art-round2"
curl -sL "<dino_roster url>"    -o "$TEMP/dw-art-round2/dino_roster-raw.png"
curl -sL "<eggs_incubator url>" -o "$TEMP/dw-art-round2/eggs_incubator-raw.png"
curl -sL "<sell url>"           -o "$TEMP/dw-art-round2/sell-raw.png"
for b in dino_roster eggs_incubator sell; do
  node "<repo>/scripts/fit-art.mjs" banner \
    "$TEMP/dw-art-round2/$b-raw.png" \
    "<repo>/assets/images/banners/$b.png"
done
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts`
Expected: PASS (13 banners present, all 1536×1024)

- [ ] **Step 7: Commit**

```bash
git add assets/images/banners/dino_roster.png assets/images/banners/eggs_incubator.png assets/images/banners/sell.png docs/assets/prompts.md tests/images.test.ts
git commit -m "feat(art): add roster, incubator, and sell banners"
```

---

### Task 29: `/dino list` carries the roster banner

**Files:**
- Modify: `src/modules/park/index.ts:26-43,272-276`
- Test: `tests/dinos.test.ts:80-88,91-100`

**Interfaces:**
- Consumes: `assetImage('banners', 'dino_roster')` (Task 28)
- Produces: `dinoListPayload(ctx: Ctx, userId: string, page: number): { embeds: EmbedBuilder[]; components: ReturnType<typeof pageRow>[]; files?: AttachmentBuilder[] }`

- [ ] **Step 1: Write the failing test**

Add to `tests/dinos.test.ts` inside `describe('park dino commands')`, after the ESCAPED test:

```ts
  it('/dino list sets the roster banner as the embed image and attaches it', async () => {
    ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    const dinoCmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'list', user: 'u1' });
    await dinoCmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { image?: { url: string } } }>; files?: Array<{ name: string | null }>;
    };
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://dino_roster.png');
    expect(payload.files!.map((f) => f.name)).toEqual(['dino_roster.png']);
  });
```

And add to `describe('dino list pagination')`, inside the existing `page button re-renders…` test after the footer assertion:

```ts
    // Matches the hatch:eggs precedent: the page flip re-uploads the banner, so the
    // previous page's copy must be cleared or the message keeps both.
    expect((b.replies[0] as { attachments?: unknown[] }).attachments).toEqual([]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dinos.test.ts -t "/dino list sets the roster banner"`
Expected: FAIL with `expected undefined to be 'attachment://dino_roster.png'`

- [ ] **Step 3: Write the implementation**

In `src/modules/park/index.ts`, replace lines 40-42 of `dinoListPayload`:

```ts
  const embed = new EmbedBuilder().setTitle('🦕 Your dinos').setDescription(lines).setColor(0x3ba55c)
    .setFooter({ text: `Page ${p}/${pages}` });
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof pageRow>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: pages > 1 ? [pageRow('park', 'dinos', userId, p, pages)] : [] };
  const banner = assetImage('banners', 'dino_roster');
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  return payload;
}
```

and replace line 275 in the `dinos` button branch:

```ts
          await i.update({ ...dinoListPayload(ctx, i.user.id, Number(pageStr)), attachments: [] });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dinos.test.ts`
Expected: PASS

- [ ] **Step 5: Verify the widened return type typechecks**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add src/modules/park/index.ts tests/dinos.test.ts
git commit -m "feat(park): put the roster banner on /dino list"
```

---

### Task 30: `/eggs` carries the incubator banner

**Files:**
- Modify: `src/modules/hatchery/embeds.ts:51-68`
- Test: `tests/hatchery.test.ts:95-113`

**Interfaces:**
- Consumes: `assetImage('banners', 'eggs_incubator')` (Task 28)
- Produces: `eggListPayload(...)` payload now carries the egg thumbnail file AND the incubator banner file (`files` length 2 with eggs, 1 with none)

- [ ] **Step 1: Write the failing test**

Update the two file-count assertions in `tests/hatchery.test.ts`. Replace lines 95-102:

```ts
  it('eggListPayload thumbnails the ready egg over incubating and newest, under the incubator banner', () => {
    const ready = { ...addEgg('epic'), hatchesAt: 5, incubationStartedAt: 1 };
    const incubating = { ...addEgg('rare'), hatchesAt: 999_999, incubationStartedAt: 1 };
    const newest = addEgg('common');
    const p = eggListPayload([newest, incubating, ready], 10, 'u1');
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://epic.png');
    expect(p.embeds[0].toJSON().image?.url).toBe('attachment://eggs_incubator.png');
    expect(p.files!.map((f) => f.name)).toEqual(['epic.png', 'eggs_incubator.png']);
  });
```

and lines 109-113:

```ts
  it('eggListPayload with no eggs has no thumbnail but still banners the incubator', () => {
    const p = eggListPayload([], 10, 'u1');
    expect(p.embeds[0].toJSON().thumbnail).toBeUndefined();
    expect(p.files!.map((f) => f.name)).toEqual(['eggs_incubator.png']);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hatchery.test.ts -t "eggListPayload with no eggs"`
Expected: FAIL with `TypeError: Cannot read properties of undefined (reading 'map')` — `p.files` is still undefined on the empty branch

- [ ] **Step 3: Write the implementation**

In `src/modules/hatchery/embeds.ts`, replace line 66 (the end of `eggListPayload`) with:

```ts
  if (img) { embed.setThumbnail(img.url); payload.files = [img.file]; }
  // Banner attaches on every branch, including the no-eggs one — mirrors the
  // two-file thumbnail+image pattern in src/modules/shop/index.ts.
  const banner = assetImage('banners', 'eggs_incubator');
  if (banner) { embed.setImage(banner.url); payload.files = [...(payload.files ?? []), banner.file]; }
  return payload;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hatchery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/embeds.ts tests/hatchery.test.ts
git commit -m "feat(hatchery): put the incubator banner on /eggs"
```

---

### Task 31: `/sell` prompt becomes an embed; the confirm update clears it

**Files:**
- Modify: `src/modules/shop/index.ts:114-121,140-148`
- Test: `tests/shop.test.ts:57-71`

**Interfaces:**
- Consumes: `assetImage('banners', 'sell')` (Task 28)
- Produces: `/sell` reply `{ embeds, components: [row], files?, flags: MessageFlags.Ephemeral }`; `sell:confirm` update `{ content, embeds: [], components: [], attachments: [] }`

- [ ] **Step 1: Write the failing test**

Add to `tests/shop.test.ts` inside `describe('sell confirm button')`:

```ts
  it('/sell prompts with the sell banner embed, stays ephemeral, and the confirm update clears it', async () => {
    const d = ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();
    const i = fakeCommand({ name: 'sell', user: 'u1', options: { dino: d.id } });
    await shopModule.commands[1].execute(ctx, i.asChatInput());
    const prompt = i.replies[0] as {
      embeds: Array<{ toJSON(): { description?: string; image?: { url: string } } }>;
      files?: Array<{ name: string | null }>; components: unknown[]; flags?: number;
    };
    expect(prompt.embeds[0].toJSON().description).toContain(`Sell dino #${d.id}`);
    expect(prompt.embeds[0].toJSON().image?.url).toBe('attachment://sell.png');
    expect(prompt.files!.map((f) => f.name)).toEqual(['sell.png']);
    expect(prompt.components).toHaveLength(1);
    expect(prompt.flags).toBe(MessageFlags.Ephemeral);
    // The confirm edits that same message: without embeds:[]/attachments:[] the
    // stale "Sell dino #N?" embed and its banner would outlive the sale.
    const b = fakeButton({ customId: `sell:confirm:${d.id}`, user: 'u1' });
    await shopModule.components[0].execute(ctx, b.asInteraction() as never);
    const done = b.replies[0] as { content: string; embeds: unknown[]; attachments: unknown[] };
    expect(done.content).toContain('Sold for');
    expect(done.embeds).toEqual([]);
    expect(done.attachments).toEqual([]);
  });
```

Extend the discord.js import at the top of `tests/shop.test.ts` so `MessageFlags` and `fakeButton` are available (the file already imports `fakeButton`; add `MessageFlags` to the `discord.js` import).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shop.test.ts -t "/sell prompts with the sell banner embed"`
Expected: FAIL with `Cannot read properties of undefined (reading '0')` — the prompt is still `{ content, components, flags }`

- [ ] **Step 3: Write the implementation**

In `src/modules/shop/index.ts`, replace lines 117-120:

```ts
          const shardText = p.capReached ? '0 shards (daily cap reached)' : `${p.minShards}–${p.maxShards} shards`;
          const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`sell:confirm:${dinoId}`).setEmoji(emojiTag('dw_cash')).setLabel('Confirm sale').setStyle(ButtonStyle.Danger));
          const sellEmbed = new EmbedBuilder().setColor(0xe67e22)
            .setTitle(`${emojiTag('dw_cash')} Confirm sale`)
            .setDescription(`Sell dino #${dinoId} for ${p.cashValue.toLocaleString()} cash + ${shardText}?`);
          const sellPayload: {
            embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[];
            files?: AttachmentBuilder[]; flags: MessageFlags.Ephemeral;
          } = { embeds: [sellEmbed], components: [row], flags: MessageFlags.Ephemeral };
          const sellBanner = assetImage('banners', 'sell');
          if (sellBanner) { sellEmbed.setImage(sellBanner.url); sellPayload.files = [sellBanner.file]; }
          await i.reply(sellPayload);
```

and line 146 in the `sell:confirm` handler:

```ts
          await i.update({ content: `${emojiTag('dw_cash')} Sold for **${res.cash.toLocaleString()}** cash and **${res.shards}** shards${cap}.`,
            embeds: [], components: [], attachments: [] });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shop.test.ts`
Expected: PASS (including the unchanged `Confirm sale` emoji test, which still reads `components[0]`)

- [ ] **Step 5: Commit**

```bash
git add src/modules/shop/index.ts tests/shop.test.ts
git commit -m "feat(shop): promote the /sell prompt to a banner embed"
```

---

### Task 32: Live gallery covers the new surfaces

**Files:**
- Modify: `scripts/test-live.ts:87-99,120-139`

**Interfaces:**
- Consumes: every payload change from Tasks 16, 18, 20, 21, 23, 24, 25
- Produces: three new gallery cases — `park:collect`, `/rescue`, `/battle fight` DEFEAT

- [ ] **Step 1: Seed the two extra dinos**

In `scripts/test-live.ts`, insert after line 99 (the battle-progress seeding loop, so the `b1/b2/b3` squad picks above are untouched):

```ts
// Two extra dinos seeded AFTER the squad picks above so b1/b2/b3 keep their
// identities: one already escaped (for /rescue), one Lv.1 weakling that loses
// to the coastal boss (for the defeat banner).
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'stegosaurus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(), escapedAt: ctx.now() - 3_600_000 }).run();
const escapedDino = ctx.db.select().from(schema.dinos).all().at(-1)!;
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'compsognathus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
const weakDino = ctx.db.select().from(schema.dinos).all().at(-1)!;
```

- [ ] **Step 2: Add the three cases**

Append to the `cases` array in `scripts/test-live.ts` (before the closing `];` on line 139):

```ts
  { title: 'park:collect — income embed (ephemeral in production)', run: () => button('park', 'park:collect', P1) },
  { title: '/rescue — recapture embed', run: () => slash('care', 'rescue', { name: 'rescue', user: P1, options: { dino: escapedDino.id } }) },
  { title: '/battle fight — DEFEAT: lone Lv.1 squad vs the coastal boss', run: () => slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'coastal_dig_boss', dino1: weakDino.id } }) },
```

- [ ] **Step 3: Verify the script typechecks**

Run: `npx tsc --noEmit -p tsconfig.test.json`
Expected: no output, exit 0

- [ ] **Step 4: Run the live sweep and review the gallery**

Run: `npm run test:live`
Expected: summary line `NN ok, 0 failed`; in `TEST_CHANNEL_ID` confirm — hatch reveal shows the cracked egg and no leftover intact egg; battle F4 shows the victory/defeat banner with no bare attachment card; `/eggs`, `/dino list`, `/sell`, `park:collect`, `/rescue` each render their banner with legible text

- [ ] **Step 5: Commit**

```bash
git add scripts/test-live.ts
git commit -m "test(live): add collect, rescue, and defeat cases to the gallery"
```

---

### Task 33: Record the new frame contract and asset conventions

**Files:**
- Modify: `CLAUDE.md:113-120`
- Modify: `docs/assets/prompts.md:1-10,229-235`

**Interfaces:**
- Consumes: the shipped behaviour from Tasks 14-26
- Produces: repo conventions text — the "files attach on F1 and F4" invariant, the `hatch` asset kind, and `scripts/fit-art.mjs`

- [ ] **Step 1: Rewrite the battles frame invariant in `CLAUDE.md`**

Replace lines 113-120 (from "`fightFrames`" through "playable without them."):

```md
  which the small-squad slicing branch relies on. `fightFrames`
  (`src/modules/battles/embeds.ts`) attaches files on **frame 1 and frame 4
  only**, and each attaching frame uploads exactly the files its embed
  references. F2/F3 must carry no `files`/`attachments` key at all — F1's
  uploads survive and their `attachment://` URLs keep resolving. F4 is the
  opposite: it always sends `attachments: []` plus its own `files`, because a
  payload carrying `files` (or an explicit `attachments` array) replaces the
  message's whole attachment set (discord.js `MessagePayload`), which is how F4
  sheds the chapter banner it no longer references and how the no-art case
  avoids stranding F1's upload as a bare attachment card. Never dress F4 with
  the chapter banner again. `tests/battles-embeds.test.ts`'s frame-contract test
  is the machine gate; the skip button replays the same F4 payload via
  `i.update`, so both paths must stay identical.
```

- [ ] **Step 2: Record the new asset plumbing in `CLAUDE.md`**

Append to the same bullet (immediately after the block from Step 1):

```md
  Embed art kinds are `eggs | sites | banners | battles | hatch` (`assetImage`,
  `src/core/images.ts`); `hatch/<rarity>-crack.png` is the hatch-reveal image and
  its attachment name never collides with `eggs/<rarity>.png`. Generated art is
  fitted by `node scripts/fit-art.mjs banner|cutout <src> <dest>` — banners are
  1536×1024 (asserted in `tests/images.test.ts`), transparent cutouts 1024×1024.
```

- [ ] **Step 3: Fix the stale counts in `docs/assets/prompts.md`**

Replace the sentence on lines 7-8 (`The five embed banners were generated with Higgsfield Nano Banana Pro, care_neglect as a reference chain off care.`):

```md
The thirteen embed banners were generated with Higgsfield Nano Banana Pro,
`care_neglect` as a reference chain off `care` and `battle_defeat` off
`battle_victory`. The six hatch cracks were generated as reference-chain edits
of their own egg icons.
```

And replace line 231 (`Six wide banners for the surfaces…`):

```md
Thirteen wide banners for the surfaces that have no site or egg art of their own.
```

- [ ] **Step 4: Run the full offline gate**

Run: `npm test`
Expected: PASS, 0 failed

- [ ] **Step 5: Run the typecheck gate**

Run: `npm run typecheck`
Expected: no output, exit 0

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/assets/prompts.md
git commit -m "docs: record the frame-4 attachment contract and hatch art kind"
```

---
