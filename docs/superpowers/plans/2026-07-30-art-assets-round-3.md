# Art Assets Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give dinosaurs a face at a fixed art cost, cut 62 MB of embed art down to ~9 MB, and make the attached-file-must-be-referenced invariant structural instead of repeated at 27 call sites.

**Architecture:** Three independently shippable waves, ordered so each makes the next smaller. Wave 1 introduces `attach()` in `src/core/images.ts` and routes 27 of the 30 `assetImage` call sites through it — a pure refactor with no behaviour change, landing first so Wave 2 edits one helper instead of 27 sites. Wave 2 converts every file under `assets/images/` to WebP q95 and flips `assetImage`, `art.ts`, `fit-art.mjs` and the prompts doc to match. Wave 3 generates 8 archetype×diet dino images, deletes the dead `spriteRef` field from 31 files, and fills two empty thumbnail slots: the hatch reveal and non-boss battle stages.

**Tech Stack:** TypeScript ESM (NodeNext), discord.js v14, `@napi-rs/canvas`, drizzle + better-sqlite3 (synchronous), vitest, Higgsfield Nano Banana Pro via MCP for image generation.

## Global Constraints

- **ESM NodeNext:** every relative import carries a `.js` extension, including in tests.
- **Time and randomness** come from `ctx.now()` / `ctx.rng()`, never `Date.now()` / `Math.random()`.
- **DB access is synchronous** drizzle/better-sqlite3 (`.get()`/`.all()`/`.run()`) — never awaited.
- **Absent art is never an error.** `assetImage` returns `null` for a missing file and the embed renders without it; `ParkArt` fields are `null` and the renderer falls back. Every task must preserve this.
- **`renderParkPng` stays synchronous.** All PNG/WebP decoding happens in `loadParkArt()` at render-worker startup. `@napi-rs/canvas` decodes raster asynchronously but SVG synchronously — drawing a raster without `await img.decode()` silently yields a blank canvas with **no error**.
- **An uploaded file the current embed does not reference renders as a bare attachment card**, and an edit shipping no `files`/`attachments` clears the previous uploads. This is the invariant `attach()` exists to make unbreakable.
- **discord.js `MessagePayload` pushes into `options.attachments` and `create()` only shallow-copies**, so one payload object reaching two send sites accumulates duplicate ids. `finalPayload` in `src/modules/battles/index.ts` is the pattern to copy.
- **`rosterFor(stage, squadSize)`** is the single source of truth for which enemies are fielded and in what order. Never re-derive the boss by matching `speciesId`.
- **Never call `emojiTag` in a module-level constant**, and never pass `rarityEmoji(...)` to `ButtonBuilder.setEmoji` — it throws rather than degrading.
- **`assets/emojis/` is untouched by every wave.** The PNGs stay PNG because Discord's application-emoji upload expects it and the committed manifest hashes are SHA-256 of those exact bytes; the SVGs stay SVG because the park renderer needs synchronous decode.
- **`npm run build` does not typecheck tests.** Run `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) before every commit touching `tests/` or `scripts/`.
- **`npm run test:live` is the only real verification of image work** — bare-attachment cards, cleared attachments and broken `attachment://` references all render green offline. Required after Waves 2 and 3.
- **`npm run deploy-commands` and `npm run deploy-emojis` are NOT required** in any wave — no command builder and no emoji changes.
- **Attribution:** no commit message, PR body, code comment, or doc line may mention Claude, AI, an assistant, or any tool. All work is authored by the user.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `assets/images/dinos/<archetype>-<diet>.webp` × 8 | Archetype-keyed dino art. Keyed on fields every species already declares, so adding a species needs no new art. |

**Modified**

| Path | Change |
|---|---|
| `src/core/images.ts` | Gains `attach()`; `assetImage` switches to `.webp` and its `kind` union gains `'dinos'`. |
| 11 module files (27 call sites) | Attach-and-degrade idiom replaced by one `attach()` call each. |
| `src/modules/battles/embeds.ts` | Keeps 3 bespoke `assetImage` calls (F1/F4 contract); gains the non-boss archetype thumbnail. |
| `src/modules/hatchery/embeds.ts` | `revealPayload` gains the archetype thumbnail beside the rarity crack image. |
| `src/core/render/art.ts` | Park raster filenames switch to `.webp`. |
| `scripts/fit-art.mjs` | Emits WebP so regeneration produces the shipped format. |
| `src/data/types.ts` + 30 species files | `spriteRef` deleted. |
| `docs/assets/prompts.md` | File-target tables switch to `.webp`; gains the 8 dino prompts. |
| `assets/images/**` (40 files) | PNG → WebP q95. |

---

## Wave 1 — The attach helper

### Task 1: The `attach` helper

**Files:**
- Modify: `src/core/images.ts:1` (import), `src/core/images.ts:24` (append helper)
- Test: `tests/images.test.ts:1-5` (imports), `tests/images.test.ts:42` (insert new describe)

**Interfaces:**
- Consumes: `ImageRef { file: AttachmentBuilder; url: string }` and `assetImage(kind, name): ImageRef | null` — both already exported from `src/core/images.ts`.
- Produces: `attach(embed: EmbedBuilder, payload: { files?: AttachmentBuilder[] }, slot: 'image' | 'thumbnail', ref: ImageRef | null): void` — exported from `src/core/images.ts`. Null ref is a total no-op (does **not** create `payload.files`). Otherwise sets the slot AND appends `ref.file`. Every one of Task 2's 27 call sites depends on this exact signature and on append-not-assign semantics.

- [ ] **Step 1: Write the failing test**

First widen the existing imports at `tests/images.test.ts:1-5`. Replace lines 1-5:

```ts
import { describe, it, expect } from 'vitest';
import { Image, createCanvas } from '@napi-rs/canvas';
import { EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetImage, attach } from '../src/core/images.js';
```

Then insert this block immediately after line 42 (the `});` closing `describe('assetImage')`):

```ts
describe('attach', () => {
  const blank = () => ({ embed: new EmbedBuilder().setTitle('t'), payload: {} as { files?: AttachmentBuilder[] } });

  it('is a total no-op for a null ref — no slot set, no files key created', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'image', null);
    attach(embed, payload, 'thumbnail', null);
    expect(embed.toJSON().image).toBeUndefined();
    expect(embed.toJSON().thumbnail).toBeUndefined();
    // Absent, NOT []. preHatchPayload and the notify handlers assert files is undefined.
    expect('files' in payload).toBe(false);
    expect(payload.files).toBeUndefined();
  });

  it('sets the image slot and attaches its file together', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'image', assetImage('eggs', 'common'));
    expect(embed.toJSON().image?.url).toBe('attachment://common.png');
    expect(embed.toJSON().thumbnail).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['common.png']);
  });

  it('sets the thumbnail slot and attaches its file together', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'thumbnail', assetImage('eggs', 'common'));
    expect(embed.toJSON().thumbnail?.url).toBe('attachment://common.png');
    expect(embed.toJSON().image).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['common.png']);
  });

  it('appends rather than assigns, so two calls both survive in call order', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'thumbnail', assetImage('eggs', 'epic'));
    attach(embed, payload, 'image', assetImage('banners', 'eggs_incubator'));
    expect(embed.toJSON().thumbnail?.url).toBe('attachment://epic.png');
    expect(embed.toJSON().image?.url).toBe('attachment://eggs_incubator.png');
    expect(payload.files!.map((f) => f.name)).toEqual(['epic.png', 'eggs_incubator.png']);
  });

  it("appends onto a pre-initialised files array (revealPayload's shape)", () => {
    const embed = new EmbedBuilder().setTitle('t');
    const payload: { files: AttachmentBuilder[]; attachments: never[] } = { files: [], attachments: [] };
    attach(embed, payload, 'image', assetImage('hatch', 'rare-crack'));
    expect(payload.files.map((f) => f.name)).toEqual(['rare-crack.png']);
    expect(payload.attachments).toEqual([]);
  });

  it('a missing asset between two present ones leaves the others untouched', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'thumbnail', assetImage('eggs', 'epic'));
    attach(embed, payload, 'image', assetImage('banners', 'no-such-banner'));
    expect(embed.toJSON().thumbnail?.url).toBe('attachment://epic.png');
    expect(embed.toJSON().image).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['epic.png']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "attach"`
Expected: FAIL with `TypeError: attach is not a function` on every case in the new block (vitest transpiles without typechecking, so the missing named export resolves to `undefined` at call time rather than erroring at import).

- [ ] **Step 3: Write the implementation**

Change `src/core/images.ts:1` to pull `EmbedBuilder` in as a **type** (it is only used in the signature; `AttachmentBuilder` stays a value import because line 23 constructs it):

```ts
import { AttachmentBuilder, type EmbedBuilder } from 'discord.js';
```

Then append after the closing brace of `assetImage` (line 24):

```ts

// Sets an embed slot AND attaches the file, in one statement a caller cannot
// half-do. Round 2 shipped three attachment defects, each one a call site where
// "set the slot" and "attach the file" had drifted apart; behind this they
// cannot drift. A null ref (missing asset) is a total no-op — `files` is not
// even created, so an art-free payload never ships an empty attachment array.
// Appends rather than assigns: a second assignment would drop the first file
// and leave a dangling attachment:// URL in the embed.
export function attach(
  embed: EmbedBuilder,
  payload: { files?: AttachmentBuilder[] },
  slot: 'image' | 'thumbnail',
  ref: ImageRef | null,
): void {
  if (!ref) return;
  if (slot === 'image') embed.setImage(ref.url);
  else embed.setThumbnail(ref.url);
  (payload.files ??= []).push(ref.file);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts -t "attach"`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/core/images.ts tests/images.test.ts
