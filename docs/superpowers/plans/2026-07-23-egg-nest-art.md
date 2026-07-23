# Egg-in-Nest Rarity Art Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the six egg rarity PNGs (`assets/images/eggs/*.png`, transparent, 1024×1024) with a new set where each egg sits in a woven twig nest, with all light effects confined to the egg/nest silhouette so background matting stays clean.

**Architecture:** Generate the common egg-in-nest first on a flat light-gray studio background; after user approval it becomes the locked reference. The other five rarities are image-edits of that reference ("same egg, same nest — change only shell + nest dressing"), all editing from the common directly so drift never compounds. Every image then goes through background removal, scale-and-center onto a 1024×1024 transparent canvas, and an automated transparency check (edges + floating-island scan) before landing in `assets/images/eggs/`. No bot code changes: `assetImage('eggs', rarity)` (src/core/images.ts) picks the files up, and the two currently-failing assertions in `tests/images.test.ts` go green.

**Tech Stack:** Higgsfield MCP tools (`generate_image`, `remove_background`, `job_status`, `job_display`), curl for downloads, `@napi-rs/canvas` (already a dependency) for compositing + verification, vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-egg-nest-art-design.md`

## Global Constraints

- Shared style block appended verbatim to every generation prompt: "Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements."
- **Hard no-glow rule appended verbatim to every generation prompt:** "No glow, rays, embers, sparkles, or light effects extending beyond the egg or the nest; glowing details may appear only on the surfaces themselves."
- Composition: single upright egg ~70–75% of frame height, centered; low woven twig-and-leaf nest ring around the bottom quarter of the frame; nest never covers more than the lower fifth of the shell.
- Shell colors track the embed accent colors in `src/modules/hatchery/embeds.ts:9` (common 0x95a5a6, uncommon 0x2ecc71, rare 0x3498db, epic 0x9b59b6, legendary 0xf1c40f). Mythic is the exception: locked to obsidian black + glowing orange lava cracks (matches `volcano_core` site art), not the red embed accent.
- One shared egg silhouette and one shared nest base across all six; rarity is expressed only via shell design and subtle nest dressing.
- Final files: `assets/images/eggs/{common,uncommon,rare,epic,legendary,mythic}.png`, 1024×1024, transparent background, no pixel content outside the egg+nest silhouette.
- `docs/assets/prompts.md` is the source of truth for prompts — rewrite its "Egg rarities" section with the final prompts in the same change.
- The six old egg PNGs are already deleted in the working tree (uncommitted); writing the new files to the same paths turns each deletion into a plain modification — no special git handling needed.
- **This plan requires user interaction (Task 1 and Task 4 approval checkpoints) and Higgsfield MCP access — execute inline in the main session, not via subagents.**
- Scratchpad for intermediate downloads: the session scratchpad directory (never `/tmp`, never the repo). Written as `<scratchpad>` below.

---

### Task 1: Generate and approve the common (reference) egg-in-nest

**Files:**
- Create (scratchpad only at this stage): `<scratchpad>/eggs-raw/common-raw.png`

**Interfaces:**
- Produces: an approved raw common egg-in-nest image (Higgsfield generation id + URL) that Task 2 uses as the edit reference, and the final common prompt text (with any user-driven adjustments) that Task 4 records in prompts.md.

- [ ] **Step 1: Load Higgsfield MCP tools**

One ToolSearch call:

```
ToolSearch query: "select:mcp__claude_ai_Higgsfield__generate_image,mcp__claude_ai_Higgsfield__job_status,mcp__claude_ai_Higgsfield__remove_background,mcp__claude_ai_Higgsfield__job_display"
```

- [ ] **Step 2: Confirm baseline test failure**

Run: `npx vitest run tests/images.test.ts`
Expected: FAIL — the `eggs/common` present-file assertions (tests/images.test.ts:6–9) and the `eggs/mythic` cache-check assertions (tests/images.test.ts:16–17) fail because the files were deleted from the working tree.

- [ ] **Step 3: Generate the common egg-in-nest**

Call `generate_image` with model Nano Banana Pro, square aspect (1:1), prompt:

> A single large cartoon dinosaur egg standing upright, sitting in a low woven nest of brown twigs with two or three green leaves tucked in, perfectly centered: smooth gray-white eggshell with scattered small brown speckles, one soft glossy highlight on the upper left of the shell. The egg fills about three quarters of the frame height; the nest is a low ring around the bottom quarter of the frame, covering only the very base of the egg. Plain flat light-gray studio background, no scenery. No glow, rays, embers, sparkles, or light effects extending beyond the egg or the nest; glowing details may appear only on the surfaces themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements.

Poll `job_status` until complete; show the result to the user via `job_display`.

- [ ] **Step 4: USER CHECKPOINT — approve silhouette, nest shape, and style**

Stop and ask the user to approve the common egg-in-nest before generating anything else. If rejected, adjust the prompt per their feedback and regenerate (repeat Step 3). Do not proceed to Task 2 without explicit approval. Record the final approved prompt text — Task 4 copies it into prompts.md.

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
- Consumes: approved common egg-in-nest generation (image reference) from Task 1.
- Produces: five raw egg-in-nest images with identical egg silhouette and nest base, one per remaining rarity, plus the final `{SHELL}`/`{NEST}` fragments (with any adjustments) that Task 4 records in prompts.md.

- [ ] **Step 1: Generate each rarity as an edit of the reference**

For each rarity below, call `generate_image` (Nano Banana Pro, 1:1) with the approved common egg attached as the input/reference image and this prompt frame:

> Keep the exact same cartoon dinosaur egg and the exact same woven twig nest: same shape, same size, same position, same outline, same framing, same plain flat light-gray studio background. Change only the egg shell design and add small nest decorations: {SHELL}. {NEST}. No glow, rays, embers, sparkles, or light effects extending beyond the egg or the nest; glowing details may appear only on the surfaces themselves. Glossy cartoon mobile-game art style, bold dark outlines, vibrant saturated colors, strong glossy highlights, clean cel shading with smooth gradients, polished game-asset look. No text, no characters, no UI elements.

`{SHELL}` / `{NEST}` per rarity:

- **uncommon**
  - SHELL: "moss-green eggshell (around #2ecc71) decorated with a simple pattern of small darker-green leaf shapes, subtle glossy highlight"
  - NEST: "weave a few extra fresh green leaves and tiny white flowers into the twigs"
- **rare**
  - SHELL: "ocean-blue eggshell (around #3498db) with a wavy water-sheen pattern wrapping the shell and a few small water droplets on the surface, glossy wet-look highlights"
  - NEST: "tuck a few smooth blue pebbles and small seashells between the twigs"
- **epic**
  - SHELL: "violet eggshell (around #9b59b6) with angular crystal facets embedded in the surface, the facets glowing softly on the shell surface only"
  - NEST: "place a few small violet amethyst crystal shards among the twigs"
- **legendary**
  - SHELL: "polished golden eggshell (around #f1c40f) engraved with elegant curved rune lines, the engraving gleaming on the shell surface only, no rays of light"
  - NEST: "weave a thin gold ribbon and a few tiny gold trinkets through the twigs"
- **mythic**
  - SHELL: "jet-black obsidian eggshell covered in jagged glowing orange lava cracks, dramatic inner glow visible only through the cracks, no floating embers"
  - NEST: "make the twigs charred and dark with ember-orange painted tips, and add a few small black obsidian pebbles"

Poll `job_status` for each; the five calls can be issued and polled concurrently.

- [ ] **Step 2: Sanity-check silhouettes and the no-glow rule**

View each result (`job_display` or Read after download). Reject and regenerate a rarity (from the same common reference, with tightened "keep identical" language) if any of:
- the egg shape/outline or nest shape drifts from the reference,
- any glow, rays, embers, or sparkles extend past the egg/nest silhouette (most likely on epic/legendary/mythic).

Do not accept drift or off-silhouette glow — matting cleanliness depends on it.

- [ ] **Step 3: Download all five raw images**

```bash
for r in uncommon rare epic legendary mythic; do
  curl -sL "<image-url-for-$r>" -o "<scratchpad>/eggs-raw/$r-raw.png"
