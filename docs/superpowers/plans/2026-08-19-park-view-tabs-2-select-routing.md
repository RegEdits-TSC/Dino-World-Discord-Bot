# Select Menu Routing Implementation Plan (PR 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the router to dispatch Discord string select menus safely, with a test harness and a value-validation guard, without touching the seventeen existing button handlers.

**Architecture:** A parallel `selects?: SelectDef[]` array on `ModuleManifest` with its own registry lookup, and a third branch in `routeInteraction`. `ComponentDef` keeps its `ButtonInteraction` parameter untouched. The existing `clickedIdIsOnMessage` guard is reused as-is; a new sibling `submittedValuesAreOnMessage` covers the one thing it cannot — the submitted values, which ride outside the customId and are unattested client input.

**Tech Stack:** TypeScript (ESM NodeNext), discord.js 14.27.0, vitest, zod (test payload validation).

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()`.
- DB access is synchronous drizzle/better-sqlite3, never awaited.
- The test-inclusive gate is `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`). `npm test` does not typecheck at all.
- Rejections use `deferUpdate()` — never a bare `return` (paints "This interaction failed" after 3s) and never a distinct text reply (an oracle telling an attacker the guard stopped them).
- Client-supplied values are validated against a real union and degraded, never cast — the `parseDexFilters` rule.
- No authorship attribution of any kind in commits, code comments, or docs.

## Why this ships without a user-visible surface

This PR adds no select menu to the game. It lands the engine change on its own so it can be reviewed against a `main` where the tabs already work, rather than mixed into a diff that also spends money. The first real menus arrive in PR 3.

**Known limitation, deliberate:** `tests/router.test.ts`'s real-payload sweep cannot cover select menus in this PR — it harvests ids from payload builders, and nothing mints a select yet. That work is Task 1 of PR 3, and this plan's Task 3 covers the router branch with hand-built fixtures instead.

---

### Task 1: `SelectDef` and registry lookup

**Files:**
- Modify: `src/core/modules.ts`
- Test: `tests/registry-load.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface SelectDef { prefix: string; execute(ctx: Ctx, i: StringSelectMenuInteraction): Promise<void>; }`
  - `ModuleManifest.selects?: SelectDef[]` — **optional**, so none of the seventeen existing manifests change.
  - `ModuleRegistry.findSelect(customId: string): SelectDef | undefined`

- [ ] **Step 1: Write the failing test**

Add to `tests/registry-load.test.ts`:

```ts
import { ModuleRegistry } from '../src/core/modules.js';
import type { ModuleManifest, SelectDef } from '../src/core/modules.js';

