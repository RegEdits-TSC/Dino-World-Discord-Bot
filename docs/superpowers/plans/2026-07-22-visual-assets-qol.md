# Visual Assets + QoL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire egg/site art into embeds (hero egg on hatch, thumbnails elsewhere, site banners on claim) and ship 8 QoL fixes: /help, escape countdown, trade pings, pagination, /mythic confirm, next-step hints, income-cap warning, /top your-rank.

**Architecture:** A tiny `assetImage` helper resolves PNGs under `assets/images/` and returns `AttachmentBuilder` + `attachment://` refs, or `null` when the file is absent — every call site degrades to an image-less embed. QoL items are per-module edits reusing existing patterns (confirm buttons, `ComponentDef` prefixes, `deliverNotification`); one new module (`help`), one new core file (`paginate.ts`), one new `Ctx` method (`notify`).

**Tech Stack:** discord.js 14, drizzle + better-sqlite3 (synchronous), vitest, ESM NodeNext.

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time via `ctx.now()`, randomness via `ctx.rng()` — never `Date.now()`/`Math.random()` in src.
- DB access is synchronous drizzle (`.get()`/`.all()`/`.run()`), never awaited.
- Missing image asset = embed renders without the image. Never throw, never log per-interaction.
- Success replies: public `i.reply({ content })` with emoji prefix. Errors: `MessageFlags.Ephemeral`. Buttons: `i.update(...)` on success.
- Run a single test file: `npm test -- tests/<file>.test.ts`. Full suite: `npm test`. Types: `npm run typecheck`.
- Commit after each task. Plain one-line messages. Do not append Co-Authored-By trailers or any generated-with footer — commits are authored solely by the repo owner.
- The new `/help` command changes deployed builders: after the final task, `npm run deploy-commands` must be run (exactly one bot instance per token).
- Baseline before Task 1: 228 passing tests.
- **Asset generation is outside this plan** (deliberate): the repo owner generates the 7 remaining site images with ChatGPT using `docs/assets/prompts.md` and drops them into `assets/images/sites/` as they finish. The style test (`volcano_core-banner.png`) is already approved and committed. No task may depend on any `sites/` file existing.
- Deliberate deviations from the spec, decided here once: (1) escape countdowns render as live Discord relative timestamps (`<t:…:R>`) instead of static "Xh Ym" text; (2) the at-risk and income-cap warnings render as parts of the dashboard embed's fields (the embed has no literal "Collect field" — Collect is a button); (3) `ImageRef.file` is the field name (not the spec's `attachment`, which would collide conceptually with the `attachment://` string); (4) lazy per-path existence memoization replaces the spec's startup scan — equivalent effect, and a file added at runtime is picked up on first reference unless that path was already negatively cached.

---

### Task 1: `assetImage` helper

**Files:**
- Create: `src/core/images.ts`
- Test: `tests/images.test.ts`

**Interfaces:**
- Produces: `assetImage(kind: 'eggs' | 'sites', name: string): ImageRef | null` where `ImageRef = { file: AttachmentBuilder; url: string }`. `url` is `attachment://<name>.png`. Used by Tasks 2–4.

- [ ] **Step 1: Write the failing test**

`tests/images.test.ts` (new file). The six egg PNGs are committed under `assets/images/eggs/`, so the present-file case uses a real egg; site art may be absent while assets are still being generated, so no test may assume any `sites/` file exists.

```ts
import { describe, it, expect } from 'vitest';
import { assetImage } from '../src/core/images.js';

describe('assetImage', () => {
  it('returns an attachment ref for a present file', () => {
    const img = assetImage('eggs', 'common');
    expect(img).not.toBeNull();
    expect(img!.url).toBe('attachment://common.png');
    expect(img!.file.name).toBe('common.png');
  });
  it('returns null for a missing file', () => {
    expect(assetImage('eggs', 'no-such-rarity')).toBeNull();
    expect(assetImage('sites', 'no-such-site-banner')).toBeNull();
  });
  it('caches existence checks (same answer on repeat calls)', () => {
    expect(assetImage('eggs', 'mythic')).not.toBeNull();
    expect(assetImage('eggs', 'mythic')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/images.test.ts`
Expected: FAIL — `Cannot find module '../src/core/images.js'`

- [ ] **Step 3: Write the implementation**

`src/core/images.ts` (new file):

```ts
import { AttachmentBuilder } from 'discord.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ImageRef { file: AttachmentBuilder; url: string }

// Existence is checked once per path and cached — assets don't change at runtime.
const cache = new Map<string, boolean>();

function present(abs: string): boolean {
  let hit = cache.get(abs);
  if (hit === undefined) { hit = existsSync(abs); cache.set(abs, hit); }
  return hit;
}

// Missing asset = null; callers render the embed without the image. The bot
// must work with zero, some, or all assets present. `name` values come from
// internal enums (rarities, site ids) — never user input.
export function assetImage(kind: 'eggs' | 'sites', name: string): ImageRef | null {
  const fileName = `${name}.png`;
  const abs = resolve(process.cwd(), 'assets/images', kind, fileName);
  if (!present(abs)) return null;
  return { file: new AttachmentBuilder(abs, { name: fileName }), url: `attachment://${fileName}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/images.test.ts` — Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/images.ts tests/images.test.ts
git commit -m "Add assetImage helper with missing-file fallback"
```

---

### Task 2: Hatchery visuals — hero egg on hatch, thumbnail on /eggs

**Files:**
- Modify: `src/modules/hatchery/embeds.ts`
- Modify: `src/modules/hatchery/index.ts` (the `/hatch` reply at ~line 52 and the `/eggs` handler at lines 18–28)
- Test: `tests/hatchery.test.ts`

**Interfaces:**
- Consumes: `assetImage` from Task 1.
- Produces: `preHatchPayload(rarity: string, eggId: number)` returning `{ embeds, components, files? }` (replaces direct `preHatchEmbed` use in `/hatch`); `eggListPayload(eggs: Egg[], now: number)` returning `{ embeds, files? }`; `RARITY_COLOR` becomes exported from `hatchery/embeds.ts` (Task 3 imports it). `revealPayload` gains `files: []` and `attachments: []` so cracking strips the egg image. Task 9 extends `eggListPayload` with paging.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hatchery.test.ts` (existing file; setup already has `makeCtx`, `getOrCreateUser`, `addEgg` helpers):

```ts
import { preHatchPayload, eggListPayload, revealPayload } from '../src/modules/hatchery/embeds.js';
import { getSpecies } from '../src/data/species/index.js';

describe('hatchery visuals', () => {
  it('preHatchPayload sets the hero egg image and attaches the file', () => {
    const p = preHatchPayload('rare', 7);
    expect(p.embeds[0].toJSON().image?.url).toBe('attachment://rare.png');
    expect(p.files).toHaveLength(1);
    expect(p.components).toHaveLength(1); // crack button preserved
  });
  it('preHatchPayload degrades to no image when the asset is missing', () => {
    const p = preHatchPayload('not-a-rarity', 7);
    expect(p.embeds[0].toJSON().image).toBeUndefined();
    expect(p.files).toBeUndefined();
  });
  it('revealPayload clears attachments so the egg image disappears on crack', () => {
    const p = revealPayload(getSpecies('velociraptor'));
    expect(p.files).toEqual([]);
    expect(p.attachments).toEqual([]);
  });
  it('eggListPayload thumbnails the ready egg over incubating and newest', () => {
    const ready = { ...addEgg('epic'), hatchesAt: 5, incubationStartedAt: 1 };
    const incubating = { ...addEgg('rare'), hatchesAt: 999_999, incubationStartedAt: 1 };
    const newest = addEgg('common');
    const p = eggListPayload([newest, incubating, ready], 10);
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://epic.png');
    expect(p.files).toHaveLength(1);
  });
  it('eggListPayload falls back to newest-obtained when nothing is incubating', () => {
    const older = { ...addEgg('common'), obtainedAt: 1 };
    const newer = { ...addEgg('legendary'), obtainedAt: 2 };
    const p = eggListPayload([older, newer], 10);
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://legendary.png');
  });
  it('eggListPayload with no eggs has no thumbnail', () => {
    const p = eggListPayload([], 10);
    expect(p.embeds[0].toJSON().thumbnail).toBeUndefined();
    expect(p.files).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/hatchery.test.ts`
