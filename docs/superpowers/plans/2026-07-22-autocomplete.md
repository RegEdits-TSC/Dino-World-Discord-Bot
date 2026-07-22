# Slash-Command Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every identifier-taking option (egg/dino/lot/trade ids, species keys) and per-user-validity option (expedition site, shop rarity) gets Discord native autocomplete with state-tagged, valid-first suggestions.

**Architecture:** Per-module autocomplete providers plus a shared kit in `src/core/autocomplete.ts`. `CommandDef` gains an optional `autocomplete?(ctx, i)` handler; the router gains a third dispatch branch for `AutocompleteInteraction` with its own error path (`respond([])`, never `reply()`). Raw-id typing keeps working everywhere — autocomplete is a suggestion layer; existing execute-path validation is unchanged.

**Tech Stack:** TypeScript (ESM/NodeNext), discord.js 14, drizzle-orm + better-sqlite3 (synchronous), vitest.

**Spec:** `docs/superpowers/specs/2026-07-22-autocomplete-design.md` — read it first; it holds the label style (style C) and the full provider matrix.

## Global Constraints

- Relative imports MUST carry `.js` extensions (`import { schema } from '../../core/db/index.js';`) — NodeNext ESM; omitting the extension breaks resolution.
- Time comes from `ctx.now()`, never `Date.now()`; randomness from `ctx.rng()` — tests inject both.
- DB calls are synchronous drizzle/better-sqlite3: `.get()` / `.all()` / `.run()` — never `await` a query.
- Autocomplete providers are read-only. They MUST NOT call `getOrCreateUser` (no row creation on keystrokes). Sole exceptions: `settleEscapes` (care) and `expireStale` (trading) — idempotent writes required for label accuracy. `settleEscapes` crashes if the user row is missing (`toClockDinos` uses `.get()!`), so care providers must check the user row exists first.
- Providers only ever call `i.respond(choices)` — an `AutocompleteInteraction` has no `reply()`/`deferReply()`. Errors inside a provider are caught by the router, which responds `[]`.
- Discord caps: 25 choices per response, 100 chars per choice name and per string value. Integer options take `{ name: string, value: number }` choices; string options take string values.
- An option can have `.addChoices(...)` OR `.setAutocomplete(true)`, never both — conversions must remove the choices.
- Label style C (see spec): entity emoji anchor + `#id` + name, UPPERCASE tags only for urgent states. Valid entries always rank above invalid ones.
- Empty-state rule: when the user's *unfiltered* entity list is empty, respond with one informational row (sentinel value `0` for integer options, `'-'` for string options) whose label names the fix (e.g. `No eggs — get one from /shop egg or /expedition`). When the list is merely filtered to zero by the typed query, plain `[]` is fine.
- Commit style: imperative sentence subject matching repo history (e.g. "Add autocomplete routing and core kit"), no trailers of any kind.
- After merge, `npm run deploy-commands` must be re-run (option shapes changed). `tests/registry-load.test.ts` expects 18 commands — count is unchanged by this plan; do not touch it.
- Run `npm run typecheck` and `npm test` at the end of every task; both must be green before committing.

## File Structure

| File | Role |
|---|---|
| `src/core/modules.ts` (modify) | `CommandDef.autocomplete?` — the only interface change |
| `src/core/router.ts` (modify) | autocomplete dispatch branch, own try/catch, no `touchPresence` |
| `src/core/autocomplete.ts` (create) | shared kit: ranking, matching, duration/label formatting, list completion |
| `src/modules/*/index.ts` (modify) | `.setAutocomplete(true)` on builders + per-command `autocomplete` handlers |
| `tests/harness.ts` (modify) | `fakeAutocomplete()` helper |
| `tests/router.test.ts` (modify) | autocomplete routing cases |
| `tests/autocomplete-kit.test.ts` (create) | kit unit tests |
| `tests/autocomplete-<module>.test.ts` (create ×7) | provider tests per module |
| `README.md` (modify), `CLAUDE.md` (create) | docs |

---

### Task 1: Core plumbing — CommandDef hook, router branch, harness helper

**Files:**
- Modify: `src/core/modules.ts:1-8`
- Modify: `src/core/router.ts:21-27`
- Modify: `tests/harness.ts`
- Test: `tests/router.test.ts`

**Interfaces:**
- Consumes: existing `ModuleRegistry.findCommand(name)` (`src/core/modules.ts:29-31`).
- Produces: `CommandDef.autocomplete?(ctx: Ctx, i: AutocompleteInteraction): Promise<void>` — every later task implements this signature. `fakeAutocomplete(opts)` returning `FakeInteraction & { asAutocomplete(): AutocompleteInteraction }` — every later test consumes it. Router contract: unknown command or missing handler → `respond([])`; throwing handler → `respond([])`, no crash; `touchPresence` not called for autocomplete.

- [ ] **Step 1: Add `fakeAutocomplete` to the harness**

In `tests/harness.ts`, change the discord.js type import (line 6) and append the new factory after `fakeButton`:

```ts
import type { ChatInputCommandInteraction, Interaction, AutocompleteInteraction } from 'discord.js';
```

```ts
export function fakeAutocomplete(opts: {
  name: string; sub?: string; user: string; guild?: string;
  focused: { name: string; value: string };
  options?: Record<string, string | number>;
}): FakeInteraction & { asAutocomplete(): AutocompleteInteraction } {
  const replies: unknown[] = [];
  const raw = {
    commandName: opts.name,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    isChatInputCommand: () => false, isButton: () => false, isAutocomplete: () => true,
    options: {
      getSubcommand: () => opts.sub ?? null,
      getFocused: (full?: boolean) => (full ? opts.focused : opts.focused.value),
      get: (k: string) => (opts.options?.[k] != null ? { value: opts.options[k] } : null),
    },
    respond: async (choices: unknown) => { replies.push(choices); },
  };
  return {
    replies,
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
    asAutocomplete: () => raw as unknown as AutocompleteInteraction,
  };
}
```

`replies[0]` will hold the choices array passed to `respond` — assert on it exactly like command tests assert on reply payloads.

- [ ] **Step 2: Write the failing router tests**

Append to `tests/router.test.ts` (follow the file's existing imports for `makeCtx` and `routeInteraction`; add `fakeAutocomplete` to the harness import and this registry scaffolding):

```ts
import { ModuleRegistry } from '../src/core/modules.js';
import { SlashCommandBuilder } from 'discord.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

describe('autocomplete routing', () => {
  function acRegistry(handler?: (ctx: unknown, i: unknown) => Promise<void>) {
    return new ModuleRegistry([{
      name: 'm',
      commands: [{
        data: new SlashCommandBuilder().setName('ac').setDescription('d'),
        execute: async () => {},
        ...(handler ? { autocomplete: handler as never } : {}),
      }],
      components: [],
    }], { m: true });
  }

  it('dispatches autocomplete to the command handler', async () => {
    const ctx = makeCtx();
    let called = false;
    const registry = acRegistry(async (_ctx, i) => {
      called = true;
      await (i as { respond(c: unknown): Promise<void> }).respond([{ name: 'x', value: 1 }]);
    });
    const i = fakeAutocomplete({ name: 'ac', user: 'u1', focused: { name: 'egg', value: '' } });
    await routeInteraction(ctx, registry, i.asInteraction());
    expect(called).toBe(true);
    expect(i.replies[0]).toEqual([{ name: 'x', value: 1 }]);
  });

  it('responds [] when the command has no autocomplete handler', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'ac', user: 'u1', focused: { name: 'egg', value: '' } });
    await routeInteraction(ctx, acRegistry(), i.asInteraction());
    expect(i.replies[0]).toEqual([]);
  });

  it('responds [] when the provider throws, without crashing', async () => {
    const ctx = makeCtx();
    const registry = acRegistry(async () => { throw new Error('boom'); });
    const i = fakeAutocomplete({ name: 'ac', user: 'u1', focused: { name: 'egg', value: '' } });
    await routeInteraction(ctx, registry, i.asInteraction());
    expect(i.replies[0]).toEqual([]);
  });

  it('does not touch presence on autocomplete', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'ac', user: 'u1', guild: 'g1', focused: { name: 'egg', value: '' } });
    await routeInteraction(ctx, acRegistry(), i.asInteraction());
    const rows = ctx.db.select().from(schema.userGuilds).where(eq(schema.userGuilds.userId, 'u1')).all();
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/router.test.ts`
Expected: the 4 new tests FAIL — `autocomplete` is not a known `CommandDef` field and the router ignores autocomplete interactions (`replies` stays empty). A TS error on the `autocomplete:` property is the expected failure mode for compile-first runs.

- [ ] **Step 4: Implement — `CommandDef` and router**

`src/core/modules.ts` — extend the type import (line 1-2) and the interface (lines 5-8):

```ts
import type { SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder, SlashCommandOptionsOnlyBuilder,
  ChatInputCommandInteraction, ButtonInteraction, AutocompleteInteraction } from 'discord.js';
```

```ts
export interface CommandDef {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
  execute(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void>;
  // Providers only respond(); they never reply, defer, or create user rows.
  autocomplete?(ctx: Ctx, i: AutocompleteInteraction): Promise<void>;
}
```

`src/core/router.ts` — insert the branch at the top of `routeInteraction` (before the current `const isCommand = ...` at line 24):

```ts
export async function routeInteraction(
  ctx: Ctx, registry: ModuleRegistry, interaction: Interaction,
): Promise<void> {
  if (interaction.isAutocomplete()) {
    const cmd = registry.findCommand(interaction.commandName);
    try {
      if (cmd?.autocomplete) await cmd.autocomplete(ctx, interaction);
      else await interaction.respond([]);
    } catch (err) {
      logger.debug({ err }, 'autocomplete failed');
      await interaction.respond([]).catch(() => {});
    }
    return;
  }
  const isCommand = interaction.isChatInputCommand();
  // ... rest of the function unchanged
```

Do NOT move or duplicate `touchPresence` into the new branch — autocomplete fires per keystroke and must not write presence rows. Debug-level log, not error: provider failures degrade to an empty dropdown by design.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/router.test.ts && npm run typecheck`
Expected: PASS (all pre-existing router tests still green).

- [ ] **Step 6: Commit**

```bash
git add src/core/modules.ts src/core/router.ts tests/harness.ts tests/router.test.ts
git commit -m "Add autocomplete dispatch to the router and CommandDef"
```

---

### Task 2: Kit core — matching, ranking, duration formatting

**Files:**
- Create: `src/core/autocomplete.ts`
- Test: `tests/autocomplete-kit.test.ts`

**Interfaces:**
- Produces (consumed by every provider task):
  - `interface AcEntry { value: string | number; label: string; valid: boolean }`
  - `matches(query: string, ...haystacks: Array<string | number | null | undefined>): boolean` — case-insensitive substring; empty/whitespace query matches everything.
  - `respondRanked(i: AutocompleteInteraction, entries: AcEntry[]): Promise<void>` — stable valid-first partition, 25-cap, 100-char label truncation, maps to `{name, value}`.
  - `emptyRow(label: string, value: string | number): AcEntry` — informational row, `valid: false`.
  - `fmtDuration(ms: number): string` — `"15m"`, `"3h 20m"`, `"2d 1h"`; floors to minutes, minimum `"1m"`.
  - `capitalize(s: string): string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/autocomplete-kit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matches, respondRanked, emptyRow, fmtDuration, capitalize } from '../src/core/autocomplete.js';
