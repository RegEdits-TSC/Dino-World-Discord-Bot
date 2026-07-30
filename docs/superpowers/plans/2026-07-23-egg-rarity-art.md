# Egg Rarity Art Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the six egg rarity PNGs (`assets/images/eggs/*.png`, transparent, 1024×1024) deleted at 657f904, using a reference-chain workflow on Higgsfield Nano Banana Pro.

**Architecture:** Generate the common egg first on a plain background; after user approval it becomes the visual reference. The other five rarities are image-edits of that reference ("same egg, reskin shell"), so the silhouette stays identical. Every image then goes through background removal, download, resize-to-1024, and a transparency check before landing in `assets/images/eggs/`. No bot code changes: `assetImage('eggs', rarity)` (src/core/images.ts) picks the files up, and the two currently-failing assertions in `tests/images.test.ts` go green.

**Tech Stack:** Higgsfield MCP tools (`generate_image`, `remove_background`, `job_status`), curl for downloads, `@napi-rs/canvas` (already a dependency) for resize + transparency verification, vitest.

## Global Constraints

- Shared style block appended verbatim to every generation prompt: "Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements."
- Shell colors track the embed accent colors in `src/modules/hatchery/embeds.ts:9` (common 0x95a5a6, uncommon 0x2ecc71, rare 0x3498db, epic 0x9b59b6, legendary 0xf1c40f, mythic 0xe74c3c).
- Mythic is locked to obsidian black + glowing orange lava cracks (the `volcano_core` site art was generated to match it).
- One shared egg silhouette across all six; rarity is expressed only via shell color, pattern, and effects.
- Final files: `assets/images/eggs/{common,uncommon,rare,epic,legendary,mythic}.png`, 1024×1024, transparent background.
- `docs/assets/prompts.md` is the source of truth for prompts — record the final egg prompts there in the same change.
- **This plan requires user interaction (Task 1 approval checkpoint) and Higgsfield MCP access — execute inline in the main session, not via subagents.**
- Scratchpad for intermediate downloads: the session scratchpad directory (never `/tmp`, never the repo).

---

### Task 1: Generate and approve the common (reference) egg

**Files:**
- Create (scratchpad only at this stage): `<scratchpad>/eggs-raw/common-raw.png`

**Interfaces:**
- Produces: an approved raw common-egg image (Higgsfield generation id + URL) that Task 2 uses as the edit reference, and the approved silhouette description used in all Task 2 edit prompts.

- [ ] **Step 1: Load Higgsfield MCP tools**

One ToolSearch call:

```
ToolSearch query: "select:mcp__claude_ai_Higgsfield__generate_image,mcp__claude_ai_Higgsfield__job_status,mcp__claude_ai_Higgsfield__remove_background,mcp__claude_ai_Higgsfield__job_display"
```

- [ ] **Step 2: Confirm baseline test failure**

Run: `npx vitest run tests/images.test.ts`
Expected: FAIL — assertions at lines 6–9 (`eggs/common` present-file case) and 16–17 (`eggs/mythic`) fail because `assets/images/eggs/` does not exist.

- [ ] **Step 3: Generate the common egg**

Call `generate_image` with model Nano Banana Pro, square aspect (1:1), prompt:

> A single large cartoon dinosaur egg standing upright, perfectly centered: smooth gray-white eggshell with scattered small brown speckles, one soft glossy highlight on the upper left of the shell. Plain flat light-gray studio background, no scenery. Centered composition, large readable shape filling most of the frame. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements.

Poll `job_status` until complete; show result to the user via `job_display`.

- [ ] **Step 4: USER CHECKPOINT — approve silhouette and style**

Stop and ask the user to approve the common egg before generating anything else. If rejected, adjust the prompt per their feedback and regenerate (repeat Step 3). Do not proceed to Task 2 without explicit approval.

- [ ] **Step 5: Download the approved raw image**

```bash
mkdir -p "<scratchpad>/eggs-raw"
curl -sL "<approved-image-url>" -o "<scratchpad>/eggs-raw/common-raw.png"
```

Expected: file exists and is a valid PNG (non-zero size).

### Task 2: Generate the five remaining rarities as reference edits

**Files:**
- Create (scratchpad): `<scratchpad>/eggs-raw/{uncommon,rare,epic,legendary,mythic}-raw.png`

**Interfaces:**
- Consumes: approved common-egg generation (image reference) from Task 1.
- Produces: five raw egg images with identical silhouette, one per remaining rarity.

- [ ] **Step 1: Generate each rarity as an edit of the reference**

For each rarity below, call `generate_image` (Nano Banana Pro, 1:1) with the approved common egg attached as the input/reference image and this prompt frame:

> Keep the exact same cartoon dinosaur egg: same shape, same size, same position, same outline, same framing, same plain flat light-gray studio background. Change only the shell design: {RESKIN}. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements.

`{RESKIN}` per rarity:

- **uncommon:** "moss-green eggshell (around #2ecc71) decorated with a simple pattern of small darker-green leaf shapes, subtle glossy highlight"
- **rare:** "ocean-blue eggshell (around #3498db) with a wavy water-sheen pattern wrapping the shell and a few small water droplets on the surface, glossy wet-look highlights"
- **epic:** "violet eggshell (around #9b59b6) with angular crystal facets embedded in the surface and a soft purple glow emanating from the facets, kept tight to the shell"
- **legendary:** "polished golden eggshell (around #f1c40f) engraved with elegant curved rune lines, radiating short golden rays of light kept close to the shell"
- **mythic:** "jet-black obsidian eggshell covered in jagged glowing orange lava cracks, faint orange embers rising just above the shell, dramatic inner glow through the cracks, kept tight to the shell"

Poll `job_status` for each; the five calls can be issued and polled concurrently.

- [ ] **Step 2: Sanity-check silhouettes**

View each result (`job_display` or Read after download). If any egg's shape/outline drifts from the reference, regenerate that rarity from the same reference — do not accept drift.

- [ ] **Step 3: Download all five raw images**

```bash
for r in uncommon rare epic legendary mythic; do
  curl -sL "<image-url-for-$r>" -o "<scratchpad>/eggs-raw/$r-raw.png"
done
```

Expected: five valid PNGs in `<scratchpad>/eggs-raw/`.

### Task 3: Background removal, resize, transparency verification

**Files:**
- Create: `assets/images/eggs/common.png`, `uncommon.png`, `rare.png`, `epic.png`, `legendary.png`, `mythic.png`
- Create (scratchpad): `<scratchpad>/finalize-eggs.mjs`

**Interfaces:**
- Consumes: six raw PNGs from Tasks 1–2 (as Higgsfield media for `remove_background`).
- Produces: the six final repo asset files `assets/images/eggs/<rarity>.png`, 1024×1024 RGBA with transparent corners.

- [ ] **Step 1: Remove backgrounds**

For each of the six generations, call `remove_background` (pass the generation/media reference from the earlier job), poll `job_status`, and download the cutout:

```bash
mkdir -p "<scratchpad>/eggs-cut"
curl -sL "<cutout-url-for-$r>" -o "<scratchpad>/eggs-cut/$r.png"
```

Glow check (epic/legendary/mythic): view each cutout. If matting clipped the glow into hard ugly edges, fall back per spec — regenerate that rarity on a flat dark-neutral background with glow kept tight to the shell, then re-mat.

- [ ] **Step 2: Write the finalize script**

Create `<scratchpad>/finalize-eggs.mjs`:

```js
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [srcDir, outDir] = process.argv.slice(2);
const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
mkdirSync(outDir, { recursive: true });

for (const r of rarities) {
  const img = await loadImage(readFileSync(join(srcDir, `${r}.png`)));
  const canvas = createCanvas(1024, 1024);
  const cx = canvas.getContext('2d');
  // fit the egg into the square, centered, preserving aspect
  const scale = Math.min(1024 / img.width, 1024 / img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  cx.drawImage(img, (1024 - w) / 2, (1024 - h) / 2, w, h);
  // transparency check: all four corners must be fully transparent
  for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]]) {
    const a = cx.getImageData(x, y, 1, 1).data[3];
    if (a !== 0) throw new Error(`${r}: corner ${x},${y} not transparent (alpha=${a})`);
  }
  writeFileSync(join(outDir, `${r}.png`), canvas.toBuffer('image/png'));
  console.log(`${r}: OK 1024x1024 transparent`);
}
```

- [ ] **Step 3: Run it**

```bash
cd "<repo>"
node "<scratchpad>/finalize-eggs.mjs" "<scratchpad>/eggs-cut" "assets/images/eggs"
```

Expected output: six `<rarity>: OK 1024x1024 transparent` lines. A thrown corner-alpha error means background removal left residue — redo Step 1 for that rarity.

- [ ] **Step 4: Visual QA**

Read each `assets/images/eggs/<rarity>.png` and confirm: shared silhouette, correct shell color/motif per the spec table, effects intact after matting.

- [ ] **Step 5: Run the image tests**

Run: `npx vitest run tests/images.test.ts`
Expected: PASS — present-file cases for common and mythic now resolve.

### Task 4: Record prompts, full test run, commit

**Files:**
- Modify: `docs/assets/prompts.md` (append egg section; update the stale intro reference if needed)

**Interfaces:**
- Consumes: final prompts actually used in Tasks 1–2 (including any user-driven adjustments).

- [ ] **Step 1: Append an "Egg rarities" section to `docs/assets/prompts.md`**

Add a `## Egg rarities` section documenting: file target table (`assets/images/eggs/<rarity>.png`, 1024×1024, transparent, embed thumbnail + hatch hero), the reference-chain workflow (common generated first, others are edits of it, then `remove_background`), the exact common-egg prompt as finally approved, and the five `{RESKIN}` fragments as finally used. Copy the real prompts from the session — not the plan's draft text — if the user checkpoint changed them.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all tests pass (228+).

- [ ] **Step 3: Commit assets + docs together**

```bash
git add assets/images/eggs docs/assets/prompts.md
git commit -m "Regenerate egg rarity art as a reference-chained set"
```

- [ ] **Step 4: Manual Discord spot-check (user-assisted, optional)**

Suggest the user run `/shop` or `/hatchery` on the dev guild to confirm thumbnails render on dark theme. No deploy-commands needed — no command builders changed.