Expected: FAIL — `preHatchPayload`/`eggListPayload` not exported.

- [ ] **Step 3: Implement in `embeds.ts`**

In `src/modules/hatchery/embeds.ts`: export `RARITY_COLOR` (change `const RARITY_COLOR` to `export const RARITY_COLOR`), add imports, add the two payload builders, and extend `revealPayload`'s return:

```ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type AttachmentBuilder } from 'discord.js';
import type { Species } from '../../data/types.js';
import { RARITY } from '../../data/rarity.js';
import { assetImage } from '../../core/images.js';
import type { Egg } from './service.js';

export const RARITY_COLOR: Record<string, number> = {
  common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xf1c40f, mythic: 0xe74c3c,
};
```

New functions (keep `crackButton` and `preHatchEmbed` as-is; `preHatchPayload` wraps the latter):

```ts
export function preHatchPayload(rarity: string, eggId: number) {
  const embed = preHatchEmbed(rarity);
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof crackButton>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: [crackButton(eggId)] };
  const img = assetImage('eggs', rarity);
  if (img) { embed.setImage(img.url); payload.files = [img.file]; }
  return payload;
}

// The egg the player most likely acts on next: ready-to-hatch, else incubating, else newest.
function featuredEgg(eggs: Egg[], now: number): Egg | undefined {
  return eggs.find((e) => e.hatchesAt !== null && e.hatchesAt <= now)
    ?? eggs.find((e) => e.hatchesAt !== null && e.hatchesAt > now)
    ?? [...eggs].sort((a, b) => b.obtainedAt - a.obtainedAt)[0];
}

export function eggListPayload(eggs: Egg[], now: number) {
  const lines = eggs.length ? eggs.map((e) => {
    const status = e.hatchesAt === null ? 'in inventory'
      : e.hatchesAt <= now ? 'READY — /hatch' : `hatching (ready <t:${Math.floor(e.hatchesAt / 1000)}:R>)`;
    return `#${e.id} — ${e.rarity} egg — ${status}`;
  }).join('\n') : 'No eggs. Run /expedition or /shop.';
  const embed = new EmbedBuilder().setTitle('🥚 Eggs').setDescription(lines).setColor(0x3ba55c);
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  const featured = featuredEgg(eggs, now);
  const img = featured ? assetImage('eggs', featured.rarity) : null;
  if (img) { embed.setThumbnail(img.url); payload.files = [img.file]; }
  return payload;
}
```

In `revealPayload`, change the return to strip the pre-hatch attachment on `i.update`:

```ts
  return { embeds: [embed], components: [], files: [], attachments: [] };
```

- [ ] **Step 4: Rewire `index.ts`**

In `src/modules/hatchery/index.ts`:
- Import change: `import { preHatchPayload, crackButton, revealPayload, eggListPayload } from './embeds.js';` (drop `preHatchEmbed` if now unused there; keep `crackButton` only if still referenced).
- `/hatch` reply (was `await i.reply({ embeds: [preHatchEmbed(egg.rarity)], components: [crackButton(eggId)] });`) becomes:

```ts
await i.reply(preHatchPayload(egg.rarity, eggId));
```

- `/eggs` execute body (lines 24–32) becomes:

```ts
getOrCreateUser(ctx, i.user.id, i.user.displayName);
const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
await i.reply(eggListPayload(eggs, ctx.now()));
```

(The `EmbedBuilder` import in `index.ts` may become unused — remove it if so.)

- [ ] **Step 5: Run tests, verify pass + no regressions**

Run: `npm test -- tests/hatchery.test.ts` — Expected: PASS (all prior cases plus 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/modules/hatchery tests/hatchery.test.ts
git commit -m "Add hero egg art to hatch and featured-egg thumbnail to /eggs"
```

---

### Task 3: Shop visuals — rotation thumbnail, purchase embed

**Files:**
- Modify: `src/modules/shop/index.ts` (`/shop view` lines 31–40, `/shop egg` lines 41–46)
- Test: `tests/shop.test.ts`

**Interfaces:**
- Consumes: `assetImage` (Task 1), `RARITY_COLOR` from `../hatchery/embeds.js` (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `tests/shop.test.ts` (existing setup seeds cash via `ctx.economy.apply('u1', { cash: 200_000 }, 'seed', 0)`):

```ts
describe('shop visuals', () => {
  it('/shop view thumbnails the best egg in today\'s rotation', async () => {
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { thumbnail?: { url: string } } }>; files?: unknown[] };
    // dailyEggOffers always returns ≥1 rarity with egg art present for all six rarities
    expect(payload.embeds[0].toJSON().thumbnail?.url).toMatch(/^attachment:\/\/(common|uncommon|rare|epic|legendary)\.png$/);
    expect(payload.files).toHaveLength(1);
  });
  it('/shop egg purchase replies with a rarity-colored embed and egg thumbnail', async () => {
    const offers = dailyEggOffers(0, ctx.now());
    const i = fakeCommand({ name: 'shop', sub: 'egg', user: 'u1', options: { rarity: offers[0] } });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { thumbnail?: { url: string }; description?: string } }> };
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${offers[0]}.png`);
    expect(payload.embeds[0].toJSON().description).toContain('/incubate');
  });
});
```

`dailyEggOffers` is already imported at the top of `tests/shop.test.ts` (line 4) — do not add a second import.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/shop.test.ts` — Expected: the 2 new tests FAIL (no thumbnail / reply is plain content).

- [ ] **Step 3: Implement**

In `src/modules/shop/index.ts` add imports:

```ts
import { assetImage } from '../../core/images.js';
import { RARITY_COLOR } from '../hatchery/embeds.js';
import { RARITY } from '../../data/rarity.js';
import type { AttachmentBuilder } from 'discord.js';
```

`/shop view`: after building the embed (existing `addFields` chain), thumbnail the highest-rarity offer. `Object.keys(RARITY)` is the canonical common→mythic order:

```ts
const embed = new EmbedBuilder().setTitle('🏪 Shop — today').setColor(0x5865F2).addFields(
  { name: '🥚 Eggs (/shop egg)', value: eggLines },
  { name: '🍖 Food (/shop food)', value: foodLine },
  { name: '🌴 Decor (/decorate)', value: decorLine },
);
const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
const order = Object.keys(RARITY);
const best = offers.length ? offers.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a)) : null;
const img = best ? assetImage('eggs', best) : null;
if (img) { embed.setThumbnail(img.url); payload.files = [img.file]; }
await i.reply(payload);
```

`/shop egg` success reply (replaces the plain-content reply after `buyEgg`):