import type { AcEntry } from '../src/core/autocomplete.js';
import type { AutocompleteInteraction } from 'discord.js';

function fakeRespond() {
  const out: unknown[] = [];
  return { out, i: { respond: async (c: unknown) => { out.push(c); } } as unknown as AutocompleteInteraction };
}

describe('matches', () => {
  it('empty query matches everything', () => {
    expect(matches('', 12, 'Velociraptor')).toBe(true);
    expect(matches('   ', 12)).toBe(true);
  });
  it('substring-matches ids and names case-insensitively', () => {
    expect(matches('velo', 7, 'Velociraptor')).toBe(true);
    expect(matches('12', 12, 'Trike')).toBe(true);
    expect(matches('RARE', 3, 'rare')).toBe(true);
    expect(matches('zzz', 3, 'Velociraptor')).toBe(false);
  });
  it('skips null/undefined haystacks', () => {
    expect(matches('x', null, undefined)).toBe(false);
  });
});

describe('respondRanked', () => {
  it('ranks valid entries first, preserving in-group order', async () => {
    const { out, i } = fakeRespond();
    const entries: AcEntry[] = [
      { value: 1, label: 'a', valid: false },
      { value: 2, label: 'b', valid: true },
      { value: 3, label: 'c', valid: true },
    ];
    await respondRanked(i, entries);
    expect(out[0]).toEqual([
      { name: 'b', value: 2 }, { name: 'c', value: 3 }, { name: 'a', value: 1 },
    ]);
  });
  it('caps at 25 rows, valid entries never crowded out', async () => {
    const { out, i } = fakeRespond();
    const entries: AcEntry[] = [
      ...Array.from({ length: 30 }, (_, n) => ({ value: n, label: `inv${n}`, valid: false })),
      { value: 99, label: 'ok', valid: true },
    ];
    await respondRanked(i, entries);
    const rows = out[0] as Array<{ name: string; value: number }>;
    expect(rows).toHaveLength(25);
    expect(rows[0]).toEqual({ name: 'ok', value: 99 });
  });
  it('truncates labels to 100 chars', async () => {
    const { out, i } = fakeRespond();
    await respondRanked(i, [{ value: 1, label: 'x'.repeat(150), valid: true }]);
    expect((out[0] as Array<{ name: string }>)[0].name).toHaveLength(100);
  });
});

describe('emptyRow', () => {
  it('builds an invalid informational entry', () => {
    expect(emptyRow('No eggs', 0)).toEqual({ value: 0, label: 'No eggs', valid: false });
  });
});

describe('fmtDuration', () => {
  it('formats minutes, hours, days', () => {
    expect(fmtDuration(15 * 60_000)).toBe('15m');
    expect(fmtDuration(3 * 3_600_000 + 20 * 60_000)).toBe('3h 20m');
    expect(fmtDuration(4 * 3_600_000)).toBe('4h');
    expect(fmtDuration(25 * 3_600_000)).toBe('1d 1h');
    expect(fmtDuration(48 * 3_600_000)).toBe('2d');
  });
  it('floors to a 1m minimum', () => {
    expect(fmtDuration(1)).toBe('1m');
    expect(fmtDuration(0)).toBe('1m');
  });
});

