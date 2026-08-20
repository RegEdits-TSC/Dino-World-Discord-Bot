# Park Component Handler Default Arm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `park` component handler a default arm so an unrecognised `park:*` customId is acknowledged instead of silently timing out.

**Architecture:** `src/modules/park/index.ts`'s component handler is an if-chain over the parsed `action` segment with no final `else`. An action nobody wrote a branch for falls off the end, the handler returns without acknowledging, and Discord paints "This interaction failed" after three seconds. This is the same trap `/park`'s *subcommand* dispatch already had and already fixed with a real `switch` plus a `default` arm; the component handler never got the same treatment. Convert the chain to a `switch` and add the arm.

**Tech Stack:** TypeScript (ESM NodeNext), discord.js 14.27.0, vitest, better-sqlite3 + drizzle.

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()` — never `Date.now()`/`Math.random()`.
- DB access is synchronous drizzle/better-sqlite3 (`.get()`/`.all()`/`.run()`), never awaited.
- The test-inclusive gate is `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`). `npm run build` does not typecheck tests and `npm test` does not typecheck at all — run `typecheck` before every commit touching `tests/`.
- No authorship attribution of any kind in commits, code comments, or docs.
- Rejections of unrecognised component ids use `deferUpdate()`, never a bare `return` (which paints "This interaction failed") and never a distinct text reply (which is an oracle telling an attacker what stopped them).

## Why this ships alone

This is a live defect on `main` today, independent of any tab work. It is one task, it touches one file, and it is worth reviewing on its own rather than buried inside a large UI diff. It is also a precondition for the tabs plan: a `park:tab:…` id from a renamed tab after a later deploy lands in exactly this hole.

---

### Task 1: Default arm on the park component handler

**Files:**
- Modify: `src/modules/park/index.ts:399-465` (the `prefix: 'park'` component handler)
- Test: `tests/park.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is the first task.
- Produces: no new exported symbols. Behavioural guarantee later plans rely on: **any `park:` customId whose action segment matches no branch is acknowledged with `deferUpdate()` and produces no reply.**

- [ ] **Step 1: Write the failing test**

Add to `tests/park.test.ts`. `fakeButton` defaults `componentIds` to `[customId]`, so this models a genuine click on a button the message really carries — the id is unrecognised, not forged.

```ts
describe('park component handler default arm', () => {
  it('acknowledges an unrecognised park action instead of timing out', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:notathing:u1', user: 'u1' });
    const comp = parkModule.components.find((c) => c.prefix === 'park')!;
    await comp.execute(ctx, b.asInteraction() as never);
    // deferUpdate, not deferReply: deferReply posts a public "thinking…" placeholder
    // that never resolves when the handler goes on to do nothing.
    expect(b.deferOpts).toEqual([{ kind: 'update' }]);
    expect(b.replies).toEqual([]);
  });

  it('still dispatches the actions it does know', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:collect', user: 'u1' });
    const comp = parkModule.components.find((c) => c.prefix === 'park')!;
    await comp.execute(ctx, b.asInteraction() as never);
    expect(b.replies).toHaveLength(1);
    expect(b.deferOpts).toEqual([]);
  });
});
```

Confirm `fakeButton` and `parkModule` are already imported at the top of `tests/park.test.ts`; add whichever is missing:

```ts
import { fakeButton } from './harness.js';
import { parkModule } from '../src/modules/park/index.js';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park.test.ts -t "default arm"`

Expected: FAIL. The first case fails on `expect(b.deferOpts).toEqual([{ kind: 'update' }])` receiving `[]` — the handler returns without acknowledging. The second case passes already; it exists to catch a regression introduced by the fix.

- [ ] **Step 3: Convert the if-chain to a switch with a default arm**

In `src/modules/park/index.ts`, the handler currently reads (abridged — keep every existing branch body byte-identical, only the control flow changes):

```ts
        const parts = i.customId.split(':');
        const [, action, uid, pageStr] = parts;
        if (action === 'assignyes' || action === 'assignno') { /* … */ return; }
        if (action === 'dinos') { /* … */ return; }
        if (action === 'tour') { /* … */ return; }
        if (action === 'landmark') { /* … */ }
```

Restructure to:

```ts
        const parts = i.customId.split(':');
        const [, action, uid, pageStr] = parts;
        // A real switch with a default arm, not a chain of equality checks that falls off
        // the end. An action nobody wrote a branch for — a stale id from an older deploy,
        // or a tab name that was renamed — used to return without acknowledging, and
        // Discord paints "This interaction failed" after 3 seconds. The default answers
        // with deferUpdate for the same reason the router's guard rejection does: a silent
        // ack is correct where a bare return is visibly broken, and a distinct text reply
        // would be an oracle. Any future park action MUST be added as its own case.
        switch (action) {
          case 'assignyes':
          case 'assignno': {
            /* existing body, unchanged */
            return;
          }
          case 'dinos': {
            /* existing body, unchanged */
            return;
          }
          case 'tour': {
            /* existing body, unchanged */
            return;
          }
          case 'landmark': {
            /* existing body, unchanged */
            return;
          }
          default:
            await i.deferUpdate();
            return;
        }
```

Note: the `park:collect` early-return above this block stays exactly where it is — it is matched on the whole customId before `parts` is computed, and must keep that position.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/park.test.ts -t "default arm"`

Expected: PASS, both cases.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`

Expected: PASS. Every existing `park:` button case still routes — the branch bodies are unchanged, only their enclosing control flow moved.

Run: `npm run typecheck`

Expected: no output, exit 0. A `switch` over a `string` needs no exhaustiveness annotation, so this should be clean.

- [ ] **Step 6: Update the repo conventions note**

In `CLAUDE.md`, find the paragraph describing `/park`'s subcommand `switch` (it begins "`/park`'s dispatch used to be a trap for the next subcommand"). Append:

```markdown
  The park COMPONENT handler had the same hole and got the same fix: its `action` chain is
  now a `switch` with a `default` arm that `deferUpdate()`s, because an unrecognised
  `park:*` action previously returned without acknowledging and Discord painted "This
  interaction failed" after 3 seconds. A stale id from an older deploy lands there. Any
  future park component action MUST be added as its own `case`.
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/park/index.ts tests/park.test.ts CLAUDE.md
git commit -m "Acknowledge unrecognised park component actions

The park component handler was an if-chain over the action segment with no
final else, so an action nobody wrote a branch for returned without
acknowledging and Discord painted 'This interaction failed' after three
seconds. Converted to a switch with a default arm that defers the update,
matching the fix /park's subcommand dispatch already received."
```

## Self-Review

**Spec coverage:** This plan implements §2.1 of `docs/superpowers/specs/2026-08-19-park-view-tabs-design.md` in full. Nothing else in that spec is in scope here.

**Placeholder scan:** The `/* existing body, unchanged */` markers in Step 3 are deliberate and are not placeholders — they instruct the implementer to preserve code that already exists verbatim rather than retype it, and retyping it would risk transcription errors in branch bodies that handle money (`park:landmark`) and escrow (`park:assignyes`). Every step that introduces *new* code shows that code in full.

**Type consistency:** `comp.execute(ctx, b.asInteraction() as never)` matches how existing direct-execute button tests in this repo call handlers whose parameter is `ButtonInteraction`. `deferOpts` entries carry `kind` per `tests/harness.ts:261-274`.