```ts
const egg = buyEgg(ctx, i.user.id, rarity);
const embed = new EmbedBuilder().setColor(RARITY_COLOR[egg.rarity] ?? 0x95a5a6)
  .setTitle(`🥚 Bought a ${egg.rarity} egg (#${egg.id})`)
  .setDescription(`Incubate it with /incubate ${egg.id}.`);
const eggPayload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
const eggImg = assetImage('eggs', egg.rarity);
if (eggImg) { embed.setThumbnail(eggImg.url); eggPayload.files = [eggImg.file]; }
await i.reply(eggPayload);
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/shop.test.ts` — Expected: PASS. If a prior test asserted the old plain-text purchase reply (`replies[0].content` containing 'Bought'), update it to read the embed title instead — the behavior change is the point of this task.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shop/index.ts tests/shop.test.ts
git commit -m "Add egg art thumbnails to shop view and purchases"
```

---

### Task 4: Expedition visuals — site thumbs on start/status, banner on claim

**Files:**
- Modify: `src/modules/expeditions/index.ts` (start line ~43, status 46–49, claim 50–54)
- Test: `tests/expeditions.test.ts`

**Interfaces:**
- Consumes: `assetImage` (Task 1). Site art files: `sites/<siteId>-thumb.png`, `sites/<siteId>-banner.png` — may not all exist yet; every path must work without them.

- [ ] **Step 1: Write the failing tests**

Append to `tests/expeditions.test.ts` (existing file; it already creates users and seeds cash for `startExpedition`):

```ts
describe('expedition visuals', () => {
  it('/expedition start replies with a site embed', async () => {
    ctx.economy.apply('u1', { cash: 1_000 }, 'seed', 0);
    const i = fakeCommand({ name: 'expedition', sub: 'start', user: 'u1', guild: 'g1', options: { site: 'coastal_dig' } });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> };
    expect(payload.embeds[0].toJSON().title).toContain('Coastal Dig');
  });
  it('/expedition claim embed still renders when banner art is absent', async () => {
    ctx.economy.apply('u1', { cash: 1_000 }, 'seed', 0);
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 16 * 60_000);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> };
    expect(payload.embeds[0].toJSON().title).toContain('Coastal Dig');
  });
});
```

(Assert only structure, not image presence — site art files land asynchronously as they're generated.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/expeditions.test.ts` — Expected: the start test FAILS (reply is plain `content`, embeds undefined).

- [ ] **Step 3: Implement**

In `src/modules/expeditions/index.ts` add imports:

```ts
import { assetImage } from '../../core/images.js';
import type { AttachmentBuilder } from 'discord.js';
```

Add a local payload builder above the manifest:

```ts
function sitePayload(siteId: string, description: string) {
  const embed = new EmbedBuilder().setColor(0xe8590c)
    .setTitle(`🧭 ${EXPEDITION_SITES[siteId].name}`).setDescription(description);
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  const img = assetImage('sites', `${siteId}-thumb`);
  if (img) { embed.setThumbnail(img.url); payload.files = [img.file]; }
  return payload;
}
```

Rewire the three subcommands:

```ts
if (sub === 'start') {
  const exp = startExpedition(ctx, i.user.id, i.options.getString('site', true), i.guildId);
  await i.reply(sitePayload(exp.siteId, `Crew dispatched — back <t:${Math.floor(exp.returnsAt / 1000)}:R>.`));
} else if (sub === 'status') {
  const exp = activeExpedition(ctx, i.user.id);
  if (!exp) { await i.reply({ content: 'No active expedition. Start one with /expedition start.', flags: MessageFlags.Ephemeral }); return; }
  await i.reply(sitePayload(exp.siteId, exp.returnsAt <= ctx.now()
    ? '✅ Back! Use /expedition claim.'
    : `⏳ Digging — back <t:${Math.floor(exp.returnsAt / 1000)}:R>.`));
} else {
  const { loot, site } = claimExpedition(ctx, i.user.id);
  const embed = new EmbedBuilder().setColor(0xe8590c).setTitle(`🧭 ${site.name} — returned!`)
    .setDescription(`Found a **${loot.eggRarity}** egg!`)
    .addFields({ name: '💰 Cash', value: `+${loot.cash}`, inline: true }, { name: '🍖 Food', value: `+${loot.food}`, inline: true });
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  const banner = assetImage('sites', `${site.id}-banner`);
  if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
  await i.reply(payload);
}
```

(Keep the surrounding `getOrCreateUser` call and the `ExpeditionError`/`InsufficientFundsError` catch tail exactly as they are.)

- [ ] **Step 4: Run tests, verify pass + fix any prior assertions**

Run: `npm test -- tests/expeditions.test.ts` — Expected: PASS. Prior tests asserting `replies[0].content` for start/status must be updated to read the embed instead (same information, embed-shaped now).

- [ ] **Step 5: Commit**

```bash
git add src/modules/expeditions/index.ts tests/expeditions.test.ts
git commit -m "Add site art to expedition embeds with banner on claim"
```

---

### Task 5: `/help` module

**Files:**
- Create: `src/modules/help/index.ts`
- Modify: `modules.json`, `src/index.ts`, `src/deploy-commands.ts`
- Test: create `tests/help.test.ts`; modify `tests/registry-load.test.ts` (18 → 19 + import/flags/array), `tests/config.test.ts` (modules map)

**Interfaces:**
- Produces: `helpModule: ModuleManifest` with one `/help [topic]` command, static choices, no autocomplete, no components.

- [ ] **Step 1: Write the failing tests**

`tests/help.test.ts` (new file):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { helpModule, HELP_TOPICS } from '../src/modules/help/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

describe('/help', () => {
  it('overview embed lists every topic and includes the first-10-minutes walkthrough', async () => {
    const i = fakeCommand({ name: 'help', user: 'u1' });
    await helpModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { description?: string; fields?: Array<{ name: string }> } }> }).embeds[0].toJSON();
    expect(embed.fields).toHaveLength(Object.keys(HELP_TOPICS).length);
    expect(embed.description).toContain('first 10 minutes');
  });
  it('every topic renders its own embed', async () => {
    for (const topic of Object.keys(HELP_TOPICS)) {
      const i = fakeCommand({ name: 'help', user: 'u1', options: { topic } });
      await helpModule.commands[0].execute(ctx, i.asChatInput());
      const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> }).embeds[0].toJSON();
      expect(embed.title).toBe(HELP_TOPICS[topic].title);
    }
  });
});
```

Update `tests/registry-load.test.ts`: add `import { helpModule } from '../src/modules/help/index.js';`, add `help: true` to the flags object, add `helpModule` to the array, change `expect(r.commands().length).toBe(18)` to `toBe(19)`.

Update `tests/config.test.ts` line 22 expected map: add `help: true` (position must match however `modules.json` is edited; `toEqual` ignores key order).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/help.test.ts tests/registry-load.test.ts tests/config.test.ts`
Expected: help + registry FAIL (module missing). config also FAILS (its expected map now includes `help: true` but `modules.json` doesn't yet — Step 4 fixes that).

- [ ] **Step 3: Implement the module**

`src/modules/help/index.ts` (new file):

```ts
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { ModuleManifest } from '../../core/modules.js';

export const HELP_TOPICS: Record<string, { title: string; body: string }> = {
  'getting-started': { title: '🦕 Getting started', body: [
    'Your first 10 minutes:',
    '1. `/park view` — see your park and the Collect button.',
    '2. `/expedition start site:coastal_dig` — send a dig crew (15 min).',
    '3. `/expedition claim` when it returns — you get an egg + cash + food.',
    '4. `/incubate egg:<id>`, then `/hatch egg:<id>` when ready.',
    '5. `/build kind:herbivore_paddock`, then `/dino assign` — unassigned dinos earn nothing.',
    '6. `/feed all` regularly — hungry dinos get uncomfortable and eventually escape.',
  ].join('\n') },
  park: { title: '🏞️ Park', body: [
    '`/park view [user]` — dashboard, park map, Collect button.',
    '`/park rename name:<text>` — rename your park.',
    '`/build kind:<lot>` — build a paddock or facility on an empty lot.',
    '`/upgrade lot:<id>` — raise a lot one level.',
    '`/decorate lot:<id> item:<decor>` — decor boosts comfort for matching biomes.',
    'Income accrues while dinos are comfortable, up to your Visitor Center cap — collect often.',
  ].join('\n') },
  eggs: { title: '🥚 Eggs', body: [
    '`/eggs` — your eggs and incubator status.',
    '`/incubate egg:<id>` — start the timer (slots grow with the Hatchery Lab).',
    '`/hatch egg:<id>` — crack a ready egg and meet your dino.',
    '`/mythic species:<name>` — spend 500 shards on a Mythic egg (needs 4★ rating).',
  ].join('\n') },
  expeditions: { title: '🧭 Expeditions', body: [
    '`/expedition start site:<site>` — pay cash, wait, get loot. Higher sites need higher rating.',
    '`/expedition status` — check the timer.',
    '`/expedition claim` — collect the egg + cash + food.',
    'Sites: Coastal Dig (15m) → Amber Ridge (1h) → Frozen Cliffs (4h) → Volcano Core (8h).',
  ].join('\n') },
  shop: { title: '🏪 Shop', body: [
    '`/shop view` — today\'s egg rotation (changes daily), food, decor.',
    '`/shop egg rarity:<r>` — buy an egg from today\'s rotation.',
    '`/shop food units:<n>` — food for feeding.',
    '`/sell dino:<id>` — sell a dino for cash + shards (shards buy Mythics).',
  ].join('\n') },
  care: { title: '🍖 Care', body: [
    '`/feed one dino:<id>` or `/feed all` — feeding resets hunger; costs food by rarity.',
    'Hunger drains over 48h. Low comfort long enough → the dino escapes and stops earning.',
    '`/rescue dino:<id>` — recapture an escaped dino for a fee.',
  ].join('\n') },
  trading: { title: '🤝 Trading', body: [
    '`/trade offer user:<u> ...` — offer dinos/eggs/cash/food for theirs.',
    '`/trade list` — pending trades. `/trade accept|decline id:<id>` as recipient, `/trade cancel id:<id>` as sender.',
    'Offers expire after a while; offered items are locked until resolved.',
  ].join('\n') },
  ranks: { title: '🏆 Ranks', body: [
    '`/top metric:<rating|cash|collection> [scope]` — server or global leaderboards.',
    'Rating grows with dinos, lots, and comfort; it gates expeditions, shop tiers, and Mythics.',
  ].join('\n') },
};

const topicChoices = Object.keys(HELP_TOPICS).map((t) => ({ name: t, value: t }));

export const helpModule: ModuleManifest = {
  name: 'help',
  commands: [
    { data: new SlashCommandBuilder().setName('help').setDescription('How to play Dino World')
        .addStringOption((o) => o.setName('topic').setDescription('Jump to a topic').addChoices(...topicChoices)),
      async execute(_ctx, i) {
        const topic = i.options.getString('topic');
        if (topic && HELP_TOPICS[topic]) {
          const t = HELP_TOPICS[topic];
          await i.reply({ embeds: [new EmbedBuilder().setTitle(t.title).setDescription(t.body).setColor(0x5865F2)] });
          return;
        }
        // The no-topic overview must itself contain the first-10-minutes walkthrough (spec QoL item 1).
        const overview = new EmbedBuilder().setTitle('🦕 Dino World — help').setColor(0x5865F2)
          .setDescription(`Hatch dinos, build a park, keep them fed.\n\n${HELP_TOPICS['getting-started'].body}`)
          .addFields(Object.entries(HELP_TOPICS).map(([key, t]) => ({
            name: t.title, value: `\`/help topic:${key}\``, inline: true,
          })));
        await i.reply({ embeds: [overview] });
      } },
  ],
  components: [],
};
```

- [ ] **Step 4: Register at all 5 sites**

1. `modules.json`: add `"help": true` (keep single-line format).
2. `src/index.ts`: `import { helpModule } from './modules/help/index.js';` + add `helpModule` to the `ModuleRegistry([...])` array.
3. `src/deploy-commands.ts`: same import + array entry.
4. `tests/registry-load.test.ts`: done in Step 1.
5. `tests/config.test.ts`: done in Step 1.

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- tests/help.test.ts tests/registry-load.test.ts tests/config.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/help modules.json src/index.ts src/deploy-commands.ts tests/help.test.ts tests/registry-load.test.ts tests/config.test.ts
git commit -m "Add /help module with topic guide"
```

