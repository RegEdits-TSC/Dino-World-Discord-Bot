# Full-Functionality Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate testing of all bot functionality (strict Discord-semantics harness, full entry-point/journey coverage, live REST validation) so manual review is limited to cosmetics.

**Architecture:** Three tiers. Tier 0 rebuilds `tests/harness.ts` internals into strict simulators (reply-state machine, builder-backed option getters, payload validation against Discord limits). Tier 1 fills every uncovered entry point, router path, and multi-command journey. Tier 2 is a REST-only live sweep (`npm run test:live`) that registers builders with Discord and posts every command's real output to a test channel for one-scroll cosmetic review. Triggers: `npm test`, `npm run test:live`, a `/verify` repo command, and GitHub Actions CI.

**Tech Stack:** TypeScript (ESM NodeNext), vitest 4, discord.js 14, drizzle-orm + better-sqlite3 (synchronous), zod 4.

**Spec:** `docs/superpowers/specs/2026-07-25-full-functionality-testing-design.md`

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension, including imports of `.ts` files.
- Time from `ctx.now()`, randomness from `ctx.rng()` — never `Date.now()`/`Math.random()` in src or tests (except `src/index.ts` which already owns the real clock).
- DB access is synchronous drizzle (`.get()`/`.all()`/`.run()`), never awaited.
- Never attribute work to AI anywhere (commits, comments, docs). Plain sentence-case commit messages like the repo's existing history (`git log --oneline`), no `Co-Authored-By`, no conventional-commit prefixes.
- Never weaken or skip an existing test to make something pass. A test that starts failing under the strict harness is surfacing a real semantics violation — fix the module or the test's incorrect fixture, and say which in the commit.
- Custom emoji tags never appear in autocomplete labels; `emojiTag` never called in module-level constants.
- Run commands from the repo root. Test command: `npx vitest run tests/<file>.test.ts` (or `npm test` for all). Typecheck: `npm run typecheck`.
- CI pins verified 2026-07-25: `actions/checkout@v7`, `actions/setup-node@v7`, Node 24 (current LTS).

## File Map

| File | Task | Role |
| --- | --- | --- |
| `tests/lib/discord-limits.ts` | 1 | zod validators for Discord payload limits |
| `tests/discord-limits.test.ts` | 1 | validator unit tests |
| `tests/harness.ts` | 2, 4 | strict state machine (2), builder-backed getters + emoji map helper (4) |
| `tests/harness.test.ts` | 2, 4 | meta-tests of the strictness |
| `src/core/module-list.ts` | 3 | single module array |
| `src/index.ts`, `src/deploy-commands.ts`, `tests/registry-load.test.ts` | 3 | consume module-list |
| `tests/contract.test.ts` | 3 | builder serialization + autocomplete-flag manifest |
| `src/modules/shop/index.ts` | 3 | fix: `/sell` dino option missing `.setAutocomplete(true)` |
| existing per-module test files | 5, 6 | uncovered entry points + error branches |
| `tests/settings.test.ts` | 6 | first settings coverage |
| `tests/router.test.ts` | 7 | router gap tests |
| `tests/journeys.test.ts` | 8 | sequence suite |
| `src/core/emoji-sync.ts`, `src/deploy-emojis.ts`, `tests/deploy-emojis.test.ts` | 9 | extract + test emoji sync state machine |
| `src/core/render/protocol.ts`, `src/core/render/worker.ts`, `src/core/render/client.ts`, `tests/render-worker.test.ts` | 10 | shared render protocol + runner tests |
| `tests/notify-handlers.test.ts`, `tests/scheduler.test.ts` | 10 | scheduler handlers + edges |
| `tests/emoji-assets.test.ts` | 11 | FOODS/rarity/site emoji-name parity |
| `scripts/test-live.ts`, `package.json`, `.env.example` | 12 | live REST sweep |
| `.claude/commands/verify.md` | 13 | /verify command |
| `.github/workflows/ci.yml` | 14 | CI |
| `README.md`, `CLAUDE.md` | 15 | docs |

---

### Task 1: Discord payload limit validators

**Files:**
- Create: `tests/lib/discord-limits.ts`
- Test: `tests/discord-limits.test.ts`

**Interfaces:**
- Consumes: nothing (zod only).
- Produces: `validateMessagePayload(payload: unknown, source: string): void` — throws `Error` whose message starts with `source` on any Discord limit violation; accepts strings, plain objects, and builder objects (anything with `toJSON()`). `validateAutocompleteChoices(choices: unknown, source: string): void` — same contract for autocomplete respond payloads. Both are used by Task 2/4 (harness) and Task 12 (live sweep).

- [ ] **Step 1: Write the failing test**

Create `tests/discord-limits.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { validateMessagePayload, validateAutocompleteChoices } from './lib/discord-limits.js';

const ok = (p: unknown) => expect(() => validateMessagePayload(p, 'test')).not.toThrow();
const bad = (p: unknown, re: RegExp) => expect(() => validateMessagePayload(p, 'test')).toThrow(re);

describe('validateMessagePayload', () => {
  it('accepts typical payloads', () => {
    ok('plain string reply');
    ok({ content: 'hi' });
    ok({ embeds: [new EmbedBuilder().setTitle('t').setDescription('d')] });
    ok({ components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('a:b:1').setLabel('Go').setStyle(ButtonStyle.Primary))] });
    ok({ embeds: [{ title: 'raw object embed' }] });
  });
  it('rejects content over 2000 chars (string and object form)', () => {
    bad('x'.repeat(2001), /content/);
    bad({ content: 'x'.repeat(2001) }, /content/);
  });
  it('rejects more than 10 embeds', () => {
    bad({ embeds: Array.from({ length: 11 }, () => ({ title: 't' })) }, /embeds/);
  });
  it('rejects per-embed field violations', () => {
    bad({ embeds: [{ title: 'x'.repeat(257) }] }, /title/);
    bad({ embeds: [{ description: 'x'.repeat(4097) }] }, /description/);
    bad({ embeds: [{ fields: Array.from({ length: 26 }, (_, i) => ({ name: `n${i}`, value: 'v' })) }] }, /fields/);
    bad({ embeds: [{ fields: [{ name: '', value: 'v' }] }] }, /name/);
    bad({ embeds: [{ fields: [{ name: 'n', value: 'x'.repeat(1025) }] }] }, /value/);
    bad({ embeds: [{ footer: { text: 'x'.repeat(2049) } }] }, /footer/);
  });
  it('rejects combined embed text over 6000 chars', () => {
    const big = { description: 'x'.repeat(4000) };
    bad({ embeds: [big, big] }, /6000/);
  });
  it('rejects component violations', () => {
    const row = (n: number) => ({ components: Array.from({ length: n }, (_, i) => ({ custom_id: `c${i}`, label: 'b', style: 2 })) });
    bad({ components: Array.from({ length: 6 }, () => row(1)) }, /rows/);
    bad({ components: [row(6)] }, /buttons/);
    bad({ components: [{ components: [{ custom_id: 'x'.repeat(101), label: 'b', style: 2 }] }] }, /custom_id/);
  });
});

describe('validateAutocompleteChoices', () => {
  const bad = (c: unknown, re: RegExp) => expect(() => validateAutocompleteChoices(c, 'ac')).toThrow(re);
  it('accepts a normal choice list', () => {
    expect(() => validateAutocompleteChoices(
      [{ name: 'Ferns — 10 cash', value: 'ferns' }, { name: '#3', value: 3 }], 'ac')).not.toThrow();
  });
  it('rejects more than 25 choices', () => {
    bad(Array.from({ length: 26 }, (_, i) => ({ name: `n${i}`, value: i })), /25/);
  });
  it('rejects bad names and long string values', () => {
    bad([{ name: '', value: 'v' }], /name/);
    bad([{ name: 'x'.repeat(101), value: 'v' }], /name/);
    bad([{ name: 'n', value: 'x'.repeat(101) }], /value/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discord-limits.test.ts`
Expected: FAIL — cannot resolve `./lib/discord-limits.js`.

- [ ] **Step 3: Write the implementation**

Create `tests/lib/discord-limits.ts`:

```ts
import { z } from 'zod';

// Discord message/interaction payload limits, enforced on every payload the
// fake interactions record and on every payload the live sweep posts.
// Sources: Discord API docs (message + embed + component + autocomplete limits).

const toJson = (x: unknown): unknown =>
  x != null && typeof (x as { toJSON?: unknown }).toJSON === 'function'
    ? (x as { toJSON(): unknown }).toJSON() : x;

const fieldSchema = z.looseObject({
  name: z.string().min(1, 'field name empty').max(256, 'field name > 256'),
  value: z.string().min(1, 'field value empty').max(1024, 'field value > 1024'),
});
const embedSchema = z.looseObject({
  title: z.string().max(256, 'title > 256').optional(),
  description: z.string().max(4096, 'description > 4096').optional(),
  fields: z.array(fieldSchema).max(25, 'fields > 25').optional(),
  footer: z.looseObject({ text: z.string().max(2048, 'footer > 2048') }).optional(),
  author: z.looseObject({ name: z.string().max(256, 'author > 256') }).optional(),
});
const buttonSchema = z.looseObject({
  custom_id: z.string().max(100, 'custom_id > 100').optional(),
  label: z.string().max(80, 'label > 80').optional(),
});
const rowSchema = z.looseObject({
  components: z.array(buttonSchema).max(5, 'buttons per row > 5'),
});

type RawEmbed = z.infer<typeof embedSchema>;
function embedTextLength(e: RawEmbed): number {
  return (e.title?.length ?? 0) + (e.description?.length ?? 0)
    + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0)
    + (e.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
}

function fail(source: string, msg: string): never {
  throw new Error(`${source}: ${msg}`);
}
function parseOr(source: string, what: string, schema: z.ZodType, value: unknown): unknown {
  const r = schema.safeParse(value);
  if (!r.success) fail(source, `${what} ${r.error.issues[0]?.message ?? 'invalid'}`);
  return r.data;
}

export function validateMessagePayload(payload: unknown, source: string): void {
  if (payload == null) fail(source, 'empty payload');
  if (typeof payload === 'string') {
    if (payload.length > 2000) fail(source, `content ${payload.length} > 2000`);
    return;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.content === 'string' && p.content.length > 2000) {
    fail(source, `content ${p.content.length} > 2000`);
  }
  const embeds = Array.isArray(p.embeds) ? p.embeds.map(toJson) : [];
  if (embeds.length > 10) fail(source, `embeds ${embeds.length} > 10`);
  let total = 0;
  for (const e of embeds) {
    total += embedTextLength(parseOr(source, 'embed', embedSchema, e) as RawEmbed);
  }
  if (total > 6000) fail(source, `combined embed text ${total} > 6000`);
  const rows = Array.isArray(p.components) ? p.components.map(toJson) : [];
  if (rows.length > 5) fail(source, `component rows ${rows.length} > 5`);
  for (const r of rows) parseOr(source, 'row', rowSchema, r);
}

export function validateAutocompleteChoices(choices: unknown, source: string): void {
  if (!Array.isArray(choices)) fail(source, 'respond() payload is not an array');
  if (choices.length > 25) fail(source, `choices ${choices.length} > 25`);
  for (const c of choices as Array<Record<string, unknown>>) {
    const name = c?.name;
    if (typeof name !== 'string' || name.length < 1 || name.length > 100) {
      fail(source, `choice name must be a 1-100 char string (got ${JSON.stringify(name)})`);
    }
    const value = c?.value;
    if (typeof value === 'string' && value.length > 100) fail(source, `choice value > 100 chars`);
    if (typeof value !== 'string' && typeof value !== 'number') {
      fail(source, `choice value must be string|number`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discord-limits.test.ts`
Expected: PASS (all cases). If a zod v4 API name differs (`z.looseObject`), check the installed zod docs — the repo pins zod ^4; do not downgrade the check to `.passthrough()` without confirming it exists in v4.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expect clean.

```bash
git add tests/lib/discord-limits.ts tests/discord-limits.test.ts
git commit -m "Add Discord payload limit validators for the test harness"
```

---

### Task 2: Reply-state machine in the fake interactions

**Files:**
- Modify: `tests/harness.ts` (rewrite `fakeCommand` and `fakeButton` internals; exported API unchanged, plus new fields)
- Test: `tests/harness.test.ts`

**Interfaces:**
- Consumes: `validateMessagePayload` from Task 1.
- Produces: `fakeCommand(opts)` / `fakeButton(opts)` unchanged signatures, but the returned object gains `deferOpts: unknown[]` (recorded `deferReply`/`deferUpdate` options). Thrown lifecycle errors carry `.code` of `'InteractionAlreadyReplied'` or `'InteractionNotReplied'` (mirroring discord.js `DiscordjsError` codes). New export `replyText(r: unknown): string` — extracts `content` from a string-or-object payload (used by Tasks 5-8). `fakeButton`'s raw object gains `deferUpdate()` and a `message: { id: string }` property.

- [ ] **Step 1: Write the failing tests**

Append to `tests/harness.test.ts` inside the existing `describe('harness', ...)` (imports at top become `import { makeCtx, fakeCommand, fakeButton, mulberry32, replyText } from './harness.js';`):

```ts
  it('reply after reply throws InteractionAlreadyReplied', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await i.reply({ content: 'one' });
    await expect(i.reply({ content: 'two' })).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
  });
  it('reply after deferReply throws InteractionAlreadyReplied', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await i.deferReply();
    await expect(i.reply({ content: 'x' })).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
  });
  it('editReply and followUp before any ack throw InteractionNotReplied', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await expect(i.editReply({ content: 'x' })).rejects.toMatchObject({ code: 'InteractionNotReplied' });
    await expect(i.followUp({ content: 'x' })).rejects.toMatchObject({ code: 'InteractionNotReplied' });
  });
  it('defer then editReply works and records defer options', async () => {
    const fi = fakeCommand({ name: 'zzz-test', user: 'u1' });
    const i = fi.asChatInput();
    await i.deferReply();
    await i.editReply({ content: 'later' });
    expect(fi.replies).toEqual([{ content: 'later' }]);
    expect(fi.deferOpts).toHaveLength(1);
    expect(i.deferred).toBe(true);
    expect(i.replied).toBe(true);
  });
  it('double deferReply throws', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await i.deferReply();
    await expect(i.deferReply()).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
  });
  it('button update enforces the same lifecycle and exposes message', async () => {
    const fb = fakeButton({ customId: 'x:y:1', user: 'u1' });
    const b = fb.asInteraction() as unknown as {
      update(p: unknown): Promise<void>; deferUpdate(): Promise<void>; message: { id: string };
    };
    expect(b.message.id).toBeTruthy();
    await b.update({ content: 'edited' });
    await expect(b.update({ content: 'again' })).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
    const fb2 = fakeButton({ customId: 'x:y:2', user: 'u1' });
    const b2 = fb2.asInteraction() as unknown as { deferUpdate(): Promise<void>; update(p: unknown): Promise<void> };
    await b2.deferUpdate();
    await expect(b2.update({ content: 'x' })).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
  });
  it('recorded payloads are validated against Discord limits', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await expect(i.reply({ content: 'x'.repeat(2001) })).rejects.toThrow(/content/);
  });
  it('replyText extracts content from both payload forms', () => {
    expect(replyText('plain')).toBe('plain');
    expect(replyText({ content: 'obj' })).toBe('obj');
    expect(replyText({ embeds: [] })).toBe('');
  });
```

