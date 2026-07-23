# Egg-in-nest rarity art — design

Date: 2026-07-23
Status: approved
Supersedes: `2026-07-23-egg-rarity-art-design.md` (that set shipped at 6927710
and is being replaced; its working-tree deletion lands with this change).

## Goal

Replace the six egg rarity images with a new set where each egg sits in a
dinosaur nest. Two changes drive the redesign:

1. **Nest**: every egg sits in a low woven twig-and-leaf nest, grounding the
   floating-egg look.
2. **No glow past the silhouette**: the previous set's glow/rays/embers
   extended beyond the shell and survived background removal as floating
   islands on transparency. The new set bans any light effect outside the
   egg/nest silhouette; emissive detail is allowed only on surfaces.

No code changes: `assetImage('eggs', rarity)` (src/core/images.ts) picks the
files up as soon as they exist, and the two currently-failing assertions in
`tests/images.test.ts` (common and mythic present-file cases) go green again.

## Deliverables

Six transparent PNGs, 1024×1024:

```
assets/images/eggs/common.png
assets/images/eggs/uncommon.png
assets/images/eggs/rare.png
assets/images/eggs/epic.png
assets/images/eggs/legendary.png
assets/images/eggs/mythic.png
```

Plus a rewritten "Egg rarities" section in `docs/assets/prompts.md` recording
the final prompts, the nest workflow, and the no-glow rule (that file declares
itself the source of truth for regenerating assets).

## Visual spec

- **Composition:** single upright egg, ~70–75% of frame height, centered. Low
  woven twig-and-leaf nest ring around the bottom quarter of the frame; the
  egg sits in the nest and the nest never covers more than the lower fifth of
  the shell. Egg-dominant so the shape still reads at 80px thumbnail size.
- **Nest:** classic woven brown twigs with a few green leaves tucked in. The
  nest base is identical across all six rarities (locked by the reference
  chain); rarity shows through subtle nest dressing on top of the shared base.
- **Generation background:** flat light-gray studio background, matted away in
  post. The shipped PNGs are transparent outside the egg+nest silhouette.
- **Hard no-glow rule (all six):** no glow, rays, embers, sparkles, or light
  effects extending past the egg/nest silhouette. Emissive detail is allowed
  only ON surfaces (crystal facets, runes, lava cracks). This is what keeps
  background removal clean.
- **Style:** the shared style block from `docs/assets/prompts.md` (glossy
  cartoon mobile-game art, bold dark outlines, vibrant saturated colors, cel
  shading, no text/characters/UI), so eggs and expedition-site art stay one
  family.
- **Shell colors track the embed accent colors** in
  `src/modules/hatchery/embeds.ts` so the thumbnail matches the embed sidebar.
  Exception: mythic keeps the obsidian-and-lava motif (the `volcano_core` site
  art was generated to match it); its lava orange-red sits close enough to the
  red embed accent (#e74c3c).

| Rarity | Shell | Nest dressing |
|---|---|---|
| common | gray-white (~#95a5a6), brown speckles | plain twigs, 2–3 green leaves |
| uncommon | moss green (~#2ecc71), darker leaf pattern | extra fresh leaves and tiny white flowers woven in |
| rare | ocean blue (~#3498db), wavy water-sheen, droplets | a few smooth blue pebbles and small seashells in the twigs |
| epic | violet (~#9b59b6), embedded crystal facets, facet glow on surface only | small amethyst shards among the twigs |
| legendary | polished gold (~#f1c40f), engraved runes, no rays | thin gold ribbon and tiny gold trinkets woven through |
| mythic | obsidian black, glowing orange lava cracks, inner glow contained, no floating embers | charred dark twigs, a few obsidian pebbles, ember-orange painted twig tips |

Flair intensity escalates up the ladder: common is plain; mythic is dramatic —
but every rarity obeys the no-glow rule.

## Pipeline

Generation runs on Higgsfield Nano Banana Pro (reference-chain workflow for
silhouette + nest consistency):

1. Generate the **common** egg-in-nest on the flat light-gray studio
   background, 1:1.
2. **Checkpoint:** user approves silhouette, nest shape, and style before any
   further generation. The approved image becomes the locked reference for the
   whole set.
3. Generate the other five as image-edits, each with the approved common
   attached as the reference. Prompt frame: "Keep the exact same egg, same
   nest, same position, same framing, same background. Change only:
   {shell reskin} + {nest dressing}." All five edit from the common reference
   directly — no chained edits, so drift never accumulates.
4. `remove_background` on each of the six → scale down to fit if larger, then
   center on a 1024×1024 transparent canvas → save to
   `assets/images/eggs/<rarity>.png`.
5. Rewrite the "Egg rarities" section of `docs/assets/prompts.md` with the
   final prompts, nest workflow, dressing table, and no-glow rule.
6. **Checkpoint:** user reviews all six matted results side by side.
7. Run the test suite; commit the six deletions + six new PNGs + prompts.md in
   one commit.

The batch of five runs without per-image stops unless drift is spotted.

## Error handling / risks

- **Reskin drift** (nest or egg shape shifts in an edit): regenerate that
  rarity only, with tightened "keep identical" language. The reference is
  always the approved common, so drift never compounds.
- **Matting damage** (background removal clips lava cracks or dark twig edges,
  most likely on mythic): inspect matted edges per image; if clipped,
  regenerate with stronger silhouette contrast rather than hand-patching
  pixels.
- **Rollback:** the previous set lives at commit 6927710 and is recoverable
  with `git checkout` if the new set is rejected. The working-tree deletions
  stay uncommitted until final approval.
- **Budget:** Higgsfield Plus trial is active; six generations plus retries
  fit comfortably.
- **Absent-art degradation:** already handled — `assetImage` returns null for
  missing files and embeds render without art, so partial progress never
  breaks the bot.

## Testing

- Existing `tests/images.test.ts` covers the present-file path (common,
  mythic) and the missing-file null path; no new tests needed — this change
  restores the fixture files the suite already asserts on.
- Transparency check per image: corners and edges fully transparent, no
  floating pixel islands outside the egg+nest silhouette.
- Manual check: hatch-reveal hero and shop/hatchery thumbnails render each
  rarity on Discord dark theme.