---

### Task 6: Escape countdown in /dino list + at-risk count on /park view

**Files:**
- Modify: `src/core/clock.ts` (export `rawEscape` as `escapeAt`, add `ESCAPE_WARN_MS`)
- Modify: `src/modules/park/dinos.ts` (`listDinos` gains `escapeAt`)
- Modify: `src/modules/park/embeds.ts` (`dashboardPayload` gains an `opts` param)
- Modify: `src/modules/park/index.ts` (`/dino list` lines, `/park view` own-park path)
- Test: `tests/clock.test.ts`, `tests/dinos.test.ts`, `tests/park.test.ts`

**Interfaces:**
- Consumes: existing private `rawEscape` logic in clock.ts.
- Produces: `export function escapeAt(d: ClockDino): number | null` (rename of private `rawEscape`; update internal callers `escapeMoment` and `accruedIncome`); `export const ESCAPE_WARN_MS = 12 * 3_600_000;`; `listDinos` items gain `escapeAt: number | null`; `dashboardPayload(user, lots, dinoCount, pending, escapedCount = 0, opts: { atRiskCount?: number; capped?: boolean } = {})` — `capped` is consumed by Task 7.

- [ ] **Step 1: Write the failing tests**

Append to `tests/clock.test.ts`. The file's real fixtures are `triceratops`/`velociraptor` (species imports), `herb`/`carn` (`PADDOCKS.herbivore_paddock`/`carnivore_paddock`), and a `fedTrike()` factory; `GRACE_MS` is already imported on line 2 — extend that existing import with `escapeAt, ESCAPE_WARN_MS` rather than adding a new import line:

```ts
describe('escapeAt', () => {
  const base = { hungerAtFed: 100, lastFedAt: 0, escapedAt: null };
  it('is null for an unassigned dino', () => {
    expect(escapeAt({ ...base, species: triceratops, paddock: null, decor: [] })).toBeNull();
  });
  it('is crossing + grace for an assigned dino', () => {
    const e = escapeAt({ ...base, species: triceratops, paddock: herb, decor: [] });
    expect(e).not.toBeNull();
    expect(e!).toBeGreaterThan(GRACE_MS); // crossing is strictly positive from full hunger
  });
  it('returns the stamped instant for an already-escaped dino', () => {
    expect(escapeAt({ ...base, escapedAt: 123, species: triceratops, paddock: herb, decor: [] })).toBe(123);
  });
});
```

Append to `tests/park.test.ts`. The file's `beforeEach` only does `ctx = makeCtx()` — no shared user row — so create one locally. Add `dashboardPayload` to the imports (currently absent): `import { dashboardPayload } from '../src/modules/park/embeds.js';`

```ts
describe('dashboard warnings', () => {
  it('shows the at-risk count in the dino field', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 3, 0, 0, { atRiskCount: 2 });
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name === '🦕 Dinos')!;
    expect(field.value).toContain('⚠ 2 at risk');
  });
  it('omits the warning at zero', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 3, 0, 0, {});
    const field = p.embeds[0].toJSON().fields!.find((f) => f.name === '🦕 Dinos')!;
    expect(field.value).toBe('3');
  });
});
```

Also append a threshold-boundary test for the `/dino list` warning window. Escape math for `triceratops` in an undecorated `herbivore_paddock` (fit 0.75, hunger 100): crossing at `lastFedAt + 32h`, escape at `lastFedAt + 40h`. Place one dino just inside the 12h window and one just outside:

```ts
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
```