Note: the tests use command name `zzz-test`, which no real module defines — Task 4 makes unknown names skip builder checks, and until then no builder checks exist, so the name is future-proof.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run tests/harness.test.ts`
Expected: FAIL — `deferOpts`/`replyText` undefined, no lifecycle errors thrown.

- [ ] **Step 3: Rewrite the fakes**

In `tests/harness.ts`, add imports and a shared recorder. Add at top:

```ts
import { validateMessagePayload } from './lib/discord-limits.js';
```

Add above `fakeCommand`:

```ts
function djsError(code: 'InteractionAlreadyReplied' | 'InteractionNotReplied'): Error {
  const e = new Error(code === 'InteractionAlreadyReplied'
    ? 'The reply to this interaction has already been sent or deferred.'
    : 'The reply to this interaction has not been sent or deferred.');
  (e as Error & { code: string }).code = code;
  return e;
}

/** Extract the text content from a reply payload (string or options object). */
export function replyText(r: unknown): string {
  if (typeof r === 'string') return r;
  return (r as { content?: string })?.content ?? '';
}
```

Extend `FakeInteraction`:

```ts
export interface FakeInteraction {
  replies: unknown[];
  deferOpts: unknown[];
  asChatInput(): ChatInputCommandInteraction;
  asInteraction(): Interaction;
}
```

Replace `fakeCommand`'s body from `const replies: unknown[] = [];` through the `deferReply` line with:

```ts
  const replies: unknown[] = [];
  const deferOpts: unknown[] = [];
  const label = `/${opts.name}${opts.sub ? ` ${opts.sub}` : ''}`;
  const raw = {
    commandName: opts.name,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    deferred: false, replied: false,
    isChatInputCommand: () => true, isButton: () => false, isAutocomplete: () => false,
    options: {
      getSubcommand: () => opts.sub ?? null,
      getString: (k: string) => (opts.options?.[k] as string) ?? null,
      getInteger: (k: string) => (opts.options?.[k] as number) ?? null,
      getUser: (k: string) => {
        const id = opts.options?.[k];
        return id != null ? { id: String(id), displayName: String(id), bot: false } : null;
      },
    },
    reply: async (payload: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      validateMessagePayload(payload, `${label} reply`);
      raw.replied = true; replies.push(payload);
    },
    editReply: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} editReply`);
      raw.replied = true; replies.push(payload);
    },
    followUp: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} followUp`);
      replies.push(payload);
    },
    deferReply: async (o?: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      raw.deferred = true; deferOpts.push(o ?? {});
    },
  };
  return {
    replies, deferOpts,
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
  };
```

(The `options` getters stay as-is in this task; Task 4 replaces them with builder-backed versions.)

Replace `fakeButton` similarly:

```ts
export function fakeButton(opts: { customId: string; user: string; guild?: string }): FakeInteraction {
  const replies: unknown[] = [];
  const deferOpts: unknown[] = [];
  const label = `button ${opts.customId}`;
  const raw = {
    customId: opts.customId,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    message: { id: 'fake-message' },
    deferred: false, replied: false,
    isChatInputCommand: () => false, isButton: () => true, isAutocomplete: () => false,
    reply: async (payload: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      validateMessagePayload(payload, `${label} reply`);
      raw.replied = true; replies.push(payload);
    },
    editReply: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} editReply`);
      raw.replied = true; replies.push(payload);
    },
    followUp: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} followUp`);
      replies.push(payload);
    },
    update: async (payload: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      validateMessagePayload(payload, `${label} update`);
      raw.replied = true; replies.push(payload);
    },
    deferUpdate: async (o?: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      raw.deferred = true; deferOpts.push(o ?? {});
    },
    deferReply: async (o?: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      raw.deferred = true; deferOpts.push(o ?? {});
    },
  };
  return {
    replies, deferOpts,
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
  };
}
```

Also add `deferOpts` to the object returned by `fakeAutocomplete` (as an empty array — autocomplete never defers) so it still satisfies `FakeInteraction`.

- [ ] **Step 4: Run harness tests, then the whole suite**

Run: `npx vitest run tests/harness.test.ts` — expect PASS.
Run: `npm test` — expect PASS. If any existing test fails, it is a real lifecycle violation (double reply, editReply without defer, oversized payload) in either a module or a test fixture. Diagnose which side is wrong against real discord.js semantics and fix that side; record what was found in the commit message. Do not loosen the state machine.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expect clean.

```bash
git add tests/harness.ts tests/harness.test.ts
git commit -m "Enforce the Discord interaction lifecycle and payload limits in test fakes"
```

---

### Task 3: Single module list + builder contract test + `/sell` autocomplete fix

**Files:**
- Create: `src/core/module-list.ts`
- Modify: `src/index.ts:12-21,33`, `src/deploy-commands.ts:5-17`, `tests/registry-load.test.ts`
- Modify: `src/modules/shop/index.ts:110` (add `.setAutocomplete(true)` to the `/sell` `dino` option)
- Test: `tests/contract.test.ts`

**Interfaces:**
- Consumes: the 10 `*Module` manifests.
- Produces: `ALL_MODULES: ModuleManifest[]` from `src/core/module-list.ts` — the ONLY module array in the repo; `src/index.ts`, `src/deploy-commands.ts`, tests, and the Task 12 live sweep all import it.

**Background:** the module array is currently copy-pasted in `src/index.ts:33`, `src/deploy-commands.ts:17`, and `tests/registry-load.test.ts:17` — dropping a module from `index.ts` alone keeps every test green while live commands silently lose their handler. Separately, the audit found `/sell`'s `dino` option defines an autocomplete provider (`shop/index.ts:123-137`) but the builder never sets `.setAutocomplete(true)`, so Discord never sends autocomplete for it in production — a dead provider that its test never catches because the test invokes the handler directly.

- [ ] **Step 1: Create the single module list**

Create `src/core/module-list.ts`:

```ts
import type { ModuleManifest } from './modules.js';
import { parkModule } from '../modules/park/index.js';
import { hatcheryModule } from '../modules/hatchery/index.js';
import { expeditionsModule } from '../modules/expeditions/index.js';
import { shopModule } from '../modules/shop/index.js';
import { settingsModule } from '../modules/settings/index.js';
import { careModule } from '../modules/care/index.js';
import { tradingModule } from '../modules/trading/index.js';
import { leaderboardsModule } from '../modules/leaderboards/index.js';
import { adminModule } from '../modules/admin/index.js';
import { helpModule } from '../modules/help/index.js';

// The one and only module array. index.ts, deploy-commands.ts, and the test
// suite all consume this list, so registered handlers and deployed builders
// can never drift apart by editing one copy.
export const ALL_MODULES: ModuleManifest[] = [
  parkModule, hatcheryModule, expeditionsModule, shopModule, settingsModule,
  careModule, tradingModule, leaderboardsModule, adminModule, helpModule,
];
```

- [ ] **Step 2: Consume it in `src/index.ts` and `src/deploy-commands.ts`**

In `src/index.ts`: delete the 10 `import { xModule } from './modules/...'` lines (12-21), add `import { ALL_MODULES } from './core/module-list.js';`, and change line 33 to:

```ts
const registry = new ModuleRegistry(ALL_MODULES, config.modules);
```

In `src/deploy-commands.ts`: delete the 10 module imports (lines 5-14), add `import { ALL_MODULES } from './core/module-list.js';`, and change line 17 to:

```ts
const registry = new ModuleRegistry(ALL_MODULES, config.modules);
```

- [ ] **Step 3: Point `tests/registry-load.test.ts` at the list**

Replace the whole file with:

```ts
import { describe, it, expect } from 'vitest';
import { ModuleRegistry } from '../src/core/modules.js';
import { ALL_MODULES } from '../src/core/module-list.js';

describe('full module registry', () => {
  it('loads all modules without a name/prefix collision', () => {
    const flags = Object.fromEntries(ALL_MODULES.map((m) => [m.name, true]));
    const r = new ModuleRegistry(ALL_MODULES, flags);
    expect(ALL_MODULES).toHaveLength(10);
    expect(r.commands().length).toBe(19);
  });
});
```

Run: `npx vitest run tests/registry-load.test.ts tests/config.test.ts` — expect PASS (config.test.ts pins modules.json flags and is untouched by this refactor).

- [ ] **Step 4: Write the failing contract test**

Create `tests/contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ApplicationCommandOptionType } from 'discord.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { ALL_MODULES } from '../src/core/module-list.js';

const registry = new ModuleRegistry(ALL_MODULES, Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])));

interface OptJson { type: number; name: string; autocomplete?: boolean; options?: OptJson[] }

// Every option below is served by an autocomplete provider; every flagged
// builder option must appear here. Keyed 'command' or 'command sub'.
const AUTOCOMPLETE_OPTIONS: Record<string, string[]> = {
  'incubate': ['egg'],
  'hatch': ['egg'],
  'expedition start': ['site'],
  'shop egg': ['rarity'],
  'shop food': ['item'],
  'sell': ['dino'],
  'feed one': ['dino', 'food'],
  'rescue': ['dino'],
  'upgrade': ['lot'],
  'dino assign': ['dino', 'lot'],
  'dino unassign': ['dino'],
  'decorate': ['lot'],
  'trade offer': ['give-dinos', 'give-eggs', 'give-food', 'want-dinos', 'want-eggs', 'want-food'],
  'trade accept': ['id'],
  'trade decline': ['id'],
  'trade cancel': ['id'],
  'admin give': ['dino-species'],
};

function collect(name: string, opts: OptJson[] | undefined, out: Map<string, boolean>): void {
  for (const o of opts ?? []) {
    if (o.type === ApplicationCommandOptionType.Subcommand) {
      collect(`${name} ${o.name}`, o.options, out);
    } else {
      out.set(`${name} :: ${o.name}`, o.autocomplete === true);
    }
  }
}

describe('builder contract', () => {
  it('every builder serializes (Discord would accept the deploy body)', () => {
    const body = registry.commands().map((c) => c.data.toJSON());
    expect(body).toHaveLength(19);
    for (const b of body) expect(b.name).toMatch(/^[a-z-]+$/);
  });

  it('autocomplete flags match the providers exactly, both directions', () => {
    const flagged = new Map<string, boolean>();
    for (const c of registry.commands()) {
      collect(c.data.name, (c.data.toJSON() as { options?: OptJson[] }).options, flagged);
    }
    for (const [key, names] of Object.entries(AUTOCOMPLETE_OPTIONS)) {
      for (const n of names) {
        expect(flagged.get(`${key} :: ${n}`), `${key} option '${n}' should set .setAutocomplete(true)`).toBe(true);
      }
    }
    const expected = new Set(Object.entries(AUTOCOMPLETE_OPTIONS)
      .flatMap(([key, names]) => names.map((n) => `${key} :: ${n}`)));
    for (const [id, isFlagged] of flagged) {
      if (isFlagged) expect(expected.has(id), `flagged option ${id} missing from AUTOCOMPLETE_OPTIONS manifest`).toBe(true);
    }
  });

  it('every command with an autocomplete handler has at least one flagged option', () => {
    for (const c of registry.commands()) {
      if (!c.autocomplete) continue;
      const flagged = new Map<string, boolean>();
      collect(c.data.name, (c.data.toJSON() as { options?: OptJson[] }).options, flagged);
      expect([...flagged.values()].some(Boolean), `/${c.data.name} defines autocomplete() but no option is flagged`).toBe(true);
    }
  });
});
```

- [ ] **Step 5: Run to verify it fails on `/sell`**

Run: `npx vitest run tests/contract.test.ts`
Expected: FAIL — `sell option 'dino' should set .setAutocomplete(true)`. (If it fails on anything else, the manifest above mis-states a builder — read the named builder and correct the manifest to match reality, unless the builder itself is missing a flag its provider needs.)

- [ ] **Step 6: Fix the `/sell` builder**

In `src/modules/shop/index.ts` line 110, the `/sell` `dino` integer option: add `.setAutocomplete(true)` exactly as the `/shop egg` `rarity` option does at line 30.

Run: `npx vitest run tests/contract.test.ts` — expect PASS.

- [ ] **Step 7: Full suite, typecheck, commit**

Run: `npm test && npm run typecheck` — expect PASS/clean.

```bash
git add src/core/module-list.ts src/index.ts src/deploy-commands.ts src/modules/shop/index.ts tests/registry-load.test.ts tests/contract.test.ts
git commit -m "Single-source the module list, pin builder contracts, fix dead /sell autocomplete"
```

Note for the operator (goes in the Task 15 docs and the final report): the `/sell` builder changed, so `npm run deploy-commands` must be run once after this lands.

---

### Task 4: Builder-backed option getters, strict autocomplete, emoji-map helper

**Files:**
- Modify: `tests/harness.ts`
- Test: `tests/harness.test.ts`, additions to `tests/emojis.test.ts`, `tests/autocomplete-shop.test.ts`

**Interfaces:**
- Consumes: `ALL_MODULES` (Task 3), `validateAutocompleteChoices` (Task 1), `setEmojiMap`/`clearEmojiMap`/`EMOJI_FALLBACK` from `src/core/emojis.js`.
- Produces: `testRegistry: ModuleRegistry` (all 10 modules, all flags on) exported from `tests/harness.ts`; `installTestEmojiMap(): () => void` — installs a synthetic custom-emoji map covering every `EMOJI_FALLBACK` name, returns the restore function; `fakeCommand`/`fakeAutocomplete` now throw on any fixture/getter that disagrees with the command's real builder JSON. Commands whose name is not in `testRegistry` (synthetic router-test commands) keep the old permissive getters.

- [ ] **Step 1: Write the failing tests**

Append to `tests/harness.test.ts`:

```ts
  it('rejects an option name the builder does not define', () => {
    expect(() => fakeCommand({ name: 'incubate', user: 'u1', options: { egg: 1, speces: 'typo' } }))
      .toThrow(/speces/);
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: 1 } }).asChatInput();
    expect(() => i.options.getString('nope')).toThrow(/not defined/);
  });
  it('rejects a getter whose type disagrees with the builder', () => {
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: 1 } }).asChatInput();
    expect(() => i.options.getString('egg')).toThrow(/type/);   // egg is an Integer option
    expect(i.options.getInteger('egg')).toBe(1);
  });
  it('required getter throws when the fixture omits the option', () => {
    const i = fakeCommand({ name: 'incubate', user: 'u1' }).asChatInput();
    expect(() => i.options.getInteger('egg', true)).toThrow(/Required option/);
    expect(i.options.getInteger('egg')).toBeNull();
  });
  it('enforces subcommand names against the builder', () => {
    expect(() => fakeCommand({ name: 'shop', user: 'u1' })).toThrow(/subcommand/);
    expect(() => fakeCommand({ name: 'shop', sub: 'nope', user: 'u1' })).toThrow(/nope/);
    expect(() => fakeCommand({ name: 'incubate', sub: 'extra', user: 'u1', options: { egg: 1 } }))
      .toThrow(/no subcommands/);
  });
  it('keeps permissive mode for synthetic commands unknown to the registry', () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1', options: { anything: 'goes' } }).asChatInput();
    expect(i.options.getString('anything')).toBe('goes');
  });
  it('autocomplete fake rejects a focused option without the builder flag', () => {
    expect(() => fakeAutocomplete({ name: 'expedition', sub: 'start', user: 'u1', focused: { name: 'site', value: '' } }))
      .not.toThrow();
    expect(() => fakeAutocomplete({ name: 'top', user: 'u1', focused: { name: 'metric', value: '' } }))
      .toThrow(/autocomplete/);
  });
  it('autocomplete respond() is once-only and validated', async () => {
    const fa = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    const a = fa.asAutocomplete();
    await a.respond([]);
    await expect(a.respond([])).rejects.toThrow(/already responded/);
  });