describe('capitalize', () => {
  it('uppercases the first letter only', () => {
    expect(capitalize('rare')).toBe('Rare');
    expect(capitalize('')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-kit.test.ts`
Expected: FAIL — module `src/core/autocomplete.ts` does not exist.

- [ ] **Step 3: Implement `src/core/autocomplete.ts`**

```ts
import type { AutocompleteInteraction, ApplicationCommandOptionChoiceData } from 'discord.js';

// One suggestion row. `valid` drives ranking only: invalid rows are still selectable and
// fail in the execute path with the existing ephemeral errors (spec: all state-tagged, valid first).
export interface AcEntry {
  value: string | number;
  label: string;
  valid: boolean;
}

const MAX_CHOICES = 25;
const MAX_NAME = 100;

export function matches(query: string, ...haystacks: Array<string | number | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => h != null && String(h).toLowerCase().includes(q));
}

export function emptyRow(label: string, value: string | number): AcEntry {
  return { value, label, valid: false };
}

export async function respondRanked(i: AutocompleteInteraction, entries: AcEntry[]): Promise<void> {
  const ranked = [...entries.filter((e) => e.valid), ...entries.filter((e) => !e.valid)]
    .slice(0, MAX_CHOICES)
    .map((e) => ({ name: e.label.slice(0, MAX_NAME), value: e.value }));
  await i.respond(ranked as ApplicationCommandOptionChoiceData[]);
}

export function fmtDuration(ms: number): string {
  const totalMin = Math.max(1, Math.floor(ms / 60_000));
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-kit.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/autocomplete.ts tests/autocomplete-kit.test.ts
git commit -m "Add autocomplete kit: matching, ranking, duration formatting"
```

---

### Task 3: Kit labels — eggLabel, dinoLabel

**Files:**
- Modify: `src/core/autocomplete.ts`
- Test: `tests/autocomplete-kit.test.ts`

**Interfaces:**
- Consumes: `fmtDuration`, `capitalize` (Task 2); `schema` egg/dino row types; `Species` from `src/data/types.ts`.
- Produces:
  - `eggLabel(egg: typeof schema.eggs.$inferSelect, now: number): string` — `🥚 #12 Rare — READY` / `— hatching, 3h 20m left` / `— in inventory`.
  - `dinoLabel(dino: typeof schema.dinos.$inferSelect, species: Species, now: number): string` — `🦖 #7 Velociraptor — fed 20h ago (lot 3)` / `— VERY HUNGRY (lot 3)` / `— ESCAPED, rescue first`.
  - `VERY_HUNGRY_MS = 36 * 3_600_000` (75% of the 48h `HUNGER_DRAIN_MS` window — spec).

- [ ] **Step 1: Write the failing tests**

Append to `tests/autocomplete-kit.test.ts` (extend the kit import with `eggLabel, dinoLabel, VERY_HUNGRY_MS`; add `import { getSpecies } from '../src/data/species/index.js';`):

```ts
const H = 3_600_000;

function egg(over: Record<string, unknown> = {}) {
  return {
    id: 12, userId: 'u1', rarity: 'rare', speciesId: null, source: 'shop',
    viaTrade: false, locked: false, obtainedAt: 0, incubationStartedAt: null, hatchesAt: null,
    ...over,
  } as never;
}
function dino(over: Record<string, unknown> = {}) {
  return {
    id: 7, userId: 'u1', lotId: 3, speciesId: 'velociraptor', nickname: null,
    hunger: 100, lastFedAt: 0, escapedAt: null, viaTrade: false, locked: false, hatchedAt: 0,
    ...over,
  } as never;
}

describe('eggLabel', () => {
  it('labels inventory, incubating, and ready states', () => {
    expect(eggLabel(egg(), 0)).toBe('🥚 #12 Rare — in inventory');
    expect(eggLabel(egg({ incubationStartedAt: 0, hatchesAt: 4 * H }), 40 * 60_000))
      .toBe('🥚 #12 Rare — hatching, 3h 20m left');
    expect(eggLabel(egg({ incubationStartedAt: 0, hatchesAt: 100 }), 100)).toBe('🥚 #12 Rare — READY');
  });
});

describe('dinoLabel', () => {
  const species = getSpecies('velociraptor');
  it('shows fed-ago and lot for a healthy dino', () => {
    expect(dinoLabel(dino(), species, 20 * H)).toBe('🦖 #7 Velociraptor — fed 20h ago (lot 3)');
  });
  it('shows fed just now under an hour, unassigned without a lot', () => {
    expect(dinoLabel(dino({ lotId: null }), species, 30 * 60_000))
      .toBe('🦖 #7 Velociraptor — fed just now (unassigned)');
  });
  it('flips to VERY HUNGRY at the 36h threshold', () => {
    expect(dinoLabel(dino(), species, VERY_HUNGRY_MS)).toBe('🦖 #7 Velociraptor — VERY HUNGRY (lot 3)');
    expect(dinoLabel(dino(), species, VERY_HUNGRY_MS - 1)).toBe('🦖 #7 Velociraptor — fed 35h ago (lot 3)');
  });
  it('ESCAPED overrides everything', () => {
    expect(dinoLabel(dino({ escapedAt: 5 }), species, 100 * H))
      .toBe('🦖 #7 Velociraptor — ESCAPED, rescue first');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-kit.test.ts`
Expected: FAIL — `eggLabel` / `dinoLabel` / `VERY_HUNGRY_MS` not exported.

- [ ] **Step 3: Implement — append to `src/core/autocomplete.ts`**

Add imports at the top of the file:

```ts
import { schema } from './db/index.js';
import type { Species } from '../data/types.js';
```

Append:

```ts
type EggRow = typeof schema.eggs.$inferSelect;
type DinoRow = typeof schema.dinos.$inferSelect;

export function eggLabel(egg: EggRow, now: number): string {
  const base = `🥚 #${egg.id} ${capitalize(egg.rarity)}`;
  if (egg.hatchesAt === null) return `${base} — in inventory`;
  if (egg.hatchesAt <= now) return `${base} — READY`;
  return `${base} — hatching, ${fmtDuration(egg.hatchesAt - now)} left`;
}

// 75% of the 48h HUNGER_DRAIN_MS window (src/core/clock.ts) — spec's VERY HUNGRY threshold.
export const VERY_HUNGRY_MS = 36 * 3_600_000;

export function dinoLabel(dino: DinoRow, species: Species, now: number): string {
  const base = `🦖 #${dino.id} ${species.name}`;
  if (dino.escapedAt !== null) return `${base} — ESCAPED, rescue first`;
  const loc = dino.lotId != null ? `(lot ${dino.lotId})` : '(unassigned)';
  const sinceFed = now - dino.lastFedAt;
  if (sinceFed >= VERY_HUNGRY_MS) return `${base} — VERY HUNGRY ${loc}`;
  const hours = Math.floor(sinceFed / 3_600_000);
  return hours < 1 ? `${base} — fed just now ${loc}` : `${base} — fed ${hours}h ago ${loc}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-kit.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/autocomplete.ts tests/autocomplete-kit.test.ts
git commit -m "Add shared egg and dino autocomplete labels"
```

---

### Task 4: Kit — listCompleter for trade id-lists

**Files:**
- Modify: `src/core/autocomplete.ts`
- Test: `tests/autocomplete-kit.test.ts`

**Interfaces:**
- Consumes: `matches` (Task 2). Token grammar mirrors `parseIdList` (`src/modules/trading/validate.ts`): split on `/[\s,]+/`, positive integers, deduped.
- Produces:
  - `interface ListCandidate { id: number; label: string }` (label WITHOUT the id-list prefix, e.g. `🦖 Velociraptor (rare)`)
  - `listCompleter(rawInput: string, candidates: ListCandidate[], opts: { maxItems: number }): Array<{ name: string; value: string }>`

Behavior contract: complete the LAST token, re-emit prior tokens as a comma prefix in every choice's value; exclude already-entered ids; at `maxItems` prior ids return a single `Max N items per side` row; a value that would exceed 100 chars returns a single `List too long — type manually` row; choice names over 100 chars are elided from the FRONT (`…` + tail) so the current pick and its label stay visible; at most 25 rows.

- [ ] **Step 1: Write the failing tests**

Append to `tests/autocomplete-kit.test.ts` (extend kit import with `listCompleter`):

```ts
describe('listCompleter', () => {
  const cands = [
    { id: 12, label: '🦖 Velociraptor (rare)' },
    { id: 45, label: '🦖 Triceratops (common)' },
    { id: 47, label: '🥚 rare egg' },
  ];

  it('suggests all candidates for empty input', () => {
    const rows = listCompleter('', cands, { maxItems: 5 });
    expect(rows).toEqual([
      { name: '12 — 🦖 Velociraptor (rare)', value: '12' },
      { name: '45 — 🦖 Triceratops (common)', value: '45' },
      { name: '47 — 🥚 rare egg', value: '47' },
    ]);
  });

  it('completes the last token and re-emits the prefix', () => {
    const rows = listCompleter('12, 4', cands, { maxItems: 5 });
    expect(rows).toEqual([
      { name: '12, 45 — 🦖 Triceratops (common)', value: '12, 45' },
      { name: '12, 47 — 🥚 rare egg', value: '12, 47' },
    ]);
  });

  it('treats a trailing separator as a fresh token and dedupes entered ids', () => {
    const rows = listCompleter('12, ', cands, { maxItems: 5 });
    expect(rows.map((r) => r.value)).toEqual(['12, 45', '12, 47']);
  });

  it('matches the active token against labels too', () => {
    const rows = listCompleter('12, velo', cands, { maxItems: 5 });
    expect(rows).toEqual([]);  // 12 already taken; only id 12 matches 'velo'
    expect(listCompleter('velo', cands, { maxItems: 5 }))
      .toEqual([{ name: '12 — 🦖 Velociraptor (rare)', value: '12' }]);
  });

  it('caps at maxItems prior ids', () => {
    const rows = listCompleter('1, 2, 3, 4, 5, ', cands, { maxItems: 5 });
    expect(rows).toEqual([{ name: 'Max 5 items per side', value: '1, 2, 3, 4, 5' }]);
  });

  it('bails out when the value would exceed 100 chars', () => {
    const longPrefix = Array.from({ length: 24 }, (_, n) => String(1000 + n)).join(', ');  // 24*6-2 = 142 chars
    const rows = listCompleter(`${longPrefix}, 4`, cands, { maxItems: 99 });
    expect(rows).toEqual([{ name: 'List too long — type manually', value: longPrefix }]);
  });

  it('front-elides names over 100 chars but keeps the value intact', () => {
    const bigLabel = { id: 45, label: 'x'.repeat(95) };
    const rows = listCompleter('12, 4', [bigLabel], { maxItems: 5 });
    expect(rows[0].value).toBe('12, 45');
    expect(rows[0].name).toHaveLength(100);
    expect(rows[0].name.startsWith('…')).toBe(true);
    expect(rows[0].name.endsWith('x')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-kit.test.ts`
Expected: FAIL — `listCompleter` not exported.

- [ ] **Step 3: Implement — append to `src/core/autocomplete.ts`**

```ts
export interface ListCandidate { id: number; label: string }

// Completes the last token of a comma/whitespace-separated id list (same grammar as
// parseIdList in src/modules/trading/validate.ts). Selecting a choice replaces the whole
// field, so every value re-emits the prior ids as a prefix.
export function listCompleter(
  rawInput: string,
  candidates: ListCandidate[],
  opts: { maxItems: number },
): Array<{ name: string; value: string }> {
  const endsOpen = rawInput.trim() !== '' && !/[\s,]$/.test(rawInput);
  const tokens = rawInput.split(/[\s,]+/).filter(Boolean);
  const active = endsOpen ? tokens[tokens.length - 1] : '';
  const prior = [...new Set(endsOpen ? tokens.slice(0, -1) : tokens)];
  const prefix = prior.join(', ');
  if (prior.length >= opts.maxItems) {
    return [{ name: `Max ${opts.maxItems} items per side`, value: prefix }];
  }
  const taken = new Set(prior.map(Number));
  const rows: Array<{ name: string; value: string }> = [];
  for (const c of candidates) {
    if (taken.has(c.id) || !matches(active, c.id, c.label)) continue;
    const value = prefix ? `${prefix}, ${c.id}` : String(c.id);
    if (value.length > MAX_NAME) return [{ name: 'List too long — type manually', value: prefix }];
    const name = `${value} — ${c.label}`;
    rows.push({ name: name.length <= MAX_NAME ? name : `…${name.slice(-(MAX_NAME - 1))}`, value });
    if (rows.length === MAX_CHOICES) break;
  }
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-kit.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/autocomplete.ts tests/autocomplete-kit.test.ts
git commit -m "Add listCompleter for multi-id trade option autocomplete"
```

---

### Task 5: Hatchery providers — /incubate and /hatch

**Files:**
- Modify: `src/modules/hatchery/index.ts` (builders at :28-29 and :37-38; handlers adjacent)
- Test: `tests/autocomplete-hatchery.test.ts` (create)

**Interfaces:**
- Consumes: `matches`, `respondRanked`, `emptyRow`, `eggLabel` (`src/core/autocomplete.js`); egg list query idiom `ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all()` (already used at index.ts:20).
- Produces: user-visible behavior only.

- [ ] **Step 1: Write the failing tests**

Create `tests/autocomplete-hatchery.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { hatcheryModule } from '../src/modules/hatchery/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';

const H = 3_600_000;
const cmd = (name: string) => hatcheryModule.commands.find((c) => c.data.name === name)!;

function seedEggs(ctx: ReturnType<typeof makeCtx>) {
  getOrCreateUser(ctx, 'u1', 'u1');
  const mk = (over: Partial<typeof schema.eggs.$inferInsert>) =>
    ctx.db.insert(schema.eggs).values({ userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0, ...over }).returning().get();
  const inventory = mk({ rarity: 'common' });                                        // not incubating
  const hatching = mk({ rarity: 'epic', incubationStartedAt: 0, hatchesAt: 12 * H }); // incubating
  const ready = mk({ rarity: 'rare', incubationStartedAt: 0, hatchesAt: 1 });         // ready
  return { inventory, hatching, ready };
}

describe('/incubate egg autocomplete', () => {
  it('ranks non-incubating eggs first with state-tagged labels', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { inventory, hatching, ready } = seedEggs(ctx);
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows[0]).toEqual({ name: `🥚 #${inventory.id} Common — in inventory`, value: inventory.id });
    expect(rows.map((r) => r.value)).toEqual([inventory.id, hatching.id, ready.id]);
    expect(rows[1].name).toBe(`🥚 #${hatching.id} Epic — hatching, 10h left`);
    expect(rows[2].name).toBe(`🥚 #${ready.id} Rare — READY`);
  });

  it('filters by the typed query', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { ready } = seedEggs(ctx);
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: 'rare' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows.map((r) => r.value)).toEqual([ready.id]);
  });

  it('shows the empty-state row when the user has no eggs', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const i = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('incubate').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No eggs — get one from /shop egg or /expedition', value: 0 }]);
  });
});