describe('select menu registry', () => {
  const sel = (prefix: string): SelectDef => ({ prefix, execute: async () => {} });
  const mod = (name: string, selects?: SelectDef[]): ModuleManifest =>
    ({ name, commands: [], components: [], ...(selects ? { selects } : {}) });

  it('resolves a select by its customId prefix', () => {
    const r = new ModuleRegistry([mod('a', [sel('park')])], { a: true });
    expect(r.findSelect('park:build:u1')?.prefix).toBe('park');
    expect(r.findSelect('nope:x')).toBeUndefined();
  });

  it('a module with no selects array is legal and resolves nothing', () => {
    const r = new ModuleRegistry([mod('a')], { a: true });
    expect(r.findSelect('park:build:u1')).toBeUndefined();
  });

  it('throws at construction on a duplicate select prefix', () => {
    expect(() => new ModuleRegistry([mod('a', [sel('park')]), mod('b', [sel('park')])], { a: true, b: true }))
      .toThrow(/Duplicate select prefix/);
  });

  it('a select and a button MAY share a prefix — they are separate namespaces', () => {
    const m: ModuleManifest = {
      name: 'a', commands: [],
      components: [{ prefix: 'park', execute: async () => {} }],
      selects: [sel('park')],
    };
    expect(() => new ModuleRegistry([m], { a: true })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/registry-load.test.ts -t "select menu registry"`

Expected: FAIL — `findSelect is not a function`.

- [ ] **Step 3: Implement**

In `src/core/modules.ts`, add to the discord.js type import: `StringSelectMenuInteraction`.

```ts
/**
 * A string select menu handler. Deliberately a SEPARATE type from ComponentDef rather than
 * a widened one.
 *
 * ComponentDef.execute is declared with METHOD syntax, so its parameter is bivariant:
 * widening it to accept a select compiles across all seventeen modules while letting a
 * select menu reach handlers written for buttons only. This was measured, not assumed —
 * widening it breaks exactly ONE call site under `tsc --noEmit -p tsconfig.test.json`, an
 * unrelated helper, and everything else goes green. Every button handler opens with
 * `i.customId.split(':')` and none reads `i.values`, so a select dispatched into one would
 * silently run the button path against the wrong payload shape. The near-silence is the
 * hazard, not the good news.
 */
export interface SelectDef {
  prefix: string;
  execute(ctx: Ctx, i: StringSelectMenuInteraction): Promise<void>;
}
```

Add the optional field to `ModuleManifest`:

```ts
export interface ModuleManifest {
  name: string; commands: CommandDef[]; components: ComponentDef[];
  // Optional so the seventeen manifests that mint no select menu are untouched.
  selects?: SelectDef[];
}
```

In the `ModuleRegistry` constructor, after the existing component-prefix check:

```ts
    // Selects get their own namespace and their own duplicate check. A select and a button
    // may share a prefix — they are resolved through different maps — but two selects may
    // not, for the same boot-time reason two components may not.
    const selectPrefixes = this.enabled.flatMap((m) => m.selects ?? []).map((s) => s.prefix);
    const dupSelect = selectPrefixes.find((p, idx) => selectPrefixes.indexOf(p) !== idx);
    if (dupSelect) throw new Error(`Duplicate select prefix across modules: ${dupSelect}`);
```

And the lookup:

```ts
  findSelect(customId: string): SelectDef | undefined {
    const prefix = customId.split(':')[0];
    return this.enabled.flatMap((m) => m.selects ?? []).find((s) => s.prefix === prefix);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/registry-load.test.ts -t "select menu registry"`

Expected: PASS, four cases.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS. `selects` is optional, so no manifest changes.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/core/modules.ts tests/registry-load.test.ts
git commit -m "Add a SelectDef registry alongside ComponentDef

A parallel selects array rather than a widened ComponentDef: that type is
declared with method syntax, so its parameter is bivariant and widening it
compiles across all seventeen modules while letting a select reach handlers
written for buttons. Measured — widening breaks exactly one unrelated call
site and everything else goes green."
```

---

### Task 2: `fakeSelect` test harness

**Files:**
- Modify: `tests/harness.ts`, `tests/harness.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 — the fake is independent of the registry.
- Produces:
  ```ts
  export function fakeSelect(opts: {
    customId: string; user: string; values: string[]; guild?: string;
    componentIds?: string[]; options?: string[];
  }): FakeInteraction
  ```
  `componentIds` defaults to `[opts.customId]` and `options` defaults to `opts.values`, so a fixture models a well-formed click unless it opts out.

- [ ] **Step 1: Write the failing test**

Add to `tests/harness.test.ts`:

```ts
import { fakeSelect } from './harness.js';

describe('fakeSelect', () => {
  it('defaults componentIds to the clicked id, like fakeButton', () => {
    const s = fakeSelect({ customId: 'park:build:u1', user: 'u1', values: ['gene_lab'] });
    const raw = s.asInteraction() as unknown as {
      message: { components: Array<{ components: Array<{ type: number; customId: string }> }> };
    };
    expect(raw.message.components[0].components[0]).toMatchObject({ type: 3, customId: 'park:build:u1' });
  });

  it('models a forged value by letting options and values diverge', () => {
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u1', values: ['__proto__'], options: ['gene_lab'],
    });
    const raw = s.asInteraction() as unknown as {
      values: string[];
      message: { components: Array<{ components: Array<{ options: Array<{ value: string }> }> }> };
    };
    expect(raw.values).toEqual(['__proto__']);
    expect(raw.message.components[0].components[0].options).toEqual([{ value: 'gene_lab', label: 'gene_lab' }]);
  });

  it('discriminates the two defers, like fakeButton', async () => {
    const s = fakeSelect({ customId: 'x:y', user: 'u1', values: ['a'] });
    const raw = s.asInteraction() as unknown as { deferUpdate(): Promise<void> };
    await raw.deferUpdate();
    expect(s.deferOpts).toEqual([{ kind: 'update' }]);
  });

  it('enforces reply-once', async () => {
    const s = fakeSelect({ customId: 'x:y', user: 'u1', values: ['a'] });
    const raw = s.asInteraction() as unknown as { reply(p: unknown): Promise<void> };
    await raw.reply({ content: 'one' });
    await expect(raw.reply({ content: 'two' })).rejects.toThrow(/InteractionAlreadyReplied/);
  });

  it('reports itself as a select and not as a button', () => {
    const raw = fakeSelect({ customId: 'x:y', user: 'u1', values: ['a'] })
      .asInteraction() as unknown as { isButton(): boolean; isStringSelectMenu(): boolean };
    expect(raw.isButton()).toBe(false);
    expect(raw.isStringSelectMenu()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/harness.test.ts -t "fakeSelect"`

Expected: FAIL — no export named `fakeSelect`.

- [ ] **Step 3: Implement `fakeSelect`**

Add to `tests/harness.ts`, directly beneath `fakeButton`. The lifecycle block is copied wholesale from `fakeButton` on purpose — a thinner fake that only records replies cannot tell a correct `deferUpdate` rejection from a UX-breaking `deferReply` one, which is the subtlest property the router guard has.

```ts
export function fakeSelect(opts: {
  customId: string; user: string; values: string[]; guild?: string;
  componentIds?: string[]; options?: string[];
}): FakeInteraction {
  const replies: unknown[] = [];
  const deferOpts: unknown[] = [];
  const label = `select ${opts.customId}`;
  // options defaults to values, so a fixture models a well-formed submission unless it
  // deliberately opts out. Divergence is how a test models the one attack a select adds
  // over a button: a value the minted menu never offered.
  const optionValues = opts.options ?? opts.values;
  const raw = {
    customId: opts.customId,
    values: opts.values,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    // Type 3 children, mirroring Message#components for a select-bearing row. Discord
    // allows exactly one select per action row, so each id gets its own row.
    message: {
      id: 'fake-message',
      interactionMetadata: null,
      components: (opts.componentIds ?? [opts.customId]).map((id) => ({
        type: 1,
        components: [{
          type: 3, customId: id,
          options: optionValues.map((v) => ({ value: v, label: v })),
        }],
      })),
    },
    deferred: false, replied: false,
    isChatInputCommand: () => false, isButton: () => false, isAutocomplete: () => false,
    isStringSelectMenu: () => true,
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
      raw.deferred = true; deferOpts.push({ kind: 'update', ...(o as Record<string, unknown> ?? {}) });
    },
    deferReply: async (o?: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      raw.deferred = true; deferOpts.push({ kind: 'reply', ...(o as Record<string, unknown> ?? {}) });
    },
  };
  return {
    replies, deferOpts,
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/harness.test.ts -t "fakeSelect"`

Expected: PASS, five cases.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/harness.ts tests/harness.test.ts
git commit -m "Add a fakeSelect interaction fixture

Copies fakeButton's lifecycle block wholesale rather than thinning it: a fake
that only records replies cannot distinguish a correct deferUpdate rejection
from a deferReply one, which is the subtlest property the router guard has.
options defaults to values so a fixture is well-formed unless it opts out —
divergence is how a test models a value the minted menu never offered."
```

---

### Task 3: Router select branch

**Files:**
- Modify: `src/core/router.ts`
- Test: `tests/router.test.ts`

**Interfaces:**
- Consumes: `findSelect` (Task 1), `fakeSelect` (Task 2).
- Produces: select menus dispatch through `routeInteraction`, gated by `clickedIdIsOnMessage`, with the same rejection shape buttons get.

- [ ] **Step 1: Write the failing test**

Add to `tests/router.test.ts`:

```ts
import { fakeSelect } from './harness.js';
import type { SelectDef } from '../src/core/modules.js';

describe('router select branch', () => {
  const selCtx = () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    return ctx;
  };
  const regWith = (execute: SelectDef['execute']) =>
    new ModuleRegistry([{ name: 'm', commands: [], components: [], selects: [{ prefix: 'm', execute }] }], { m: true });

  it('dispatches a select whose id the message actually carries', async () => {
    let got: string[] | null = null;
    const s = fakeSelect({ customId: 'm:pick', user: 'u1', values: ['a'], componentIds: ['m:pick'] });
    await routeInteraction(selCtx(), regWith(async (_c, i) => { got = i.values; }), s.asInteraction());
    expect(got).toEqual(['a']);
    expect(s.deferOpts).toHaveLength(0);
  });

  it('rejects a forged select id anchored on a message that never carried it', async () => {
    let ran = false;
    const s = fakeSelect({ customId: 'm:pick', user: 'u1', values: ['a'], componentIds: [] });
    await routeInteraction(selCtx(), regWith(async () => { ran = true; }), s.asInteraction());
    expect(ran).toBe(false);
    expect(s.replies).toHaveLength(0);
    expect(s.deferOpts[0]).toMatchObject({ kind: 'update' });
  });

  it('stays silent for a select prefix no module claims', async () => {
    const s = fakeSelect({ customId: 'unclaimed:x', user: 'u1', values: ['a'] });
    await routeInteraction(selCtx(), regWith(async () => {}), s.asInteraction());
    expect(s.replies).toHaveLength(0);
    expect(s.deferOpts).toHaveLength(0);
  });

  it('does not dispatch a select into a button handler of the same prefix', async () => {
    let button = false; let select = false;
    const registry = new ModuleRegistry([{
      name: 'm', commands: [],
      components: [{ prefix: 'm', execute: async () => { button = true; } }],
      selects: [{ prefix: 'm', execute: async () => { select = true; } }],
    }], { m: true });
    const s = fakeSelect({ customId: 'm:pick', user: 'u1', values: ['a'] });
    await routeInteraction(selCtx(), registry, s.asInteraction());
    expect(select).toBe(true);
    expect(button).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/router.test.ts -t "router select branch"`

Expected: FAIL — the first case's `got` is `null`. `routeInteraction` returns at `if (!isCommand && !isButton) return;` before touching the select.

- [ ] **Step 3: Add the branch**

In `src/core/router.ts`, add `StringSelectMenuInteraction` to the type import. Replace the early gate:

```ts
  const isCommand = interaction.isChatInputCommand();
  const isButton = interaction.isButton();
  if (!isCommand && !isButton) return;
```

with:

```ts
  const isCommand = interaction.isChatInputCommand();
  const isButton = interaction.isButton();
  const isSelect = interaction.isStringSelectMenu();
  // A third branch, deliberately, rather than widening the button one: ComponentDef.execute
  // is declared with method syntax, so its parameter is bivariant and widening it would
  // compile clean across all seventeen modules while letting a select reach a handler that
  // only ever parses i.customId. Anything still unrecognised here keeps the historical
  // silent no-op — modals in particular are NOT routed.
  if (!isCommand && !isButton && !isSelect) return;
```

Then, inside the `try`, extend the dispatch. The existing `if (isCommand) { … } else { … }` becomes a three-way:

```ts
    if (isCommand) {
      const cmd = registry.findCommand((interaction as ChatInputCommandInteraction).commandName);
      if (cmd) await cmd.execute(ctx, interaction as ChatInputCommandInteraction);
    } else if (isSelect) {
      const sel = registry.findSelect((interaction as StringSelectMenuInteraction).customId);
      if (sel) {
        const s = interaction as StringSelectMenuInteraction;
        // Same guard, same reasoning, same rejection shape as the button branch below.
        // It proves the bot minted THIS MENU on THIS MESSAGE — and nothing whatsoever
        // about s.values, which ride outside the customId and are unattested client
        // input. Every select handler validates its own values in addition to this.
        if (!clickedIdIsOnMessage(s)) {
          logger.warn(
            { customId: s.customId, userId: s.user.id, messageId: s.message?.id },
            'select id not present on its message',
          );
          await s.deferUpdate();
          return;
        }
        await sel.execute(ctx, s);
      }
    } else {
      /* existing button branch, unchanged */
    }
```

The `postDispatch` source line already reads the customId off a cast; widen its cast so a select reports its prefix too:

```ts
      const source = isCommand
        ? { command: (interaction as ChatInputCommandInteraction).commandName }
        : { prefix: (interaction as ButtonInteraction | StringSelectMenuInteraction).customId.split(':')[0] };
```

`RouterHooks.postDispatch`'s parameter type must accept a select. Widen it in `src/core/router.ts`:

```ts
  postDispatch?(
    ctx: Ctx,
    i: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction,
    source: { command?: string; prefix?: string },
  ): Promise<void>;
```

This widening is safe where `ComponentDef`'s is not: `dailyRouterHooks.postDispatch` reads only `i.user.id`, `i.deferred`, `i.replied` and `i.followUp`, all present on every member of the union.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/router.test.ts -t "router select branch"`

Expected: PASS, four cases.

- [ ] **Step 5: Confirm the modal pin still means what it says**

`tests/router.test.ts` has a case asserting a "modalish" interaction is not routed. Re-read it: it must still describe something genuinely unrouted. If it was built from an object that now satisfies `isStringSelectMenu()`, it is asserting the opposite of what it claims. Update its fixture so it reports `false` for all four predicates, and add a comment naming modals as the remaining unrouted kind.

Run: `npx vitest run tests/router.test.ts`

Expected: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/core/router.ts tests/router.test.ts
git commit -m "Route string select menus

Third branch rather than a widened button branch. A select was silently
dropped before reaching the guard, the handler or even presence tracking, so
the user saw 'This interaction failed' after three seconds. The forgery guard
applies unchanged and rejects the same way; it proves the menu was minted on
the message and nothing about the submitted values."
```

---

### Task 4: `submittedValuesAreOnMessage`

**Files:**
- Modify: `src/core/components.ts`
- Test: `tests/components.test.ts`

**Interfaces:**
- Consumes: `fakeSelect` (Task 2).
- Produces: `export function submittedValuesAreOnMessage(i: StringSelectMenuInteraction): boolean`

- [ ] **Step 1: Write the failing test**

Add to `tests/components.test.ts`:

```ts
import { submittedValuesAreOnMessage } from '../src/core/components.js';
import { fakeSelect } from './harness.js';

const asSelect = (o: { customId: string; values: string[]; options?: string[]; componentIds?: string[] }) =>
  fakeSelect({ user: 'u1', ...o }).asInteraction() as never;

describe('submittedValuesAreOnMessage', () => {
  it('accepts values the minted menu actually offered', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['a'], options: ['a', 'b'],
    }))).toBe(true);
  });

  it('rejects a value the menu never offered', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['evil'], options: ['a', 'b'],
    }))).toBe(false);
  });

  it('rejects a prototype key, which a plain-object lookup would read back truthy', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['__proto__'], options: ['a'],
    }))).toBe(false);
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['constructor'], options: ['a'],
    }))).toBe(false);
  });

  it('rejects a partially valid submission rather than accepting the good half', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['a', 'evil'], options: ['a', 'b'],
    }))).toBe(false);
  });

  it('fails closed on an empty submission and on a menu that is not on the message', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: [], options: ['a'],
    }))).toBe(false);
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['a'], options: ['a'], componentIds: [],
    }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components.test.ts -t "submittedValuesAreOnMessage"`

Expected: FAIL — no such export.

- [ ] **Step 3: Implement**

Add to `src/core/components.ts`. Extend the local `ComponentLike` shape with `options`:

```ts
interface ComponentLike {
  customId?: string | null;
  components?: readonly ComponentLike[];
  options?: readonly { value?: string }[];
}
```

```ts
/**
 * Are the submitted values ones the bot actually offered on this menu?
 *
 * `clickedIdIsOnMessage` proves the bot minted THIS MENU on THIS MESSAGE. It proves
 * nothing about `i.values`, which arrive on a separate client-supplied channel and are
 * never mentioned in the customId. Nothing in the installed discord.js or
 * discord-api-types claims Discord's gateway rejects a value absent from the option list,
 * a count outside min_values/max_values, or a click on a disabled component — so this
 * repo assumes none of it is enforced.
 *
 * Deliberately a SEPARATE exported function rather than folded into clickedIdIsOnMessage:
 * the router calls that guard for every component including buttons, which have no values
 * to check.
 *
 * A corollary worth stating: do NOT close a select flow by disabling the menu. Neither
 * guard reads `disabled`, so a disabled select is not a lock. Close a flow by removing the
 * component.
 *
 * Fails CLOSED: an empty submission, a menu absent from the message, or a menu carrying no
 * options authorises nothing. All-or-nothing — a partially valid submission is rejected
 * rather than filtered down to its good half, because a handler receiving a shortened
 * values array would act on a selection the player never made.
 */