```

(Add `fakeAutocomplete` to the harness import line.)

Append to `tests/emojis.test.ts`:

```ts
import { installTestEmojiMap } from './harness.js';
import { foodEmoji } from '../src/core/emojis.js';

describe('custom-tag arm under a loaded map', () => {
  it('foodEmoji uses the custom tag when the map is loaded, fallback otherwise', () => {
    const restore = installTestEmojiMap();
    try {
      expect(foodEmoji('ferns')).toMatch(/^<:dw_ferns:\d+> $/);
    } finally { restore(); }
    expect(foodEmoji('ferns')).toBe('🌿 ');
  });
});
```

(Merge these imports with the file's existing ones — `foodEmoji` and `describe`/`it`/`expect` are already imported there; only add what is missing.)

Append to `tests/autocomplete-shop.test.ts` (uses its existing imports plus `installTestEmojiMap` from the harness):

```ts
  it('food item labels contain no custom emoji tags even with the map loaded', async () => {
    const restore = installTestEmojiMap();
    try {
      const ctx = makeCtx();
      getOrCreateUser(ctx, 'u1', 'u1');
      const fa = fakeAutocomplete({ name: 'shop', sub: 'food', user: 'u1', focused: { name: 'item', value: '' } });
      await shopModule.commands.find((c) => c.data.name === 'shop')!.autocomplete!(ctx, fa.asAutocomplete());
      const choices = fa.replies[0] as Array<{ name: string }>;
      expect(choices.length).toBeGreaterThan(0);
      for (const c of choices) expect(c.name).not.toMatch(/<a?:\w+:\d+>/);
    } finally { restore(); }
  });
```

(Match the file's existing local helper names — it already imports `makeCtx`, `fakeAutocomplete`, `shopModule`, and a user-creation helper; reuse whatever it uses to create the user row.)

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run tests/harness.test.ts tests/emojis.test.ts tests/autocomplete-shop.test.ts`
Expected: FAIL — no builder checks, `installTestEmojiMap` missing.

- [ ] **Step 3: Implement in `tests/harness.ts`**

Add imports:

```ts
import { ApplicationCommandOptionType } from 'discord.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import { EMOJI_FALLBACK, setEmojiMap, clearEmojiMap } from '../src/core/emojis.js';
import { validateAutocompleteChoices } from './lib/discord-limits.js';
```

Add module-level registry + builder introspection:

```ts
export const testRegistry = new ModuleRegistry(
  ALL_MODULES, Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])));

interface OptSpec { name: string; type: number; autocomplete: boolean }
interface BuilderSpec { hasSubs: boolean; options: Map<string, OptSpec> }
interface OptJson { type: number; name: string; autocomplete?: boolean; options?: OptJson[] }

// Resolve the real builder for a command; null → synthetic test command,
// which keeps the old permissive getters (router tests use stub commands).
function builderSpec(name: string, sub: string | null | undefined): BuilderSpec | null {
  const cmd = testRegistry.findCommand(name);
  if (!cmd) return null;
  const json = cmd.data.toJSON() as { options?: OptJson[] };
  const subs = (json.options ?? []).filter((o) => o.type === ApplicationCommandOptionType.Subcommand);
  let opts: OptJson[] | undefined;
  if (subs.length > 0) {
    if (!sub) throw new Error(`fakeCommand: /${name} requires a subcommand (${subs.map((s) => s.name).join(', ')})`);
    const s = subs.find((x) => x.name === sub);
    if (!s) throw new Error(`fakeCommand: /${name} has no subcommand '${sub}'`);
    opts = s.options;
  } else {
    if (sub) throw new Error(`fakeCommand: /${name} has no subcommands (got '${sub}')`);
    opts = json.options;
  }
  const map = new Map<string, OptSpec>();
  for (const o of opts ?? []) map.set(o.name, { name: o.name, type: o.type, autocomplete: o.autocomplete === true });
  return { hasSubs: subs.length > 0, options: map };
}

function requiredMissing(k: string): Error {
  const e = new Error(`Required option "${k}" not found.`);
  (e as Error & { code: string }).code = 'CommandInteractionOptionNotFound';
  return e;
}

function makeGetter<T>(
  spec: BuilderSpec | null, fixtures: Record<string, unknown> | undefined,
  label: string, expected: number[], convert: (v: unknown) => T,
): (k: string, required?: boolean) => T | null {
  return (k, required = false) => {
    if (spec) {
      const o = spec.options.get(k);
      if (!o) throw new Error(`option '${k}' is not defined in the ${label} builder`);
      if (!expected.includes(o.type)) {
        throw new Error(`option '${k}' in ${label} is builder type ${o.type}, read with the wrong getter (expected one of ${expected.join('/')})`);
      }
    }
    const v = fixtures?.[k];
    if (v == null) {
      if (required) throw requiredMissing(k);
      return null;
    }
    return convert(v);
  };
}
```

In `fakeCommand`, before building `raw`, resolve the spec and validate fixture keys; widen the `options` param type to `Record<string, string | number | boolean | { id: string; bot?: boolean }>`:

```ts
  const spec = builderSpec(opts.name, opts.sub ?? null);
  if (spec) {
    for (const k of Object.keys(opts.options ?? {})) {
      if (!spec.options.has(k)) {
        throw new Error(`fakeCommand ${label}: fixture option '${k}' is not defined in the builder`);
      }
    }
  }
```

Replace the `options` block of `raw` with:

```ts
    options: {
      getSubcommand: () => opts.sub ?? null,
      getString: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.String], String),
      getInteger: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.Integer], Number),
      getBoolean: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.Boolean], Boolean),
      getUser: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.User], (v) =>
        typeof v === 'object' && v !== null
          ? { displayName: String((v as { id: string }).id), bot: false, ...(v as object) }
          : { id: String(v), displayName: String(v), bot: false }),
      getChannel: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.Channel], (v) =>
        ({ id: String(v), type: 0 })),   // 0 = ChannelType.GuildText
    },
```

In `fakeAutocomplete`, resolve the same spec, then enforce the focused option's flag and respond-once + payload validation:

```ts
  const spec = builderSpec(opts.name, opts.sub ?? null);
  if (spec) {
    const o = spec.options.get(opts.focused.name);
    if (!o) throw new Error(`fakeAutocomplete /${opts.name}: focused option '${opts.focused.name}' is not in the builder`);
    if (!o.autocomplete) throw new Error(`fakeAutocomplete /${opts.name}: option '${opts.focused.name}' does not set autocomplete in the builder`);
  }
  let responded = false;
```

and its `respond`:

```ts
    respond: async (choices: unknown) => {
      if (responded) throw new Error(`/${opts.name} autocomplete already responded`);
      responded = true;
      validateAutocompleteChoices(choices, `/${opts.name} autocomplete`);
      replies.push(choices);
    },
```

Add the emoji-map helper at the bottom:

```ts
// Install a synthetic custom-emoji map covering every known emoji name, so
// tests can exercise the custom-tag arms that production hits after client
// ready. Returns the restore function; call it in finally/afterEach.
export function installTestEmojiMap(): () => void {
  const entries: Record<string, string> = {};
  let id = 900000;
  for (const name of Object.keys(EMOJI_FALLBACK)) entries[name] = `<:${name}:${id++}>`;
  setEmojiMap(entries);
  return clearEmojiMap;
}
```

- [ ] **Step 4: Run the new tests, then the whole suite**

Run: `npx vitest run tests/harness.test.ts tests/emojis.test.ts tests/autocomplete-shop.test.ts` — expect PASS.
Run: `npm test` — expect PASS. Failures here mean a test fixture used an option name/type the real builder doesn't define, a test routed a subcommand-command without a sub, or an autocomplete test focused an unflagged option — each is exactly the drift class this task exists to catch. Fix the fixture (or the builder, if the builder is genuinely wrong) and note it in the commit.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expect clean.

```bash
git add tests/harness.ts tests/harness.test.ts tests/emojis.test.ts tests/autocomplete-shop.test.ts
git commit -m "Back fake interactions with real builder JSON and add a test emoji map"
```

---

### Task 5: Uncovered entry points — hatchery, care, park

**Files:**
- Test: additions to `tests/hatchery.test.ts`, `tests/care.test.ts`, `tests/park.test.ts`, `tests/dinos.test.ts`

**Interfaces:**
- Consumes: strict harness (`makeCtx`, `fakeCommand`, `fakeButton`, `replyText`), module manifests, services already imported by these files (`getOrCreateUser`, `incubateEgg`, `buildLot`, `assignDino`), `schema`, `RARITY`.
- Produces: nothing new — coverage only. Command lookup idiom used throughout: `const cmd = <module>.commands.find((c) => c.data.name === '<name>')!;` and component lookup `const comp = <module>.components.find((c) => c.prefix === '<prefix>')!;`. Button dispatch idiom: `comp.execute(ctx, btn.asInteraction() as unknown as ButtonInteraction)` (import the type from discord.js; match how each file already dispatches buttons if it differs).