describe('/hatch egg autocomplete', () => {
  it('ranks READY eggs first', async () => {
    const ctx = makeCtx({ nowMs: 2 * H });
    const { ready } = seedEggs(ctx);
    const i = fakeAutocomplete({ name: 'hatch', user: 'u1', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows[0].value).toBe(ready.id);
    expect(rows).toHaveLength(3);
  });

  it('never lists another user\'s eggs', async () => {
    const ctx = makeCtx();
    seedEggs(ctx);
    getOrCreateUser(ctx, 'u2', 'u2');
    const i = fakeAutocomplete({ name: 'hatch', user: 'u2', focused: { name: 'egg', value: '' } });
    await cmd('hatch').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No eggs — get one from /shop egg or /expedition', value: 0 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-hatchery.test.ts`
Expected: FAIL — `autocomplete` is undefined on both commands.

- [ ] **Step 3: Implement**

In `src/modules/hatchery/index.ts` add the kit import:

```ts
import { matches, respondRanked, emptyRow, eggLabel } from '../../core/autocomplete.js';
```

Change both egg option builders (index.ts:29 and :38) — new description + autocomplete flag:

```ts
        .addIntegerOption((o) => o.setName('egg').setDescription('Egg — type to search').setRequired(true).setAutocomplete(true)),
```

Add an `autocomplete` method to the `/incubate` command object (sibling of its `execute`):

```ts
      async autocomplete(ctx, i) {
        const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
        if (!eggs.length) { await respondRanked(i, [emptyRow('No eggs — get one from /shop egg or /expedition', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, eggs
          .filter((e) => matches(q, e.id, e.rarity))
          .map((e) => ({ value: e.id, label: eggLabel(e, ctx.now()), valid: e.incubationStartedAt === null })));
      },
```

And to `/hatch` — identical except the validity predicate:

```ts
      async autocomplete(ctx, i) {
        const eggs = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, i.user.id)).all();
        if (!eggs.length) { await respondRanked(i, [emptyRow('No eggs — get one from /shop egg or /expedition', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, eggs
          .filter((e) => matches(q, e.id, e.rarity))
          .map((e) => ({ value: e.id, label: eggLabel(e, ctx.now()), valid: e.hatchesAt !== null && e.hatchesAt <= ctx.now() })));
      },
```

Slot-fullness is deliberately NOT part of `/incubate` validity (spec) — the execute path's `HatcheryError` covers it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-hatchery.test.ts tests/hatchery.test.ts && npm run typecheck`
Expected: PASS, existing hatchery tests untouched and green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/index.ts tests/autocomplete-hatchery.test.ts
git commit -m "Add egg autocomplete to /incubate and /hatch"
```

---

### Task 6: Care providers — /feed one and /rescue

**Files:**
- Modify: `src/modules/care/index.ts` (builders at :11-14 and :33-34)
- Test: `tests/autocomplete-care.test.ts` (create)

**Interfaces:**
- Consumes: kit fns; `settleEscapes` (`../park/escapes.js`, already imported); `hungerAt` from `../../core/clock.js`; `getSpecies` from `../../data/species/index.js`. NEW imports needed in care/index.ts: `schema` (`../../core/db/index.js`), `eq` (`drizzle-orm`), `hungerAt`, `getSpecies`, kit fns, `type { Ctx }` (`../../core/context.js`).
- Produces: module-local `settledDinos(ctx, userId)` helper (below), reused by both providers.

**CRITICAL:** `settleEscapes` calls `toClockDinos`, which does `.get()!` on the users row — it CRASHES for a user with no row. The helper checks the user row first and returns `null` for unknown users. `settleEscapes` is otherwise required here: escape state must be settled or labels lie (spec).

- [ ] **Step 1: Write the failing tests**

Create `tests/autocomplete-care.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { careModule } from '../src/modules/care/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';

const H = 3_600_000;
const cmd = (name: string) => careModule.commands.find((c) => c.data.name === name)!;

function seedDino(ctx: ReturnType<typeof makeCtx>, over: Partial<typeof schema.dinos.$inferInsert> = {}) {
  return ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'velociraptor', lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();
}

describe('/feed one autocomplete', () => {
  it('lists non-escaped dinos first, hungriest first', async () => {
    const ctx = makeCtx({ nowMs: 10 * H });
    getOrCreateUser(ctx, 'u1', 'u1');
    const fresh = seedDino(ctx, { lastFedAt: 9 * H });            // fed 1h ago
    const hungry = seedDino(ctx, { speciesId: 'triceratops' });   // fed 10h ago — hungrier
    const escaped = seedDino(ctx, { speciesId: 'stegosaurus', escapedAt: 1 });
    const i = fakeAutocomplete({ name: 'feed', sub: 'one', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('feed').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([hungry.id, fresh.id, escaped.id]);
    expect(rows[0].name).toBe(`🦖 #${hungry.id} Triceratops — fed 10h ago (unassigned)`);
    expect(rows[2].name).toBe(`🦖 #${escaped.id} Stegosaurus — ESCAPED, rescue first`);
  });

  it('responds the empty-state row for a user with no row (and does not crash)', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'feed', sub: 'one', user: 'ghost', focused: { name: 'dino', value: '' } });
    await cmd('feed').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No dinos — hatch an egg first', value: 0 }]);
  });

  it('responds [] for the all subcommand', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const i = fakeAutocomplete({ name: 'feed', sub: 'all', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('feed').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([]);
  });
});

describe('/rescue autocomplete', () => {
  it('ranks escaped dinos first with the ESCAPED tag', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const safe = seedDino(ctx);
    const escaped = seedDino(ctx, { speciesId: 'triceratops', escapedAt: 1 });
    const i = fakeAutocomplete({ name: 'rescue', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('rescue').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([escaped.id, safe.id]);
    expect(rows[0].name).toBe(`🦖 #${escaped.id} Triceratops — ESCAPED, rescue first`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-care.test.ts`
Expected: FAIL — no `autocomplete` handlers.

- [ ] **Step 3: Implement**

In `src/modules/care/index.ts` add imports:

```ts
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { hungerAt } from '../../core/clock.js';
import { getSpecies } from '../../data/species/index.js';
import { matches, respondRanked, emptyRow, dinoLabel } from '../../core/autocomplete.js';
```

Add the module-local helper above the manifest:

```ts
// Autocomplete-safe dino listing: settleEscapes crashes for users with no row
// (toClockDinos uses .get()!), so guard on row existence and never create one here.
function settledDinos(ctx: Ctx, userId: string) {
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) return null;
  settleEscapes(ctx, userId);
  return ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
}
```

Builders — add `.setAutocomplete(true)` and new descriptions:

```ts
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true)))
```
(on the `/feed one` option, index.ts:13)

```ts
        .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true)),
```
(on `/rescue`, index.ts:34)

`/feed` command object — add:

```ts
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'one') { await i.respond([]); return; }
        const dinos = settledDinos(ctx, i.user.id);
        if (!dinos?.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
        const q = String(i.options.getFocused());
        const now = ctx.now();
        await respondRanked(i, dinos
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
          .sort((a, b) => hungerAt(a.d.hunger, a.d.lastFedAt, now) - hungerAt(b.d.hunger, b.d.lastFedAt, now))
          .map(({ d, species }) => ({ value: d.id, label: dinoLabel(d, species, now), valid: d.escapedAt === null })));
      },
```

`/rescue` command object — add:

```ts
      async autocomplete(ctx, i) {
        const dinos = settledDinos(ctx, i.user.id);
        if (!dinos?.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
        const q = String(i.options.getFocused());
        const now = ctx.now();
        await respondRanked(i, dinos
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
          .map(({ d, species }) => ({ value: d.id, label: dinoLabel(d, species, now), valid: d.escapedAt !== null })));
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-care.test.ts tests/care.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/care/index.ts tests/autocomplete-care.test.ts
git commit -m "Add dino autocomplete to /feed one and /rescue"
```

---

### Task 7: Park providers — /upgrade, /dino assign/unassign, /decorate

**Files:**
- Modify: `src/modules/park/index.ts` (builders :82-83, :98-104, :131-133)
- Test: `tests/autocomplete-park.test.ts` (create)

**Interfaces:**
- Consumes: kit fns; `paddockCapacity` (exported, `./dinos.js:11`); `FACILITIES` (`../../data/facilities.js`); `getSpecies`. Park index.ts already imports `schema`, `eq`; add `FACILITIES`, `paddockCapacity`, `getSpecies`, kit fns as needed (check existing imports before adding duplicates).
- Produces: user-visible behavior only. maxLevel rule: `FACILITIES[lot.kind]?.maxLevel ?? 4` (paddocks have no def — the 4 mirrors `upgradeLot`, `src/modules/park/service.ts:66`).

- [ ] **Step 1: Write the failing tests**

Create `tests/autocomplete-park.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { parkModule } from '../src/modules/park/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';

const cmd = (name: string) => parkModule.commands.find((c) => c.data.name === name)!;

function seedLot(ctx: ReturnType<typeof makeCtx>, over: Partial<typeof schema.lots.$inferInsert> = {}) {
  return ctx.db.insert(schema.lots).values({
    userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock', ...over,
  }).returning().get();
}
function seedDino(ctx: ReturnType<typeof makeCtx>, over: Partial<typeof schema.dinos.$inferInsert> = {}) {
  return ctx.db.insert(schema.dinos).values({
    userId: 'u1', speciesId: 'velociraptor', lastFedAt: 0, hatchedAt: 0, ...over,
  }).returning().get();
}

describe('/upgrade lot autocomplete', () => {
  it('tags maxed lots and ranks upgradable first', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const maxed = seedLot(ctx, { level: 4 });                      // paddock maxLevel is 4
    const open = seedLot(ctx, { type: 'facility', kind: 'hatchery_lab', name: 'Hatchery Lab', level: 2 }); // maxLevel 3
    const i = fakeAutocomplete({ name: 'upgrade', user: 'u1', focused: { name: 'lot', value: '' } });
    await cmd('upgrade').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([open.id, maxed.id]);
    expect(rows[0].name).toBe(`🏗️ #${open.id} Hatchery Lab (lvl 2)`);
    expect(rows[1].name).toBe(`🏗️ #${maxed.id} Herbivore Paddock (lvl 4) — MAX LEVEL`);
  });

  it('shows the empty-state row with no lots', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const i = fakeAutocomplete({ name: 'upgrade', user: 'u1', focused: { name: 'lot', value: '' } });
    await cmd('upgrade').autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No lots — /build one first', value: 0 }]);
  });
});

describe('/dino assign autocomplete', () => {
  it('dino option: escaped dinos rank last and are tagged', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const escaped = seedDino(ctx, { escapedAt: 1 });
    const ok = seedDino(ctx, { speciesId: 'triceratops' });
    const i = fakeAutocomplete({ name: 'dino', sub: 'assign', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('dino').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows.map((r) => r.value)).toEqual([ok.id, escaped.id]);
  });

  it('lot option: only paddocks, FULL ones tagged and ranked last', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const full = seedLot(ctx);                                     // lvl 1 => capacity 2
    seedDino(ctx, { lotId: full.id }); seedDino(ctx, { lotId: full.id });
    const open = seedLot(ctx, { kind: 'carnivore_paddock', name: 'Carnivore Paddock' });
    seedLot(ctx, { type: 'facility', kind: 'visitor_center', name: 'Visitor Center' }); // excluded entirely
    const i = fakeAutocomplete({ name: 'dino', sub: 'assign', user: 'u1', focused: { name: 'lot', value: '' } });
    await cmd('dino').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([open.id, full.id]);
    expect(rows[0].name).toBe(`🏗️ #${open.id} Carnivore Paddock (lvl 1, 0/2)`);
    expect(rows[1].name).toBe(`🏗️ #${full.id} Herbivore Paddock (lvl 1, 2/2) — FULL`);
  });
});

describe('/dino unassign autocomplete', () => {
  it('assigned dinos rank first', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const lot = seedLot(ctx);
    const unassigned = seedDino(ctx);
    const assigned = seedDino(ctx, { speciesId: 'triceratops', lotId: lot.id });
    const i = fakeAutocomplete({ name: 'dino', sub: 'unassign', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('dino').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ value: number }>;
    expect(rows.map((r) => r.value)).toEqual([assigned.id, unassigned.id]);
  });
});

describe('/decorate lot autocomplete', () => {
  it('lists only paddocks', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const pad = seedLot(ctx);
    seedLot(ctx, { type: 'facility', kind: 'food_court', name: 'Food Court' });
    const i = fakeAutocomplete({ name: 'decorate', user: 'u1', focused: { name: 'lot', value: '' } });
    await cmd('decorate').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ name: `🏗️ #${pad.id} Herbivore Paddock (lvl 1)`, value: pad.id });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-park.test.ts`
Expected: FAIL — no handlers.

- [ ] **Step 3: Implement**

In `src/modules/park/index.ts`, add to the existing imports (it already has `schema` and `eq`):

```ts
import { FACILITIES } from '../../data/facilities.js';
import { paddockCapacity } from './dinos.js';
import { getSpecies } from '../../data/species/index.js';
import { matches, respondRanked, emptyRow, dinoLabel } from '../../core/autocomplete.js';
```
(If any of these are already imported — `paddockCapacity` may not be in the existing `./dinos.js` import list — merge into the existing import statements instead of duplicating.)

Builder changes (`.setAutocomplete(true)` + descriptions):

```ts
// /upgrade (index.ts:83)
        .addIntegerOption((o) => o.setName('lot').setDescription('Lot — type to search').setRequired(true).setAutocomplete(true)),
// /dino assign (index.ts:100-101)
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('lot').setDescription('Paddock — type to search').setRequired(true).setAutocomplete(true)))
// /dino unassign (index.ts:103)
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true))),
// /decorate (index.ts:132)
        .addIntegerOption((o) => o.setName('lot').setDescription('Paddock — type to search').setRequired(true).setAutocomplete(true))