(If `buildLot`/`schema`/`parkModule` are not yet imported in `tests/park.test.ts`, extend the existing import lines — the file already imports from `./harness.js`, `../src/modules/park/service.js`, and `../src/core/db/index.js` for its other tests.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/clock.test.ts tests/park.test.ts` — Expected: FAIL (`escapeAt` not exported; `dashboardPayload` arity).

- [ ] **Step 3: Implement clock + dinos changes**

`src/core/clock.ts`: rename `function rawEscape` to `export function escapeAt` (keep the doc comment), update its two internal callers (`escapeMoment` line ~54, `accruedIncome` line ~68) from `rawEscape(d)` to `escapeAt(d)`. Add:

```ts
/** Show "escapes soon" warnings when the escape instant is within this window. */
export const ESCAPE_WARN_MS = 12 * 3_600_000;
```

`src/modules/park/dinos.ts` — `listDinos` mapping gains the instant (import `escapeAt` from `'../../core/clock.js'`):

```ts
return dinos.map((d, i) => ({
  dino: d,
  species: getSpecies(d.speciesId),
  comfort: comfortAt(clockDinos[i], ctx.now()),
  escapeAt: escapeAt(clockDinos[i]),
}));
```

- [ ] **Step 4: Implement embed + command changes**

`src/modules/park/embeds.ts` — `dashboardPayload` new signature and dino field:

```ts
export function dashboardPayload(
  user: User, lots: Lot[], dinoCount: number, pending: number, escapedCount = 0,
  opts: { atRiskCount?: number; capped?: boolean } = {},
) {
  const extras: string[] = [];
  if (escapedCount > 0) extras.push(`${escapedCount} 🚨 escaped`);
  if (opts.atRiskCount) extras.push(`⚠ ${opts.atRiskCount} at risk`);
  const dinoValue = extras.length ? `${dinoCount} (${extras.join(', ')})` : String(dinoCount);
  // ...same embed, with the Dinos field value replaced by dinoValue
```

(`opts.capped` is wired in Task 7 — accept it now so the signature only changes once.)

`src/modules/park/index.ts` `/dino list` lines (was lines 124-133):

```ts
if (sub === 'list') {
  const dinos = listDinos(ctx, i.user.id);
  const nowMs = ctx.now();
  const lines = dinos.length
    ? dinos.map((d) => {
        const status = d.dino.escapedAt !== null ? '🚨 ESCAPED — /rescue' : `${Math.round(d.comfort * 100)}% comfort`;
        const warn = d.dino.escapedAt === null && d.escapeAt !== null && d.escapeAt - nowMs <= ESCAPE_WARN_MS
          ? ` — ⚠ escapes <t:${Math.floor(d.escapeAt / 1000)}:R>` : '';
        const loc = d.dino.lotId ? `lot ${d.dino.lotId}` : 'unassigned';
        return `#${d.dino.id} ${d.species.name} — ${status}${warn} — ${loc}`;
      }).join('\n')
    : 'No dinos yet. Hatch one!';
  await i.reply({ embeds: [new EmbedBuilder().setTitle('🦕 Your dinos').setDescription(lines).setColor(0x3ba55c)] });
}
```

`/park view` own-park path — compute the at-risk count (import `toClockDinos` from `'./service.js'`, `escapeAt, ESCAPE_WARN_MS` from `'../../core/clock.js'`):

```ts
const { clockDinos } = toClockDinos(ctx, i.user.id);
const nowMs = ctx.now();
const atRiskCount = clockDinos.filter((c) => {
  if (c.escapedAt !== null) return false;
  const e = escapeAt(c);
  return e !== null && e - nowMs <= ESCAPE_WARN_MS;
}).length;
const base = dashboardPayload(user, lots, dinos.length, pendingIncome(ctx, i.user.id), escapedCount, { atRiskCount });
```

(The other-user path keeps its current call — defaults apply.)

- [ ] **Step 5: Run tests, verify pass + no regressions**

Run: `npm test -- tests/clock.test.ts tests/park.test.ts tests/dinos.test.ts tests/escapes.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/clock.ts src/modules/park tests/clock.test.ts tests/park.test.ts
git commit -m "Surface escape countdowns in dino list and park dashboard"
```

---

### Task 7: Income-cap warning on the dashboard

**Files:**
- Modify: `src/modules/park/embeds.ts` (consume `opts.capped`)
- Modify: `src/modules/park/index.ts` (`/park view` own-park path)
- Test: `tests/park.test.ts`

**Interfaces:**
- Consumes: `dashboardPayload` opts from Task 6; `capHours(lots)` from `park/service.ts`; `users.lastCollectAt`.

- [ ] **Step 1: Write the failing tests**

Two layers: rendering given the flag, and the flag's condition driven through `/park view` over time. Append to `tests/park.test.ts` `dashboard warnings` describe:

```ts
  it('adds a capped field when capped', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 1, 480, 0, { capped: true });
    const names = p.embeds[0].toJSON().fields!.map((f) => f.name);
    expect(names).toContain('⛔ Income capped');
  });
  it('no capped field otherwise', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 1, 480, 0, {});
    const names = p.embeds[0].toJSON().fields!.map((f) => f.name);
    expect(names).not.toContain('⛔ Income capped');
  });
```

Condition tests (no Visitor Center → 8h cap; `/park view` defers then edits, so the payload is `replies[0]`; render falls back to embed-only in tests):

```ts
describe('/park view cap warning condition', () => {
  const H = 3_600_000;
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/park.test.ts` — Expected: the 2 new cases FAIL.

- [ ] **Step 3: Implement**

`dashboardPayload`: after the existing `addFields(...)` chain, append conditionally:

```ts
if (opts.capped) {
  embed.addFields({ name: '⛔ Income capped', value: 'Idle earnings hit the Visitor Center cap — collect now to restart them.' });
}
```

`/park view` own-park path (import `capHours` from `'./service.js'`). The elapsed-window check alone false-positives when nothing is earning (pending stays 0 forever), so gate on `pending > 0` too:

```ts
const pending = pendingIncome(ctx, i.user.id);
const capped = pending > 0 && ctx.now() - user.lastCollectAt >= capHours(lots) * 3_600_000;
const base = dashboardPayload(user, lots, dinos.length, pending, escapedCount, { atRiskCount, capped });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/park.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/park tests/park.test.ts
git commit -m "Warn on the dashboard when idle income hits the cap"
```

---

### Task 8: Trade pings via `ctx.notify`

**Files:**
- Modify: `src/core/context.ts` (add `notify`), `src/index.ts` (wire it), `tests/harness.ts` (record calls)
- Modify: `src/modules/trading/index.ts` (offer/accept/decline branches)
- Test: `tests/trading.test.ts`

**Interfaces:**
- Produces: `Ctx.notify(userId: string, originGuildId: string | null, message: string): Promise<void>` — fire-and-forget delivery through the existing channel→DM fallback; never throws. `makeCtx` result gains `notifications: Array<{ userId: string; originGuildId: string | null; message: string }>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/trading.test.ts`. The file's `beforeEach` (lines 12–15) creates users `'a'` and `'b'` with `parkRating` 200 (= `TRADE_MIN_RATING`) — use those, and the real builder option names (`give-cash`/`want-cash` etc., per `src/modules/trading/index.ts:45-52`). The offerer needs cash to lock: seed it.

```ts
describe('trade notifications', () => {
  it('offer pings the recipient', async () => {
    ctx.economy.apply('a', { cash: 1_000 }, 'seed', 0);
    const i = fakeCommand({ name: 'trade', sub: 'offer', user: 'a', guild: 'g1', options: { user: 'b', 'give-cash': 100 } });
    await tradingModule.commands[0].execute(ctx, i.asChatInput());
    expect(ctx.notifications).toHaveLength(1);
    expect(ctx.notifications[0].userId).toBe('b');
    expect(ctx.notifications[0].originGuildId).toBe('g1');
    expect(ctx.notifications[0].message).toContain('/trade accept');
  });
  it('accept pings the offerer', async () => {
    ctx.economy.apply('a', { cash: 1_000 }, 'seed', 0);
    const t = createTrade(ctx, 'a', 'b', { dinoIds: [], eggIds: [], cash: 100, food: 0 }, { dinoIds: [], eggIds: [], cash: 0, food: 0 });
    const i = fakeCommand({ name: 'trade', sub: 'accept', user: 'b', guild: 'g1', options: { id: t.id } });
    await tradingModule.commands[0].execute(ctx, i.asChatInput());
    expect(ctx.notifications.some((n) => n.userId === 'a' && n.message.includes('accepted'))).toBe(true);
  });
  it('decline pings the offerer', async () => {
    ctx.economy.apply('a', { cash: 1_000 }, 'seed', 0);
    const t = createTrade(ctx, 'a', 'b', { dinoIds: [], eggIds: [], cash: 100, food: 0 }, { dinoIds: [], eggIds: [], cash: 0, food: 0 });
    const i = fakeCommand({ name: 'trade', sub: 'decline', user: 'b', guild: 'g1', options: { id: t.id } });
    await tradingModule.commands[0].execute(ctx, i.asChatInput());
    expect(ctx.notifications.some((n) => n.userId === 'a' && n.message.includes('declined'))).toBe(true);
  });
});
```

(If `createTrade` isn't imported in the test file yet, add it to the existing `./service.js`-side import used by other cases.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/trading.test.ts` — Expected: FAIL — `ctx.notifications` undefined (and `notify` missing from `Ctx`).

- [ ] **Step 3: Extend Ctx + harness + index.ts**

`src/core/context.ts`:

```ts
export interface Ctx {
  db: Db; economy: EconomyService; config: Config; scheduler: Scheduler;
  now(): number;        // epoch ms — injected so tests control time
  rng(): number;        // [0,1) — injected so tests are deterministic
  // Fire-and-forget player notification (channel→DM fallback). Never throws.
  notify(userId: string, originGuildId: string | null, message: string): Promise<void>;
}
```

`src/index.ts` — inside the ctx literal add (the `sender` const declared below is captured lazily; `deliverNotification` is already imported in this file for the handlers — if only the handler factories are imported, add `deliverNotification` to that import):

```ts
notify: (userId, originGuildId, message) => deliverNotification(sender, ctx, userId, originGuildId, message),
```

`tests/harness.ts` — `makeCtx` return type becomes `Ctx & { setNow(ms: number): void; notifications: Array<{ userId: string; originGuildId: string | null; message: string }> }`; inside:

```ts
const notifications: Array<{ userId: string; originGuildId: string | null; message: string }> = [];
return {
  // ...existing fields...
  notify: async (userId: string, originGuildId: string | null, message: string) => { notifications.push({ userId, originGuildId, message }); },
  notifications,
  ...overrides,
};
```

- [ ] **Step 4: Wire the three trading branches**

`src/modules/trading/index.ts`:

Offer branch — after `createTrade` and before/after the existing reply (order irrelevant; keep the reply text unchanged):

```ts
const t = createTrade(ctx, i.user.id, target.id, offer, request);
await ctx.notify(target.id, i.guildId,
  `📨 Trade #${t.id} from **${i.user.displayName}** — they give ${summarize(offer)}, they want ${summarize(request)}. Run \`/trade accept id:${t.id}\`.`);
await i.reply({ content: `🤝 Trade **#${t.id}** sent to <@${target.id}>.\nYou give: ${summarize(offer)}\nYou want: ${summarize(request)}\nThey run \`/trade accept id:${t.id}\`.` });
```

Accept branch:

```ts
const t = acceptTrade(ctx, i.user.id, i.options.getInteger('id', true));
await ctx.notify(t.fromUser, i.guildId, `✅ **${i.user.displayName}** accepted your trade #${t.id}!`);
await i.reply({ content: `✅ Trade #${t.id} completed!` });
```

Decline branch — `declineTrade` returns void, so read the row first:

```ts
const declineId = i.options.getInteger('id', true);
const declined = ctx.db.select().from(schema.trades).where(eq(schema.trades.id, declineId)).get();
declineTrade(ctx, i.user.id, declineId);
if (declined) await ctx.notify(declined.fromUser, i.guildId, `❌ Your trade #${declined.id} was declined.`);
await i.reply({ content: '❌ Trade declined.' });
```

(`schema` and `eq` imports: `schema` is already imported in trading/index.ts for autocomplete; add `eq` from `'drizzle-orm'` if absent. Cancel branch unchanged — the canceller is the offerer.)

- [ ] **Step 5: Run tests, verify pass + full-suite sweep**

Run: `npm test` — Expected: full suite PASS. The `Ctx` interface change is the risk point: any test constructing a bare `Ctx` object outside `makeCtx` fails typecheck — run `npm run typecheck` and fix by routing through `makeCtx`.

- [ ] **Step 6: Commit**

```bash
git add src/core/context.ts src/index.ts src/modules/trading/index.ts tests/harness.ts tests/trading.test.ts
git commit -m "Notify trade counterparties on offer, accept, and decline"
```

---

### Task 9: Pagination for /dino list, /eggs, /trade list

**Files:**
- Create: `src/core/paginate.ts`
- Modify: `src/modules/park/index.ts` (dino list + `park` component), `src/modules/hatchery/embeds.ts` + `index.ts` (`eggListPayload` + `hatch` component), `src/modules/trading/index.ts` (list + new `trade` component)
- Test: create `tests/paginate.test.ts`; extend `tests/dinos.test.ts`, `tests/hatchery.test.ts`, `tests/trading.test.ts`

**Interfaces:**
- Produces: `paginate<T>(all: T[], page: number, perPage = 10): { items: T[]; page: number; pages: number }` (page clamped to [1, pages]); `pageRow(prefix: string, action: string, userId: string, page: number, pages: number): ActionRowBuilder<ButtonBuilder>` with customIds `<prefix>:<action>:<userId>:<targetPage>`, Prev disabled on page 1, Next disabled on the last page. `eggListPayload(eggs, now, userId, page = 1)` (extends Task 2's signature).
- CustomId actions: `park:dinos:<userId>:<page>`, `hatch:eggs:<userId>:<page>`, `trade:list:<userId>:<page>`. The embedded userId locks paging to the list owner; others get an ephemeral refusal.

- [ ] **Step 1: Write the failing tests**

`tests/paginate.test.ts` (new file):

```ts
import { describe, it, expect } from 'vitest';
import { paginate, pageRow } from '../src/core/paginate.js';

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, n) => n);
  it('slices 10 per page and reports pages', () => {
    expect(paginate(items, 1)).toEqual({ items: items.slice(0, 10), page: 1, pages: 3 });
    expect(paginate(items, 3).items).toHaveLength(5);
  });
  it('clamps out-of-range pages', () => {
    expect(paginate(items, 0).page).toBe(1);
    expect(paginate(items, 99).page).toBe(3);
  });
  it('empty list is one empty page', () => {
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pages: 1 });
  });
  it('exactly 10 rows is a single page', () => {
    expect(paginate(items.slice(0, 10), 1).pages).toBe(1);
  });
});