General shape of every test in Tasks 5-6: seed via existing services/schema inserts, dispatch through `execute()`, assert on `replyText(i.replies[0])` with `toContain` (exact strings are pinned loosely so wording tweaks don't churn tests) plus a DB effect, and assert `flags: MessageFlags.Ephemeral` (import from discord.js) on error replies via `expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral)`.

- [ ] **Step 1: hatchery — `/incubate` and `/hatch` execute (write failing tests)**

Append to `tests/hatchery.test.ts` (reuse its existing imports; add `replyText` and `RARITY` if absent):

```ts
describe('/incubate execute', () => {
  it('incubates and replies with a ready timestamp, enqueues egg_hatch timer', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'incubate')!;
    const i = fakeCommand({ name: 'incubate', user: 'u1', guild: 'g1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Incubating your common egg');
    const timer = ctx.db.select().from(schema.timers).all().find((t) => t.kind === 'egg_hatch');
    expect(timer?.refId).toBe(egg.id);
  });
  it('rejects an egg you do not own, ephemeral', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u2', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'incubate')!;
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('do not own');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
});

describe('/hatch execute', () => {
  it('not-yours and not-ready are ephemeral rejections', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'hatch')!;
    const notMine = fakeCommand({ name: 'hatch', user: 'u1', options: { egg: 9999 } });
    await cmd.execute(ctx, notMine.asChatInput());
    expect(replyText(notMine.replies[0])).toContain('do not own');
    const notReady = fakeCommand({ name: 'hatch', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, notReady.asChatInput());
    expect(replyText(notReady.replies[0])).toContain('not ready to hatch');
  });
  it('ready egg gets the pre-hatch embed with a crack button', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    incubateEgg(ctx, 'u1', egg.id, null);
    ctx.setNow(RARITY.common.incubationMs + 1);
    const cmd = hatcheryModule.commands.find((c) => c.data.name === 'hatch')!;
    const i = fakeCommand({ name: 'hatch', user: 'u1', options: { egg: egg.id } });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { components?: unknown[] };
    expect(JSON.stringify(payload.components ?? [])).toContain(`hatch:crack:${egg.id}`);
  });
});
```

If `incubateEgg`'s signature in `src/modules/hatchery/service.ts` differs from `(ctx, userId, eggId, guildId)`, read the existing service tests at the top of this file and match their call shape.

- [ ] **Step 2: Run, expect the new describes to fail, then confirm they pass**

Run: `npx vitest run tests/hatchery.test.ts` — the new tests must fail only if the assertions or seeds are wrong (the handlers exist); expected outcome after fixing any seed slip: PASS. The TDD value here is pinning behavior, not driving new src code — if a test fails against the real handler, the test's expectation is wrong; correct it against the module source, never the reverse.

- [ ] **Step 3: care — `/rescue` execute**

Append to `tests/care.test.ts`:

```ts
describe('/rescue execute', () => {
  const rescueCmd = careModule.commands.find((c) => c.data.name === 'rescue')!;
  it('recaptures an escaped dino for the fee', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, escapedAt: 100,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: dino.id } });
    await rescueCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Recaptured');
    expect(ctx.db.select().from(schema.dinos).all()[0].escapedAt).toBeNull();
  });
  it('rejects a dino that has not escaped, ephemeral', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: dino.id } });
    await rescueCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('not escaped');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
  it('maps InsufficientFundsError to the recapture-fee message', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, escapedAt: 100,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const i = fakeCommand({ name: 'rescue', user: 'u1', options: { dino: dino.id } });
    await rescueCmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('recapture fee');
  });
});
```

Important seed rule for escaped dinos in these tests: set `hunger: 100, lastFedAt: 0` and keep `ctx.now()` at 0 (or small) so `settleEscapes` — which every care/park execute runs first — computes no NEW escape and does not overwrite the seeded state. The seeded `escapedAt` is respected because `settleEscapes` skips dinos whose `escapedAt` is already set. `'triceratops'` is a known herbivore species id (used by `tests/clock.test.ts`); if its rarity makes the rescue fee ≤ 500 for the insufficient-cash case, the explicit `cash: 0` update above still forces the failure.

- [ ] **Step 4: park — `/upgrade` (+service), `/decorate`, `/park rename`, `/dino unassign`, `park:collect`**

Append to `tests/park.test.ts`:

```ts
describe('upgradeLot service', () => {
  it('charges and bumps the level', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    const before = ctx.db.select().from(schema.users).all()[0].cash;
    const upgraded = upgradeLot(ctx, 'u1', lot.id);
    expect(upgraded.level).toBe(2);
    expect(ctx.db.select().from(schema.users).all()[0].cash).toBeLessThan(before);
  });
  it('throws LotLimitError at max level and UnknownKindError for missing/foreign lots', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 10_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    ctx.db.update(schema.lots).set({ level: 4 }).run();   // paddock max level
    expect(() => upgradeLot(ctx, 'u1', lot.id)).toThrow(LotLimitError);
    expect(() => upgradeLot(ctx, 'u1', 9999)).toThrow(UnknownKindError);
  });
  it('throws InsufficientFundsError when broke', () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    expect(() => upgradeLot(ctx, 'u1', lot.id)).toThrow(InsufficientFundsError);
  });
});

describe('/upgrade, /decorate, /park rename, /dino unassign, park:collect', () => {
  it('/upgrade execute success and each error reply', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    const cmd = parkModule.commands.find((c) => c.data.name === 'upgrade')!;
    const okI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: lot.id } });
    await cmd.execute(ctx, okI.asChatInput());
    expect(replyText(okI.replies[0])).toContain('level 2');
    const noneI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: 9999 } });
    await cmd.execute(ctx, noneI.asChatInput());
    expect(replyText(noneI.replies[0])).toContain('No such lot');
    ctx.db.update(schema.lots).set({ level: 4 }).run();
    const maxI = fakeCommand({ name: 'upgrade', user: 'u1', options: { lot: lot.id } });
    await cmd.execute(ctx, maxI.asChatInput());
    expect(replyText(maxI.replies[0])).toContain('max level');
  });
  it('/decorate execute adds decor', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', Object.keys(PADDOCKS)[0]);
    const item = Object.keys(DECOR)[0];
    const cmd = parkModule.commands.find((c) => c.data.name === 'decorate')!;
    const i = fakeCommand({ name: 'decorate', user: 'u1', options: { lot: lot.id, item } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Decoration added');
    expect(ctx.db.select().from(schema.lots).all()[0].decor).toContain(DECOR[item].kind ?? item);
  });
  it('/park rename updates parkName', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = parkModule.commands.find((c) => c.data.name === 'park')!;
    const i = fakeCommand({ name: 'park', sub: 'rename', user: 'u1', options: { name: 'Raptor Ranch' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Raptor Ranch');
    expect(ctx.db.select().from(schema.users).all()[0].parkName).toBe('Raptor Ranch');
  });
});
```

The `/decorate` decor assertion depends on `DECOR`'s shape (`src/data/decor.ts`): read it first — the builder choices use its values' `kind` per the audit; assert whatever `decorateLot` actually appends (the existing `decorateLot` service test in `tests/dinos.test.ts:39-43` shows the exact expectation to copy). Add imports as needed: `upgradeLot`, `LotLimitError`, `UnknownKindError` from `../src/modules/park/service.js`, `InsufficientFundsError` from `../src/core/economy.js`, `PADDOCKS` from `../src/data/paddocks.js`, `DECOR` from `../src/data/decor.js`, `parkModule`, `replyText`, `MessageFlags`.

Append to `tests/dinos.test.ts` (it already imports `assignDino`, park module, harness):

```ts
  it('/dino unassign execute unassigns through the command layer', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', herbivorePaddockKind());
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, lotId: lot.id,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const cmd = parkModule.commands.find((c) => c.data.name === 'dino')!;
    const i = fakeCommand({ name: 'dino', sub: 'unassign', user: 'u1', options: { dino: dino.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Unassigned');
    expect(ctx.db.select().from(schema.dinos).all()[0].lotId).toBeNull();
  });
  it('park:collect button collects for the clicker, then reports nothing left', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 1_000_000 }).run();
    const lot = buildLot(ctx, 'u1', herbivorePaddockKind());
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, lotId: lot.id,
    }).run();
    ctx.db.update(schema.users).set({ lastCollectAt: 0 }).run();
    ctx.setNow(2 * 3_600_000);
    const comp = parkModule.components.find((c) => c.prefix === 'park')!;
    const b1 = fakeButton({ customId: 'park:collect', user: 'u1' });
    await comp.execute(ctx, b1.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(b1.replies[0])).toContain('Collected');
    const b2 = fakeButton({ customId: 'park:collect', user: 'u1' });
    await comp.execute(ctx, b2.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(b2.replies[0])).toContain('Nothing to collect');
  });
```

Where `herbivorePaddockKind()` is a small local helper to add near the top of the file:

```ts
import { PADDOCKS } from '../src/data/paddocks.js';
const herbivorePaddockKind = () =>
  Object.keys(PADDOCKS).find((k) => PADDOCKS[k].diet === 'herbivore')!;
```

(If the file already builds herbivore paddocks another way — check its existing assign tests — reuse that idiom instead of adding the helper.)

- [ ] **Step 5: Run all four files, typecheck, commit**

Run: `npx vitest run tests/hatchery.test.ts tests/care.test.ts tests/park.test.ts tests/dinos.test.ts` — expect PASS.
Run: `npm run typecheck` — expect clean.

```bash
git add tests/hatchery.test.ts tests/care.test.ts tests/park.test.ts tests/dinos.test.ts
git commit -m "Cover incubate, hatch, rescue, upgrade, decorate, rename, unassign, and park:collect entry points"
```

---

### Task 6: Uncovered entry points — shop, expeditions, trading, admin, settings + error branches

**Files:**
- Create: `tests/settings.test.ts`
- Test: additions to `tests/shop.test.ts`, `tests/expeditions.test.ts`, `tests/trading.test.ts`, `tests/admin.test.ts`, `tests/hatchery.test.ts`, `tests/autocomplete-trading.test.ts`

**Interfaces:**
- Consumes: strict harness incl. `getChannel` support (Task 4), module manifests, existing service imports per file.
- Produces: coverage only.

- [ ] **Step 1: `tests/settings.test.ts` (new file — first coverage of the settings module)**

```ts
import { describe, it, expect } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, replyText } from './harness.js';
import { settingsModule } from '../src/modules/settings/index.js';
import { schema } from '../src/core/db/index.js';

const cmd = settingsModule.commands[0];

describe('/settings channel', () => {
  it('refuses outside a guild, ephemeral', async () => {
    const ctx = makeCtx();
    const i = fakeCommand({ name: 'settings', sub: 'channel', user: 'u1', options: { channel: 'chan1' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Use this in a server');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(ctx.db.select().from(schema.guildSettings).all()).toHaveLength(0);
  });
  it('inserts then updates the notify channel for a guild', async () => {
    const ctx = makeCtx();
    const first = fakeCommand({ name: 'settings', sub: 'channel', user: 'u1', guild: 'g1', options: { channel: 'chanA' } });
    await cmd.execute(ctx, first.asChatInput());
    expect(replyText(first.replies[0])).toContain('<#chanA>');
    expect(ctx.db.select().from(schema.guildSettings).all()).toEqual([
      { guildId: 'g1', notifyChannelId: 'chanA' },
    ]);
    const second = fakeCommand({ name: 'settings', sub: 'channel', user: 'u1', guild: 'g1', options: { channel: 'chanB' } });
    await cmd.execute(ctx, second.asChatInput());
    expect(ctx.db.select().from(schema.guildSettings).all()).toEqual([
      { guildId: 'g1', notifyChannelId: 'chanB' },
    ]);
  });
});
```

- [ ] **Step 2: shop — `/shop food` execute, `/sell` unsellable preview, `sell:confirm` locked error**

Append to `tests/shop.test.ts`:

```ts
  it('/shop food execute buys units and replies with the total', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = shopModule.commands.find((c) => c.data.name === 'shop')!;
    const i = fakeCommand({ name: 'shop', sub: 'food', user: 'u1', options: { item: 'ferns', units: 10 } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Bought 10× Ferns for 100 cash');
    expect(ctx.economy.getFoodInventory('u1').ferns).toBe(20);   // 10 starter + 10 bought
  });
  it('/sell rejects an unsellable (locked) dino ephemeral, and sell:confirm re-checks', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, locked: true,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const sell = shopModule.commands.find((c) => c.data.name === 'sell')!;
    const i = fakeCommand({ name: 'sell', user: 'u1', options: { dino: dino.id } });
    await sell.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('cannot be sold');
    const comp = shopModule.components.find((c) => c.prefix === 'sell')!;
    const b = fakeButton({ customId: `sell:confirm:${dino.id}`, user: 'u1' });
    await comp.execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(b.replies[0])).toContain('locked');
  });
```

- [ ] **Step 3: expeditions — `/expedition status` both branches**

Append to `tests/expeditions.test.ts`:

```ts
  it('/expedition status with none active is an ephemeral hint', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const cmd = expeditionsModule.commands.find((c) => c.data.name === 'expedition')!;
    const i = fakeCommand({ name: 'expedition', sub: 'status', user: 'u1' });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('No active expedition');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });
  it('/expedition status while digging shows the countdown embed', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    startExpedition(ctx, 'u1', 'coastal_dig', null);
    const cmd = expeditionsModule.commands.find((c) => c.data.name === 'expedition')!;
    const i = fakeCommand({ name: 'expedition', sub: 'status', user: 'u1' });
    await cmd.execute(ctx, i.asChatInput());
    const embeds = (i.replies[0] as { embeds?: Array<{ toJSON?: () => unknown }> }).embeds ?? [];
    expect(embeds.length).toBe(1);
    expect(JSON.stringify(embeds.map((e) => (e.toJSON ? e.toJSON() : e)))).toContain('Digging');
  });
```

Match `startExpedition`'s exact signature from the top of this file's existing service tests.

- [ ] **Step 4: trading — `/trade cancel` execute; decline-sub and want-food autocomplete**

Append to `tests/trading.test.ts` (reuse its trade-seeding helpers — it has working `createTrade` setups around lines 20-166; copy one that seeds both users at rating ≥ 200 with a tradeable dino):

```ts
  it('/trade cancel execute cancels a pending trade and unlocks the offer', async () => {
    const ctx = makeCtx();
    // Reuse the file's existing two-user + createTrade seed idiom here.
    const { tradeId, dinoId } = seedPendingTrade(ctx);   // see note below
    const cmd = tradingModule.commands.find((c) => c.data.name === 'trade')!;
    const i = fakeCommand({ name: 'trade', sub: 'cancel', user: 'a', options: { id: tradeId } });
    await cmd.execute(ctx, i.asChatInput());
    expect(i.replies).toHaveLength(1);
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('cancelled');
    expect(ctx.db.select().from(schema.dinos).all().find((d) => d.id === dinoId)?.locked).toBe(false);
  });
```

`seedPendingTrade` is not an existing helper — extract the file's repeated offer-seeding block (create users `a`/`b`, set both `parkRating` to 200, insert a dino for `a`, `createTrade` offering it) into a local function returning `{ tradeId, dinoId }`, and reuse it in this test. The cancel reply text is not pinned (only the status flip and unlock are) because the audit did not capture the exact string — do NOT invent one; if you want the text pinned, read `src/modules/trading/index.ts:134-136` first and use `toContain` on a distinctive word from the actual source.

Append to `tests/autocomplete-trading.test.ts`:

```ts
  it('decline id autocomplete lists incoming trades by name', async () => {
    const ctx = makeCtx();
    const { tradeId } = seedPendingTrade(ctx);   // same helper idiom as trading.test.ts
    const fa = fakeAutocomplete({ name: 'trade', sub: 'decline', user: 'b', focused: { name: 'id', value: '' } });
    await tradingModule.commands.find((c) => c.data.name === 'trade')!.autocomplete!(ctx, fa.asAutocomplete());
    const choices = fa.replies[0] as Array<{ value: unknown }>;
    expect(choices.map((c) => c.value)).toContain(tradeId);
  });
  it('want-food with the user option set lists the counterparty inventory', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'a', 'a'); getOrCreateUser(ctx, 'b', 'b');
    const fa = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'a',
      focused: { name: 'want-food', value: '' }, options: { user: 'b' },
    });
    await tradingModule.commands.find((c) => c.data.name === 'trade')!.autocomplete!(ctx, fa.asAutocomplete());
    const names = (fa.replies[0] as Array<{ name: string }>).map((c) => c.name);
    expect(names.some((n) => n.includes('they hold'))).toBe(true);
  });
```

(The `b` user's starter food — 10 ferns, 10 fish — is what shows up as holdings.)

- [ ] **Step 5: admin — `/admin fast-forward` execute + give pairing validation; hatchery/park error branches**

Append to `tests/admin.test.ts` (reuse its `run()` helper at lines 108-148 if it fits, else `fakeCommand` directly with `user: 'owner'`):

```ts
  it('/admin fast-forward shifts time through the command layer', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'target', 'target');
    const cmd = adminModule.commands[0];
    const i = fakeCommand({ name: 'admin', sub: 'fast-forward', user: 'owner', options: { user: 'target', hours: 24 } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Fast-forwarded');
  });
  it('/admin give rejects half-set food pairing', async () => {
    const ctx = makeCtx();
    const cmd = adminModule.commands[0];
    const i = fakeCommand({ name: 'admin', sub: 'give', user: 'owner', options: { user: 'target', 'food-item': 'ferns' } });
    await cmd.execute(ctx, i.asChatInput());
    expect(replyText(i.replies[0])).toContain('Set both food-item and food-qty');
  });
```

Append to `tests/hatchery.test.ts` (error branches):

```ts
  it('mythic:confirm blocks below 4-star rating and on empty wallet', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const comp = hatcheryModule.components.find((c) => c.prefix === 'mythic')!;
    const gated = fakeButton({ customId: 'mythic:confirm:indominus', user: 'u1' });
    await comp.execute(ctx, gated.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(gated.replies[0])).toContain('4★');
    ctx.db.update(schema.users).set({ ratingHighWater: 400, shards: 0 }).run();
    const broke = fakeButton({ customId: 'mythic:confirm:indominus', user: 'u1' });
    await comp.execute(ctx, broke.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(broke.replies[0])).toContain('Not enough shards');
  });
  it('hatch:crack on a non-incubating egg is an ephemeral error', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    const egg = ctx.db.insert(schema.eggs)
      .values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0 }).returning().get();
    const comp = hatcheryModule.components.find((c) => c.prefix === 'hatch')!;
    const b = fakeButton({ customId: `hatch:crack:${egg.id}`, user: 'u1' });
    await comp.execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(replyText(b.replies[0])).toContain('not incubating');
  });
```

(The 4★ gate assertion: read the exact string thrown by `buyMythicEgg` in `src/modules/shop/shards.ts:60` — audit says `Reach 4★ park rating to unlock Mythic purchases.`; `toContain('4★')` pins it loosely.)

Append to `tests/park.test.ts` (`/build` error branches):

```ts
  it('/build maps LotLimitError and InsufficientFundsError to ephemeral replies', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ cash: 10_000_000 }).run();
    const kind = Object.keys(PADDOCKS)[0];
    for (let n = 0; n < 3; n++) buildLot(ctx, 'u1', kind);   // base slots = 3
    // Guard: recomputeRating after 3 builds must not have raised the slot cap.
    expect(lotSlots(ctx.db.select().from(schema.users).all()[0].ratingHighWater)).toBe(3);
    const cmd = parkModule.commands.find((c) => c.data.name === 'build')!;
    const full = fakeCommand({ name: 'build', user: 'u1', options: { kind } });
    await cmd.execute(ctx, full.asChatInput());
    expect(replyText(full.replies[0])).toContain('All lots full');
    ctx.db.delete(schema.lots).run();
    ctx.db.update(schema.users).set({ cash: 0 }).run();
    const broke = fakeCommand({ name: 'build', user: 'u1', options: { kind } });
    await cmd.execute(ctx, broke.asChatInput());
    expect(replyText(broke.replies[0])).toContain('Not enough cash');
  });
```

(`lotSlots` from `../src/data/progression.js`. If the guard assertion fails — 3 empty lots already raise `ratingHighWater` past the 4-slot threshold — drop the guard and instead build up to whatever `lotSlots` reports before asserting the full error.)

Append to `tests/care.test.ts` (feed not-your-dino branch):

```ts
  it('/feed one rejects a dino you do not own', async () => {
    const ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    ctx.db.insert(schema.dinos).values({
      userId: 'u2', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    const cmd = careModule.commands.find((c) => c.data.name === 'feed')!;
    const i = fakeCommand({ name: 'feed', sub: 'one', user: 'u1', options: { dino: dino.id } });
    await cmd.execute(ctx, i.asChatInput());
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    expect(replyText(i.replies[0])).toContain('own');
  });
```

- [ ] **Step 6: Run everything, typecheck, commit**

Run: `npm test` — expect PASS (fix any wrong expectation against module source, as in Task 5).
Run: `npm run typecheck` — expect clean.

```bash
git add tests/settings.test.ts tests/shop.test.ts tests/expeditions.test.ts tests/trading.test.ts tests/autocomplete-trading.test.ts tests/admin.test.ts tests/hatchery.test.ts tests/park.test.ts tests/care.test.ts
git commit -m "Cover settings, shop food, expedition status, trade cancel, admin fast-forward, and error branches"
```

---

### Task 7: Router gap tests

**Files:**
- Test: additions to `tests/router.test.ts`

**Interfaces:**
- Consumes: `routeInteraction` from `src/core/router.js`, strict harness, the file's existing synthetic-module idiom (it builds stub `ModuleRegistry` instances with fake commands like `ping` — reuse that pattern; synthetic names stay in permissive harness mode by design).
- Produces: coverage only.

- [ ] **Step 1: Write the tests**

Append to `tests/router.test.ts`, reusing its existing `makeCtx`/registry-building helpers:

```ts
  it('falls back to followUp when the handler deferred before throwing', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const reg = new ModuleRegistry([{
      name: 'm', components: [],
      commands: [{
        data: new SlashCommandBuilder().setName('boom').setDescription('x'),
        async execute(_c, i) { await i.deferReply(); throw new Error('boom'); },
      }],
    }], { m: true });
    const fi = fakeCommand({ name: 'boom', user: 'u1' });
    await routeInteraction(ctx, reg, fi.asInteraction());
    // deferReply recorded nothing; the followUp fallback is the only reply.
    expect(fi.replies).toHaveLength(1);
    expect(replyText(fi.replies[0])).toContain('Something went wrong');
  });
  it('falls back to followUp when the handler replied before throwing', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const reg = new ModuleRegistry([{
      name: 'm', components: [],
      commands: [{
        data: new SlashCommandBuilder().setName('boom2').setDescription('x'),
        async execute(_c, i) { await i.reply({ content: 'partial' }); throw new Error('late'); },
      }],
    }], { m: true });
    const fi = fakeCommand({ name: 'boom2', user: 'u1' });
    await routeInteraction(ctx, reg, fi.asInteraction());
    expect(fi.replies).toHaveLength(2);
    expect(replyText(fi.replies[1])).toContain('Something went wrong');
  });
  it('unknown command is a silent no-op but presence still writes', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const reg = new ModuleRegistry([], {});
    const fi = fakeCommand({ name: 'ghost', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, reg, fi.asInteraction());
    expect(fi.replies).toHaveLength(0);
    expect(ctx.db.select().from(schema.userGuilds).all()).toHaveLength(1);
  });
  it('first-ever user (no users row) routes without crashing; displayName update no-ops', async () => {
    const ctx = makeCtx();
    const reg = new ModuleRegistry([], {});
    const fi = fakeCommand({ name: 'ghost', user: 'new-user', guild: 'g1' });
    await routeInteraction(ctx, reg, fi.asInteraction());
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.userGuilds).all()).toHaveLength(1);
  });
  it('unmatched button customId is a silent no-op', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const reg = new ModuleRegistry([], {});
    const fb = fakeButton({ customId: 'nowhere:at:all', user: 'u1' });
    await routeInteraction(ctx, reg, fb.asInteraction());
    expect(fb.replies).toHaveLength(0);
  });
  it('non-command, non-button, non-autocomplete interactions return quietly with no presence write', async () => {
    const ctx = makeCtx();
    const reg = new ModuleRegistry([], {});
    const modalish = {
      isAutocomplete: () => false, isChatInputCommand: () => false, isButton: () => false,
      user: { id: 'u1', displayName: 'u1' }, guildId: 'g1',
    };
    await routeInteraction(ctx, reg, modalish as unknown as Interaction);
    expect(ctx.db.select().from(schema.userGuilds).all()).toHaveLength(0);
  });
  it('autocomplete double-fault (provider throws, recovery respond throws too) never rejects', async () => {
    const ctx = makeCtx();
    const reg = new ModuleRegistry([{
      name: 'm', components: [],
      commands: [{
        data: new SlashCommandBuilder().setName('ac').setDescription('x')
          .addStringOption((o) => o.setName('q').setDescription('q').setAutocomplete(true)),
        async execute() { /* unused */ },
        async autocomplete() { throw new Error('provider boom'); },
      }],
    }], { m: true });
    const hostile = {
      commandName: 'ac',
      isAutocomplete: () => true, isChatInputCommand: () => false, isButton: () => false,
      user: { id: 'u1', displayName: 'u1' }, guildId: null,
      respond: async () => { throw new Error('respond boom'); },
    };
    await expect(routeInteraction(ctx, reg, hostile as unknown as Interaction)).resolves.toBeUndefined();
  });
```

Also add one assertion to the file's existing repeated-interactions test (`upserts user_guilds on repeated interactions`, lines 61-64): after routing, assert `ctx.db.select().from(schema.users).all()[0].displayName` equals the fake's display name — pinning the `touchPresence` displayName write.

Match the file's existing import style for `ModuleRegistry`, `SlashCommandBuilder`, `Interaction`, `schema`, `routeInteraction` — most are already imported there; add `replyText` and `fakeButton` from the harness if missing. Users seeded directly via `schema.users` inserts need `lastCollectAt` and `createdAt` (both NOT NULL).

- [ ] **Step 2: Run, fix expectations against router source if needed, commit**

Run: `npx vitest run tests/router.test.ts` — expect PASS.
Run: `npm run typecheck` — expect clean.

```bash
git add tests/router.test.ts
git commit -m "Cover router fallback, unknown-target, first-user, and double-fault paths"
```

---

### Task 8: Journey suite

**Files:**
- Create: `tests/journeys.test.ts`

**Interfaces:**
- Consumes: strict harness, all module manifests, `eggHatchHandler`/`expeditionReturnHandler` + `Sender` from `src/core/notify.js`, `accruedIncome`/`comfortAt`/`ClockDino` from `src/core/clock.js`, `RARITY`, `PADDOCKS`, `getSpecies`, `settingsModule`, `schema`, `getOrCreateUser`, `buildLot`.
- Produces: coverage only. This file is the regression net over the six risky time/state couplings from the audit — comments in the file must say what invariant each test pins.

- [ ] **Step 1: Create the file skeleton with shared helpers**

```ts
import { describe, it, expect } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { parkModule } from '../src/modules/park/index.js';
import { hatcheryModule } from '../src/modules/hatchery/index.js';
import { careModule } from '../src/modules/care/index.js';
import { tradingModule } from '../src/modules/trading/index.js';
import { expeditionsModule } from '../src/modules/expeditions/index.js';
import { adminModule } from '../src/modules/admin/index.js';
import { settingsModule } from '../src/modules/settings/index.js';
import { eggHatchHandler, type Sender } from '../src/core/notify.js';
import { accruedIncome, comfortAt, type ClockDino } from '../src/core/clock.js';
import { RARITY } from '../src/data/rarity.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { getSpecies } from '../src/data/species/index.js';

const H = 3_600_000;
const cmd = (m: { commands: Array<{ data: { name: string } }> }, name: string) =>
  (m.commands as Array<{ data: { name: string }; execute: Function; autocomplete?: Function }>)
    .find((c) => c.data.name === name)!;
const comp = (m: { components: Array<{ prefix: string }> }, prefix: string) =>
  (m.components as Array<{ prefix: string; execute: Function }>).find((c) => c.prefix === prefix)!;
const paddockKindFor = (diet: string) => Object.keys(PADDOCKS).find((k) => PADDOCKS[k].diet === diet)!;

async function run(module: unknown, name: string, opts: Parameters<typeof fakeCommand>[0]) {
  const i = fakeCommand(opts);
  await cmd(module as never, name).execute!(undefined as never, i.asChatInput());
  return i;
}
```

Do NOT use the `run` helper above as written — it drops `ctx`. Use this corrected form (shown separately so the mistake is visible): every dispatch takes `ctx` first:

```ts
type AnyModule = { commands: Array<{ data: { name: string }; execute: (c: unknown, i: unknown) => Promise<void> }> };
async function dispatch(ctx: unknown, module: AnyModule, name: string, opts: Parameters<typeof fakeCommand>[0]) {
  const i = fakeCommand(opts);
  await module.commands.find((c) => c.data.name === name)!.execute(ctx, i.asChatInput());
  return i;
}
async function click(ctx: unknown, module: { components: Array<{ prefix: string; execute: (c: unknown, i: unknown) => Promise<void> }> }, customId: string, user: string) {
  const b = fakeButton({ customId, user });
  await module.components.find((c) => c.prefix === customId.split(':')[0])!.execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
  return b;
}
```

(Keep only `dispatch`/`click`; typed loosely because module execute signatures take the concrete `Ctx`.)

- [ ] **Step 2: The full spine — incubate → hatch → crack → assign → earn → collect**

```ts
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
```

Note: the freshly hatched dino is fed (`hunger` set at hatch — verify against `hatchEgg` in `src/modules/hatchery/service.ts`; if it hatches at hunger 100 with `lastFedAt = now` this works as-is; if not, add a `/feed one` dispatch before advancing time).

- [ ] **Step 3: Coupling 1+2 — feed inside the collect window, and the hunger-100 knee**

```ts
  it('feed inside an uncollected window: collect pays exactly what the current formula integrates', async () => {
    // Pins coupling #1 (audit): collectIncome integrates [lastCollectAt, now] with the
    // dino's CURRENT hungerAtFed/lastFedAt — a feed mid-window retroactively reprices
    // the pre-feed segment. This is a characterization test of the shipped behavior;
    // if the formula is ever made feed-aware, this expectation changes deliberately.
    const ctx = makeCtx(); ctx.setNow(0);
    await dispatch(ctx, adminModule, 'admin', {
      name: 'admin', sub: 'give', user: 'owner',
      options: { user: 'p1', 'dino-species': 'triceratops', cash: 100_000, 'food-item': 'royal_greens', 'food-qty': 50 },
    });
    const dino = ctx.db.select().from(schema.dinos).all()[0];
    await dispatch(ctx, parkModule, 'build', { name: 'build', user: 'p1', options: { kind: paddockKindFor('herbivore') } });
    const lot = ctx.db.select().from(schema.lots).all()[0];
    await dispatch(ctx, parkModule, 'dino', { name: 'dino', sub: 'assign', user: 'p1', options: { dino: dino.id, lot: lot.id } });
    ctx.db.update(schema.users).set({ lastCollectAt: ctx.now() }).run();
    ctx.setNow(30 * H);   // hunger has drained well below 100
    const feed = await dispatch(ctx, careModule, 'feed', {
      name: 'feed', sub: 'one', user: 'p1', options: { dino: dino.id, food: 'royal_greens' },
    });
    expect(replyText(feed.replies[0])).toContain('Fed');
    ctx.setNow(35 * H);
    // Expected: what the service formula computes from the POST-feed row over the
    // full window — including the knee at hunger 100 (fillTo 150 crosses it).
    const row = ctx.db.select().from(schema.dinos).all()[0];
    const lotRow = ctx.db.select().from(schema.lots).all()[0];
    const clockDino: ClockDino = {
      species: getSpecies(row.speciesId), paddock: PADDOCKS[lotRow.kind], decor: lotRow.decor,
      hungerAtFed: row.hunger, lastFedAt: row.lastFedAt, escapedAt: row.escapedAt,
    };
    const user = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!;
    const expected = accruedIncome([clockDino], 0, 8, user.lastCollectAt, ctx.now());
    const before = user.cash;
    const collect = await click(ctx, parkModule, 'park:collect', 'p1');
    expect(replyText(collect.replies[0])).toContain('Collected');
    const after = ctx.db.select().from(schema.users).all().find((u) => u.discordId === 'p1')!.cash;
    expect(after - before).toBe(expected);
    // Knee guard (coupling #2): a naive two-point trapezoid over the whole window
    // must NOT equal the piecewise result, or this test can't catch a "simplifying"
    // refactor of the knee. Window: [lastCollectAt, capped end].
    const capEnd = Math.min(ctx.now(), user.lastCollectAt + 8 * H);
    const naive = Math.floor(
      ((comfortAt(clockDino, user.lastCollectAt) + comfortAt(clockDino, capEnd)) / 2)
      * ((capEnd - user.lastCollectAt) / H) * RARITY[getSpecies(row.speciesId).rarity].incomePerHr);
    expect(naive).not.toBe(expected);
  });
```

Window arithmetic sanity for the knee guard: feed happens at t=30h with `fillTo` 150, knee sits at `lastFedAt + (150-100)/100 × 48h` = 30h + 24h = 54h; collect at 35h with `lastCollectAt` = 30h*... — WRONG, `lastCollectAt` is 0h and the cap is 8h, so the integration window is [0h, 8h], entirely PRE-feed, back-extrapolated above `hungerAtFed`. That still exercises coupling #1 (retroactive full-comfort repricing: hunger extrapolates above 150 but `comfortAt` clamps at 100 → flat comfort, so the naive trapezoid EQUALS the piecewise result and the knee guard fails). Fix when implementing: set `lastCollectAt` to `28 * H` via the db update placed AFTER `ctx.setNow(30 * H)` and feed, i.e. reorder so the window is [28h, 35h] — it then straddles the feed instant (30h) and, because the window is only 7h < 8h cap, no cap truncation. With `hungerAtFed = 150, lastFedAt = 30h`, the knee lands at 54h — OUTSIDE this window, so for the knee-specific guard use a SECOND collect: advance to `58 * H`, collect again (window [35h, 43h]? no — `lastCollectAt` becomes 35h at first collect, cap 8h ⇒ window [35h, 43h], knee 54h still outside). Conclusion for the implementer: assert the formula-equality expectation exactly as written (it is window-agnostic — it always mirrors the service), but compute the knee guard on a DIRECT window that straddles it: `accruedIncome([clockDino], 0, 48, 53*H, 55*H)` vs the two-point trapezoid over [53h, 55h] — no command dispatch needed for the guard, it pins `accruedIncome`'s piecewise property with the exact same dino row the journey produced. Adjust the code accordingly; the assertions to keep are (a) command-path collect delta === `accruedIncome(...)` over `[lastCollectAt, now]` with cap from `capHours` (import it and pass `capHours(lots)` instead of the literal 8), and (b) piecewise ≠ trapezoid on a knee-straddling window.

- [ ] **Step 4: Coupling 3 — escape → settle-on-interaction → rescue → resume**

```ts
  it('escape loop: starve → interaction settles → /rescue → feeding and earning resume', async () => {
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
    expect(replyText(feedOk.replies[0])).toContain('Fed');
    ctx.db.update(schema.users).set({ lastCollectAt: ctx.now() }).run();
    ctx.setNow(62 * H);
    const collect = await click(ctx, parkModule, 'park:collect', 'p1');
    expect(replyText(collect.replies[0])).toContain('Collected');
  });
```

- [ ] **Step 5: Coupling 4 — trade escrow expiry at the command layer**

```ts
  it('trade expiry: /trade offer → +25h → /trade accept fails expired and the dino unlocks', async () => {
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
    expect(replyText(offer.replies[0])).toContain('Trade');
    expect(ctx.db.select().from(schema.dinos).all()[0].locked).toBe(true);
    const trade = ctx.db.select().from(schema.trades).all()[0];
    ctx.setNow(25 * H);
    const accept = await dispatch(ctx, tradingModule, 'trade', {
      name: 'trade', sub: 'accept', user: 'b', options: { id: trade.id },
    });
    expect(replyText(accept.replies[0])).toMatch(/expired|no longer open/);
    expect(ctx.db.select().from(schema.trades).all()[0].status).toBe('expired');
    expect(ctx.db.select().from(schema.dinos).all()[0].locked).toBe(false);
    expect(ctx.db.select().from(schema.dinos).all()[0].userId).toBe('a');
  });
```

(`expireStale` runs at the top of the accept execute, so the status is already `expired` when the accept path evaluates — either rejection message is a valid pin; the DB assertions are the real invariant.)

- [ ] **Step 6: Coupling 5 — scheduler → notification handlers end-to-end (via /settings)**

```ts
  it('notification chain: /settings channel → /incubate → tick → channel ping; hatched egg → no ping', async () => {
    const ctx = makeCtx(); ctx.setNow(0);
    const sent: Array<{ channelId: string; content: string }> = [];
    const sender: Sender = {
      channelSend: async (channelId, content) => { sent.push({ channelId, content }); },
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
    expect(sent[0].channelId).toBe('notify-chan');
    expect(sent[0].content).toContain('<@p1>');
    expect(sent[0].content).toContain('ready to hatch');
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
```

- [ ] **Step 7: Coupling 6 — rating high-water earned through play, gates observed**

```ts
  it('rating: play raises ratingHighWater monotonically; locked site gate holds', async () => {
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
});
```

- [ ] **Step 8: Run, reconcile, typecheck, commit**

Run: `npx vitest run tests/journeys.test.ts` — expect PASS after reconciling any expectation that disagrees with source (same rule as Tasks 5-6: the module is the truth; also re-check the Step 3 window-arithmetic note). Then `npm test` and `npm run typecheck`.

```bash
git add tests/journeys.test.ts
git commit -m "Add command-level journey tests for the six risky time couplings"
```

---

### Task 9: Extract and test the emoji-sync state machine

**Files:**
- Create: `src/core/emoji-sync.ts`
- Modify: `src/deploy-emojis.ts` (becomes a thin shell)
- Test: `tests/deploy-emojis.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: from `src/core/emoji-sync.ts` —

```ts
export interface EmojiRestOps {
  create(name: string, png: Buffer): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface SyncResult { created: string[]; replaced: string[]; unchanged: string[]; orphans: string[] }
export function sha(b: Buffer): string;
export async function syncEmojis(
  local: Map<string, Buffer>,
  remote: Map<string, string>,          // name -> id, pre-fetched by the caller
  manifest: Record<string, string>,     // name -> sha256; MUTATED in place per upload
  ops: EmojiRestOps,
  log?: (line: string) => void,
): Promise<SyncResult>
```

`manifest` mutation-per-upload is the load-bearing contract: the caller writes the manifest in a `finally`, so a mid-loop failure must leave already-uploaded digests recorded (this is the existing behavior at `src/deploy-emojis.ts:43-58`, preserved verbatim).

- [ ] **Step 1: Write the failing tests**

Create `tests/deploy-emojis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { syncEmojis, sha, type EmojiRestOps } from '../src/core/emoji-sync.js';

const png = (s: string) => Buffer.from(s);
function recorder() {
  const calls: string[] = [];
  const ops: EmojiRestOps = {
    create: async (name) => { calls.push(`create:${name}`); },
    remove: async (id) => { calls.push(`remove:${id}`); },
  };
  return { calls, ops };
}

describe('syncEmojis', () => {
  it('skips unchanged, creates new, replaces changed (delete then create)', async () => {
    const { calls, ops } = recorder();
    const local = new Map([['same', png('A')], ['fresh', png('B')], ['edited', png('C2')]]);
    const remote = new Map([['same', 'id1'], ['edited', 'id2']]);
    const manifest: Record<string, string> = { same: sha(png('A')), edited: sha(png('C1')) };
    const r = await syncEmojis(local, remote, manifest, ops);
    expect(r.unchanged).toEqual(['same']);
    expect(r.created).toEqual(['fresh']);
    expect(r.replaced).toEqual(['edited']);
    expect(calls).toEqual(['create:fresh', 'remove:id2', 'create:edited']);
    expect(manifest.fresh).toBe(sha(png('B')));
    expect(manifest.edited).toBe(sha(png('C2')));
  });
  it('remote-missing but manifest-matching name is re-created (self-heal)', async () => {
    const { calls, ops } = recorder();
    const local = new Map([['ghost', png('X')]]);
    const manifest: Record<string, string> = { ghost: sha(png('X')) };
    const r = await syncEmojis(local, new Map(), manifest, ops);
    expect(r.created).toEqual(['ghost']);
    expect(calls).toEqual(['create:ghost']);
  });
  it('a mid-loop create failure keeps earlier uploads in the manifest and rethrows', async () => {
    const calls: string[] = [];
    const ops: EmojiRestOps = {
      create: async (name) => {
        if (name === 'second') throw new Error('rate limited');
        calls.push(`create:${name}`);
      },
      remove: async () => {},
    };
    const local = new Map([['first', png('1')], ['second', png('2')]]);
    const manifest: Record<string, string> = {};
    await expect(syncEmojis(local, new Map(), manifest, ops)).rejects.toThrow('rate limited');
    expect(manifest.first).toBe(sha(png('1')));
    expect(manifest.second).toBeUndefined();
  });
  it('reports remote orphans without touching them', async () => {
    const { calls, ops } = recorder();
    const r = await syncEmojis(new Map(), new Map([['stray', 'id9']]), {}, ops);
    expect(r.orphans).toEqual(['stray']);
    expect(calls).toEqual([]);
  });
});
```

Map iteration order note: `local` iterates in insertion order, so the expected `calls` sequences above are deterministic.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/deploy-emojis.test.ts` — FAIL (module missing).

- [ ] **Step 3: Extract the logic**

Create `src/core/emoji-sync.ts` by moving the loop from `src/deploy-emojis.ts:25-53,59-61` (semantics identical — compare side by side when done):

```ts
import { createHash } from 'node:crypto';

export interface EmojiRestOps {
  create(name: string, png: Buffer): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface SyncResult { created: string[]; replaced: string[]; unchanged: string[]; orphans: string[] }

export function sha(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}

// Hash-manifest sync of local PNGs to Discord application emojis. `manifest`
// is mutated per successful upload so the caller's finally-write never claims
// an emoji that a mid-loop failure never created.
export async function syncEmojis(
  local: Map<string, Buffer>,
  remote: Map<string, string>,
  manifest: Record<string, string>,
  ops: EmojiRestOps,
  log: (line: string) => void = () => {},
): Promise<SyncResult> {
  const result: SyncResult = { created: [], replaced: [], unchanged: [], orphans: [] };
  for (const [name, png] of local) {
    const digest = sha(png);
    const existingId = remote.get(name);
    if (existingId && manifest[name] === digest) { result.unchanged.push(name); continue; }
    if (existingId) {        // changed → delete + recreate (new ID; runtime refetches on next boot)
      await ops.remove(existingId);
    }
    await ops.create(name, png);
    manifest[name] = digest;
    if (existingId) { result.replaced.push(name); log(`Replaced: ${name}`); }
    else { result.created.push(name); log(`Created: ${name}`); }
  }
  for (const name of remote.keys()) {
    if (!local.has(name)) {
      result.orphans.push(name);
      log(`Orphan on Discord (no local PNG, left in place): ${name}`);
    }
  }
  return result;
}
```

Rewrite `src/deploy-emojis.ts` to keep only: config/REST setup, PNG dir read, manifest read (incl. the corrupt-manifest throw), the remote fetch, then:

```ts
import { syncEmojis } from './core/emoji-sync.js';
// ... existing setup unchanged down to `const remote = ...` ...
let result;
try {
  result = await syncEmojis(local, remote, manifest, {
    create: (name, png) => rest.post(Routes.applicationEmojis(config.clientId), {
      body: { name, image: `data:image/png;base64,${png.toString('base64')}` },
    }).then(() => {}),
    remove: (id) => rest.delete(Routes.applicationEmoji(config.clientId, id)).then(() => {}),
  }, console.log);
} finally {
  // Written on every exit — success or thrown error — so a partial run never
  // loses the record of emojis it already uploaded.
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}
console.log(`Emojis synced: ${result.created.length} created, ${result.replaced.length} replaced, ${result.unchanged.length} unchanged (${local.size} local).`);
```

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `npx vitest run tests/deploy-emojis.test.ts` — PASS. Then `npm test && npm run typecheck`.

```bash
git add src/core/emoji-sync.ts src/deploy-emojis.ts tests/deploy-emojis.test.ts
git commit -m "Extract the emoji sync state machine and pin its skip, replace, and failure semantics"
```

---

### Task 10: Render protocol, notify handlers, scheduler edges

**Files:**
- Create: `src/core/render/protocol.ts`
- Modify: `src/core/render/worker.ts`, `src/core/render/client.ts`
- Test: `tests/render-worker.test.ts`, `tests/notify-handlers.test.ts`, additions to `tests/scheduler.test.ts`

**Interfaces:**
- Consumes: `renderParkPng` from `src/core/render/draw.js`, `ParkSnapshot` type.
- Produces: from `src/core/render/protocol.ts` —

```ts
export interface RenderRequest { id: number; snapshot: ParkSnapshot }
export interface WorkerReply { id: number; ok: boolean; png?: Buffer; error?: string }
export function handleRenderRequest(req: RenderRequest, render?: (s: ParkSnapshot) => Buffer): WorkerReply
```

and from `client.ts` a new export `createRunner(getW: () => WorkerLike): Runner` where `WorkerLike` is `{ on(ev: string, fn: (...a: never[]) => void): unknown; off(ev: string, fn: (...a: never[]) => void): unknown; postMessage(m: unknown): void }`. `runOnWorker` becomes `createRunner(getWorker)`; behavior is unchanged. Both sides of the thread boundary now import the SAME message types, so a field rename breaks the compile instead of silently killing live renders.

- [ ] **Step 1: Write the failing tests**

Create `tests/render-worker.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { handleRenderRequest } from '../src/core/render/protocol.js';
import { createRunner } from '../src/core/render/client.js';

describe('handleRenderRequest', () => {
  it('returns ok with the png for a successful render', () => {
    const png = Buffer.from('png-bytes');
    const reply = handleRenderRequest({ id: 7, snapshot: {} as never }, () => png);
    expect(reply).toEqual({ id: 7, ok: true, png });
  });
  it('returns ok:false with the error string when the render throws', () => {
    const reply = handleRenderRequest({ id: 8, snapshot: {} as never }, () => { throw new Error('bad snapshot'); });
    expect(reply.id).toBe(8);
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('bad snapshot');
  });
});

class FakeWorker extends EventEmitter {
  sent: unknown[] = [];
  postMessage(m: unknown) { this.sent.push(m); }
}

describe('createRunner', () => {
  it('resolves with a Buffer and ignores stale replies for older ids', async () => {
    const w = new FakeWorker();
    const run = createRunner(() => w as never);
    const p = run({} as never);
    const req = w.sent[0] as { id: number };
    w.emit('message', { id: req.id - 1, ok: true, png: Buffer.from('stale') });   // ignored
    w.emit('message', { id: req.id, ok: true, png: Buffer.from('fresh') });
    await expect(p).resolves.toEqual(Buffer.from('fresh'));
  });
  it('rejects on an error reply and on a worker error event', async () => {
    const w = new FakeWorker();
    const run = createRunner(() => w as never);
    const p1 = run({} as never);
    w.emit('message', { id: (w.sent[0] as { id: number }).id, ok: false, error: 'boom' });
    await expect(p1).rejects.toThrow('boom');
    const p2 = run({} as never);
    w.emit('error', new Error('worker died'));
    await expect(p2).rejects.toThrow('worker died');
  });
});
```

Create `tests/notify-handlers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { eggHatchHandler, expeditionReturnHandler, clientSender, type Sender } from '../src/core/notify.js';

function capture() {
  const dms: string[] = [];
  const sender: Sender = {
    channelSend: async () => { throw new Error('no channel configured in these tests'); },
    dmSend: async (_userId, content) => { dms.push(content); },
  };
  return { dms, sender };
}

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
    expect(dms[0]).toContain('rare egg is ready to hatch');
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
    expect(dms[0]).toContain('has returned');
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
    const sent: string[] = [];
    const fakeClient = {
      channels: { fetch: async () => ({ isTextBased: () => true, send: async (c: string) => { sent.push(c); } }) },
      users: { fetch: async () => ({ send: async (c: string) => { sent.push(`dm:${c}`); } }) },
    };
    const s = clientSender(fakeClient as never);
    await s.channelSend('c1', 'hello');
    expect(sent).toEqual(['hello']);
    await s.dmSend('u1', 'direct');
    expect(sent).toEqual(['hello', 'dm:direct']);
    const badClient = { channels: { fetch: async () => ({ isTextBased: () => false }) } };
    await expect(clientSender(badClient as never).channelSend('c1', 'x')).rejects.toThrow('not sendable');
  });
});
```

Append to `tests/scheduler.test.ts` (reuse its existing ctx/db idiom):

```ts
  it('a fresh Scheduler over the same DB retries a timer whose handler failed (restart recovery)', async () => {
    const ctx = makeCtx();
    const s1 = ctx.scheduler;
    s1.register('flaky', async () => { throw new Error('down'); });
    s1.enqueue({ kind: 'flaky', userId: 'u1', refId: 1, originGuildId: null, firesAt: 10 });
    expect(await s1.tick(20)).toBe(0);            // attempted, failed, blocked in-process
    expect(await s1.tick(30)).toBe(0);            // still blocked by the attempted set
    const s2 = new Scheduler(ctx.db);             // simulated restart
    let fired = 0;
    s2.register('flaky', async () => { fired++; });
    expect(await s2.tick(40)).toBe(1);
    expect(fired).toBe(1);
  });
  it('a handler registered after the first tick never fires timers that tick already attempted', async () => {
    // Pins the boot-order hazard: register() must run before the first tick.
    const ctx = makeCtx();
    const s = ctx.scheduler;
    s.enqueue({ kind: 'late', userId: 'u1', refId: 1, originGuildId: null, firesAt: 10 });
    expect(await s.tick(20)).toBe(0);             // unregistered kind → attempted anyway
    let fired = 0;
    s.register('late', async () => { fired++; });
    expect(await s.tick(30)).toBe(0);
    expect(fired).toBe(0);
  });
  it('an in-flight timer is not double-fired by an overlapping tick', async () => {
    const ctx = makeCtx();
    const s = ctx.scheduler;
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let calls = 0;
    s.register('slow', async () => { calls++; await gate; });
    s.enqueue({ kind: 'slow', userId: 'u1', refId: 1, originGuildId: null, firesAt: 10 });
    const first = s.tick(20);                     // starts, blocks in the handler
    const second = await s.tick(21);              // overlapping tick sees it in `attempted`
    expect(second).toBe(0);
    release();
    expect(await first).toBe(1);
    expect(calls).toBe(1);
  });
```

Import `Scheduler` from `../src/core/scheduler.js` in that file if not already imported.

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run tests/render-worker.test.ts tests/notify-handlers.test.ts tests/scheduler.test.ts` — render file fails on missing module/export; notify tests should pass immediately (they target existing exports — if any fail, reconcile against `src/core/notify.ts`, the source is the truth); the scheduler additions should pass as written (they pin existing behavior).

- [ ] **Step 3: Implement the render refactor**

Create `src/core/render/protocol.ts`:

```ts
import { renderParkPng } from './draw.js';
import type { ParkSnapshot } from '../../modules/park/snapshot.js';

// The single definition of the client↔worker message shape. Both sides import
// it, so a field rename is a compile error instead of a silent live-render loss.
export interface RenderRequest { id: number; snapshot: ParkSnapshot }
export interface WorkerReply { id: number; ok: boolean; png?: Buffer; error?: string }

export function handleRenderRequest(
  req: RenderRequest, render: (s: ParkSnapshot) => Buffer = renderParkPng,
): WorkerReply {
  try {
    return { id: req.id, ok: true, png: render(req.snapshot) };
  } catch (e) {
    return { id: req.id, ok: false, error: String(e) };
  }
}
```

Rewrite `src/core/render/worker.ts` to:

```ts
import { parentPort } from 'node:worker_threads';
import { handleRenderRequest, type RenderRequest } from './protocol.js';

// One message in, one message out. The id lets the client ignore replies for a
// request it already abandoned (e.g. after a timeout), so a stale reply can never
// resolve a newer request on the reused worker.
parentPort?.on('message', (req: RenderRequest) => {
  parentPort!.postMessage(handleRenderRequest(req));
});
```

In `src/core/render/client.ts`: delete the local `WorkerReply` interface, add `import type { WorkerReply } from './protocol.js';`, define the `WorkerLike` interface, and split `runOnWorker` into an exported factory plus the bound instance:

```ts
export interface WorkerLike {
  on(ev: 'message' | 'error', fn: (m: never) => void): unknown;
  off(ev: 'message' | 'error', fn: (m: never) => void): unknown;
  postMessage(m: unknown): void;
}

export function createRunner(getW: () => WorkerLike): Runner {
  return (snapshot) => new Promise<Buffer>((res, rej) => {
    let w: WorkerLike;
    try { w = getW(); } catch (e) { rej(e instanceof Error ? e : new Error(String(e))); return; }
    const id = ++seq;
    const onMsg = (m: WorkerReply) => {
      if (m.id !== id) return;   // reply for an older, abandoned request — ignore
      cleanup();
      m.ok && m.png ? res(Buffer.from(m.png)) : rej(new Error(m.error ?? 'render failed'));
    };
    const onErr = (e: unknown) => { cleanup(); rej(e instanceof Error ? e : new Error(String(e))); };
    function cleanup() { w.off('message', onMsg as never); w.off('error', onErr as never); }
    w.on('message', onMsg as never); w.on('error', onErr as never);
    w.postMessage({ id, snapshot });
  });
}

const runOnWorker: Runner = createRunner(getWorker);
```

(`getWorker` and `seq` stay as they are; `renderPark`'s signature and the chain logic do not change.)

- [ ] **Step 4: Run all three files, full suite, typecheck, commit**

Run: `npx vitest run tests/render-worker.test.ts tests/notify-handlers.test.ts tests/scheduler.test.ts` then `npm test && npm run typecheck` — all PASS/clean.

```bash
git add src/core/render/protocol.ts src/core/render/worker.ts src/core/render/client.ts tests/render-worker.test.ts tests/notify-handlers.test.ts tests/scheduler.test.ts
git commit -m "Share the render worker protocol, test notify handlers and scheduler recovery edges"
```

---

### Task 11: Emoji-name parity — FOODS, rarities, sites

**Files:**
- Test: additions to `tests/emoji-assets.test.ts`

**Interfaces:**
- Consumes: `FOODS`, `EMOJI_FALLBACK`, `RARITY`, `EXPEDITION_SITES`, plus the file's existing SVG-directory listing helper (it already reads `assets/emojis/svg/` for the SVG↔fallback parity test at lines ~97-102 — reuse the same listing).
- Produces: coverage only. Closes the audit gap: a typo'd `emoji` key in `src/data/foods.ts` currently falls back to unicode forever in production with green tests.

- [ ] **Step 1: Write the tests**

Append to `tests/emoji-assets.test.ts` (reuse its existing svg-name listing; add missing imports):

```ts
describe('emoji name parity with data tables', () => {
  it('every FOODS emoji name has a committed SVG and a unicode fallback', () => {
    for (const f of Object.values(FOODS)) {
      expect(svgNames, `missing SVG for FOODS.${f.id}.emoji=${f.emoji}`).toContain(f.emoji);
      expect(Object.hasOwn(EMOJI_FALLBACK, f.emoji), `missing EMOJI_FALLBACK for ${f.emoji}`).toBe(true);
    }
  });
  it('every rarity has a dw_rarity_* SVG', () => {
    for (const r of Object.keys(RARITY)) {
      expect(svgNames, `missing SVG dw_rarity_${r}`).toContain(`dw_rarity_${r}`);
    }
  });
  it('every expedition site has a dw_site_* SVG', () => {
    for (const s of Object.keys(EXPEDITION_SITES)) {
      expect(svgNames, `missing SVG dw_site_${s}`).toContain(`dw_site_${s}`);
    }
  });
});
```

`svgNames` refers to whatever identifier the existing parity test uses for the listed SVG basenames — read the file and bind to that (or recompute with the same `readdirSync` expression). Imports to add if missing: `FOODS` from `../src/data/foods.js`, `EMOJI_FALLBACK` from `../src/core/emojis.js`, `RARITY` from `../src/data/rarity.js`, `EXPEDITION_SITES` from `../src/data/sites.js`.

- [ ] **Step 2: Run, typecheck, commit**

Run: `npx vitest run tests/emoji-assets.test.ts && npm run typecheck` — PASS/clean.

```bash
git add tests/emoji-assets.test.ts
git commit -m "Pin food, rarity, and site emoji names against the committed SVG set"
```

---

### Task 12: Live REST sweep — `npm run test:live`

**Files:**
- Create: `scripts/test-live.ts`
- Modify: `package.json` (add script), `.env.example` (add `TEST_CHANNEL_ID`), `tsconfig.test.json` (ensure `scripts/` is typechecked — check its `include` and add `"scripts"` if absent)

**Interfaces:**
- Consumes: `loadConfig`, `ALL_MODULES`, `ModuleRegistry`, `setEmojiMap`, `makeCtx`/`fakeCommand`/`fakeButton` from `../tests/harness.js`, `validateMessagePayload`, services for seeding, discord.js `REST`/`Routes`.
- Produces: the `test:live` npm script. REST-only — the script NEVER calls `client.login()`, so it cannot violate the one-gateway-instance-per-token rule and is safe while the bot runs. Exit code 0 = Discord accepted everything; 1 = at least one rejection (each printed with the case name and Discord's error).

- [ ] **Step 1: Wire the script entry and env**

`package.json` scripts, after `"test:watch"`:

```json
    "test:live": "tsx scripts/test-live.ts",
```

`.env.example`: append (matching the file's existing comment style — read it first):

```
# Channel in the dev guild where the live test sweep posts every command's output.
TEST_CHANNEL_ID=
```

- [ ] **Step 2: Write `scripts/test-live.ts`**

```ts
import 'dotenv/config';
import { REST, Routes, MessageFlags } from 'discord.js';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/core/config.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { setEmojiMap } from '../src/core/emojis.js';
import { FOODS } from '../src/data/foods.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { RARITY } from '../src/data/rarity.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino } from '../src/modules/park/dinos.js';
import { incubateEgg } from '../src/modules/hatchery/service.js';
import { startExpedition } from '../src/modules/expeditions/service.js';
import { createTrade } from '../src/modules/trading/service.js';
import { makeCtx, fakeCommand, fakeButton, type FakeInteraction } from '../tests/harness.js';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { Ctx } from '../src/core/context.js';

// ---- env -------------------------------------------------------------------
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DATABASE_PATH', 'OWNER_ID', 'DEV_GUILD_ID', 'TEST_CHANNEL_ID']) {
  if (!process.env[name]) { console.error(`test:live needs ${name} set in .env`); process.exit(1); }
}
const config = loadConfig();
const devGuildId = process.env.DEV_GUILD_ID!;
const testChannelId = process.env.TEST_CHANNEL_ID!;
const rest = new REST().setToken(config.token);

const failures: Array<{ step: string; error: string }> = [];
const passed: string[] = [];

// ---- 1. Discord validates every builder -------------------------------------
const registry = new ModuleRegistry(ALL_MODULES, Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])));
try {
  const body = registry.commands().map((c) => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.clientId, devGuildId), { body });
  passed.push(`deploy: ${body.length} builders accepted by Discord`);
} catch (e) {
  failures.push({ step: 'deploy builders', error: String(e) });
}