done
```

Expected: five valid PNGs in `<scratchpad>/eggs-raw/`.

### Task 3: Background removal, finalize, transparency verification

**Files:**
- Create: `assets/images/eggs/common.png`, `uncommon.png`, `rare.png`, `epic.png`, `legendary.png`, `mythic.png`
- Create (scratchpad): `<scratchpad>/finalize-eggs.mjs`

**Interfaces:**
- Consumes: six raw generations from Tasks 1–2 (as Higgsfield media for `remove_background`).
- Produces: the six final repo asset files `assets/images/eggs/<rarity>.png`, 1024×1024 RGBA, fully transparent outside one connected egg+nest silhouette.

- [ ] **Step 1: Remove backgrounds**

For each of the six generations, call `remove_background` (pass the generation/media reference from the earlier job), poll `job_status`, and download the cutout:

```bash
mkdir -p "<scratchpad>/eggs-cut"
curl -sL "<cutout-url-for-$r>" -o "<scratchpad>/eggs-cut/$r.png"
```

Edge check (mythic especially): view each cutout. If matting clipped lava cracks or chewed dark twig edges into ragged shapes, regenerate that rarity with stronger silhouette contrast against the light-gray background, then re-mat — do not hand-patch pixels.

- [ ] **Step 2: Write the finalize script**

Create `<scratchpad>/finalize-eggs.mjs`. It scales each cutout to fit, centers it on a 1024×1024 transparent canvas, then enforces the spec's transparency requirements: every border pixel fully transparent, and exactly one connected opaque region (the egg+nest blob) — any secondary region larger than 16 pixels fails the image, smaller specks are logged.

```js
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [srcDir, outDir] = process.argv.slice(2);
const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const SIZE = 1024;
mkdirSync(outDir, { recursive: true });