describe('pageRow', () => {
  it('encodes owner + target pages and disables at bounds', () => {
    const row = pageRow('park', 'dinos', 'u1', 1, 3).toJSON();
    expect(row.components[0].custom_id).toBe('park:dinos:u1:0');
    expect(row.components[0].disabled).toBe(true);   // Prev on page 1
    expect(row.components[1].custom_id).toBe('park:dinos:u1:2');
    expect(row.components[1].disabled).toBe(false);
    const last = pageRow('park', 'dinos', 'u1', 3, 3).toJSON();
    expect(last.components[1].disabled).toBe(true);  // Next on last page
  });
});
```

Append a component test to `tests/dinos.test.ts`. Extend the harness import first — the file currently imports only `makeCtx, fakeCommand`; change it to `import { makeCtx, fakeCommand, fakeButton } from './harness.js';`. Insert 11 dinos directly (2 pages):

```ts
describe('dino list pagination', () => {
  it('page button re-renders the requested page for the owner', async () => {
    for (let n = 0; n < 11; n++) {
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    }
    const b = fakeButton({ customId: 'park:dinos:u1:2', user: 'u1', guild: 'g1' });
    await parkModule.components[0].execute(ctx, b.asInteraction() as never);
    const payload = b.replies[0] as { embeds: Array<{ toJSON(): { footer?: { text: string } } }> };
    expect(payload.embeds[0].toJSON().footer?.text).toBe('Page 2/2');
  });
  it('rejects another user\'s click', async () => {
    const b = fakeButton({ customId: 'park:dinos:u1:2', user: 'u2', guild: 'g1' });
    await parkModule.components[0].execute(ctx, b.asInteraction() as never);
    expect((b.replies[0] as { content: string }).content).toContain('Not your');
  });
});
```

Append to `tests/hatchery.test.ts`: `/eggs` with 11 eggs shows `Page 1/2` footer and a `hatch:eggs:u1:2` Next button; `hatch:eggs` button click by owner updates to page 2. Same shape as the dinos tests, via `addEgg` in a loop and `hatcheryModule.components` (find the ComponentDef whose `prefix` is `'hatch'`).

Append to `tests/trading.test.ts`: `/trade list` with 11 pending trades shows `Page 1/2`; a `trade:list:a:2` click by `'a'` updates to page 2. **`createTrade` cannot seed 11 trades** — `TRADE_DAILY_CAP` is 3 per sender per 24h — so insert rows directly, the way other tests insert dinos:

```ts
for (let n = 0; n < 11; n++) {
  ctx.db.insert(schema.trades).values({
    fromUser: 'b', toUser: 'a',
    offer: { dinoIds: [], eggIds: [], cash: 1, food: 0 },
    request: { dinoIds: [], eggIds: [], cash: 0, food: 0 },
    status: 'pending', createdAt: ctx.now(),
  }).run();
}
```

The trading manifest gains its first ComponentDef — also assert `tradingModule.components[0].prefix === 'trade'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/paginate.test.ts tests/dinos.test.ts` — Expected: FAIL (`paginate` module missing; button branch absent).

- [ ] **Step 3: Implement `src/core/paginate.ts`**

```ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const PAGE_SIZE = 10;