```

`/upgrade` command object — add:

```ts
      async autocomplete(ctx, i) {
        const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all();
        if (!lots.length) { await respondRanked(i, [emptyRow('No lots — /build one first', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, lots
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => {
            const maxLevel = FACILITIES[l.kind]?.maxLevel ?? 4;
            const valid = l.level < maxLevel;
            return { value: l.id, valid, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level})${valid ? '' : ' — MAX LEVEL'}` };
          }));
      },
```

`/dino` command object — add (branches on the focused option):

```ts
      async autocomplete(ctx, i) {
        const focused = i.options.getFocused(true);
        const q = String(focused.value);
        const now = ctx.now();
        if (focused.name === 'dino') {
          const sub = i.options.getSubcommand();
          const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
          if (!dinos.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
          await respondRanked(i, dinos
            .map((d) => ({ d, species: getSpecies(d.speciesId) }))
            .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
            .map(({ d, species }) => ({
              value: d.id, label: dinoLabel(d, species, now),
              valid: sub === 'unassign' ? d.lotId !== null : d.escapedAt === null,
            })));
          return;
        }
        // focused.name === 'lot' (assign target) — paddocks only, FULL tagged
        const paddocks = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all()
          .filter((l) => l.type === 'paddock');
        if (!paddocks.length) { await respondRanked(i, [emptyRow('No paddocks — /build one first', 0)]); return; }
        const occupants = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        await respondRanked(i, paddocks
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => {
            const occ = occupants.filter((d) => d.lotId === l.id).length;
            const cap = paddockCapacity(l.level);
            const valid = occ < cap;
            return { value: l.id, valid, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level}, ${occ}/${cap})${valid ? '' : ' — FULL'}` };
          }));
      },