git commit -m "feat(images): add attach helper binding embed slot to file upload"
```

---

### Task 2: Codemod the 27 call sites onto `attach`

**Files:**
- Create: `C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/0f545c9e-f0ef-4a4c-aac5-332ebd11d75b/scratchpad/attach-codemod.mjs` (throwaway, not committed)
- Modify: `src/core/notify.ts:8,62-64,78-80` · `src/modules/battles/embeds.ts:2,157-163` · `src/modules/care/index.ts:16,25-27,36-38` · `src/modules/expeditions/index.ts:13,25-27,77-83` · `src/modules/hatchery/embeds.ts:4,24-27,45-50,70-80` · `src/modules/hatchery/index.ts:10,35-37` · `src/modules/help/index.ts:3,87-91,111-113` · `src/modules/leaderboards/index.ts:6,42-44` · `src/modules/park/index.ts:22,36-39,59-62` · `src/modules/shop/index.ts:15,51-57,67-69,77-79,130-135` · `src/modules/trading/index.ts:18,60-63,126-129,141-143`
- Test: `tests/images.test.ts:1-4` (imports), `tests/images.test.ts` (append guard describe at end of file)

**Interfaces:**
- Consumes: `attach(embed, payload, slot, ref)` from Task 1.
- Produces: no new exports. Establishes the repo-wide invariant that `.files = [` appears nowhere in `src/`, enforced by the new guard test.

Verified counts (the spec's "21 assign / 6 append" is **wrong**): 30 `assetImage` call sites outside `images.ts`, of which **23 assign-fresh + 4 append = 27 convert**, and 3 are exceptions. The 4 appends are `src/modules/expeditions/index.ts:83`, `src/modules/battles/embeds.ts:163`, `src/modules/shop/index.ts:57`, `src/modules/hatchery/embeds.ts:80`.

- [ ] **Step 1: Write the failing test**

Change `tests/images.test.ts` node imports (lines 3-4 after Task 1's edit) to:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
```

Append this block at the very end of `tests/images.test.ts`:

```ts
function srcFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? srcFiles(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

describe('attach adoption', () => {
  // The point of attach() is that "set the slot" and "attach the file" cannot
  // drift apart. A hand-rolled `payload.files = [...]` IS that drift, and it
  // shipped three defects in round 2 — so the idiom is banned outright.
  // fightFrames' three deliberate exceptions build their arrays as locals
  // (`f1.files = files`), which does not match this pattern.
  it('no source file hand-assigns an embed payload files array', () => {
    const offenders: string[] = [];
    for (const file of srcFiles(resolve(process.cwd(), 'src'))) {
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, idx) => {
        if (/\.files\s*=\s*\[/.test(line)) offenders.push(`${file}:${idx + 1} ${line.trim()}`);
      });
    }
    expect(offenders, `use attach() instead of assigning files:\n${offenders.join('\n')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "hand-assigns"`
Expected: FAIL — `AssertionError: use attach() instead of assigning files: … expected [ 'src\core\notify.ts:64 …', … ] to deeply equal []`, listing **28** offenders (the 27 call sites plus the now-stale `// APPEND, never re-assign: a second \`payload.files = [...]\`` comment line in `src/modules/expeditions/index.ts:80`).

- [ ] **Step 3: Write the implementation**

Write the codemod to the scratchpad, then run it from the repo root. It matches only `const <ref> = <expr>;` immediately followed by `if (<ref>) { <embed>.setImage|setThumbnail(<ref>.url); <payload>.files = …; }`, which is why the three `fightFrames` exceptions (no `if` on the following line) are structurally excluded. Files are CRLF, so it normalises and restores line endings.

```js
// attach-codemod.mjs — one-shot; run from the repo root: node <path>/attach-codemod.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = [
  'src/core/notify.ts',
  'src/modules/battles/embeds.ts',
  'src/modules/care/index.ts',
  'src/modules/expeditions/index.ts',
  'src/modules/hatchery/embeds.ts',
  'src/modules/hatchery/index.ts',
  'src/modules/help/index.ts',
  'src/modules/leaderboards/index.ts',
  'src/modules/park/index.ts',
  'src/modules/shop/index.ts',
  'src/modules/trading/index.ts',
];

// const <ref> = <expr>;
// if (<ref>) { <embed>.setImage|setThumbnail(<ref>.url); <payload>.files = [<ref>.file]; }
//                                      ...or  <payload>.files = [...(<payload>.files ?? []), <ref>.file]; }
const IDIOM = /^([ \t]*)const (\w+) = (.+);\n[ \t]*if \(\2\) \{ (\w+)\.set(Image|Thumbnail)\(\2\.url\); (\w+)\.files = (?:\[\2\.file\]|\[\.\.\.\(\6\.files \?\? \[\]\), \2\.file\]); \}$/gm;

// Comments that documented the append invariant now enforced by attach() itself.
const STALE = [
  '            // APPEND, never re-assign: a second `payload.files = [...]` would drop\n'
    + '            // the banner and leave a dangling attachment:// URL in the embed.\n',
  '  // APPEND — a second assignment would drop the banner file.\n',
];

let total = 0;
for (const rel of FILES) {
  const raw = readFileSync(rel, 'utf8');
  const crlf = raw.includes('\r\n');
  const src = crlf ? raw.replaceAll('\r\n', '\n') : raw;
  let n = 0;
  let out = src.replace(IDIOM, (_m, indent, _ref, expr, embed, setter, payload) => {
    n += 1;
    return `${indent}attach(${embed}, ${payload}, '${setter === 'Image' ? 'image' : 'thumbnail'}', ${expr});`;
  });
  out = out.replace('import { assetImage } from', 'import { assetImage, attach } from');
  for (const c of STALE) out = out.replace(c, '');
  total += n;
  console.log(`${n}\t${rel}`);
  writeFileSync(rel, crlf ? out.replaceAll('\n', '\r\n') : out, 'utf8');
}
console.log(`total call sites converted: ${total}`);
if (total !== 27) { console.error(`EXPECTED 27, GOT ${total}`); process.exit(1); }
```

Run it:

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
node "C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/0f545c9e-f0ef-4a4c-aac5-332ebd11d75b/scratchpad/attach-codemod.mjs"
```

Expected per-file output: notify 2, battles/embeds 2, care 2, expeditions 3, hatchery/embeds 4, hatchery/index 1, help 2, leaderboards 1, park 2, shop 5, trading 3 — `total call sites converted: 27`. A non-27 total exits 1 and the codemod must be fixed, not worked around.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts -t "hand-assigns" && npx vitest run --reporter=dot`
Expected: PASS — guard reports 0 offenders, and the full suite is `Test Files 64 passed (64) / Tests 630 passed (630)` (623 baseline + Task 1's 6 + this guard) with **zero existing assertions edited**. In particular these tripwires stay green and prove the helper is right: `tests/hatchery.test.ts:94` (`p.files` toBeUndefined on the degrade path), `tests/notify-handlers.test.ts:54` (same on the notify path), `tests/hatchery.test.ts:116` (`toEqual(['epic.png','eggs_incubator.png'])` — order), `tests/expeditions.test.ts:98-140`, `tests/hatchery.test.ts:118-142`, `tests/battles-embeds.test.ts:231-253` (the three `mockImplementationOnce` call-order queues), `tests/battles-embeds.test.ts:229` (`toHaveLength(2)`), and `tests/battles-embeds.test.ts:76-77,115,164` (which fail if the three `fightFrames` exceptions were converted).

- [ ] **Step 5: Commit**

```bash
git add src/core/notify.ts src/modules/battles/embeds.ts src/modules/care/index.ts src/modules/expeditions/index.ts src/modules/hatchery/embeds.ts src/modules/hatchery/index.ts src/modules/help/index.ts src/modules/leaderboards/index.ts src/modules/park/index.ts src/modules/shop/index.ts src/modules/trading/index.ts tests/images.test.ts
git commit -m "refactor: route all 27 art call sites through attach"
```

---

### Task 3: Tidy the converted sites and annotate the three exceptions

**Files:**
- Modify: `src/modules/help/index.ts:88-90`, `src/modules/help/index.ts:92-96`, `src/modules/battles/embeds.ts:44-46`
- Test: `tests/help.test.ts` (existing, unchanged — re-run as the regression gate)

**Interfaces:**
- Consumes: `attach(...)` call sites produced by Task 2.
- Produces: nothing new. Removes the codemod's leftover brace block and records why `fightFrames` opts out, so Wave 2/3 do not "finish the job" by converting the exceptions.

- [ ] **Step 1: Write the failing test**

No new test. The behaviour is already pinned by `tests/help.test.ts:35-54`, which loops every `HELP_TOPICS` entry with art and asserts both `image.url` and that `files` contains the same name. Capture the pre-edit green baseline so any regression in Step 4 is unambiguous.

Run: `npx vitest run tests/help.test.ts tests/battles-embeds.test.ts --reporter=dot`
Expected: PASS (baseline before touching these files).

- [ ] **Step 2: Run test to verify it fails**

There is no failing state to demonstrate — this task removes a redundant brace block and adds comments, neither of which is observable. The guard from Task 2 (`no source file hand-assigns an embed payload files array`) is the standing machine gate for this area; confirm it is green before editing so Step 4's result is attributable.

Run: `npx vitest run tests/images.test.ts -t "hand-assigns"`
Expected: PASS (1 passed) — the invariant Task 2 established is intact going in.

- [ ] **Step 3: Write the implementation**

In `src/modules/help/index.ts`, collapse the block the codemod left behind. Replace:

```ts
          if (t.art) {
            attach(embed, payload, 'image', assetImage(t.art.kind, t.art.name));
          }
```

with:

```ts
          if (t.art) attach(embed, payload, 'image', assetImage(t.art.kind, t.art.name));
```

Still in `src/modules/help/index.ts`, extend the comment on the park branch to record the live hazard — `withParkImage` rebuilds `files` from scratch, so it would silently drop any art `attach` just added. Replace:

```ts
          if (topic === 'park') {
            // The park topic illustrates itself with the reader's own map: a worker
            // render, so defer first and degrade to the text-only embed on any
            // failure (including "this reader has no park row yet").
```

with:

```ts
          if (topic === 'park') {
            // The park topic illustrates itself with the reader's own map: a worker
            // render, so defer first and degrade to the text-only embed on any
            // failure (including "this reader has no park row yet").
            // withParkImage ASSIGNS files: [park.png], so it would drop anything
            // attach() put on this payload. Safe only because HELP_TOPICS.park
            // declares no `art` — give it art and the banner vanishes silently.
```

In `src/modules/battles/embeds.ts`, mark the three opt-outs. Replace:

```ts
  if (!stage) throw new Error(`Unknown stage: ${outcome.stageId}`);
  const banner = assetImage('sites', `${stage.chapterId}-banner`);
```

with:

```ts
  if (!stage) throw new Error(`Unknown stage: ${outcome.stageId}`);
  // These three refs deliberately do NOT use attach(): each is dressed onto up to
  // three different embeds and the files are then distributed across two payloads
  // by the F1/F4 contract below, which attach's one-embed-one-payload shape cannot
  // express. Everywhere else in the repo, attach() is mandatory.
  const banner = assetImage('sites', `${stage.chapterId}-banner`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/help.test.ts tests/battles-embeds.test.ts tests/images.test.ts --reporter=dot`
Expected: PASS — same counts as Step 1's baseline, no assertion changes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/help/index.ts src/modules/battles/embeds.ts
git commit -m "refactor: tidy converted art sites, document fightFrames opt-out"
```

---

### Task 4: Document the `attach` contract in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:40-42`

**Interfaces:**
- Consumes: `attach` from Task 1, the guard test from Task 2, the exception comment from Task 3.
- Produces: the binding repo convention Waves 2 and 3 read before adding any new art call site (`'dinos'` kind, hatch-reveal thumbnail, non-boss battle thumbnail).

- [ ] **Step 1: Write the failing test**

No test — CLAUDE.md is prose. The enforcement for this convention is the machine guard already added in Task 2 (`tests/images.test.ts` → `no source file hand-assigns an embed payload files array`); this task writes down the *why* the guard cannot express. Confirm the guard is the live enforcement before documenting it as such.

Run: `npx vitest run tests/images.test.ts -t "hand-assigns"`
Expected: PASS (1 passed) — the claim the doc is about to make is true.

- [ ] **Step 2: Run test to verify it fails**

Not applicable — a documentation edit has no failing state. Instead verify the doc's factual claims against the tree, so nothing written is stale:

Run: `grep -rn "\.files = \[" src/ | wc -l && grep -rn "attach(" src/ --include=*.ts | grep -v "core/images.ts" | wc -l`
Expected: `0` then `27` — exactly the numbers the CLAUDE.md entry will assert.

- [ ] **Step 3: Write the implementation**

In `CLAUDE.md`, replace lines 40-42:

```
- Embed art ships from `assets/images/` via `assetImage` (`src/core/images.ts`);
  a missing file means the embed renders without the image — absent art is
  never an error. Generation prompts live in `docs/assets/prompts.md`.
```

with:

```
- Embed art ships from `assets/images/` via `assetImage` (`src/core/images.ts`);
  a missing file means the embed renders without the image — absent art is
  never an error. Generation prompts live in `docs/assets/prompts.md`.
  **Always wire art with `attach(embed, payload, slot, assetImage(...))`** — it
  sets the embed slot and appends the file together, so the two can never drift
  apart (that drift shipped three attachment defects in round 2). A null ref is
  a total no-op: `payload.files` is not even created, so an art-free payload
  never ships an empty attachment array — `tests/hatchery.test.ts` and
  `tests/notify-handlers.test.ts` both assert `files` is `undefined`, not `[]`.
  `attach` APPENDS, so two calls on one payload both survive and **call order is
  upload order**: several tests pin `files.map((f) => f.name)` with `toEqual`,
  and three mock `assetImage` as a `mockImplementationOnce` queue keyed on
  1st-call/2nd-call identity, so never reorder the calls, never hoist the
  lookups above them, and never collect refs into an array first. A ternary that
  guards on *domain data* (`best ? assetImage(...) : null` in shop,
  `featured ? … : null` in hatchery) stays outside `attach` — it is not an
  asset miss. `tests/images.test.ts`'s "no source file hand-assigns an embed
  payload files array" guard bans the old `payload.files = [...]` idiom outright.
  The only exceptions are the three refs at the top of `fightFrames`
  (`src/modules/battles/embeds.ts`), which dress one ref onto several embeds and
  split the files across two payloads via the F1/F4 contract — do not convert
  them. Separately, `withParkImage` (`src/modules/park/embeds.ts`) *assigns*
  `files`, so it drops anything `attach` added to the payload it wraps; only
  `/help topic:park` pipes a payload through it, and that topic has no art.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts --reporter=dot`
Expected: PASS — 13 passed in this file (7 `assetImage` + 6 `attach`) plus the adoption guard, i.e. the documented invariants are all machine-checked where they can be.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the attach contract and its fightFrames exception"
```

---

### Task 5: Wave 1 gates

**Files:**
- Modify: none — verification only.
- Test: whole suite

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: a green baseline of **630 tests across 64 files** for Wave 2 to build on, and the confirmed guarantee that Wave 2 changes `assetImage`'s extension in exactly one place rather than at 30 call sites.

- [ ] **Step 1: Write the failing test**

No new test. This task's job is to run the three gates in the order CLAUDE.md mandates. Start with the test-inclusive typecheck, because `npm run build` only `include`s `src` and `npm test` transpiles without typechecking — a type error in `tests/` or `scripts/` passes both of those silently and would otherwise escape the wave.

Run: `npm run typecheck`
Expected: PASS — no output, exit 0. A failure here most likely means `revealPayload`'s return type in `src/modules/hatchery/embeds.ts` was widened to `files?:` — it must stay required `files: AttachmentBuilder[]`, because `tests/hatchery.test.ts:102` calls `p.files.map(...)` without `!`.

- [ ] **Step 2: Run test to verify it fails**

Not applicable — Wave 1 is a pure refactor whose acceptance evidence is that **nothing** fails. Prove the tree is exactly the intended change and nothing else drifted:

Run: `git status --porcelain && git diff --stat main...HEAD`
Expected: clean working tree; the diff touches only `src/core/images.ts`, `src/core/notify.ts`, the 9 module files, `tests/images.test.ts`, and `CLAUDE.md` — and **no other test file appears**, which is the wave's central claim (zero existing assertions changed).

- [ ] **Step 3: Write the implementation**

No code. Run the remaining two gates:

```bash
npm test
npm run build
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test && npm run build`
Expected: PASS — `Test Files 64 passed (64)` / `Tests 630 passed (630)` (623 baseline + 6 `attach` cases + 1 adoption guard), then `tsc` exits 0 with no output.

`npm run test:live` is **NOT required for Wave 1.** The spec gates it on waves 2 and 3 only. Wave 1 changes no asset bytes, no filename, no embed URL, and no command builder — every `attachment://` URL and every uploaded file is byte-identical to `main`, so there is nothing cosmetic for a live post to reveal. `npm run deploy-commands` is likewise not needed (no builder changed) and neither is `npm run deploy-emojis`. Waves 2 and 3 both require `test:live`, and Wave 2 requires it as a hard gate since Discord's WebP rendering is the one thing the offline suite cannot prove.

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "chore: verify wave 1 gates green at 630 tests"
```

---

## Wave 2 — WebP conversion

### Task 6: WebP asset conversion and path-builder flip

**Files:**
- Create: `C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/0f545c9e-f0ef-4a4c-aac5-332ebd11d75b/scratchpad/convert-webp.mjs` (one-off, never committed)
- Modify: `assets/images/**` — 40 `.png` deleted, 40 `.webp` added
- Modify: `src/core/images.ts:20`
- Modify: `src/core/render/art.ts:35-37,46,59-63`
- Test: `tests/images.test.ts` (new guard + 8 flips), `tests/park-art-assets.test.ts`, `tests/render-park-art.test.ts`, and 12 further test files flipped by scoped sed

**Interfaces:**
- Consumes: `assetImage(kind: 'eggs'|'sites'|'banners'|'battles'|'hatch', name: string): ImageRef | null`; `ImageRef { file: AttachmentBuilder; url: string }`
- Produces: `assetImage` builds `${name}.webp`; every `attachment://` URL and `files[].name` in the tree ends `.webp`; `loadRasterImage(absPath: string): Promise<Image | null>` (renamed from `loadPngImage`); `decodeRaster(bytes: Buffer): Promise<Image>` in `tests/park-art-assets.test.ts`; all 40 assets are `assets/images/<kind>/<name>.webp`

This task is atomic on purpose: the assets and the extension are inseparable, so the intermediate states are contained inside the task and only the final green state is committed.

- [ ] **Step 1: Write the failing test**

Append to `tests/images.test.ts` (end of file — `RARITIES` at line 82 and the `CAMPAIGN` import must be in scope), and change the `node:fs` import on line 3 to `import { readdirSync, readFileSync } from 'node:fs';`:

```ts
// A half-finished conversion is SILENT: assetImage null-degrades, so an asset that
// never converted just renders imageless and every payload assertion still passes.
// This is the gate for that. Read-only by necessity — never writeFileSync/rmSync
// under assets/images (CLAUDE.md: vitest runs test files in parallel forks, so one
// file can observe or delete another's committed asset mid-run).
describe('the committed asset set', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]));

  it('ships every file under assets/images as .webp', () => {
    const files = walk(resolve(process.cwd(), 'assets/images'))
      .filter((f) => !f.endsWith('.gitkeep'));
    expect(files.length, 'no assets found — wrong root?').toBeGreaterThan(0);
    const stragglers = files.filter((f) => !f.endsWith('.webp'));
    expect(stragglers.map((f) => f.split('assets')[1]), 'non-WebP assets remain').toEqual([]);
  });

  it('resolves every asset kind the bot references', () => {
    for (const r of RARITIES) {
      expect(assetImage('eggs', r), `eggs/${r}`).not.toBeNull();
      expect(assetImage('hatch', `${r}-crack`), `hatch/${r}-crack`).not.toBeNull();
    }
    for (const c of CAMPAIGN) {
      expect(assetImage('sites', `${c.id}-banner`), `sites/${c.id}-banner`).not.toBeNull();
      expect(assetImage('sites', `${c.id}-thumb`), `sites/${c.id}-thumb`).not.toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "ships every file under assets/images as .webp"`
Expected: FAIL — `non-WebP assets remain: expected [ '/images/banners/battle_defeat.png', …40 entries… ] to deeply equal []`

- [ ] **Step 3: Write the conversion script**

Write to the scratchpad (NOT `scripts/` — it runs once). It cannot bare-import `@napi-rs/canvas` from outside the repo, so it resolves the package by absolute path:

```js
// One-off: assets/images/**/*.png -> .webp q95, originals deleted.
import { readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node convert-webp.mjs <repo-root>'); process.exit(2); }
const { createCanvas, Image } = await import(
  pathToFileURL(resolve(ROOT, 'node_modules/@napi-rs/canvas/index.js')).href
);

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

const pngs = walk(resolve(ROOT, 'assets/images')).filter((f) => f.endsWith('.png'));
const expected = [];
let before = 0, after = 0;

for (const src of pngs) {
  const srcBytes = statSync(src).size;
  const img = new Image();
  img.src = readFileSync(src);
  await img.decode();          // load-bearing: a same-tick draw encodes a BLANK canvas, silently
  if (!img.width || !img.height) { console.error(`decode failed: ${src}`); process.exit(1); }
  const canvas = createCanvas(img.width, img.height);   // SOURCE dims — park/ground has no exact-size test
  canvas.getContext('2d').drawImage(img, 0, 0);
  const buf = canvas.toBuffer('image/webp', 95);
  const dest = src.replace(/\.png$/, '.webp');
  writeFileSync(dest, buf);
  rmSync(src);
  expected.push([dest, img.width, img.height]);
  before += srcBytes; after += buf.length;
  console.log(`${dest.slice(ROOT.length + 1)}  ${img.width}x${img.height}  ${srcBytes} -> ${buf.length}`);
}

// Re-decode every output: proves the bytes are real, not a blank canvas that
// still reports the right dimensions, and that nothing was resized.
for (const [dest, w, h] of expected) {
  const v = new Image();
  v.src = readFileSync(dest);
  await v.decode();
  if (v.width !== w || v.height !== h) { console.error(`DIM MISMATCH ${dest}`); process.exit(1); }
}
console.log(`\nconverted ${expected.length} files: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
```

Run it:

```bash
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/0f545c9e-f0ef-4a4c-aac5-332ebd11d75b/scratchpad"
node "$SCRATCH/convert-webp.mjs" "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
```

Expected: `converted 40 files: ~62 MB -> ~9 MB`, and `assets/images/battles/.gitkeep` untouched.

- [ ] **Step 4: Flip the two path builders**

`src/core/images.ts:20` — the single edit that propagates to every `attachment://` URL:

```ts
  const fileName = `${name}.webp`;
```

`src/core/render/art.ts` — three edits. Comment (lines 35-37):

```ts
// SVG only. @napi-rs/canvas decodes SVG buffers synchronously, so there is nothing to await — which
// is what lets the synchronous renderer draw these. A raster (PNG or WebP) through this path would
// silently draw a blank rectangle with no error (see CLAUDE.md); use the internal raster loader in
// loadParkArt for those.
```

Loader (line 46):

```ts
// WebP decodes asynchronously exactly like PNG — verified: setting `src` and drawing in the same
// tick yields an all-zero canvas. The await below is load-bearing, not ceremony.
async function loadRasterImage(absPath: string): Promise<Image | null> {
```

Call sites (lines 59-63):

```ts
  const raster = (name: string) => loadRasterImage(resolve(process.cwd(), 'assets/images/park', name));
  const svg = (name: string) => loadSvgImage(resolve(process.cwd(), 'assets/emojis/svg', `${name}.svg`));

  const [ground, platePaddock, plateFacility] = await Promise.all([
    raster('ground.webp'), raster('plate-paddock.webp'), raster('plate-facility.webp'),
  ]);
```

- [ ] **Step 5: Flip the 15 test files by scoped sed**

103 `.png` occurrences across exactly these 15 files. Verified safe: none of them contains `park.png`, an `assets/emojis/png` path, or the PNG magic-byte assertion. `tests/docs-assets.test.ts` is deliberately EXCLUDED — it must move in lockstep with `prompts.md` in Task 8.

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
sed -i 's/\.png/.webp/g' \
  tests/battles-embeds.test.ts tests/battles-module.test.ts tests/care.test.ts \
  tests/dinos.test.ts tests/expeditions.test.ts tests/hatchery.test.ts \
  tests/help.test.ts tests/images.test.ts tests/journeys.test.ts \
  tests/leaderboards.test.ts tests/notify-handlers.test.ts tests/park-art-assets.test.ts \
  tests/render-park-art.test.ts tests/shop.test.ts tests/trading.test.ts
grep -c "\.webp" tests/battles-embeds.test.ts   # expect 21
```

This covers both regexes (`/^battle_(victory|defeat)\.webp$/` in `battles-module.test.ts:56`, the five-rarity alternation in `shop.test.ts:101`) and `tests/battles-embeds.test.ts:32`'s fabricated mock filename — mock and its 18 assertions flip in the same pass, which is the only safe way to move that file.

- [ ] **Step 6: Rename the two PNG-specific decode helpers**

sed matched only `.png`, so these identifiers and prose comments survive it. In `tests/park-art-assets.test.ts` replace lines 8-15:

```ts
// Raster decode (PNG and WebP alike) is async in @napi-rs/canvas: an un-awaited decode reports the
// right width/height while the pixels are still blank, so dimension checks alone would pass on a
// truncated download.
async function decodeRaster(bytes: Buffer): Promise<Image> {
  const i = new Image();
  i.src = bytes;
  await i.decode();
  return i;
}
```

then update its two call sites:

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
sed -i 's/decodePng(/decodeRaster(/g' tests/park-art-assets.test.ts
sed -i 's|// PNG decode is async — drawing|// raster decode is async — drawing|' tests/images.test.ts
grep -n "decodePng\|PNG decode is async" tests/park-art-assets.test.ts tests/images.test.ts   # expect no output
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts tests/park-art-assets.test.ts tests/render-park-art.test.ts`
Expected: PASS — including `ships every file under assets/images as .webp` and `resolves every asset kind the bot references`. `render-park-art.test.ts:61-62` is the real functional gate on the `art.ts` rename: a filename mismatch fails there with `assets/images/park/ground.webp missing or undecodable`.

Then confirm no straggler outside the protected set:

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
grep -rl "\.png" --include=*.ts --include=*.mjs src tests scripts | wc -l   # expect 39
```

39 = 30 species `spriteRef` files (dead data, Wave 3 deletes them — never sed these) + `src/build-emojis.ts`, `src/deploy-emojis.ts`, `src/core/render/client.ts`, `src/modules/park/embeds.ts`, `scripts/render-smoke.mjs`, `tests/emoji-assets.test.ts`, `tests/notify.test.ts`, `tests/park-view-image.test.ts`, `tests/render-draw.test.ts`. All are `park.png` (the render OUTPUT buffer), `assets/emojis/png/`, or synthetic fixtures — all correctly still PNG.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS — 64 files, 623 tests, plus the 2 new guards = 625.

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
git add assets/images src/core/images.ts src/core/render/art.ts tests/
git commit -m "Convert embed art to WebP q95"
```

Git will record this as 40 deletions + 40 additions rather than renames — the binary content differs entirely. That is expected; the spec keeps no PNG originals.

---

### Task 7: fit-art.mjs emits WebP q95

**Files:**
- Modify: `scripts/fit-art.mjs:2-3,16,30,85`
- Test: none — this script has zero automated coverage (it is `.mjs`, so `tsconfig.test.json` never sees it and no vitest file imports it). Verified by a real smoke run instead.

**Interfaces:**
- Consumes: nothing from Task 6 (standalone build-time script)
- Produces: `node scripts/fit-art.mjs banner|cutout <src> <dest.webp>` writes WebP q95, so Wave 3's 8 dino cutouts land in the shipped format directly

- [ ] **Step 1: Write the failing test**

There is no test harness for this script, so the check is a real smoke run against a converted asset. Establish the current (wrong) behaviour first:

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/0f545c9e-f0ef-4a4c-aac5-332ebd11d75b/scratchpad"
node scripts/fit-art.mjs banner assets/images/banners/trading.webp "$SCRATCH/smoke.webp"
node -e "const b=require('fs').readFileSync(process.argv[1]); console.log('magic:', b.subarray(0,4).toString('ascii'), b.subarray(8,12).toString('ascii'), 'bytes:', b.length)" "$SCRATCH/smoke.webp"
```

- [ ] **Step 2: Run test to verify it fails**

Expected: the file is named `.webp` but the magic reads `\x89PNG` — output is `magic: \x89PNG   bytes: 2564xxx`, i.e. a PNG wearing a WebP extension, and roughly 6× the size it should be.

- [ ] **Step 3: Write the implementation**

Four edits to `scripts/fit-art.mjs`. Header (lines 2-3):

```js
//   node scripts/fit-art.mjs banner <src> <dest>   -> 1536x1024, cover-scaled, center-cropped, WebP q95
//   node scripts/fit-art.mjs cutout <src> <dest>   -> 1024x1024 transparent, defringed and centered, WebP q95
```

Usage string (line 16) — the source is still whatever the generator emitted, usually PNG, so only the destination is claimed as WebP:

```js
  console.error('usage: node scripts/fit-art.mjs <banner|cutout> <src> <dest.webp>');
```

Add the quality constant immediately below the arg destructure (after line 18), so the number appears once and matches `prompts.md`:

```js
// q95 is the committed setting for every asset under assets/images (83-87% off PNG,
// visually indistinguishable at the sizes Discord renders). Keep in sync with prompts.md.
const Q = 95;
```

Then both writes (lines 30 and 85):

```js
  writeFileSync(dest, canvas.toBuffer('image/webp', Q));
```

```js
writeFileSync(dest, out.toBuffer('image/webp', Q));
```

Line 22's `await img.decode()` on the source stays — decode is async for PNG and WebP alike.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/0f545c9e-f0ef-4a4c-aac5-332ebd11d75b/scratchpad"
node scripts/fit-art.mjs banner assets/images/banners/trading.webp "$SCRATCH/smoke.webp"
node scripts/fit-art.mjs cutout assets/images/eggs/mythic.webp "$SCRATCH/smoke-cut.webp"
node -e "
const {readFileSync}=require('fs');
for (const f of process.argv.slice(1)) {
  const b=readFileSync(f);
  console.log(f.split(/[\\\\/]/).pop(), b.subarray(0,4).toString('ascii'), b.subarray(8,12).toString('ascii'), b.length);
}" "$SCRATCH/smoke.webp" "$SCRATCH/smoke-cut.webp"
rm -f "$SCRATCH/smoke.webp" "$SCRATCH/smoke-cut.webp"
```

Expected: PASS — both report magic `RIFF` / `WEBP`, banner ~0.4 MB and cutout ~0.1 MB. Nothing under `assets/images/` was written.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
git add scripts/fit-art.mjs
git commit -m "Emit WebP q95 from fit-art.mjs"
```

---

### Task 8: Regeneration targets in prompts.md

**Files:**
- Modify: `docs/assets/prompts.md` (45 `.png` occurrences + a new Output format note)
- Test: `tests/docs-assets.test.ts:21`

**Interfaces:**
- Consumes: the `.webp` asset set from Task 6; `toBuffer('image/webp', 95)` from Task 7
- Produces: `prompts.md` file-target rows naming `assets/images/**/*.webp`, so Wave 3's `dinos/<archetype>-<diet>.webp` rows slot into an already-WebP table

- [ ] **Step 1: Write the failing test**

Flip the three literal paths in `tests/docs-assets.test.ts:21` — this is the only machine gate on the park rows:

```ts
  it('prompts.md carries a regeneration target for every generated park raster', () => {
    for (const f of ['park/ground.webp', 'park/plate-paddock.webp', 'park/plate-facility.webp']) {
      expect(prompts, `prompts.md is missing the regeneration target ${f}`).toContain(f);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docs-assets.test.ts -t "prompts.md carries a regeneration target"`
Expected: FAIL — `prompts.md is missing the regeneration target park/ground.webp`

- [ ] **Step 3: Write the implementation**

A global replace is safe here: `prompts.md` contains 45 `.png` occurrences and **zero** references to `assets/emojis/png/` (verified). Every remaining hit names a committed asset, including the reference-chain mentions (`eggs/mythic.png`, `eggs/<rarity>.png`, `common.png`), all of which are now WebP.

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
sed -i 's/\.png/.webp/g' docs/assets/prompts.md
grep -c "\.png" docs/assets/prompts.md   # expect 0
```

Then add an Output format note directly after the File targets table (immediately before the line beginning `Banner = wide establishing shot of the site.`). This is the prose the sed cannot write, and it keeps the two post-processing walkthroughs honest — the pipelines described at "Post-processing (each of the six)" and in the hatch-crack Workflow hand a *generator* output to `remove_background`, and that intermediate is still whatever the generator emitted:

```markdown
**Output format.** Every committed file under `assets/images/` is **WebP, quality 95**,
encoded through `@napi-rs/canvas`'s `canvas.toBuffer('image/webp', 95)` — an 83-87%
saving over PNG that is indistinguishable at the sizes Discord renders.
`scripts/fit-art.mjs` emits it directly, so both modes write the shipped format and no
separate conversion step is needed. Intermediates are exempt: a generator's output and
the `remove_background` result in the walkthroughs below are whatever the tool produced
(usually PNG), and only the final write is WebP. `assets/emojis/png/` is **not** WebP —
Discord's application-emoji upload expects PNG and `manifest.json` hashes those exact
bytes — and `assets/emojis/svg/` stays SVG because the park renderer decodes it
synchronously.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docs-assets.test.ts`
Expected: PASS — both tests. The emoji-count test above it is unaffected (it matches digits before the word "emojis", not extensions), and `tests/battle-content.test.ts` greps `prompts.md` for bare `bossId` values with no extension, so it stays green too.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
git add docs/assets/prompts.md tests/docs-assets.test.ts
git commit -m "Update regeneration targets to WebP"
```

---

### Task 9: Repo conventions and stale production comments

**Files:**
- Modify: `CLAUDE.md:89-98,136,180-181,191`
- Modify: `src/modules/care/index.ts:18-19`, `src/modules/battles/index.ts:43`, `src/data/battle/chapters/index.ts:11`
- Test: `npm run typecheck` (comments only — no behaviour, no test assertions)

**Interfaces:**
- Consumes: the converted asset set and both renamed loaders from Task 6
- Produces: the recorded convention that `assets/images/**` is WebP q95 while `assets/emojis/png/` stays PNG and `park.png` stays a PNG render output — the rule Wave 3's 8 dino assets inherit

- [ ] **Step 1: Write the failing test**

No test asserts comment text. The gate is the standing "documentation tracks the code" rule, so the failing state is demonstrated by grepping for the now-false claims:

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
grep -n "assets/images/park/\*\.png\|<bossId>-portrait\.png\|<rarity>-crack\.png\|care_neglect\.png\|<chapter>-banner\.png" CLAUDE.md src/modules/care/index.ts src/modules/battles/index.ts src/data/battle/chapters/index.ts
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — 6 hits naming `.png` paths that no longer exist on disk (`CLAUDE.md:96,180,191`, `src/modules/care/index.ts:18-19`, `src/modules/battles/index.ts:43`, `src/data/battle/chapters/index.ts:11`).

- [ ] **Step 3: Write the implementation**

`CLAUDE.md` lines 89-98 — widen the async-decode note. This is the load-bearing edit of the task: leaving it saying "PNG" invites a future reader to treat the rename as licence to drop the `await` and get a blank park map with no error.

```markdown
- `@napi-rs/canvas` decodes **raster** buffers asynchronously — PNG **and WebP**
  alike. Setting `Image.src` from raster bytes and drawing in the same tick
  silently yields a blank canvas, with no error. Always `await img.decode()`
  before drawing one. **SVG** buffers decode synchronously, which is why
  `renderSvg` needs no await and why every icon the park renderer draws (HUD
  coin, lot icons, rarity dino chips) is read from `assets/emojis/svg/*.svg`
  rather than a raster. That asymmetry is what splits `src/core/render/art.ts`
  in two: `loadSvgImage` is synchronous, the three `assets/images/park/*.webp`
  rasters are `await img.decode()`d inside `loadRasterImage`, and
  `renderParkPng(snap, art = EMPTY_ART)` **stays synchronous** — never move a
  raster decode into it.
```

Line 136: `chapter file + index import + PNGs + prompt rows` becomes `chapter file + index import + WebPs + prompt rows`.

Lines 180-181 and 191:

```markdown
  `src/core/images.ts`); `hatch/<rarity>-crack.webp` is the hatch-reveal image and
  its attachment name never collides with `eggs/<rarity>.webp`. Banners are
```

```markdown
  (`boss-<siteId>-portrait.webp`, 1024×1024 transparent cutouts pinned by
```

Add a new bullet after the widened decode bullet:

```markdown
- Every file under `assets/images/` is **WebP q95** — `assetImage`
  (`src/core/images.ts`) is the only path builder for them and appends `.webp`,
  so flipping the format there propagates to every `attachment://` URL and every
  `files[].name`. `scripts/fit-art.mjs` emits the same format. Three things are
  deliberately NOT WebP: `assets/emojis/png/` (Discord's app-emoji upload expects
  PNG and `manifest.json` hashes those exact bytes), `assets/emojis/svg/` (the
  park renderer needs synchronous decode), and `park.png` — the `/park view`
  render OUTPUT buffer from `renderParkPng`, which is an in-memory PNG, not an
  asset. `tests/images.test.ts` guards that nothing under `assets/images/`
  regresses to another format.
```

Then the three production comments. `src/modules/care/index.ts:18-19`:

```ts
// Care replies carry a banner: care_neglect.webp when any of the player's non-escaped
// dinos has gone unfed past the VERY HUNGRY threshold, care.webp otherwise.
```

`src/modules/battles/index.ts:43`:

```ts
// restores an embed pointing at attachment://<chapter>-banner.webp that no longer
```

`src/data/battle/chapters/index.ts:11`:

```ts
  bossId: string;        // derives assets/images/battles/<bossId>-portrait.webp
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
grep -rn "assets/images.*\.png" CLAUDE.md src/   # expect no output
npm run typecheck
```

Expected: PASS — the grep returns nothing and typecheck is clean. The 30 `src/data/species/*.ts` `spriteRef: '<name>.png'` values do NOT match that grep (they carry a bare filename, not an `assets/images` path) and must stay untouched — they are dead data that Wave 3 deletes wholesale.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
git add CLAUDE.md src/modules/care/index.ts src/modules/battles/index.ts src/data/battle/chapters/index.ts
git commit -m "Document the WebP asset format"
```

---

### Task 10: Wave gates

**Files:**
- Modify: none — verification only
- Test: the full suite, plus the live REST gate

**Interfaces:**
- Consumes: everything from Tasks 6-9
- Produces: a green wave; `assets/images/**/*.webp` and the `.webp`-building `assetImage` that Wave 3 extends with the `'dinos'` kind

- [ ] **Step 1: Run the typecheck gate**

Run: `npm run typecheck`
Expected: PASS. This is the test-inclusive gate (`tsc --noEmit -p tsconfig.test.json`) — `npm run build` only covers `src`, and vitest transpiles without typechecking, so a type error in the 16 edited test files shows up here and nowhere else. The `decodePng` → `decodeRaster` and `loadPngImage` → `loadRasterImage` renames are exactly the kind of change this catches.

- [ ] **Step 2: Run the full offline suite**

Run: `npm test`
Expected: PASS — 64 files, 625 tests (623 baseline + the 2 new guards in `tests/images.test.ts`).

- [ ] **Step 3: Run the build gate**

Run: `npm run build`
Expected: PASS — clean `tsc` against `tsconfig.json`.

- [ ] **Step 4: Run the live gate**

Run: `npm run test:live`
Expected: the payload gallery posts to `TEST_CHANNEL_ID` with every embed rendering its art.

**This gate is REQUIRED for this wave, not optional.** The spec names it as risk #1: every offline test passes regardless of what Discord does with WebP, so this is the only verification that Discord renders the format at all. `scripts/test-live.ts` needs no code change — it reads `f.attachment` as a path and posts `f.name`, so WebP flows through untouched. Eyeball specifically:

- a boss portrait in the `setThumbnail` slot (transparent background over the viewer's theme — the case most likely to expose an alpha or matte problem),
- `/expedition claim` (banner + thumb on one embed, the worst-case payload, now ~0.6 MB instead of 4.65 MB),
- the `/park view` map, which exercises `loadParkArt`'s renamed WebP loader end to end.

If any embed renders imageless, the cause is `assetImage` null-degrading on a filename mismatch, not a Discord format rejection — check the file exists at `assets/images/<kind>/<name>.webp`.

- [ ] **Step 5: Confirm the wave is complete and the tree is clean**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
git status --porcelain          # expect no output
git log --oneline -4            # expect the four wave-2 commits
find assets/images -type f ! -name '*.webp' ! -name '.gitkeep' | wc -l   # expect 0
```

Expected: a clean tree, four commits (`Convert embed art to WebP q95`, `Emit WebP q95 from fit-art.mjs`, `Update regeneration targets to WebP`, `Document the WebP asset format`), and zero non-WebP assets. Nothing new to commit — this task only verifies. `npm run deploy-commands` and `npm run deploy-emojis` are **not** needed: no command builder and no emoji changed.

---

## Wave 3 — Dino archetype art

### Task 11: Dino archetype prompts in `docs/assets/prompts.md`

**Files:**
- Modify: `docs/assets/prompts.md` (insert a new `## Dino archetypes` section between `## Battle bosses` and `## Park map`; add one row to the divergence table in `## Egg rarities`)
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: nothing (Waves 1 and 2 are already merged; `assetImage` already emits `.webp`)
- Produces: `DINO_ART_KEYS` — the 8 `${archetype}-${diet}` strings, derived exhaustively from the `Archetype`/`Diet` unions inside `tests/images.test.ts`; the prompt frame + 8 `{DINO}` substitutions that Task 12 generates from

- [ ] **Step 1: Write the failing test**

Append to `tests/images.test.ts`, and add `import type { Archetype, Diet } from '../src/data/types.js';` to the import block at the top:

```ts
// Exhaustive in BOTH directions: `satisfies Record<Archetype, 0>` rejects a
// missing key and an unknown one, so adding an archetype or a diet fails
// typecheck here before it can ship without art.
const ARCHETYPES = Object.keys(
  { bruiser: 0, tank: 0, swift: 0, support: 0 } satisfies Record<Archetype, 0>) as Archetype[];
const DIETS = Object.keys({ herbivore: 0, carnivore: 0 } satisfies Record<Diet, 0>) as Diet[];
const DINO_ART_KEYS = ARCHETYPES.flatMap((a) => DIETS.map((d) => `${a}-${d}`));

describe('dino archetype prompts', () => {
  // Same precedent as tests/battle-content.test.ts's bossId cross-check:
  // prompts.md is the regeneration source of truth, so a shipped asset with no
  // prompt is unreproducible.
  it('documents all 8 archetype-diet targets in docs/assets/prompts.md', () => {
    const prompts = readFileSync(new URL('../docs/assets/prompts.md', import.meta.url), 'utf8');
    expect(DINO_ART_KEYS).toHaveLength(8);
    expect(prompts).toContain('## Dino archetypes');
    expect(prompts).toContain('assets/images/dinos/');
    for (const key of DINO_ART_KEYS) expect(prompts, key).toContain(`${key}.webp`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/images.test.ts -t "documents all 8 archetype-diet targets"`
Expected: FAIL with `expected '# Art generation prompts…' to contain '## Dino archetypes'`

- [ ] **Step 3: Write the implementation**

Insert this section into `docs/assets/prompts.md` immediately after the last `boss-volcano_core` bullet of `## Battle bosses` and before `## Park map`:

```markdown
## Dino archetypes

Eight generic dinosaur portraits keyed on `archetype × diet`, used as
`setThumbnail` on the `hatch:crack` reveal and on every frame of a **non-boss**
battle stage (the lead enemy `rosterFor` fields). Keying on the pair rather than
on the species fixes the art cost at eight files forever: a new species picks up
existing art by declaring fields it already has to declare. Null-degrade
everywhere, like every other family here.

| File | Size | Use |
|---|---|---|
| `assets/images/dinos/bruiser-herbivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/bruiser-carnivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/tank-herbivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/tank-carnivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/swift-herbivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/swift-carnivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/support-herbivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |
| `assets/images/dinos/support-carnivore.webp` | 1024×1024, transparent | hatch reveal + non-boss battle thumbnail |

`<archetype>` is one of `bruiser`, `tank`, `swift`, `support`; `<diet>` is
`herbivore` or `carnivore`. `support-carnivore` has no species today and is
generated anyway — the guarantee is that adding a species never needs new art.

**Style: deliberately simpler than the four boss portraits.** Same house
glossy-cartoon treatment and the same head-and-shoulders three-quarter framing,
but flatter: clean archetype silhouettes, no scarring, no individuating damage,
no character detail. These land in the same thumbnail slot as the boss portraits
and sometimes in the same command — a boss must read as a named individual,
these must read as a *kind*.

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the dinosaur silhouette — off-silhouette glow survives background
removal as floating islands or a light halo on transparency. Emissive detail is
allowed only ON surfaces. Every prompt carries this rule verbatim.

**Facing right:** all four committed boss portraits face right, snout pointing
right, and one boss generation came back mirrored and had to be flipped in post
(see Battle bosses). The prompt frame below states the direction up front —
still check every generation against the reference before shipping it.

**Workflow (reference chain):** all eight are generated as image-edits of the
committed `assets/images/battles/boss-coastal_dig-portrait.webp` (Nano Banana
Pro, `medias` role `image`) — every one edits from that portrait directly, never
from another dino, so the set matches the bosses' pose, framing, and rendering.
That portrait is already background-removed, which is why the prompt frame
re-states the plain flat light-gray studio background. Post-process each with
`remove_background`, then
`node scripts/fit-art.mjs cutout <src> assets/images/dinos/<archetype>-<diet>.webp`.

**Margin divergence, accepted deliberately:** `fit-art.mjs cutout` fits at 31px
(0.94); the boss portraits sit at 24px from the one-off pass described in Egg
rarities. The two families never appear in the same embed — a boss stage
suppresses the archetype art and shows the portrait instead — so the difference
is only ever visible across successive frames of one fight. That is not worth a
second one-off pass or a `--fit` flag; it is recorded in the divergence table in
Egg rarities so it is a choice, not a third undocumented margin.

**Prompt frame** (each generated with `boss-coastal_dig-portrait` attached as the
`image` reference):

> Keep the exact same head-and-shoulders three-quarter portrait framing as the
> reference image: same camera angle, same scale in frame, same small even
> margin, facing right with the snout pointing right, on a plain flat light-gray
> studio background with no scenery and no ground shadow. Change the dinosaur to
> {DINO}. Render it as a generic species type rather than a named individual:
> clean unblemished hide, no scars, no chipped teeth, no torn frills, no battle
> damage, no distinguishing marks, and flatter, calmer detail than a boss
> portrait — a simple readable silhouette. No glow, rays, embers, sparkles, or
> light effects extending beyond the dinosaur silhouette; glowing details may
> appear only on the surfaces themselves. Glossy cartoon mobile-game art style,
> bold dark outlines, vibrant saturated colors, strong glossy highlights, clean
> cel shading with smooth gradients, polished game-asset look. No text, no human
> characters, no UI elements.

`{DINO}` per file:

- **`bruiser-carnivore.webp`:** a heavy-jawed cartoon theropod predator with a
  deep boxy skull, thick muscular neck, short powerful arms, blunt brow ridge,
  and crimson-and-charcoal scales.
- **`bruiser-herbivore.webp`:** a stocky cartoon ornithopod with a thick domed
  skull, broad shoulders, blunt beak, heavy jaw, and olive-green scales with a
  sandy underside.
- **`tank-carnivore.webp`:** a heavily built cartoon aquatic predator with a
  broad blunt snout, thick armored jawline, deep-blue and slate scales, a pale
  underside, and a wet glossy sheen.
- **`tank-herbivore.webp`:** a broad-frilled cartoon ceratopsian with a thick
  bony frill, blunt nose horn, heavy plated shoulders, and earthy brown and
  moss-green plating.
- **`swift-carnivore.webp`:** a lean cartoon raptor with a narrow tapered snout,
  alert forward-set eye, slim feather-tufted crest, and teal-and-amber striped
  scales.
- **`swift-herbivore.webp`:** a slender cartoon ornithomimid with a long slim
  neck, a small beaked head, a large alert eye, and pale tan plumage with a warm
  cream underside.
- **`support-herbivore.webp`:** a gentle cartoon hadrosaur with a long tubular
  head crest, a soft duck-like beak, calm eyes, and warm honey-yellow and
  turquoise scales.
- **`support-carnivore.webp`:** a compact crested cartoon carnivore with a slim
  head, tall paired head crests, wide watchful eyes, and violet-and-teal scales
  that read as a clever pack helper rather than a brute.
```

Then add one row to the divergence table in `## Egg rarities` (the table whose
header is `| | margin on tight axis | centering | regions kept |`), directly
below the `assets/images/hatch/` row:

```markdown
| `assets/images/dinos/` (`fit-art.mjs cutout`) | 31px | whole bbox | all (a clean portrait cutout lands at 1) |
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/images.test.ts -t "documents all 8 archetype-diet targets"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/assets/prompts.md tests/images.test.ts
git commit -m "docs: add dino archetype art prompts"
```

---

### Task 12: Generate the 8 archetype portraits

**Files:**
- Create: `assets/images/dinos/bruiser-herbivore.webp`, `assets/images/dinos/bruiser-carnivore.webp`, `assets/images/dinos/tank-herbivore.webp`, `assets/images/dinos/tank-carnivore.webp`, `assets/images/dinos/swift-herbivore.webp`, `assets/images/dinos/swift-carnivore.webp`, `assets/images/dinos/support-herbivore.webp`, `assets/images/dinos/support-carnivore.webp`
- Test: `tests/images.test.ts` (existing suite must stay green with the new files present)

**Interfaces:**
- Consumes: the prompt frame and the 8 `{DINO}` substitutions written in Task 11; `node scripts/fit-art.mjs cutout <src> <dest>` (Wave 2 already made it emit WebP q95)
- Produces: the 8 files on disk, which Task 13's family guard and Tasks 14/15's runtime assertions both require

- [ ] **Step 1: Upload the coastal boss portrait as the shared reference**

The committed portrait is WebP and transparent; decode it to an opaque-safe PNG
in the scratchpad first so the upload MIME type is unambiguous, then upload:

```bash
cd /c/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/0f545c9e-f0ef-4a4c-aac5-332ebd11d75b/scratchpad"
mkdir -p "$SCRATCH/dinos"
node -e "
const { Image, createCanvas } = require('@napi-rs/canvas');
const { readFileSync, writeFileSync } = require('node:fs');
(async () => {
  const img = new Image();
  img.src = readFileSync('assets/images/battles/boss-coastal_dig-portrait.webp');
  await img.decode();
  const c = createCanvas(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  writeFileSync(process.argv[1], c.toBuffer('image/png'));
  console.log('reference png', img.width + 'x' + img.height);
})();
" "$SCRATCH/dinos/reference.png"
```

Then call `mcp__claude_ai_Higgsfield__media_upload` with
`filename: "reference.png"`, `content_type: "image/png"`, PUT the bytes to the
returned `upload_url` with `curl -T`, and call
`mcp__claude_ai_Higgsfield__media_confirm` on the returned id. Keep that
`media_id` — every one of the eight generations attaches it.

- [ ] **Step 2: Generate all 8 as image-edits of that reference**

Eight calls to `mcp__claude_ai_Higgsfield__generate_image` (the tool silently
routes `nano_banana_pro` to `nano_banana_2` — expected, do not fight it), issued
in one message so they run in parallel. Each call:

```json
{ "params": {
  "model": "nano_banana_pro",
  "aspect_ratio": "1:1",
  "count": 1,
  "medias": [{ "value": "<media_id from Step 1>", "role": "image" }],
  "prompt": "Keep the exact same head-and-shoulders three-quarter portrait framing as the reference image: same camera angle, same scale in frame, same small even margin, facing right with the snout pointing right, on a plain flat light-gray studio background with no scenery and no ground shadow. Change the dinosaur to {DINO}. Render it as a generic species type rather than a named individual: clean unblemished hide, no scars, no chipped teeth, no torn frills, no battle damage, no distinguishing marks, and flatter, calmer detail than a boss portrait — a simple readable silhouette. No glow, rays, embers, sparkles, or light effects extending beyond the dinosaur silhouette; glowing details may appear only on the surfaces themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no human characters, no UI elements."
} }
```

`{DINO}` substitutions, one per call (identical to the bullets in `prompts.md`):

| target file | `{DINO}` |
|---|---|
| `bruiser-carnivore` | a heavy-jawed cartoon theropod predator with a deep boxy skull, thick muscular neck, short powerful arms, blunt brow ridge, and crimson-and-charcoal scales |
| `bruiser-herbivore` | a stocky cartoon ornithopod with a thick domed skull, broad shoulders, blunt beak, heavy jaw, and olive-green scales with a sandy underside |
| `tank-carnivore` | a heavily built cartoon aquatic predator with a broad blunt snout, thick armored jawline, deep-blue and slate scales, a pale underside, and a wet glossy sheen |
| `tank-herbivore` | a broad-frilled cartoon ceratopsian with a thick bony frill, blunt nose horn, heavy plated shoulders, and earthy brown and moss-green plating |
| `swift-carnivore` | a lean cartoon raptor with a narrow tapered snout, alert forward-set eye, slim feather-tufted crest, and teal-and-amber striped scales |
| `swift-herbivore` | a slender cartoon ornithomimid with a long slim neck, a small beaked head, a large alert eye, and pale tan plumage with a warm cream underside |
| `support-herbivore` | a gentle cartoon hadrosaur with a long tubular head crest, a soft duck-like beak, calm eyes, and warm honey-yellow and turquoise scales |
| `support-carnivore` | a compact crested cartoon carnivore with a slim head, tall paired head crests, wide watchful eyes, and violet-and-teal scales that read as a clever pack helper rather than a brute |

Poll each returned job with `mcp__claude_ai_Higgsfield__job_status`
(`sync: true`), honouring `poll_after_seconds`. Record the eight `job_id`s
against their target filenames. Review each result before continuing: right-
facing, no off-silhouette glow, flatter than a boss portrait.

- [ ] **Step 3: Cut out the background on all 8**

Eight calls to `mcp__claude_ai_Higgsfield__remove_background` with
`params: { media_id: "<generation job_id>", media_type: "image" }`, again issued
in one message, then `mcp__claude_ai_Higgsfield__job_status` on each. Download
the eight cutouts into the scratchpad under their target names:

```bash
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/0f545c9e-f0ef-4a4c-aac5-332ebd11d75b/scratchpad/dinos"
# one line per pair, using the result URL job_status returned for that cutout
curl -L -o "$SCRATCH/bruiser-carnivore.png"  "<url>"
curl -L -o "$SCRATCH/bruiser-herbivore.png"  "<url>"
curl -L -o "$SCRATCH/tank-carnivore.png"     "<url>"
curl -L -o "$SCRATCH/tank-herbivore.png"     "<url>"
curl -L -o "$SCRATCH/swift-carnivore.png"    "<url>"
curl -L -o "$SCRATCH/swift-herbivore.png"    "<url>"
curl -L -o "$SCRATCH/support-carnivore.png"  "<url>"
curl -L -o "$SCRATCH/support-herbivore.png"  "<url>"
```

- [ ] **Step 4: Fit all 8 into the shipped assets**

```bash
cd /c/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot
SCRATCH="C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/0f545c9e-f0ef-4a4c-aac5-332ebd11d75b/scratchpad/dinos"
mkdir -p assets/images/dinos
for key in bruiser-carnivore bruiser-herbivore tank-carnivore tank-herbivore \
           swift-carnivore swift-herbivore support-carnivore support-herbivore; do
  node scripts/fit-art.mjs cutout "$SCRATCH/$key.png" "assets/images/dinos/$key.webp"
done
```

- [ ] **Step 5: Verify all 8 landed as 1024×1024 transparent cutouts**

```bash
cd /c/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot
node -e "
const { Image, createCanvas } = require('@napi-rs/canvas');
const { readFileSync } = require('node:fs');
const keys = ['bruiser','tank','swift','support'].flatMap((a) => ['herbivore','carnivore'].map((d) => a + '-' + d));
(async () => {
  let bad = 0;
  for (const k of keys) {
    const img = new Image();
    img.src = readFileSync('assets/images/dinos/' + k + '.webp');
    await img.decode();
    const c = createCanvas(1024, 1024).getContext('2d');
    c.drawImage(img, 0, 0);
    const corners = [[0,0],[1023,0],[0,1023],[1023,1023]]
      .map(([x,y]) => c.getImageData(x, y, 1, 1).data[3]);
    const ok = img.width === 1024 && img.height === 1024 && corners.every((a) => a === 0);
    if (!ok) bad++;
    console.log(k, img.width + 'x' + img.height, 'corners', corners.join(','), ok ? 'OK' : 'BAD');
  }
  console.log(keys.length + ' files,', bad, 'bad');
  process.exit(bad ? 1 : 0);
})();
"
npx vitest run tests/images.test.ts
```
Expected: `8 files, 0 bad`, and the existing `tests/images.test.ts` suite still PASSES (adding files must not disturb any other family).

- [ ] **Step 6: Commit**

```bash
git add assets/images/dinos
git commit -m "assets: add eight archetype-diet dino portraits"
```

---

### Task 13: `assetImage` gains the `dinos` kind, plus the family guard

**Files:**
- Modify: `src/core/images.ts` (the `assetImage` `kind` union)
- Test: `tests/images.test.ts`

**Interfaces:**
- Consumes: `assetImage(kind, name): ImageRef | null`; `DINO_ART_KEYS` from Task 11
- Produces: `assetImage('dinos', '<archetype>-<diet>'): ImageRef | null` — the lookup Tasks 14 and 15 call

- [ ] **Step 1: Write the failing test**

In `tests/images.test.ts`: add `import { allSpecies } from '../src/data/species/index.js';` to the imports, add the null-degrade case beside the existing `hatch` one inside `describe('assetImage')`, generalise the portrait helper, and append the dino family guard.

```ts
  it('accepts the dinos kind and null-degrades when absent', () => {
    expect(assetImage('dinos', 'no-such-archetype')).toBeNull();
  });
```

```ts
// A re-export that bakes the flat light-gray studio background back in passes
// any size-only check and then reads as a gray card in dark mode, so corners
// are asserted transparent, not just the dimensions. These are the only
// committed images used as an embed thumbnail over the viewer's theme.
async function expectTransparentCutout(kind: 'battles' | 'dinos', name: string): Promise<void> {
  expect(assetImage(kind, name), name).not.toBeNull();
  const img = new Image();
  img.src = readFileSync(resolve(process.cwd(), 'assets/images', kind, `${name}.webp`));
  await img.decode();   // decode is async for WebP as for PNG — drawing without it yields a blank canvas
  expect(img.width, name).toBe(1024);
  expect(img.height, name).toBe(1024);
  const canvas = createCanvas(1024, 1024);
  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0);
  for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]] as const) {
    expect(c.getImageData(x, y, 1, 1).data[3], `${name} corner ${x},${y}`).toBe(0);
  }
}

const PORTRAIT_BOSS_IDS = CAMPAIGN.map((c) => c.stages[4].boss!.bossId);

describe('boss portrait art', () => {
  it.each(PORTRAIT_BOSS_IDS)('%s is a 1024×1024 transparent cutout',
    (bossId) => expectTransparentCutout('battles', `${bossId}-portrait`));
});

describe('dino archetype art', () => {
  it.each(DINO_ART_KEYS)('%s is a 1024×1024 transparent cutout',
    (key) => expectTransparentCutout('dinos', key));
  // The whole point of keying on archetype×diet: every species resolves without
  // new art. support-carnivore has no species today and still ships, so adding
  // one stays a data-only change.
  it('every species resolves to a shipped archetype image', () => {
    for (const s of allSpecies()) {
      expect(assetImage('dinos', `${s.archetype}-${s.diet}`), s.id).not.toBeNull();
    }
  });
});
```

(Delete the old `expectTransparentPortrait` helper and the old `describe('boss portrait art')` block it served — the code above replaces both.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run typecheck`
Expected: FAIL with `error TS2345: Argument of type '"dinos"' is not assignable to parameter of type '"eggs" | "sites" | "banners" | "battles" | "hatch"'` (several occurrences in `tests/images.test.ts`). Note that `npx vitest run tests/images.test.ts` passes at this point — vitest transpiles without typechecking and the files from Task 12 are on disk, so `npm run typecheck` is the honest gate for this task.

- [ ] **Step 3: Write the implementation**

In `src/core/images.ts`, widen the `kind` union:

```ts
export function assetImage(
  kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch' | 'dinos',
  name: string,
): ImageRef | null {
  const fileName = `${name}.webp`;
  const abs = resolve(process.cwd(), 'assets/images', kind, fileName);
  if (!present(abs)) return null;
  return { file: new AttachmentBuilder(abs, { name: fileName }), url: `attachment://${fileName}` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/images.test.ts`
Expected: PASS — typecheck clean, and 8 new `dino archetype art` cases plus `every species resolves to a shipped archetype image` green.

- [ ] **Step 5: Commit**

```bash
git add src/core/images.ts tests/images.test.ts
git commit -m "feat: add the dinos asset kind"
```

---

### Task 14: Delete `spriteRef`

**Files:**
- Modify: `src/data/types.ts:6`
- Modify: all 30 files in `src/data/species/` except `index.ts` (mechanical, scripted)
- Test: `npm run typecheck` is the gate — the compiler is the only reference to this field

**Interfaces:**
- Consumes: nothing
- Produces: `Species = { id, name, rarity, diet, archetype, biomeTags, flavor }` — no `spriteRef`

- [ ] **Step 1: Delete the field from the interface (this is the failing test)**

In `src/data/types.ts`:

```ts
export interface Species {
  id: string; name: string; rarity: Rarity; diet: Diet; archetype: Archetype;
  biomeTags: string[]; flavor: string;
}
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npm run typecheck`
Expected: FAIL with 30 × `error TS2353: Object literal may only specify known properties, and 'spriteRef' does not exist in type 'Species'` — one per file in `src/data/species/`.

- [ ] **Step 3: Strip the field from all 30 species files**

```bash
cd /c/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot
sed -i -E "s/, spriteRef: '[a-z]+\.(png|webp)'//" src/data/species/*.ts
```

- [ ] **Step 4: Verify every site was converted and nothing else moved**

```bash
cd /c/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot
test "$(grep -rn 'spriteRef' src tests scripts | wc -l)" -eq 0 && echo "spriteRef: 0 references"
git diff --numstat src/data/species | wc -l    # expect 30 files touched
npm run typecheck
npx vitest run tests/images.test.ts
```
Expected: `spriteRef: 0 references`, `30`, typecheck clean, `every species resolves to a shipped archetype image` still PASSES (proves all 30 species objects still parse and register).

- [ ] **Step 5: Commit**

```bash
git add src/data/types.ts src/data/species
git commit -m "refactor: drop the unused spriteRef species field"
```

---

### Task 15: Hatch reveal thumbnails the archetype

**Files:**
- Modify: `src/modules/hatchery/embeds.ts` (`revealPayload`)
- Test: `tests/hatchery.test.ts`

**Interfaces:**
- Consumes: `attach(embed, payload, slot, ref)` (Wave 1); `assetImage('dinos', name)` (Task 13)
- Produces: `revealPayload(species)` returning two embed-referenced files — `<rarity>-crack.webp` as `image`, `<archetype>-<diet>.webp` as `thumbnail` — each degrading independently

- [ ] **Step 1: Write the failing tests**

In `tests/hatchery.test.ts`, replace the existing `revealPayload swaps the intact egg…` test with these four (the `assetImage` pass-through spy at the top of the file is already in place):

```ts
  it('revealPayload swaps the intact egg for the rarity crack, thumbnails the archetype, and keeps attachments cleared', () => {
    // attachments: [] is load-bearing — discord.js pushes the new descriptors into
    // the array we pass, so the pre-hatch egg upload is dropped and only these two
    // survive on the edited message.
    const p = revealPayload(getSpecies('velociraptor'));   // rare, swift/carnivore
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://rare-crack.webp');
    expect(embed.thumbnail?.url).toBe('attachment://swift-carnivore.webp');
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack.webp', 'swift-carnivore.webp']);
    expect(p.attachments).toEqual([]);
  });
  it('revealPayload keys the thumbnail off the hatched species, not a constant', () => {
    const p = revealPayload(getSpecies('triceratops'));   // common, tank/herbivore
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://tank-herbivore.webp');
    expect(p.files.map((f) => f.name)).toEqual(['common-crack.webp', 'tank-herbivore.webp']);
  });
  it('revealPayload still ships the archetype thumb when the crack art is missing', () => {
    // Degrade path 1/2: two files on one payload, two independent attach calls —
    // a miss on the crack must not suppress the thumb.
    vi.mocked(assetImage).mockImplementationOnce(() => null);   // crack call (1st) -> missing
    const p = revealPayload(getSpecies('velociraptor'));
    const embed = p.embeds[0].toJSON();
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail?.url).toBe('attachment://swift-carnivore.webp');
    expect(p.files.map((f) => f.name)).toEqual(['swift-carnivore.webp']);
  });
  it('revealPayload still ships the crack when the archetype art is missing', async () => {
    // Degrade path 2/2: the mirror case — a miss on the thumb must not drop the
    // crack that attach already appended to payload.files.
    const { assetImage: realAssetImage } = await vi.importActual<typeof import('../src/core/images.js')>('../src/core/images.js');
    vi.mocked(assetImage)
      .mockImplementationOnce((kind, name) => realAssetImage(kind, name))   // crack call (1st) -> real
      .mockImplementationOnce(() => null);                                  // thumb call (2nd) -> missing
    const p = revealPayload(getSpecies('velociraptor'));
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://rare-crack.webp');
    expect(embed.thumbnail).toBeUndefined();
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack.webp']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/hatchery.test.ts -t "revealPayload"`
Expected: FAIL — `expected undefined to be 'attachment://swift-carnivore.webp'` on the thumbnail assertion, and `expected [ 'rare-crack.webp' ] to deeply equal [ 'rare-crack.webp', 'swift-carnivore.webp' ]`.

- [ ] **Step 3: Write the implementation**

In `src/modules/hatchery/embeds.ts`, in `revealPayload`, immediately after the existing crack `attach` call:

```ts
  attach(embed, payload, 'image', assetImage('hatch', `${species.rarity}-crack`));
  // Two files on one payload, each degrading independently: the crack is the
  // "your egg burst open" beat, the archetype thumb is what came out of it.
  // attach appends, so neither call can clobber the other's file.
  attach(embed, payload, 'thumbnail', assetImage('dinos', `${species.archetype}-${species.diet}`));
  return payload;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/hatchery.test.ts`
Expected: PASS — all four `revealPayload` cases green, and the rest of the file (pre-hatch, egg list, degrade pairs) unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hatchery/embeds.ts tests/hatchery.test.ts
git commit -m "feat: thumbnail the hatch reveal with the species archetype"
```

---

### Task 16: Non-boss battle stages thumbnail the lead enemy archetype

**Files:**
- Modify: `src/modules/battles/embeds.ts` (`fightFrames` — the three `assetImage` calls at the top stay bespoke, per the Wave 1 exceptions)
- Test: `tests/battles-embeds.test.ts`
- Test: `tests/battles-module.test.ts`

**Interfaces:**
- Consumes: `assetImage('dinos', name)` (Task 13); `rosterFor(stage, squadSize)` from `src/data/battle/chapters/index.ts`; `getSpecies(id)`
- Produces: `fightFrames` frames whose thumbnail is the boss portrait on boss stages and `<archetype>-<diet>.webp` of `rosterFor(stage, squad.length)[0]` on non-boss stages, uploaded by F1 and F4 exactly as the portrait is

- [ ] **Step 1: Add a `dinos` toggle to the art mock and update `tests/battles-embeds.test.ts`**

The mock currently forwards every non-`battles` kind to the real implementation,
so a new `dinos` kind would silently resolve real committed art inside the
zero-art replay test. Update the hoisted toggle and the mock body:

```ts
const art = vi.hoisted(() => ({ portraits: true, sites: true, dinos: true }));
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return {
    ...actual,
    assetImage: vi.fn((kind: Parameters<typeof actual.assetImage>[0], name: string) => {
      // `sites: false` models a deploy with no chapter art (docs/ops.md: every
      // asset is individually optional). `dinos: false` is the same fixture for
      // the archetype thumbs — without it F1 always has a file and the replay
      // contract below stops testing the no-art case it exists to test.
      if (kind === 'sites' && !art.sites) return null;
      if (kind === 'dinos' && !art.dinos) return null;
      if (kind !== 'battles') return actual.assetImage(kind, name);   // chapter banners/thumbs stay real
      if (!art.portraits) return null;
      const fileName = `${name}.webp`;
      return { file: new AttachmentBuilder(Buffer.from('portrait'), { name: fileName }), url: `attachment://${fileName}` };
    }),
  };
});
```

Then update the four affected assertions and add the two new cases:

```ts
  it('returns 4 valid frames; files attach on F1 and F4 only', () => {
    const frames = fightFrames(makeOutcome(), skipStub);
    expect(frames).toHaveLength(4);
    for (const f of frames) validateMessagePayload(f, 'frame');
    expect(frames[0].files?.length).toBeGreaterThan(0);   // coastal_dig banner ships
    expect(frames[1].files).toBeUndefined();
    expect(frames[2].files).toBeUndefined();
    // F4 replaces the whole attachment set, so it re-uploads the thumb it shows.
    expect(frames[3].files?.map((f) => f.name)).toEqual(['battle_victory.webp', 'swift-carnivore.webp']);
    expect(frames[0].attachments).toEqual([]);   // F1 and F4 both replace the whole set
    expect(frames[3].attachments).toEqual([]);
    expect(frames[3].embeds[0].toJSON().image?.url).toBe('attachment://battle_victory.webp');
    expect(frames[3].embeds[0].toJSON().thumbnail?.url).toBe('attachment://swift-carnivore.webp');
  });
```

```ts
  it('boss stages thumbnail the portrait; non-boss stages thumbnail the lead enemy archetype', () => {
    const boss = fightFrames(makeOutcome({ stageId: 'coastal_dig_boss', bossEgg: { rarity: 'rare' } }), skipStub);
    expect(boss[2].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.webp`);
    expect(boss[3].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.webp`);
    expect(boss[0].files?.map((f) => f.name)).toContain(`${bossId}-portrait.webp`);
    expect(boss[3].files?.map((f) => f.name)).toContain(`${bossId}-portrait.webp`);   // re-uploaded, not re-referenced
    expect(boss[1].files).toBeUndefined();
    // A boss stage never carries archetype art: the boss is a named individual,
    // and rosterFor's lead entry on a 1-dino squad is the boss itself.
    expect(boss[0].files?.map((f) => f.name)).not.toContain('swift-carnivore.webp');
    expect(JSON.stringify(boss[3].embeds[0].toJSON().fields)).toContain('egg');
    // The rendered enemy line, not just the thumbnail/files wiring, names the boss.
    const enemiesField = boss[0].embeds[0].toJSON().fields!.find((f) => f.name === 'Enemies')!.value;
    expect(enemiesField).toContain('👑 Old Riptooth');
    // coastal_dig_1's weakest-first roster leads with compsognathus (swift/carnivore).
    const normal = fightFrames(makeOutcome(), skipStub);
    for (const f of normal) expect(f.embeds[0].toJSON().thumbnail?.url).toBe('attachment://swift-carnivore.webp');
  });
  it('the non-boss thumbnail is computed per stage from rosterFor[0], not a constant', () => {
    // coastal_dig_2 leads with othnielia (swift/herbivore), coastal_dig_3 with
    // microceratus (support/herbivore) — different keys down the same code path.
    const s2 = fightFrames(makeOutcome({ stageId: 'coastal_dig_2' }), skipStub);
    expect(s2[0].embeds[0].toJSON().thumbnail?.url).toBe('attachment://swift-herbivore.webp');
    const s3 = fightFrames(makeOutcome({ stageId: 'coastal_dig_3' }), skipStub);
    expect(s3[0].embeds[0].toJSON().thumbnail?.url).toBe('attachment://support-herbivore.webp');
    expect(s3[0].files?.map((f) => f.name)).toContain('support-herbivore.webp');
  });
```

```ts
  it('replay contract: F1 clears the previous fight\'s F4 banner even when it has no art of its own', () => {
    // `battle:again` calls presentFight again on the SAME message, so fight 2's F1
    // lands on the message fight 1's F4 last wrote — and F4 replaces the whole
    // attachment set with the outcome banner. On a deploy with no chapter art and
    // no archetype art F1 carries no files; if it also carried no `attachments`
    // key, Discord would keep fight 1's battle_victory.webp alive under F1-F3,
    // whose embeds reference nothing. F1's `attachments: []` must therefore be
    // unconditional, not `if (files.length)`.
    art.sites = false;
    art.dinos = false;
    try {
      const first = fightFrames(makeOutcome(), skipStub);
      const replay = fightFrames(makeOutcome(), skipStub);
      expect(first[0].files).toBeUndefined();               // no chapter art in this deploy
      expect(first[0].attachments).toEqual([]);             // ...the set is replaced regardless
      expect(liveAfter(first)).toEqual(['battle_victory.webp']);
      // The decisive step: nothing stale survives into the replay's F1-F3.
      expect(liveAfter([...first, replay[0]])).toEqual([]);
      expect(liveAfter([...first, ...replay.slice(0, 3)])).toEqual([]);
      for (const f of replay.slice(0, 3)) expect(f.embeds[0].toJSON().image).toBeUndefined();
    } finally {
      art.sites = true;
      art.dinos = true;
    }
  });
```

And replace the single `frame contract` test with a shared assertion run over
both stage shapes:

```ts
  // Mirrors discord.js MessagePayload: a payload carrying `files` (or an explicit
  // `attachments` array) REPLACES the message's whole attachment set; a payload
  // carrying neither leaves the previous uploads in place (see liveAfter above).
  const assertFrameContract = (stageId: string, bossEgg: FightOutcome['bossEgg'], expectedLive: string[]) => {
    const frames = fightFrames(makeOutcome({ stageId, bossEgg }), skipStub);
    let live: string[] = [];
    frames.forEach((frame, idx) => {
      const own = (frame.files ?? []).map((f) => f.name!);
      live = frame.files || frame.attachments ? own : [...live, ...own];
      const json = frame.embeds[0].toJSON();
      const referenced = [json.image?.url, json.thumbnail?.url]
        .filter((u): u is string => typeof u === 'string')
        .map((u) => u.replace('attachment://', ''));
      for (const r of referenced) expect(live, `${stageId} frame ${idx + 1} references ${r}`).toContain(r);
      for (const n of own) expect(referenced, `${stageId} frame ${idx + 1} uploads ${n}`).toContain(n);
    });
    expect(live).toEqual(expectedLive);
  };
  it('frame contract (boss stage): every referenced attachment is live on that frame, and no frame uploads what it never references', () => {
    assertFrameContract('coastal_dig_boss', { rarity: 'rare' }, ['battle_victory.webp', `${bossId}-portrait.webp`]);
  });
  it('frame contract (non-boss stage): the archetype thumb is uploaded by both attaching frames', () => {
    assertFrameContract('coastal_dig_1', null, ['battle_victory.webp', 'swift-carnivore.webp']);
  });
```

- [ ] **Step 2: Update the end-to-end assertion in `tests/battles-module.test.ts`**

`coastal_dig_1` is a non-boss stage and this file mocks nothing, so F4 now
carries two real files. Replace the positional assertions at the end of
`files attach on F1 and F4 only; F4 uploads exactly what its embed references`:

```ts
    const f4 = fake.replies[3] as {
      files?: Array<{ name: string | null }>; attachments?: unknown[];
      embeds: Array<{ toJSON(): { image?: { url: string }; thumbnail?: { url: string } } }>;
    };
    expect(f4.attachments).toEqual([]);                // drops F1's chapter banner
    // Two files: the outcome banner (image) and the lead enemy's archetype art
    // (thumbnail). Asserted as a set — append order is not a contract.
    const names = f4.files!.map((f) => f.name);
    expect(names).toHaveLength(2);
    expect(names).toContain('swift-carnivore.webp');   // coastal_dig_1 leads with compsognathus
    const json = f4.embeds[0].toJSON();
    expect(json.image!.url).toMatch(/^attachment:\/\/battle_(victory|defeat)\.webp$/);
    expect(json.thumbnail?.url).toBe('attachment://swift-carnivore.webp');
    expect(names).toContain(json.image!.url.replace('attachment://', ''));
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run tests/battles-embeds.test.ts tests/battles-module.test.ts`
Expected: FAIL — `expected [ 'battle_victory.webp' ] to deeply equal [ 'battle_victory.webp', 'swift-carnivore.webp' ]`, `expected undefined to be 'attachment://swift-carnivore.webp'`, and `expected [ 'battle_victory.webp' ] to have a length of 2 but got 1`.

- [ ] **Step 4: Write the implementation**

In `src/modules/battles/embeds.ts`, `fightFrames`: hoist the `rosterFor` call
above `dress`, resolve one merged `thumb`, and use it everywhere `portrait` was
used. The three up-front `assetImage` calls stay bespoke — they are the Wave 1
exceptions.

```ts
  const banner = assetImage('sites', `${stage.chapterId}-banner`);
  const portrait = stage.boss ? assetImage('battles', `${stage.boss.bossId}-portrait`) : null;
  const outcomeBanner = assetImage('banners', outcome.won ? 'battle_victory' : 'battle_defeat');
  // Single source of truth for who actually fought AND which entry is the
  // boss is rosterFor (shared with runFight) — never re-derived here. Hoisted
  // above dress() because the thumbnail is now derived from it.
  const roster = rosterFor(stage, outcome.squad.length);
  // A boss stage shows its named individual and nothing else: if the portrait is
  // missing it degrades to no thumbnail, never to archetype art standing in for a
  // boss. Non-boss stages have no individual, so they show the archetype of the
  // lead enemy rosterFor fields — the same entry the enemy list opens with.
  const lead = stage.boss ? null : getSpecies(roster[0].speciesId);
  const thumb = portrait ?? (lead ? assetImage('dinos', `${lead.archetype}-${lead.diet}`) : null);

  // Files attach on F1 and F4 only, and each attaching frame uploads exactly the
  // files its embed references. F1 and F4 both replace the message's whole
  // attachment set (`attachments: []`, unconditional on both); F2/F3 carry no
  // files/attachments key at all, so F1's uploads survive and their
  // attachment:// URLs keep resolving. Never add a file here that no frame
  // references — it renders as a bare attachment card under the message.
  const dress = (embed: EmbedBuilder) => {
    if (banner) embed.setImage(banner.url);
    if (thumb) embed.setThumbnail(thumb.url);
    return embed;
  };
```

Delete the now-duplicated `const roster = rosterFor(...)` line above
`enemyLines`, then change the three remaining `portrait` uses:

```ts
  const files = [banner?.file, thumb?.file].filter((f): f is AttachmentBuilder => f != null);
  if (files.length) f1.files = files;   // uploads on F1; F2/F3 ride on them
```

```ts
  // Deliberately NOT dress()ed: F4 shows the outcome banner, not the chapter one.
  if (outcomeBanner) f4Embed.setImage(outcomeBanner.url);
  if (thumb) f4Embed.setThumbnail(thumb.url);
```

```ts
  const f4Files = [outcomeBanner?.file, thumb?.file].filter((f): f is AttachmentBuilder => f != null);
  if (f4Files.length) f4.files = f4Files;
```

- [ ] **Step 5: Run both test files to verify they pass**

Run: `npx vitest run tests/battles-embeds.test.ts tests/battles-module.test.ts`
Expected: PASS — including both `frame contract` cases and the zero-art `replay contract`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/battles/embeds.ts tests/battles-embeds.test.ts tests/battles-module.test.ts
git commit -m "feat: thumbnail non-boss battle stages with the lead enemy archetype"
```

---

### Task 17: Record the conventions in `CLAUDE.md`, `README.md`, `docs/ops.md`

**Files:**
- Modify: `CLAUDE.md` (the battles bullet's embed-art-kinds sentence; the two-assets-in-one-payload bullet)
- Modify: `README.md:20-22` (the embed-art sentence)
- Modify: `docs/ops.md:72` (the asset-directory sentence)

**Interfaces:**
- Consumes: the behaviour landed in Tasks 12, 14, 15
- Produces: nothing code-facing — this is the durable record of the archetype-art rules

- [ ] **Step 1: Update `CLAUDE.md`**

In the battles bullet, replace the `Embed art kinds are …` sentence (Wave 2 has
already rewritten its extensions to `.webp`, so anchor on the sentence, not a
byte-exact string):

```markdown
  Embed art kinds are `eggs | sites | banners | battles | hatch | dinos`
  (`assetImage`, `src/core/images.ts`); `hatch/<rarity>-crack.webp` is the
  hatch-reveal image and its attachment name never collides with
  `eggs/<rarity>.webp`. `assets/images/dinos/<archetype>-<diet>.webp` is a fixed
  set of 8 (1024×1024 transparent cutouts, `fit-art.mjs cutout`, so a 31px
  margin against the boss portraits' 24px — deliberate, recorded in
  `docs/assets/prompts.md`): **art is keyed on archetype×diet, never on species**,
  which is what keeps adding a species a data-only change. `support-carnivore`
  ships with zero species using it for exactly that reason.
```

Then add this bullet immediately after the "Two assets in one payload" bullet:

```markdown
- `fightFrames` picks its thumbnail once, up front: the boss portrait on a boss
  stage, else the archetype art of `rosterFor(stage, squad.length)[0]` — the same
  lead enemy the Enemies field opens with, so the frame can never disagree with
  the fight. A boss stage whose portrait is missing degrades to **no** thumbnail;
  it must never fall back to archetype art, because `rosterFor`'s lead entry on a
  1-dino squad IS the boss. One merged `thumb` ref feeds `dress()` (F1-F3), F4's
  `setThumbnail`, and both `files` arrays, so the F1/F4 upload contract holds
  without a second code path. `revealPayload` is the other archetype surface: it
  ships the rarity crack as `image` and the archetype as `thumbnail`, two files on
  one `i.update` payload, each degrading independently.
```

- [ ] **Step 2: Update `README.md` and `docs/ops.md`**

`README.md` — extend the embed-art sentence:

```markdown
Embeds carry generated art — egg icons per rarity, expedition site art, and a
dinosaur portrait per archetype and diet — living under `assets/images/`; every
embed degrades gracefully and still renders, just without the image, when a file
is absent.
```

`docs/ops.md` — extend the asset-directory sentence:

```markdown
art (egg icons, site thumbnails, banners, archetype dino portraits) lives under
`assets/images/` — all
```

- [ ] **Step 3: Verify the docs actually say it**

```bash
cd /c/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot
grep -n "dinos" CLAUDE.md
grep -n "archetype" CLAUDE.md README.md docs/ops.md
```
Expected: the art-kinds union line and the new `fightFrames` bullet in `CLAUDE.md`, one hit each in `README.md` and `docs/ops.md`.

- [ ] **Step 4: Confirm nothing in the suite depended on the old wording**

Run: `npx vitest run tests/config.test.ts tests/registry-load.test.ts`
Expected: PASS (no command or module surface changed in this wave — this is the check that says so).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/ops.md
git commit -m "docs: record the archetype-keyed dino art conventions"
```

---

### Task 18: Cover the non-boss archetype thumbnail in the live gallery

**Files:**
- Modify: `scripts/test-live.ts` (imports; the `/battle fight — coastal_dig_1` case title; one new case)
- Test: `npm run typecheck` (`tsconfig.test.json` includes `scripts`)

**Interfaces:**
- Consumes: `ENERGY_CAP` from `src/data/battle/constants.js`; the existing `slash`/`ctx`/`b1`/`b2` gallery fixtures
- Produces: two gallery cases that render an archetype thumbnail — `swift-carnivore` and `support-herbivore` — so the live sweep proves two different keys, not one

- [ ] **Step 1: Add the import**

In `scripts/test-live.ts`, beside the other data imports:

```ts
import { ENERGY_CAP } from '../src/data/battle/constants.js';
```

- [ ] **Step 2: Retitle the existing non-boss case and add the second archetype case**

Replace the `coastal_dig_1` case line and add one directly after it:

```ts
  { title: '/battle fight — coastal_dig_1 win: swift-carnivore archetype thumb on all 4 frames', run: () => slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'coastal_dig_1', dino1: b1.id, dino2: b2.id } }) },
  { title: '/battle fight — coastal_dig_3: a DIFFERENT archetype thumb (support-herbivore)', run: () => {
      // Five fights cost 11 energy against a cap of 10, and the DEFEAT case at the
      // bottom needs 3 of them — top up in place, same precedent as /trade offer's
      // parkRating restore. coastal_dig_3 is already 3-starred by the seed, so this
      // is a repeat clear (no first-clear egg) and its roster leads with
      // microceratus -> support-herbivore.
      ctx.db.update(schema.users).set({ energy: ENERGY_CAP, energyUpdatedAt: ctx.now() })
        .where(eq(schema.users.discordId, P1)).run();
      return slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'coastal_dig_3', dino1: b1.id, dino2: b2.id } });
    } },
```

- [ ] **Step 3: Verify the script still typechecks**

Run: `npm run typecheck`
Expected: PASS — a stale fixture or a wrong option key in `scripts/` is caught here and nowhere else (`npm run build` only includes `src`).

- [ ] **Step 4: Confirm all 8 assets are on disk before treating the sweep as a gate**

```bash
cd /c/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot
ls assets/images/dinos/*.webp | wc -l
```
Expected: `8`. `toPost` reads `f.attachment` as a path, and a missing file makes `assetImage` return null — the gallery would then post a thumbnail-free embed and look fine while proving nothing.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-live.ts
git commit -m "chore: cover the non-boss archetype thumbnail in the live gallery"
```

---

### Task 19: Wave gates

**Files:**
- Test: the whole suite — no source changes in this task

**Interfaces:**
- Consumes: everything landed in Tasks 10-17
- Produces: the green wave

- [ ] **Step 1: Run the test-inclusive typecheck**

Run: `npm run typecheck`
Expected: PASS with no output. This is the only gate that proves `spriteRef` is gone (a surviving reference is a type error in `src/`, and a stale fixture in `tests/`/`scripts/` passes both `build` and `test` clean).

- [ ] **Step 2: Run the full offline suite**

Run: `npm test`
Expected: PASS. Baseline was 623; this wave adds 8 `dino archetype art` cases plus `every species resolves to a shipped archetype image`, the prompts cross-check, 3 new `revealPayload` cases, the per-stage archetype-key case, and one extra `frame contract` case — expect 638 passing, 0 failing.

- [ ] **Step 3: Run the production build**

Run: `npm run build`
Expected: PASS — `tsc` over `src` emits to `dist/` with no errors.

- [ ] **Step 4: Run the live sweep — REQUIRED for this wave**

Run: `npm run test:live`
Expected: every case posts to `TEST_CHANNEL_ID` with no failures reported. This is the **only** verification that Discord renders the new thumbnails: check by eye that the `hatch:crack — reveal` message shows the crack as the big image AND an archetype portrait in the thumbnail corner, that `/battle fight — coastal_dig_1` shows `swift-carnivore` on all four frames, that `/battle fight — coastal_dig_3` shows a visibly different portrait (`support-herbivore`), and that both boss cases still show their boss portraits and no archetype art. Frames 2 and 3 render thumbnail-free in the gallery because each case is posted as a standalone message with `attachments` stripped — that is pre-existing gallery behaviour, not a wave regression.

`npm run deploy-commands` is **not** required (no builder changed) and
`npm run deploy-emojis` is **not** required (no emoji changed).

- [ ] **Step 5: Confirm the tree is clean and the wave is complete**

```bash
cd /c/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot
git status --short
git log --oneline -8
```
Expected: empty status, and the eight wave-3 commits from Tasks 10-17 on `art-assets-round-3`.

---