// ---- 2. Load the REAL emoji map so posted payloads use live tags -------------
try {
  const res = await rest.get(Routes.applicationEmojis(config.clientId)) as { items: Array<{ id: string; name: string; animated?: boolean }> };
  const entries: Record<string, string> = {};
  for (const e of res.items) entries[e.name] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
  setEmojiMap(entries);
  passed.push(`emoji map: ${res.items.length} live emojis loaded`);

  // Parity: every deployed-manifest name and FOODS emoji must exist remotely.
  const manifest = JSON.parse(readFileSync('assets/emojis/manifest.json', 'utf8')) as Record<string, string>;
  const remoteNames = new Set(res.items.map((i) => i.name));
  for (const name of Object.keys(manifest)) {
    if (!remoteNames.has(name)) failures.push({ step: 'emoji parity', error: `manifest emoji '${name}' missing on Discord` });
  }
  for (const f of Object.values(FOODS)) {
    if (!remoteNames.has(f.emoji)) failures.push({ step: 'emoji parity', error: `FOODS emoji '${f.emoji}' missing on Discord` });
  }
} catch (e) {
  failures.push({ step: 'emoji fetch', error: String(e) });
}

// ---- 3. Seed a representative sim world --------------------------------------
const ctx = makeCtx();
ctx.setNow(Date.now());   // real wall time so <t:...> timestamps render sensibly in the gallery
const P1 = 'live-p1', P2 = 'live-p2';
getOrCreateUser(ctx, P1, 'LiveTester');
getOrCreateUser(ctx, P2, 'Counterparty');
ctx.db.update(schema.users).set({ cash: 500_000, parkRating: 200, ratingHighWater: 400, shards: 600 }).run();
const herb = Object.keys(PADDOCKS).find((k) => PADDOCKS[k].diet === 'herbivore')!;
const lot = buildLot(ctx, P1, herb);
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'triceratops', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
const dino = ctx.db.select().from(schema.dinos).all()[0];
assignDino(ctx, P1, dino.id, lot.id);
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'velociraptor', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
const readyEgg = ctx.db.insert(schema.eggs).values({ userId: P1, rarity: 'rare', source: 'shop', obtainedAt: ctx.now() }).returning().get();
incubateEgg(ctx, P1, readyEgg.id, devGuildId);
ctx.db.update(schema.eggs).set({ hatchesAt: ctx.now() - 1 }).run();   // force-ready for /hatch
const spareDino = ctx.db.select().from(schema.dinos).all()[1];
createTrade(ctx, P1, P2, { dinoIds: [spareDino.id], eggIds: [], cash: 0, foods: {} }, { dinoIds: [], eggIds: [], cash: 1000, foods: {} });
startExpedition(ctx, P1, 'coastal_dig', devGuildId);