```

`/decorate` command object — add:

```ts
      async autocomplete(ctx, i) {
        const paddocks = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all()
          .filter((l) => l.type === 'paddock');
        if (!paddocks.length) { await respondRanked(i, [emptyRow('No paddocks — /build one first', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, paddocks
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => ({ value: l.id, valid: true, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level})` })));
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-park.test.ts tests/park.test.ts tests/dinos.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/park/index.ts tests/autocomplete-park.test.ts
git commit -m "Add lot and dino autocomplete to park commands"
```

---

### Task 8: Shop providers — /sell dino and /shop egg rarity conversion

**Files:**
- Modify: `src/modules/shop/index.ts` (rarity option :19, sell option :52-53)
- Test: `tests/autocomplete-shop.test.ts` (create)

**Interfaces:**
- Consumes: kit fns; `dailyEggOffers(highWater, now): Rarity[]` (`./service.js`, exported, pure); `SHOP_EGG_PRICES` (`../../data/shop.js`); `SELL_CASH` (`../../data/sell.js`); `getSpecies`; the existing `eggRarityChoices` const (index.ts:11) stays as the rarity iteration source. NEW imports for index.ts: `eq`/`schema` (if not present), `getSpecies`, `SHOP_EGG_PRICES`, `SELL_CASH`, kit fns, `type { Rarity }`.
- Produces: user-visible behavior only. Sellability mirror: `species.rarity !== 'mythic' && !dino.locked` (`src/modules/shop/shards.ts:53`). `viaTrade` dinos ARE sellable (0 shards) — never filter them out.

- [ ] **Step 1: Write the failing tests**

Create `tests/autocomplete-shop.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { shopModule } from '../src/modules/shop/index.js';
import { dailyEggOffers } from '../src/modules/shop/service.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';
import { SHOP_EGG_PRICES } from '../src/data/shop.js';
import { eq } from 'drizzle-orm';

const cmd = (name: string) => shopModule.commands.find((c) => c.data.name === name)!;

describe('/shop egg rarity autocomplete', () => {
  it('ranks today\'s offers first with prices, tags the rest', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ ratingHighWater: 500 }).where(eq(schema.users.discordId, 'u1')).run();
    const offers = dailyEggOffers(500, ctx.now());
    const i = fakeAutocomplete({ name: 'shop', sub: 'egg', user: 'u1', focused: { name: 'rarity', value: '' } });
    await cmd('shop').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: string }>;
    expect(rows).toHaveLength(5);
    for (const [n, row] of rows.entries()) {
      const inRotation = offers.includes(row.value as never);
      expect(inRotation).toBe(n < offers.length);   // valid-first ordering
      if (inRotation) expect(row.name).toContain(`${SHOP_EGG_PRICES[row.value as never].toLocaleString('en-US')} cash`);
      else expect(row.name).toContain("not in today's shop");
    }
  });

  it('treats a missing user row as high-water 0 without creating a row', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'shop', sub: 'egg', user: 'ghost', focused: { name: 'rarity', value: '' } });
    await cmd('shop').autocomplete!(ctx, i.asAutocomplete());
    expect((i.replies[0] as unknown[]).length).toBe(5);
    expect(ctx.db.select().from(schema.users).all()).toEqual([]);
  });
});

describe('/sell dino autocomplete', () => {
  it('tags mythic and trade-locked dinos, appends sale value to valid ones', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const mk = (over: Partial<typeof schema.dinos.$inferInsert>) =>
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'velociraptor', lastFedAt: 0, hatchedAt: 0, ...over }).returning().get();
    const ok = mk({});                                         // velociraptor is rare -> 500 cash
    const traded = mk({ speciesId: 'triceratops', viaTrade: true });
    const locked = mk({ speciesId: 'stegosaurus', locked: true });
    const mythic = mk({ speciesId: 'indominus' });
    const i = fakeAutocomplete({ name: 'sell', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('sell').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([ok.id, traded.id, locked.id, mythic.id]);
    expect(rows[0].name).toBe(`🦖 #${ok.id} Velociraptor — 500 cash`);
    expect(rows[1].name).toBe(`🦖 #${traded.id} Triceratops — 50 cash, 0 shards (via trade)`);
    expect(rows[2].name).toBe(`🦖 #${locked.id} Stegosaurus — locked in a trade`);
    expect(rows[3].name).toBe(`🦖 #${mythic.id} Indominus rex — MYTHIC, can't sell`);
  });
});
```

Note: the mythic species display name is whatever `getSpecies('indominus').name` returns — if the assertion fails on the name only, read `src/data/species/indominus.ts` and fix the expected string, not the provider.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-shop.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/modules/shop/index.ts` add imports (merge with existing ones):

```ts
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { getSpecies } from '../../data/species/index.js';
import { SHOP_EGG_PRICES } from '../../data/shop.js';
import { SELL_CASH } from '../../data/sell.js';
import { matches, respondRanked, emptyRow, capitalize } from '../../core/autocomplete.js';
```

Convert the rarity option (index.ts:19) — REMOVE `.addChoices(...eggRarityChoices)`, ADD `.setAutocomplete(true)`:

```ts
      .addStringOption((o) => o.setName('rarity').setDescription("Egg rarity — today's rotation shows prices").setRequired(true).setAutocomplete(true)))
```
Keep the `eggRarityChoices` const (index.ts:11) — the provider iterates it.

`/shop` command object — add:

```ts
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'egg') { await i.respond([]); return; }
        const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, i.user.id)).get();
        const offers = dailyEggOffers(user?.ratingHighWater ?? 0, ctx.now());
        const q = String(i.options.getFocused());
        await respondRanked(i, eggRarityChoices
          .map((c) => c.value as Rarity)
          .filter((r) => matches(q, r))
          .map((r) => ({
            value: r,
            valid: offers.includes(r),
            label: offers.includes(r)
              // 'en-US' pinned: autocomplete labels are asserted verbatim in tests,
              // and the host locale must not change them.
              ? `🥚 ${capitalize(r)} — ${SHOP_EGG_PRICES[r].toLocaleString('en-US')} cash`
              : `🥚 ${capitalize(r)} — not in today's shop`,
          })));
      },
```

`/sell` command object — add:

```ts
      async autocomplete(ctx, i) {
        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        if (!dinos.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, dinos
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
          .map(({ d, species }) => {
            const sellable = species.rarity !== 'mythic' && !d.locked;   // mirrors shards.ts:53
            const label = !sellable
              ? `🦖 #${d.id} ${species.name} — ${species.rarity === 'mythic' ? "MYTHIC, can't sell" : 'locked in a trade'}`
              : `🦖 #${d.id} ${species.name} — ${SELL_CASH[species.rarity].toLocaleString('en-US')} cash${d.viaTrade ? ', 0 shards (via trade)' : ''}`;
            return { value: d.id, label, valid: sellable };
          }));
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-shop.test.ts tests/shop.test.ts tests/shards.test.ts && npm run typecheck`
Expected: PASS. Note: existing `/shop egg` execute tests pass option values directly and never depended on the static choices — they must stay green untouched.

- [ ] **Step 5: Commit**

```bash
git add src/modules/shop/index.ts tests/autocomplete-shop.test.ts
git commit -m "Add sell-dino autocomplete and convert shop rarity to rotation-aware suggestions"
```

---

### Task 9: Expeditions provider — /expedition start site conversion

**Files:**
- Modify: `src/modules/expeditions/index.ts` (builder :14, dead const :8)
- Test: `tests/autocomplete-expeditions.test.ts` (create)

**Interfaces:**
- Consumes: kit fns (`matches`, `respondRanked`, `fmtDuration`); `EXPEDITION_SITES` (already imported); `siteUnlocked` from `../park/rating.js` (module convention — NOT from data/progression directly); `schema`/`eq` (new imports here).
- Produces: user-visible behavior only. Missing user row → high-water 0 (coastal_dig valid, rest tagged); never `getOrCreateUser`.

- [ ] **Step 1: Write the failing tests**

Create `tests/autocomplete-expeditions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { expeditionsModule } from '../src/modules/expeditions/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

const cmd = () => expeditionsModule.commands[0];

describe('/expedition start site autocomplete', () => {
  it('unlocked sites first with cost and duration; locked tagged with the star requirement', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ ratingHighWater: 150 }).where(eq(schema.users.discordId, 'u1')).run();
    const i = fakeAutocomplete({ name: 'expedition', sub: 'start', user: 'u1', focused: { name: 'site', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: string }>;
    expect(rows.map((r) => r.value)).toEqual(['coastal_dig', 'amber_ridge', 'frozen_cliffs', 'volcano_core']);
    expect(rows[0].name).toBe('🧭 Coastal Dig — 200 cash, 15m');
    expect(rows[1].name).toBe('🧭 Amber Ridge — 1,000 cash, 1h');
    expect(rows[2].name).toBe('🧭 Frozen Cliffs — LOCKED, needs ★2.5');
    expect(rows[3].name).toBe('🧭 Volcano Core — LOCKED, needs ★4.0');
  });

  it('missing user row = high-water 0, no row created', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'expedition', sub: 'start', user: 'ghost', focused: { name: 'site', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string }>;
    expect(rows[0].name).toBe('🧭 Coastal Dig — 200 cash, 15m');
    expect(rows.filter((r) => r.name.includes('LOCKED'))).toHaveLength(3);
    expect(ctx.db.select().from(schema.users).all()).toEqual([]);
  });

  it('responds [] for other subcommands', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'expedition', sub: 'status', user: 'u1', focused: { name: 'site', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-expeditions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/modules/expeditions/index.ts`:

Add imports:

```ts
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { siteUnlocked } from '../park/rating.js';
import { matches, respondRanked, fmtDuration } from '../../core/autocomplete.js';
```

DELETE the `siteChoices` const (index.ts:8) — dead once choices are gone.

Convert the builder option (index.ts:14):

```ts
          .addStringOption((o) => o.setName('site').setDescription('Dig site — locked ones show their star requirement').setRequired(true).setAutocomplete(true)))
```

Add to the `/expedition` command object:

```ts
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'start') { await i.respond([]); return; }
        const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, i.user.id)).get();
        const hw = user?.ratingHighWater ?? 0;
        const q = String(i.options.getFocused());
        await respondRanked(i, Object.values(EXPEDITION_SITES)
          .filter((s) => matches(q, s.id, s.name))
          .map((s) => {
            const unlocked = siteUnlocked(s.unlockRating, hw);
            return {
              value: s.id, valid: unlocked,
              label: unlocked
                // 'en-US' pinned: labels are asserted verbatim in tests.
                ? `🧭 ${s.name} — ${s.cost.toLocaleString('en-US')} cash, ${fmtDuration(s.durationMs)}`
                : `🧭 ${s.name} — LOCKED, needs ★${(s.unlockRating / 100).toFixed(1)}`,
            };
          }));
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-expeditions.test.ts tests/expeditions.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/expeditions/index.ts tests/autocomplete-expeditions.test.ts
git commit -m "Convert expedition site choices to unlock-aware autocomplete"
```

---

### Task 10: Trading providers — accept/decline/cancel trade ids

**Files:**
- Modify: `src/modules/trading/index.ts` (builders :29, :31, :33)
- Test: `tests/autocomplete-trading.test.ts` (create)

**Interfaces:**
- Consumes: kit fns; `listTrades`, `expireStale` (already imported from `./service.js`); the module-local `summarize(side)` helper (index.ts:9-16); `schema`/`eq` (new imports). `expireStale` is safe for missing user rows (plain filters, no `.get()!`).
- Produces: this task adds the single `/trade` `autocomplete` handler with the id branch; Task 11 EXTENDS the same handler with the offer branch — structure it as a `sub`-switch from the start.

- [ ] **Step 1: Write the failing tests**

Create `tests/autocomplete-trading.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { tradingModule } from '../src/modules/trading/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';