export function paginate<T>(all: T[], page: number, perPage = PAGE_SIZE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(all.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { items: all.slice((p - 1) * perPage, p * perPage), page: p, pages };
}

// customId: `<prefix>:<action>:<userId>:<targetPage>` — the embedded userId locks
// paging to the list owner (these buttons sit on public messages).
export function pageRow(prefix: string, action: string, userId: string, page: number, pages: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:${action}:${userId}:${page - 1}`).setLabel('◀ Prev').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`${prefix}:${action}:${userId}:${page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages),
  );
}
```

- [ ] **Step 4: Wire the three lists**

**Park** — extract `/dino list` into a local payload fn (import `paginate, pageRow` from `'../../core/paginate.js'`, `type Ctx` from `'../../core/context.js'`):

```ts
function dinoListPayload(ctx: Ctx, userId: string, page: number) {
  const all = listDinos(ctx, userId);
  const { items, page: p, pages } = paginate(all, page);
  const nowMs = ctx.now();
  const lines = items.length
    ? items.map((d) => {
        const status = d.dino.escapedAt !== null ? '🚨 ESCAPED — /rescue' : `${Math.round(d.comfort * 100)}% comfort`;
        const warn = d.dino.escapedAt === null && d.escapeAt !== null && d.escapeAt - nowMs <= ESCAPE_WARN_MS
          ? ` — ⚠ escapes <t:${Math.floor(d.escapeAt / 1000)}:R>` : '';
        const loc = d.dino.lotId ? `lot ${d.dino.lotId}` : 'unassigned';
        return `#${d.dino.id} ${d.species.name} — ${status}${warn} — ${loc}`;
      }).join('\n')
    : 'No dinos yet. Hatch one!';
  const embed = new EmbedBuilder().setTitle('🦕 Your dinos').setDescription(lines).setColor(0x3ba55c)
    .setFooter({ text: `Page ${p}/${pages}` });
  return { embeds: [embed], components: pages > 1 ? [pageRow('park', 'dinos', userId, p, pages)] : [] };
}
```

`/dino list` branch becomes `await i.reply(dinoListPayload(ctx, i.user.id, 1));`. Extend the `park` ComponentDef:

```ts
async execute(ctx, i) {
  if (i.customId === 'park:collect') {
    settleEscapes(ctx, i.user.id);
    const { amount } = collectIncome(ctx, i.user.id);
    await i.reply({ content: amount > 0 ? `💰 Collected **${amount.toLocaleString()}** cash.` : 'Nothing to collect yet.', flags: MessageFlags.Ephemeral });
    return;
  }
  const [, action, uid, pageStr] = i.customId.split(':');
  if (action === 'dinos') {
    if (i.user.id !== uid) { await i.reply({ content: 'Not your list.', flags: MessageFlags.Ephemeral }); return; }
    settleEscapes(ctx, i.user.id);
    await i.update(dinoListPayload(ctx, i.user.id, Number(pageStr)));
  }
},
```

**Hatchery** — `eggListPayload(eggs: Egg[], now: number, userId: string, page = 1)`: paginate the lines (featured-egg thumbnail still computed from ALL eggs), add footer + `pageRow('hatch', 'eggs', userId, p, pages)` when `pages > 1`, and return `components` in the payload. `/eggs` passes `i.user.id`. The `userId` parameter is new and required — update Task 2's `eggListPayload(...)` test calls to pass `'u1'` as the third argument. Add an `eggs` action branch to the existing `hatch` ComponentDef (before the `crack` guard):

```ts
const [, action, a2, a3] = i.customId.split(':');
if (action === 'eggs') {
  if (i.user.id !== a2) { await i.reply({ content: 'Not your list.', flags: MessageFlags.Ephemeral }); return; }
  const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
  await i.update({ ...eggListPayload(eggs, ctx.now(), i.user.id, Number(a3)), attachments: [] });
  return;
}
if (action !== 'crack') return;
const idStr = a2;
```

(`attachments: []` clears the previous thumbnail upload so re-sent `files` don't accumulate.)

**Trading** — extract `/trade list` into `tradeListPayload(ctx: Ctx, userId: string, page: number)` (same paginate/footer/pageRow pattern, prefix `'trade'`, action `'list'`, empty text `'No pending trades.'`; add `import type { Ctx } from '../../core/context.js';` if the file lacks it), call it from the subcommand with page 1, and add the module's first ComponentDef:

```ts
components: [
  { prefix: 'trade', async execute(ctx, i) {
      const [, action, uid, pageStr] = i.customId.split(':');
      if (action !== 'list') return;
      if (i.user.id !== uid) { await i.reply({ content: 'Not your list.', flags: MessageFlags.Ephemeral }); return; }
      expireStale(ctx, i.user.id);
      await i.update(tradeListPayload(ctx, i.user.id, Number(pageStr)));
    } },
],
```

- [ ] **Step 5: Run tests, verify pass + full suite**

Run: `npm test` — Expected: PASS. Existing single-page tests keep passing because `components: []` when `pages <= 1` and the footer is additive.

- [ ] **Step 6: Commit**

```bash
git add src/core/paginate.ts src/modules/park src/modules/hatchery src/modules/trading tests/paginate.test.ts tests/dinos.test.ts tests/hatchery.test.ts tests/trading.test.ts
git commit -m "Paginate dino, egg, and trade lists with owner-locked buttons"
```

---

### Task 10: /mythic confirm button

**Files:**
- Modify: `src/modules/hatchery/index.ts` (`/mythic` execute + new `mythic` ComponentDef)
- Test: `tests/hatchery.test.ts`

**Interfaces:**
- Produces: customId `mythic:confirm:<speciesId>`; purchase moves from command execute to the button handler. New ComponentDef prefix `'mythic'` (second entry in the hatchery `components` array — the registry allows multiple prefixes per module).

- [ ] **Step 1: Write the failing tests**

Append to `tests/hatchery.test.ts` — seed shards + rating the way `tests/shards.test.ts` does for `buyMythicEgg` (copy its exact `ratingHighWater` value — it is the 4★ threshold):

```ts
import { mythicSpeciesChoices } from '../src/modules/shop/shards.js';

describe('/mythic confirm flow', () => {
  const mythicId = mythicSpeciesChoices()[0].id;
  beforeEach(() => {
    ctx.economy.apply('u1', { shards: 500 }, 'seed', 0);
    ctx.db.update(schema.users).set({ ratingHighWater: 400 }).where(eq(schema.users.discordId, 'u1')).run();
  });
  it('command replies with a confirm button and spends nothing', async () => {
    const i = fakeCommand({ name: 'mythic', user: 'u1', options: { species: mythicId } });
    await hatcheryModule.commands.find((c) => c.data.name === 'mythic')!.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { components: unknown[]; content: string };
    expect(payload.content).toContain('500 shards');
    expect(payload.components).toHaveLength(1);
    const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(user.shards).toBe(500); // nothing charged yet
  });
  it('confirm button buys the egg', async () => {
    const b = fakeButton({ customId: `mythic:confirm:${mythicId}`, user: 'u1', guild: 'g1' });
    const mythicComponent = hatcheryModule.components.find((c) => c.prefix === 'mythic')!;
    await mythicComponent.execute(ctx, b.asInteraction() as never);
    const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).all();
    expect(eggs.some((e) => e.rarity === 'mythic')).toBe(true);
  });
});
```

Any existing test that drove an immediate `/mythic` purchase through the command must be updated to go through the button (the two-step flow is the point of this task); `buyMythicEgg` unit tests in `tests/shards.test.ts` are untouched.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/hatchery.test.ts` — Expected: new cases FAIL (no button, purchase happens immediately).

- [ ] **Step 3: Implement**

`src/modules/hatchery/index.ts` — add `ActionRowBuilder, ButtonBuilder, ButtonStyle` to the discord.js import. `/mythic` execute becomes:

```ts
async execute(ctx, i) {
  getOrCreateUser(ctx, i.user.id, i.user.displayName);
  const speciesId = i.options.getString('species', true);
  const species = getSpecies(speciesId);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`mythic:confirm:${speciesId}`).setLabel('🌟 Confirm — 500 shards').setStyle(ButtonStyle.Danger),
  );
  await i.reply({ content: `Spend **500 shards** on a Mythic **${species.name}** egg?`, components: [row], flags: MessageFlags.Ephemeral });
},
```

New ComponentDef appended to the hatchery `components` array (the existing error mapping moves here):

```ts
{ prefix: 'mythic', async execute(ctx, i) {
    const [, action, speciesId] = i.customId.split(':');
    if (action !== 'confirm') return;
    getOrCreateUser(ctx, i.user.id, i.user.displayName);
    try {
      const egg = buyMythicEgg(ctx, i.user.id, speciesId);
      await i.update({ content: `🌟 A Mythic **${getSpecies(egg.speciesId!).name}** egg is yours! Incubate it with /incubate ${egg.id}.`, components: [] });
    } catch (e) {
      if (e instanceof ShardError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
      else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough shards (need 500).', flags: MessageFlags.Ephemeral });
      else throw e;
    }
  } },
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/hatchery.test.ts tests/shards.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/index.ts tests/hatchery.test.ts
git commit -m "Require confirmation before spending shards on a Mythic egg"
```