export function submittedValuesAreOnMessage(i: MessageComponentInteraction & { values?: readonly string[] }): boolean {
  const values = i.values ?? [];
  if (values.length === 0) return false;
  if (typeof i.customId !== 'string' || i.customId.length === 0) return false;
  const rows = (i.message?.components ?? []) as readonly ComponentLike[];
  const find = (list: readonly ComponentLike[]): ComponentLike | undefined => {
    for (const c of list) {
      if (c.customId === i.customId) return c;
      if (c.components !== undefined) {
        const hit = find(c.components);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const menu = find(rows);
  if (!menu || !menu.options || menu.options.length === 0) return false;
  // A Set, never an object keyed by value: `__proto__` and `constructor` read back truthy
  // from a plain object, which is exactly the hole that makes buildLot's kind check
  // ineffective against a forged value.
  const offered = new Set(menu.options.map((o) => o.value));
  return values.every((v) => offered.has(v));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components.test.ts -t "submittedValuesAreOnMessage"`

Expected: PASS, five cases.

- [ ] **Step 5: Record the deliberate gap in the walk's docstring**

`clickedIdIsOnMessage`'s walk does not follow `SectionComponent.accessory` or `LabelComponent.component`, which sit outside `.components`. Nothing in this repo mints either, and modals are not routed. Append to that function's docstring:

```
 * Section accessories and Label children are deliberately NOT walked: they sit outside
 * `.components`, nothing in this repo mints them, and modals are not routed. If Components
 * V2 Sections or modals ever arrive, extend the walk in the same change.
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/core/components.ts tests/components.test.ts
git commit -m "Validate submitted select values against the minted options

The existing guard proves the bot minted the menu on the message; it says
nothing about the values, which arrive on a separate client-supplied channel.
Nothing in discord.js or discord-api-types claims the gateway rejects a value
absent from the option list, so this assumes none of it is enforced. All or
nothing: a partly valid submission is rejected rather than filtered, since a
shortened values array is a selection the player never made."
```

---

### Task 5: Payload limits for select menus

**Files:**
- Modify: `tests/lib/discord-limits.ts`
- Test: `tests/harness.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `validateMessagePayload` rejects an illegal select payload, so it fails in `npm test` rather than at `test:live` against real Discord.

- [ ] **Step 1: Write the failing test**

Add to `tests/harness.test.ts`:

```ts
import { validateMessagePayload } from './lib/discord-limits.js';

describe('select menu payload limits', () => {
  const row = (components: unknown[]) => ({ components: [{ type: 1, components }] });
  const select = (over: Record<string, unknown> = {}) => ({
    type: 3, custom_id: 'm:pick',
    options: [{ label: 'a', value: 'a' }],
    ...over,
  });

  it('accepts a legal select row', () => {
    expect(() => validateMessagePayload(row([select()]), 'ok')).not.toThrow();
  });

  it('rejects more than 25 options', () => {
    const options = Array.from({ length: 26 }, (_, n) => ({ label: `o${n}`, value: `o${n}` }));
    expect(() => validateMessagePayload(row([select({ options })]), 'x')).toThrow(/options > 25/);
  });

  it('rejects a select sharing its row with anything else', () => {
    expect(() => validateMessagePayload(row([select(), { type: 2, custom_id: 'm:b' }]), 'x'))
      .toThrow(/select must be alone in its row/);
  });

  it('rejects an over-long option label and an over-long value', () => {
    expect(() => validateMessagePayload(
      row([select({ options: [{ label: 'x'.repeat(101), value: 'a' }] })]), 'x')).toThrow(/label > 100/);
    expect(() => validateMessagePayload(
      row([select({ options: [{ label: 'a', value: 'x'.repeat(101) }] })]), 'x')).toThrow(/value > 100/);
  });

  it('still enforces the five-button cap on ordinary rows', () => {
    const six = Array.from({ length: 6 }, (_, n) => ({ type: 2, custom_id: `m:${n}` }));
    expect(() => validateMessagePayload(row(six), 'x')).toThrow(/buttons per row > 5/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/harness.test.ts -t "select menu payload limits"`

Expected: FAIL on the option-count, alone-in-row, label and value cases — `rowSchema` applies only the five-buttons cap and ignores everything else via `z.looseObject`.

- [ ] **Step 3: Extend the schema**

In `tests/lib/discord-limits.ts`, add beside `buttonSchema`:

```ts
const selectOptionSchema = z.looseObject({
  label: z.string().min(1, 'option label empty').max(100, 'option label > 100'),
  value: z.string().min(1, 'option value empty').max(100, 'option value > 100'),
  description: z.string().max(100, 'option description > 100').optional(),
});
const selectSchema = z.looseObject({
  custom_id: z.string().max(100, 'custom_id > 100').optional(),
  placeholder: z.string().max(150, 'placeholder > 150').optional(),
  options: z.array(selectOptionSchema).min(1, 'options empty').max(25, 'options > 25'),
});
```

Replace the single `rowSchema` use in `validateMessagePayload` with a branch. Change:

```ts
  for (const r of rows) parseOr(source, 'row', rowSchema, r);
```

to:

```ts
  for (const r of rows) {
    const children = ((r as { components?: unknown[] }).components ?? []).map(toJson) as Array<{ type?: number }>;
    // Discord allows exactly one select per action row and nothing else beside it. This
    // is the rule a button-only rowSchema silently ignored, and an illegal payload would
    // otherwise first fail against real Discord in test:live rather than here.
    if (children.some((c) => c?.type === 3)) {
      if (children.length !== 1) fail(source, 'select must be alone in its row');
      parseOr(source, 'select', selectSchema, children[0]);
      continue;
    }
    parseOr(source, 'row', rowSchema, r);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/harness.test.ts -t "select menu payload limits"`

Expected: PASS, five cases.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS. No existing payload contains a type-3 component, so the new branch is inert until PR 3.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add tests/lib/discord-limits.ts tests/harness.test.ts
git commit -m "Validate select menu payload limits in the harness

rowSchema applied the five-buttons-per-row cap and knew nothing about select
menus — not the 25-option limit, not label or value lengths, not the rule that
a select is alone in its row. Without this the harness silently stops covering
the new component and an illegal payload first fails against real Discord in
test:live rather than in npm test."
```

---

### Task 6: Document the select pattern

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the conventions**

Append to `CLAUDE.md`:

```markdown
- Select menus route through their own `selects?: SelectDef[]` on `ModuleManifest`
  (`src/core/modules.ts`) with their own `findSelect` and their own boot-time duplicate
  check — NEVER by widening `ComponentDef.execute`. That declaration uses method syntax,
  so its parameter is bivariant: widening it was measured to break exactly ONE call site
  under `npm run typecheck` and go green everywhere else, while letting a select reach any
  of the seventeen button handlers, every one of which opens with `i.customId.split(':')`
  and none of which reads `i.values`. A select and a button MAY share a prefix — separate
  namespaces — but two selects may not.
  `routeInteraction` gates selects on `clickedIdIsOnMessage` exactly as it gates buttons,
  with the same `deferUpdate` + `logger.warn` rejection. That guard proves the bot minted
  THIS MENU on THIS MESSAGE and **nothing about `i.values`**, which arrive on a separate
  client-supplied channel. `submittedValuesAreOnMessage` (`src/core/components.ts`) is the
  sibling guard for those, checking the submission against the message's own option list —
  kept separate because the router calls the first guard for buttons too, which have no
  values. It is ALL-OR-NOTHING: a partly valid submission is rejected rather than filtered,
  since a shortened values array is a selection the player never made. Both use a `Set`,
  never an object keyed by value — `__proto__` and `constructor` read back truthy from a
  plain object.
  Nothing in the installed discord.js or discord-api-types claims Discord's gateway
  validates submitted values, selection counts, or clicks on a `disabled` component, so
  this repo assumes none of it is enforced. **Never close a select flow by disabling the
  menu** — neither guard reads `disabled`, so a disabled select is not a lock. Remove the
  component instead.
  Modals are still NOT routed. If they are ever added, extend `clickedIdIsOnMessage`'s walk
  to follow `SectionComponent.accessory` and `LabelComponent.component` in the same change —
  both sit outside `.components`.
  `tests/lib/discord-limits.ts` knows the select rules (25 options, 100-char label and
  value, alone in its row); `tests/contract.test.ts` structurally CANNOT catch a
  select-menu mistake, since it walks command options only.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the select menu routing pattern"
```

---

## Verification before opening the PR

- [ ] `npm test` — full suite green
- [ ] `npm run typecheck` — exit 0
- [ ] `npm run build` — exit 0
- [ ] `git diff main -- src/modules/` shows **no changes** — this PR touches `src/core/` and tests only
- [ ] No `deploy-commands` run — no builder changed

## Self-Review

**Spec coverage:** Task 1 covers spec §3.1's `SelectDef` decision and the prefix-namespace note; Task 2 covers §7's `fakeSelect` requirement; Task 3 covers §3.1's router branch and §3.2's guard wiring; Task 4 covers §3.3's `submittedValuesAreOnMessage` and the disabled-is-not-a-lock ruling; Task 5 covers §7's `discord-limits` finding; Task 6 covers §9. Spec §3.4 (the Build allowlist), §3.5 (the upgrade level anchor), §3.6 (error taxonomy) and §3.7 (confirm steps) are **PR 3**, as is the real-payload sweep extension, which needs a payload that mints a select.

**Placeholder scan:** Task 3 Step 5 instructs re-reading the existing "modalish" case rather than quoting a replacement, because the correct edit depends on how that fixture is currently built — and quoting a fixture I have not read would be fabricated. Every other step shows complete code.

**Type consistency:** `SelectDef.execute(ctx, i: StringSelectMenuInteraction)` is used consistently in Tasks 1 and 3. `fakeSelect({ customId, user, values, componentIds?, options? })` matches its uses in Tasks 2, 3 and 4. `submittedValuesAreOnMessage` takes `MessageComponentInteraction & { values?: readonly string[] }` so the `fakeSelect` cast in Task 4's tests satisfies it, and a real `StringSelectMenuInteraction` satisfies it structurally.