// If any service signature above disagrees with the source, match the source —
// tests/*.test.ts show every call shape.

// ---- 4. Run cases and post their real payloads --------------------------------
interface Case { title: string; run(): Promise<FakeInteraction> }
const mod = (name: string) => ALL_MODULES.find((m) => m.name === name)!;
const cmdOf = (m: string, c: string) => mod(m).commands.find((x) => x.data.name === c)!;
const compOf = (m: string, p: string) => mod(m).components.find((x) => x.prefix === p)!;
const slash = async (m: string, c: string, opts: Parameters<typeof fakeCommand>[0]) => {
  const i = fakeCommand(opts);
  await cmdOf(m, c).execute(ctx as Ctx, i.asChatInput() as ChatInputCommandInteraction);
  return i;
};
const button = async (m: string, customId: string, user: string) => {
  const b = fakeButton({ customId, user });
  await compOf(m, customId.split(':')[0]).execute(ctx as Ctx, b.asInteraction() as unknown as ButtonInteraction);
  return b;
};

const cases: Case[] = [
  { title: '/help — overview', run: () => slash('help', 'help', { name: 'help', user: P1 }) },
  { title: '/park view — dashboard + render', run: () => slash('park', 'park', { name: 'park', sub: 'view', user: P1 }) },
  { title: '/eggs — list', run: () => slash('hatchery', 'eggs', { name: 'eggs', user: P1 }) },
  { title: '/hatch — pre-hatch embed', run: () => slash('hatchery', 'hatch', { name: 'hatch', user: P1, options: { egg: readyEgg.id } }) },
  { title: 'hatch:crack — reveal', run: () => button('hatchery', `hatch:crack:${readyEgg.id}`, P1) },
  { title: '/shop view — storefront', run: () => slash('shop', 'shop', { name: 'shop', sub: 'view', user: P1 }) },
  { title: '/shop food — purchase', run: () => slash('shop', 'shop', { name: 'shop', sub: 'food', user: P1, options: { item: 'ferns', units: 10 } }) },
  { title: '/sell — confirm prompt (ephemeral in production)', run: () => slash('shop', 'sell', { name: 'sell', user: P1, options: { dino: dino.id } }) },
  { title: '/mythic — confirm prompt (ephemeral in production)', run: () => slash('hatchery', 'mythic', { name: 'mythic', user: P1, options: { species: 'indominus' } }) },
  { title: '/expedition status — digging', run: () => slash('expeditions', 'expedition', { name: 'expedition', sub: 'status', user: P1 }) },
  { title: '/feed all — care banner', run: () => slash('care', 'feed', { name: 'feed', sub: 'all', user: P1 }) },
  { title: '/dino list — roster', run: () => slash('park', 'dino', { name: 'dino', sub: 'list', user: P1 }) },
  { title: '/trade list — pending trades', run: () => slash('trading', 'trade', { name: 'trade', sub: 'list', user: P1 }) },
  { title: '/top — leaderboard', run: () => slash('leaderboards', 'top', { name: 'top', user: P1, guild: devGuildId, options: { metric: 'rating' } }) },
  { title: '/admin inspect — (ephemeral in production)', run: () => slash('admin', 'admin', { name: 'admin', sub: 'inspect', user: config.ownerId === 'owner' ? 'owner' : config.ownerId, options: { user: P1 } }) },
];