---

### Task 11: Next-step hints — hatch reveal + paddock build

**Files:**
- Modify: `src/modules/hatchery/embeds.ts` (`revealPayload` footer), `src/modules/park/index.ts` (`/build` reply)
- Test: `tests/hatchery.test.ts`, `tests/park.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/hatchery.test.ts`:

```ts
  it('reveal embed points at /dino assign', () => {
    const p = revealPayload(getSpecies('velociraptor'));
    expect(p.embeds[0].toJSON().footer?.text).toContain('/dino assign');
  });
```

`tests/park.test.ts` — the option name is `kind` and `herbivore_paddock` is a real `PADDOCKS` key. The user row must exist before seeding cash (`EconomyService.apply` throws for unknown users):

```ts
  it('/build paddock reply hints at assigning a dino', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.apply('u1', { cash: 100_000 }, 'seed', 0);
    const i = fakeCommand({ name: 'build', user: 'u1', options: { kind: 'herbivore_paddock' } });
    await parkModule.commands.find((c) => c.data.name === 'build')!.execute(ctx, i.asChatInput());
    expect((i.replies[0] as { content: string }).content).toContain('/dino assign');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/hatchery.test.ts tests/park.test.ts` — Expected: 2 new FAILs.

- [ ] **Step 3: Implement**

`revealPayload` — add before the return:

```ts
embed.setFooter({ text: 'Next: /dino assign — unassigned dinos earn nothing.' });
```

`/build` success reply in `src/modules/park/index.ts`:

```ts
const lot = buildLot(ctx, i.user.id, i.options.getString('kind', true));
const hint = lot.type === 'paddock' ? ' Assign a dino with /dino assign to start earning.' : '';
await i.reply({ content: `🏗️ Built **${lot.name}** (lot #${lot.id}).${hint}` });
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/hatchery.test.ts tests/park.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/embeds.ts src/modules/park/index.ts tests/hatchery.test.ts tests/park.test.ts
git commit -m "Hint the assign step after hatching and paddock builds"
```

---

### Task 12: /top your-rank footer

**Files:**
- Modify: `src/modules/leaderboards/service.ts` (extract scoring, add `playerRank`), `src/modules/leaderboards/index.ts` (footer)
- Test: `tests/leaderboards.test.ts`

**Interfaces:**
- Produces: `playerRank(ctx: Ctx, metric: Metric, scope: Scope, guildId: string | null, userId: string): { rank: number; value: number } | null` — same candidate set, scoring, and ordering as `topPlayers`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/leaderboards.test.ts`. **The file's outer `beforeEach` pre-seeds users `a`/`b`/`c` with cash 600/5,500/1,400** — those rows would skew every rank below, so give this describe a fresh context via a nested `beforeEach` (nested runs after the outer one, so reassigning `ctx` discards the pre-seeded db). Add `playerRank` to the existing import from `'../src/modules/leaderboards/service.js'`, and import `getOrCreateUser` from `'../src/modules/park/service.js'` if the file lacks it:

```ts
describe('playerRank', () => {
  beforeEach(() => { ctx = makeCtx(); }); // discard the outer describe's pre-seeded users
  // New users start with cash 500 (schema default); apply deltas on top.
  const seed = (id: string, extraCash: number) => {
    getOrCreateUser(ctx, id, id);
    if (extraCash > 0) ctx.economy.apply(id, { cash: extraCash }, 'seed', 0);
  };
  it('ranks with the same ordering as topPlayers', () => {
    seed('a', 200); seed('b', 100); seed('c', 0);   // cash: 700 / 600 / 500
    expect(playerRank(ctx, 'cash', 'global', null, 'b')).toEqual({ rank: 2, value: 600 });
  });
  it('returns null for an unknown user', () => {
    expect(playerRank(ctx, 'cash', 'global', null, 'nobody')).toBeNull();
  });
  it('/top adds a your-rank footer when the caller is outside the shown rows', async () => {
    for (let n = 0; n < 11; n++) seed(`rich${n}`, 1_000 + n);
    seed('poorest', 0);
    const i = fakeCommand({ name: 'top', user: 'poorest', options: { metric: 'cash', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { footer?: { text: string } } }> }).embeds[0].toJSON();
    expect(embed.footer?.text).toMatch(/^Your rank: #12 — /);
  });
  it('/top has no footer when the caller is in the top rows', async () => {
    seed('rich', 9_999);
    const i = fakeCommand({ name: 'top', user: 'rich', options: { metric: 'cash', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { footer?: { text: string } } }> }).embeds[0].toJSON();
    expect(embed.footer).toBeUndefined();
  });
});
```

(`fakeCommand` runs `/top` as `getOrCreateUser` is called inside execute, so the caller row exists either way; `guild` is omitted → `guildId` null → scope defaults to global.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/leaderboards.test.ts` — Expected: FAIL (`playerRank` not exported).

- [ ] **Step 3: Implement service**

`src/modules/leaderboards/service.ts` — extract the body of `topPlayers` (candidate set + scoring + sort, everything except the final `slice`) into a private `function scored(ctx, metric, scope, guildId)`; then:

```ts
export function topPlayers(
  ctx: Ctx, metric: Metric, scope: Scope, guildId: string | null, limit = 10,
): Array<{ userId: string; displayName: string; value: number }> {
  return scored(ctx, metric, scope, guildId).slice(0, Math.max(0, limit));
}

export function playerRank(
  ctx: Ctx, metric: Metric, scope: Scope, guildId: string | null, userId: string,
): { rank: number; value: number } | null {
  const all = scored(ctx, metric, scope, guildId);
  const idx = all.findIndex((r) => r.userId === userId);
  return idx === -1 ? null : { rank: idx + 1, value: all[idx].value };
}
```

- [ ] **Step 4: Implement command footer**

`src/modules/leaderboards/index.ts` — import `playerRank`, restructure execute to hold the embed before replying:

```ts
const rows = topPlayers(ctx, metric, scope, i.guildId);
const body = rows.length
  ? rows.map((r, idx) => `**${idx + 1}.** ${r.displayName} — ${formatValue(metric, r.value)}`).join('\n')
  : 'No players yet.';
const embed = new EmbedBuilder().setTitle(`🏆 Top ${METRIC_LABEL[metric]} — ${scope}`).setDescription(body).setColor(0xf1c40f);
if (!rows.some((r) => r.userId === i.user.id)) {
  const mine = playerRank(ctx, metric, scope, i.guildId, i.user.id);
  if (mine) embed.setFooter({ text: `Your rank: #${mine.rank} — ${formatValue(metric, mine.value)}` });
}
await i.reply({ embeds: [embed] });
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- tests/leaderboards.test.ts` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/leaderboards tests/leaderboards.test.ts
git commit -m "Show the caller's own rank under the leaderboard"
```

---

### Task 13: Docs, final sweep, deploy note

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Update README**

In the command table/list section, add `/help` in the same format as neighboring rows, e.g.:

```markdown
| `/help [topic]` | How to play — overview + per-topic guides |
```

Add one line to the features/overview prose: embeds now carry generated art (egg icons per rarity, expedition site art); assets live in `assets/images/` and every embed degrades gracefully when a file is absent.

- [ ] **Step 2: Update repo CLAUDE.md**

Append one bullet:

```markdown
- Embed art ships from `assets/images/` via `assetImage` (`src/core/images.ts`);
  a missing file means the embed renders without the image — absent art is
  never an error. Generation prompts live in `docs/assets/prompts.md`.
```

- [ ] **Step 3: Full verification**

Run: `npm test` — Expected: all tests pass (baseline 228 + ~30 new).
Run: `npm run typecheck` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document /help and the embed art pipeline"
```

- [ ] **Step 5: Deploy reminder (manual, post-merge)**

`/help` is a new builder: run `npm run deploy-commands` (exactly one bot instance per token). Site art PNGs can be dropped into `assets/images/sites/` at any time — no code change or redeploy needed. Existence is memoized per path on first reference, so a newly added file is picked up automatically **unless that path was already requested while missing** (negative result cached) — in that one case, restart the bot.