for (const r of rarities) {
  const img = await loadImage(readFileSync(join(srcDir, `${r}.png`)));
  const canvas = createCanvas(SIZE, SIZE);
  const cx = canvas.getContext('2d');
  const scale = Math.min(SIZE / img.width, SIZE / img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  cx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);

  const alpha = cx.getImageData(0, 0, SIZE, SIZE).data;
  const a = (x, y) => alpha[(y * SIZE + x) * 4 + 3];

  // 1. every border pixel must be fully transparent
  for (let i = 0; i < SIZE; i++) {
    for (const [x, y] of [[i, 0], [i, SIZE - 1], [0, i], [SIZE - 1, i]]) {
      if (a(x, y) !== 0) throw new Error(`${r}: border pixel ${x},${y} not transparent (alpha=${a(x, y)})`);
    }
  }

  // 2. floating-island scan: label 4-connected components of non-transparent pixels
  const seen = new Uint8Array(SIZE * SIZE);
  const sizes = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (a(x, y) === 0 || seen[y * SIZE + x]) continue;
      let count = 0;
      const stack = [[x, y]];
      seen[y * SIZE + x] = 1;
      while (stack.length) {
        const [px, py] = stack.pop();
        count++;
        for (const [nx, ny] of [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]) {
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
          const idx = ny * SIZE + nx;
          if (!seen[idx] && a(nx, ny) !== 0) { seen[idx] = 1; stack.push([nx, ny]); }
        }
      }
      sizes.push(count);
    }
  }
  sizes.sort((p, q) => q - p);
  if (sizes.length === 0) throw new Error(`${r}: image is fully transparent`);
  const islands = sizes.slice(1);
  const big = islands.filter((s) => s > 16);
  if (big.length) throw new Error(`${r}: ${big.length} floating island(s) beyond main silhouette, sizes: ${big.join(', ')}`);
  if (islands.length) console.log(`${r}: note — ${islands.length} sub-16px speck(s) ignored, sizes: ${islands.join(', ')}`);

  writeFileSync(join(outDir, `${r}.png`), canvas.toBuffer('image/png'));
  console.log(`${r}: OK 1024x1024, main silhouette ${sizes[0]}px, clean edges`);
}
```

- [ ] **Step 3: Run it**

```bash
cd "C:\Users\Claude\Documents\GitHub\Dino-World-Discord-Bot"
node "<scratchpad>/finalize-eggs.mjs" "<scratchpad>/eggs-cut" "assets/images/eggs"
```

Expected output: six `<rarity>: OK 1024x1024, …` lines. A border-pixel error means the cutout touches the frame edge (recrop or regenerate); a floating-island error means matting left residue or an effect escaped the silhouette — redo Step 1 for that rarity, or regenerate it if the glow itself escaped.

- [ ] **Step 4: Visual QA**

Read each `assets/images/eggs/<rarity>.png` and confirm against the spec table: shared egg silhouette and nest base, correct shell color/motif, correct nest dressing, no clipped or ragged edges after matting.

- [ ] **Step 5: Run the image tests**

Run: `npx vitest run tests/images.test.ts`
Expected: PASS — present-file cases for common and mythic now resolve.

### Task 4: Final approval, record prompts, full test run, commit

**Files:**
- Modify: `docs/assets/prompts.md` (rewrite the "Egg rarities" section, lines 40–98 in the current file)

**Interfaces:**
- Consumes: final prompts actually used in Tasks 1–2 (including any user-driven adjustments from the Task 1 checkpoint or Task 2 regenerations), and the six final PNGs from Task 3.

- [ ] **Step 1: USER CHECKPOINT — review all six matted results side by side**

Show the user all six final `assets/images/eggs/<rarity>.png` files. If any rarity is rejected, regenerate it (Task 2 Step 1 for that rarity, then Task 3) before continuing. Do not commit without approval.

- [ ] **Step 2: Rewrite the "Egg rarities" section of `docs/assets/prompts.md`**

Replace the existing `## Egg rarities` section (everything from the `## Egg rarities` heading up to but not including `## Coastal Dig (`coastal_dig`)`) with the content below — substituting the prompts actually used if the Task 1 checkpoint or Task 2 regenerations changed them:

```markdown
## Egg rarities

The six egg icons in `assets/images/eggs/` share one silhouette — an upright
egg sitting in a low woven twig-and-leaf nest — so they read as a set; rarity
is expressed only through shell design and subtle nest dressing. Shell colors
track the embed accent colors in `src/modules/hatchery/embeds.ts` (mythic is
the exception: obsidian-and-lava to match the `volcano_core` site art).

| File | Size | Use |
|---|---|---|
| `assets/images/eggs/<rarity>.png` | 1024×1024, transparent | hatch-reveal hero + shop/hatchery embed thumbnail |

`<rarity>` is one of `common`, `uncommon`, `rare`, `epic`, `legendary`,
`mythic`.

**Hard no-glow rule:** no glow, rays, embers, sparkles, or light effects may
extend beyond the egg/nest silhouette — off-silhouette glow survives
background removal as floating islands on transparency. Emissive detail is
allowed only ON surfaces (crystal facets, runes, lava cracks). Every prompt
carries this rule verbatim.

**Workflow (reference chain):** generate the common egg-in-nest first on a
plain flat light-gray studio background, then generate the other five as
image-edits of the approved common (Nano Banana Pro, `medias` role `image`) so
the egg silhouette and nest base stay identical — all five edit from the
common directly, never from each other. Run each result through
`remove_background`, then scale-and-center on a 1024×1024 transparent canvas
and verify: all border pixels transparent, exactly one connected opaque
region.

**Common (reference egg):**

> [final approved Task 1 prompt]

**Reskin edits** (each generated with the common egg attached as the `image`
reference). Prompt frame:

> Keep the exact same cartoon dinosaur egg and the exact same woven twig
> nest: same shape, same size, same position, same outline, same framing,
> same plain flat light-gray studio background. Change only the egg shell
> design and add small nest decorations: {SHELL}. {NEST}. No glow, rays,
> embers, sparkles, or light effects extending beyond the egg or the nest;
> glowing details may appear only on the surfaces themselves. Glossy cartoon
> mobile-game art style, bold dark outlines, vibrant saturated colors, strong
> glossy highlights, clean cel shading with smooth gradients, polished
> game-asset look. No text, no characters, no UI elements.

`{SHELL}` / `{NEST}` per rarity:

- **uncommon:** [final SHELL fragment] / [final NEST fragment]
- **rare:** [final SHELL fragment] / [final NEST fragment]
- **epic:** [final SHELL fragment] / [final NEST fragment]
- **legendary:** [final SHELL fragment] / [final NEST fragment]
- **mythic:** [final SHELL fragment] / [final NEST fragment]
```

The `[final …]` markers are fill-ins for the executor: copy the exact prompt
text used in the session (Task 1 Step 3 / Task 2 Step 1 as adjusted), never
leave the markers in the committed file. Also update the intro paragraph of
prompts.md (lines 3–8) if its description of the egg workflow no longer
matches ("reference chain" stays accurate; adjust wording only if needed).

- [ ] **Step 3: Full test suite**

Run: `npx vitest run`
Expected: all 278 tests pass.

- [ ] **Step 4: Commit assets + docs together**

```bash
git add assets/images/eggs docs/assets/prompts.md
git commit -m "Redesign egg rarity art as egg-in-nest set"
```

(The old PNGs were deleted from the working tree before this plan ran; writing new files to the same paths makes this commit record them as modifications.)

- [ ] **Step 5: Manual Discord spot-check (user-assisted, optional)**

Suggest the user run `/shop` or `/eggs` on the dev guild to confirm thumbnails render on dark theme. No deploy-commands needed — no command builders changed.