type RawFilePayload = { data: Buffer; name: string };
function toPost(payload: unknown): { body: Record<string, unknown>; files: RawFilePayload[] } {
  const p = typeof payload === 'string' ? { content: payload } : { ...(payload as Record<string, unknown>) };
  delete p.flags;   // ephemeral flag is invalid on channel messages
  const files: RawFilePayload[] = [];
  for (const f of (p.files as Array<{ attachment: string; name: string }> | undefined) ?? []) {
    files.push({ data: readFileSync(f.attachment), name: f.name });
  }
  delete p.files;
  p.embeds = ((p.embeds as Array<{ toJSON?: () => unknown }> | undefined) ?? []).map((e) => e.toJSON ? e.toJSON() : e);
  p.components = ((p.components as Array<{ toJSON?: () => unknown }> | undefined) ?? []).map((c) => c.toJSON ? c.toJSON() : c);
  return { body: p, files };
}

async function post(body: Record<string, unknown>, files: RawFilePayload[]): Promise<void> {
  await rest.post(Routes.channelMessages(testChannelId), { body, files });
}

await post({ content: `## Live sweep — ${new Date().toISOString()}` }, []);
for (const c of cases) {
  try {
    const i = await c.run();
    if (i.replies.length === 0) throw new Error('no reply captured');
    await post({ content: `**${c.title}**` }, []);
    for (const r of i.replies) {
      const { body, files } = toPost(r);
      await post(body, files);
    }
    passed.push(c.title);
  } catch (e) {
    failures.push({ step: c.title, error: String(e) });
  }
}