const cmd = () => tradingModule.commands[0];
const H = 3_600_000;

function seedTrade(ctx: ReturnType<typeof makeCtx>, over: Partial<typeof schema.trades.$inferInsert> = {}) {
  return ctx.db.insert(schema.trades).values({
    fromUser: 'u1', toUser: 'u2',
    offer: { dinoIds: [], eggIds: [], cash: 100, food: 0 },
    request: { dinoIds: [], eggIds: [], cash: 0, food: 5 },
    createdAt: ctx.now(), ...over,
  }).returning().get();
}

describe('/trade accept|decline|cancel id autocomplete', () => {
  it('accept: incoming trades first, outgoing tagged toward /trade cancel', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    const incoming = seedTrade(ctx, { fromUser: 'u2', toUser: 'u1' });
    const outgoing = seedTrade(ctx);
    const i = fakeAutocomplete({ name: 'trade', sub: 'accept', user: 'u1', focused: { name: 'id', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([incoming.id, outgoing.id]);
    expect(rows[0].name).toBe(`🤝 #${incoming.id} ← u2 — give 🍖 5 / get 💰 100`);
    expect(rows[1].name).toContain('your outgoing, use /trade cancel');
  });

  it('cancel: outgoing first, incoming tagged toward /trade accept', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    const incoming = seedTrade(ctx, { fromUser: 'u2', toUser: 'u1' });
    const outgoing = seedTrade(ctx);
    const i = fakeAutocomplete({ name: 'trade', sub: 'cancel', user: 'u1', focused: { name: 'id', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([outgoing.id, incoming.id]);
    expect(rows[0].name).toBe(`🤝 #${outgoing.id} → u2 — give 💰 100 / get 🍖 5`);
  });

  it('expired trades vanish (expireStale runs first)', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    seedTrade(ctx, { fromUser: 'u2', toUser: 'u1', createdAt: 0 });
    ctx.setNow(25 * H);   // past TRADE_EXPIRY_MS (24h)
    const i = fakeAutocomplete({ name: 'trade', sub: 'accept', user: 'u1', focused: { name: 'id', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No pending trades', value: 0 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-trading.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/modules/trading/index.ts` add imports:

```ts
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { matches, respondRanked, emptyRow } from '../../core/autocomplete.js';
```

Builders — all three id options (index.ts:29, :31, :33) get autocomplete:

```ts
          .addIntegerOption((o) => o.setName('id').setDescription('Trade — type to search').setRequired(true).setAutocomplete(true)))
```

Add the handler to the `/trade` command object (the `offer` branch arrives in Task 11 — leave the marked slot):

```ts
      async autocomplete(ctx, i) {
        const sub = i.options.getSubcommand();
        if (sub === 'accept' || sub === 'decline' || sub === 'cancel') {
          expireStale(ctx, i.user.id);
          const q = String(i.options.getFocused());
          const trades = listTrades(ctx, i.user.id).filter((t) => matches(q, t.id));
          if (!trades.length) { await respondRanked(i, [emptyRow('No pending trades', 0)]); return; }
          const wantIncoming = sub !== 'cancel';
          await respondRanked(i, trades.map((t) => {
            const incoming = t.toUser === i.user.id;
            const other = incoming ? t.fromUser : t.toUser;
            const otherName = ctx.db.select().from(schema.users)
              .where(eq(schema.users.discordId, other)).get()?.displayName ?? other;
            const mineGive = t.fromUser === i.user.id ? t.offer : t.request;
            const mineGet = t.fromUser === i.user.id ? t.request : t.offer;
            const base = `🤝 #${t.id} ${incoming ? '←' : '→'} ${otherName} — give ${summarize(mineGive)} / get ${summarize(mineGet)}`;
            const valid = incoming === wantIncoming;
            return {
              value: t.id, valid,
              label: valid ? base : `${base} — ${incoming ? 'incoming, use /trade accept' : 'your outgoing, use /trade cancel'}`,
            };
          }));
          return;
        }
        // sub === 'offer' handled in the next change (id-list completion)
        await i.respond([]);
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-trading.test.ts tests/trading.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/index.ts tests/autocomplete-trading.test.ts
git commit -m "Add direction-aware trade id autocomplete"
```

---

### Task 11: Trading providers — give/want id-list completion

**Files:**
- Modify: `src/modules/trading/index.ts` (builders :19-20, :23-24; extend the Task 10 handler)
- Test: `tests/autocomplete-trading.test.ts` (extend)

**Interfaces:**
- Consumes: `listCompleter`, `ListCandidate` (Task 4); `TRADE_MAX_ITEMS_PER_SIDE` from `../../data/trade.js`; `getSpecies`; tradeability mirrors `verifySide` (`src/modules/trading/service.ts:19-42`): dinos — owned, `!locked`, `escapedAt === null`, species not mythic; eggs — owned, `!locked`, `rarity !== 'mythic'`, `incubationStartedAt === null`.
- Produces: module-local `tradeableDinos(ctx, userId)` / `tradeableEggs(ctx, userId)` returning `ListCandidate[]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/autocomplete-trading.test.ts`:

```ts
describe('/trade offer id-list autocomplete', () => {
  function seedInventory(ctx: ReturnType<typeof makeCtx>, userId: string) {
    getOrCreateUser(ctx, userId, userId);
    const dino = (over: Partial<typeof schema.dinos.$inferInsert> = {}) =>
      ctx.db.insert(schema.dinos).values({ userId, speciesId: 'velociraptor', lastFedAt: 0, hatchedAt: 0, ...over }).returning().get();
    const egg = (over: Partial<typeof schema.eggs.$inferInsert> = {}) =>
      ctx.db.insert(schema.eggs).values({ userId, rarity: 'rare', source: 'shop', obtainedAt: 0, ...over }).returning().get();
    return { dino, egg };
  }

  it('give-dinos: lists only tradeable dinos, completing the last token', async () => {
    const ctx = makeCtx();
    const inv = seedInventory(ctx, 'u1');
    const ok = inv.dino({});
    inv.dino({ locked: true });
    inv.dino({ escapedAt: 1 });
    inv.dino({ speciesId: 'indominus' });          // mythic — untradeable
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'give-dinos', value: '' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: `${ok.id} — 🦖 Velociraptor (rare)`, value: String(ok.id) }]);
  });

  it('give-eggs: excludes incubating and locked eggs, re-emits the prefix', async () => {
    const ctx = makeCtx();
    const inv = seedInventory(ctx, 'u1');
    const ok = inv.egg({});
    inv.egg({ incubationStartedAt: 0, hatchesAt: 99 });
    inv.egg({ locked: true });
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'give-eggs', value: '500, ' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: `500, ${ok.id} — 🥚 rare egg`, value: `500, ${ok.id}` }]);
  });

  it('want-dinos: reads the in-flight user option and lists the counterparty\'s items', async () => {
    const ctx = makeCtx();
    seedInventory(ctx, 'u1');
    const theirs = seedInventory(ctx, 'u2');
    const target = theirs.dino({});
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'want-dinos', value: '' },
      options: { user: 'u2' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: `${target.id} — 🦖 Velociraptor (rare)`, value: String(target.id) }]);
  });

  it('want-* without a picked user prompts for it', async () => {
    const ctx = makeCtx();
    seedInventory(ctx, 'u1');
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'want-eggs', value: '' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'Pick the user option first', value: '-' }]);
  });

  it('empty tradeable pool yields an informational row', async () => {
    const ctx = makeCtx();
    seedInventory(ctx, 'u1');   // no dinos seeded
    const i = fakeAutocomplete({
      name: 'trade', sub: 'offer', user: 'u1',
      focused: { name: 'give-dinos', value: '' },
    });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'You have no tradeable items', value: '-' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-trading.test.ts`
Expected: the new describe block FAILS (offer branch responds `[]`).

- [ ] **Step 3: Implement**

Extend the trading imports:

```ts
import { getSpecies } from '../../data/species/index.js';
import { TRADE_MAX_ITEMS_PER_SIDE } from '../../data/trade.js';
import { listCompleter, type ListCandidate } from '../../core/autocomplete.js';
```
(merge with the kit import from Task 10 — one statement).

Builders — the four list options (index.ts:19-20, :23-24) get autocomplete + clearer descriptions:

```ts
          .addStringOption((o) => o.setName('give-dinos').setDescription('Your dinos — type to add, comma-separated').setAutocomplete(true))
          .addStringOption((o) => o.setName('give-eggs').setDescription('Your eggs — type to add, comma-separated').setAutocomplete(true))
```
```ts
          .addStringOption((o) => o.setName('want-dinos').setDescription('Their dinos — pick the user first').setAutocomplete(true))
          .addStringOption((o) => o.setName('want-eggs').setDescription('Their eggs — pick the user first').setAutocomplete(true))
```

Module-local helpers above the manifest (tradeability mirrors `verifySide` exactly):

```ts
function tradeableDinos(ctx: Ctx, userId: string): ListCandidate[] {
  return ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all()
    .filter((d) => !d.locked && d.escapedAt === null && getSpecies(d.speciesId).rarity !== 'mythic')
    .map((d) => {
      const s = getSpecies(d.speciesId);
      return { id: d.id, label: `🦖 ${s.name} (${s.rarity})` };
    });
}

function tradeableEggs(ctx: Ctx, userId: string): ListCandidate[] {
  return ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, userId)).all()
    .filter((e) => !e.locked && e.rarity !== 'mythic' && e.incubationStartedAt === null)
    .map((e) => ({ id: e.id, label: `🥚 ${e.rarity} egg` }));
}
```
(`Ctx` needs a type import in trading/index.ts: `import type { Ctx } from '../../core/context.js';`)

Replace the Task 10 placeholder (`// sub === 'offer' ...` + `await i.respond([]);`) with:

```ts
        if (sub === 'offer') {
          const focused = i.options.getFocused(true);
          const isWant = focused.name.startsWith('want-');
          const isDino = focused.name.endsWith('-dinos');
          if (!focused.name.endsWith('-dinos') && !focused.name.endsWith('-eggs')) { await i.respond([]); return; }
          let ownerId = i.user.id;
          if (isWant) {
            const target = i.options.get('user')?.value;
            if (typeof target !== 'string') { await i.respond([{ name: 'Pick the user option first', value: '-' }]); return; }
            ownerId = target;
          }
          const candidates = isDino ? tradeableDinos(ctx, ownerId) : tradeableEggs(ctx, ownerId);
          const rows = listCompleter(String(focused.value), candidates, { maxItems: TRADE_MAX_ITEMS_PER_SIDE });
          await i.respond(rows.length ? rows
            : [{ name: candidates.length ? 'No more matches' : (isWant ? 'They have no tradeable items' : 'You have no tradeable items'), value: '-' }]);
          return;
        }
        await i.respond([]);
```

The `'-'` sentinel fails `parseIdList` on submit with the existing ephemeral `Ids must be positive integers.` — the intended stale-pick behavior.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-trading.test.ts tests/trading.test.ts tests/trade-validate.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/index.ts tests/autocomplete-trading.test.ts
git commit -m "Add multi-id list completion to trade offers, including counterparty items"
```

---

### Task 12: Admin provider — /admin give dino-species

**Files:**
- Modify: `src/modules/admin/index.ts` (builder :48)
- Test: `tests/autocomplete-admin.test.ts` (create)

**Interfaces:**
- Consumes: kit fns; `allSpecies()` from `../../data/species/index.js` (30 entries — over the 25-row cap, so filtering is mandatory and the cap does real work here); owner check is inline `i.user.id === ctx.config.ownerId` (the `requireOwner` guard replies ephemerally and CANNOT be reused for autocomplete).
- Produces: user-visible behavior only. `/admin reset confirm` stays manual — never autocomplete it (spec).

- [ ] **Step 1: Write the failing tests**

Create `tests/autocomplete-admin.test.ts` (note `makeCtx` sets `ownerId: 'owner'`):

```ts
import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { adminModule } from '../src/modules/admin/index.js';
import { allSpecies } from '../src/data/species/index.js';

const cmd = () => adminModule.commands[0];

describe('/admin give dino-species autocomplete', () => {
  it('responds [] for non-owners', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'admin', sub: 'give', user: 'intruder', focused: { name: 'dino-species', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([]);
  });

  it('filters the 30-species registry by query for the owner', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'admin', sub: 'give', user: 'owner', focused: { name: 'dino-species', value: 'velo' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'Velociraptor (rare, carnivore)', value: 'velociraptor' }]);
  });

  it('caps the unfiltered registry at 25 rows', async () => {
    const ctx = makeCtx();
    expect(allSpecies().length).toBeGreaterThan(25);   // guards the premise
    const i = fakeAutocomplete({ name: 'admin', sub: 'give', user: 'owner', focused: { name: 'dino-species', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toHaveLength(25);
  });

  it('responds [] for other focused options', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'admin', sub: 'reset', user: 'owner', focused: { name: 'confirm', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([]);
  });
});
```

Note: if the Velociraptor rarity assertion fails, read `src/data/species/velociraptor.ts` and fix the expected `(rarity, diet)` string — not the provider.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/autocomplete-admin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/modules/admin/index.ts` add imports:

```ts
import { allSpecies } from '../../data/species/index.js';
import { matches, respondRanked, emptyRow } from '../../core/autocomplete.js';
```

Builder (index.ts:48):

```ts
          .addStringOption((o) => o.setName('dino-species').setDescription('Species — type to search').setAutocomplete(true)))
```

Add to the `/admin` command object:

```ts
      async autocomplete(ctx, i) {
        if (i.user.id !== ctx.config.ownerId) { await i.respond([]); return; }
        const focused = i.options.getFocused(true);
        if (i.options.getSubcommand() !== 'give' || focused.name !== 'dino-species') { await i.respond([]); return; }
        const q = String(focused.value);
        const hits = allSpecies().filter((s) => matches(q, s.id, s.name, s.rarity));
        if (!hits.length) { await respondRanked(i, [emptyRow('No species match', '-')]); return; }
        await respondRanked(i, hits.map((s) => ({
          value: s.id, valid: true, label: `${s.name} (${s.rarity}, ${s.diet})`,
        })));
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/autocomplete-admin.test.ts tests/admin.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin/index.ts tests/autocomplete-admin.test.ts
git commit -m "Add species autocomplete to /admin give"
```

---

### Task 13: Docs, full-suite gate, deploy note

**Files:**
- Modify: `README.md`
- Create: `CLAUDE.md` (repo root)

- [ ] **Step 1: README — feature note**

In `README.md`, append to the intro paragraph (after the `/park view` sentence, line ~13):

```
Options that take an id — eggs, dinos, lots, trades, expedition sites, shop
rarities, admin species — offer autocomplete suggestions as you type, with
currently-valid picks listed first and everything else tagged with its state.
```

And in the Setup section, extend the deploy-commands paragraph (after the `npm run deploy-commands` block) with:

```
Re-run this whenever command definitions change — autocomplete flags and
option descriptions are part of the registered command shape.
```

- [ ] **Step 2: Create repo `CLAUDE.md`**

```markdown
# Dino World — repo conventions

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()` — never
  `Date.now()`/`Math.random()`; tests inject both via `makeCtx`.
- DB access is synchronous drizzle/better-sqlite3 (`.get()`/`.all()`/`.run()`),
  never awaited.
- Slash commands live in `ModuleManifest`s (`src/core/modules.ts`). Commands
  may define `autocomplete?(ctx, i)`: providers only ever `i.respond(...)`
  (never `reply`/`defer`), never call `getOrCreateUser` (no row creation on
  keystrokes), and are read-only — the only permitted writes are
  `settleEscapes` (guard on the user row existing first: it crashes for
  unknown users) and `expireStale`. Router-level errors degrade to an empty
  suggestion list.
- Registering a new module touches 5 sites: modules.json, src/index.ts,
  src/deploy-commands.ts, tests/registry-load.test.ts (command count),
  tests/config.test.ts (expected modules).
- Changing any command builder requires `npm run deploy-commands` and exactly
  one running bot instance per token.
```

- [ ] **Step 3: Full-suite gate**

Run: `npm run typecheck && npm test`
Expected: everything green — all pre-existing tests (169+) plus the new autocomplete suites. If `registry-load.test.ts` fails on a command count, something added a command — this plan must not change the count (18).

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "Document autocomplete behavior and provider conventions"
```

- [ ] **Step 5: Operator hand-off note**

After merge: run `npm run deploy-commands` once (dev guild via DEV_GUILD_ID = instant; global rollout can take up to an hour on Discord's side), keeping the single-bot-instance rule.