// ---- 5. Summary ----------------------------------------------------------------
console.log(`\n=== test:live summary ===`);
for (const p of passed) console.log(`  ok   ${p}`);
for (const f of failures) console.log(`  FAIL ${f.step}\n       ${f.error}`);
console.log(`${passed.length} ok, ${failures.length} failed. Cosmetic review: check <#${testChannelId}> in the dev guild.`);
process.exit(failures.length ? 1 : 0);
```

Notes for the implementer:
- The `/admin inspect` case only produces output when the sim `ctx.config.ownerId` matches the invoking fake user. `makeCtx` sets `ownerId: 'owner'` — so invoke it as user `'owner'`; the ternary in the case list collapses to `'owner'` under `makeCtx` and exists only to make the intent readable. Simplify to `user: 'owner'` if the ternary reads as noise.
- `ctx.setNow(Date.now())` is correct here — this is an operator script like `deploy-commands.ts`, not a test; the repo rule about `ctx.now()` governs src/tests.
- `buttons in gallery posts are inert`: posting components on a bot message is valid; clicking them live routes to the RUNNING bot (if any), which won't recognize the sim's DB ids — harmless ephemeral errors. The gallery header says outputs are for looking at, not clicking.
- If `rest.post` rejects file payloads with the `{ data, name }` shape, check the discord.js `REST` docs for the installed major — the `files` option shape is `RawFile[]` (`{ data: Buffer | string; name: string }`) in discord.js 14.

- [ ] **Step 3: Typecheck, dry-run against the dev guild, commit**

Run: `npm run typecheck` — clean (add `"scripts"` to `tsconfig.test.json` include if the new file is not picked up).
Run: `npm run test:live` — expected output: the summary block with `0 failed`, and the gallery visible in the test channel. This step needs the real `.env`; if the operator has not created the test channel yet, create it in the dev guild and put its id in `.env` first. Discord rejections at this step are REAL findings — payloads the simulation accepted but Discord refused; fix the producing module (or the validator, if it under-approximates a limit) before committing.

```bash
git add scripts/test-live.ts package.json .env.example tsconfig.test.json
git commit -m "Add the live REST sweep: deploy validation, emoji parity, and a payload gallery"
```

---

### Task 13: `/verify` repo command

**Files:**
- Create: `.claude/commands/verify.md`

- [ ] **Step 1: Write the command**

```markdown
---
description: Full verification sweep — typecheck, offline tests, live REST sweep
---

Run the full verification sweep for this repo, in order, stopping to investigate the first failure rather than re-running blindly:

1. `npm run typecheck`
2. `npm test`
3. If `DISCORD_TOKEN`, `DEV_GUILD_ID`, and `TEST_CHANNEL_ID` are all present in `.env`: `npm run test:live`. Otherwise skip it and say which variable is missing.

Then report:
- pass/fail per step, with test counts
- any payload the live sweep says Discord rejected, by case name
- a reminder that cosmetic review (image renders, emoji art, banners) happens by scrolling the test channel gallery the live sweep just posted — that part stays human.

If a builder changed in this session, remind that `npm run deploy-commands` must run once and that exactly one bot instance may hold the token.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/verify.md
git commit -m "Add the /verify sweep command"
```

---

### Task 14: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

Version pins verified against upstream releases on 2026-07-25 (checkout v7 GA July 2026; setup-node v7.0.0 released July 14; Node 24 = current LTS). Re-verify before landing if executing later.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
```

The live tier deliberately stays out of CI (needs the bot token; can be added later as a repo secret + manual `workflow_dispatch` job without redesign). `better-sqlite3` and `@napi-rs/canvas` ship prebuilt binaries for `ubuntu-latest`/Node 24, so `npm ci` needs no toolchain setup — if the first CI run shows a node-gyp build instead, add `--build-from-source=false` diagnostics before reaching for apt packages.

- [ ] **Step 2: Sanity-check YAML locally and commit**

Run: `node -e "console.log(require('node:fs').readFileSync('.github/workflows/ci.yml','utf8').length)"` (existence check only — real validation happens on the first push).

```bash
git add .github/workflows/ci.yml
git commit -m "Add CI: typecheck and offline test suite on push"
```

After the first push, confirm the run is green on GitHub before treating CI as landed.

---

### Task 15: Documentation sync + final sweep

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README**

Add/extend a Testing section (match the README's existing tone and heading style — read it first):

- `npm test` — offline suite: strict Discord-semantics simulation, all entry points, journeys.
- `npm run test:live` — REST-only sweep against the dev guild: Discord validates all builders, posts every command's output to `TEST_CHANNEL_ID` for cosmetic review, verifies deployed emojis. Requires `DISCORD_TOKEN`, `DEV_GUILD_ID`, `TEST_CHANNEL_ID`. Never logs a gateway session (safe while the bot runs).
- `/verify` (the repo's own slash command) — typecheck + both tiers + summary.
- CI runs typecheck + offline tests on every push/PR.
- Env var table (if present): add `TEST_CHANNEL_ID`.

- [ ] **Step 2: CLAUDE.md**

- Module-registration checklist: now 4 sites — `modules.json`, `src/core/module-list.ts`, `tests/registry-load.test.ts` (count), `tests/config.test.ts` (expected modules). Remove `src/index.ts`/`src/deploy-commands.ts` from the list (they consume the shared list).
- New bullet under testing conventions: the fakes in `tests/harness.ts` enforce the real interaction lifecycle (reply-once, defer semantics), validate every payload against Discord limits, and back option getters with the command's real builder JSON — a fixture key or getter name that disagrees with the builder throws. Synthetic command names unknown to the registry stay permissive (router tests).
- New bullet: `npm run test:live` posts the payload gallery — REST-only, never a second gateway login.
- Note that `/sell`'s `dino` option now sets `.setAutocomplete(true)` (was a dead provider) — and that this builder change requires one `npm run deploy-commands`.

- [ ] **Step 3: Final full sweep and commit**

Run: `npm test && npm run typecheck` — everything green.

```bash
git add README.md CLAUDE.md
git commit -m "Document the testing tiers, verify command, and 4-site module checklist"
```

---

## Plan Self-Review (performed at write time)

1. **Spec coverage:** Tier 0 → Tasks 1, 2, 4. Contract drift + module-list refactor → Task 3. Uncovered entry points + near-miss branches → Tasks 5, 6. Router gaps → Task 7. Journey suite (six couplings + spine) → Task 8. deploy-emojis state machine → Task 9. Render worker protocol + notify handlers + scheduler edges → Task 10. FOODS↔emoji parity → Task 11. Live REST sweep + env → Task 12. `/verify` → Task 13. CI → Task 14. Docs → Task 15. Spec's `tests/contract.test.ts`, `tests/settings.test.ts`, `tests/journeys.test.ts`, `tests/deploy-emojis.test.ts`, `tests/render-worker.test.ts`, `tests/notify-handlers.test.ts` all exist as tasks. No spec item without a task.
2. **Known deviations from spec, intentional:** (a) the spec's "spawn the actual worker in vitest" is implemented as a shared protocol module + injected `WorkerLike` — Node cannot load a `.ts` worker file with `.js` import specifiers under vitest without a loader; the shared types + `handleRenderRequest` + `createRunner` tests close the same drift class at compile time and runtime. (b) The rating-gates journey asserts monotonic high-water and the locked-gate rejection rather than crossing an exact threshold through play — rating weights make exact crossings brittle; the invariant (gates read high water, high water never falls) is what the audit flagged. (c) `/sell` autocomplete builder fix added (audit finding, not in spec) — same class as contract drift, one line.
3. **Type consistency:** `replyText`, `installTestEmojiMap`, `testRegistry`, `deferOpts` (Tasks 2/4) match all later usage in Tasks 5-8 and 12. `syncEmojis`/`sha`/`EmojiRestOps` (Task 9) match the test file. `handleRenderRequest`/`createRunner`/`WorkerLike` (Task 10) match. `ALL_MODULES` (Task 3) used in Tasks 4, 12.
4. **Deliberate loose ends the implementer must resolve from source (flagged inline, not placeholders):** exact `incubateEgg`/`startExpedition`/`createTrade` signatures, the `DECOR` append shape, `seedPendingTrade` extraction, the file's `svgNames` binding, and the Task 8 Step 3 window arithmetic — each has explicit instructions for where to read the truth.

