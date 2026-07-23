# Egg rarity art regeneration — design

Date: 2026-07-23
Status: approved

## Goal

Regenerate the six dinosaur egg rarity images deleted at 657f904. Each egg is
unique per rarity while reading as one set. No code changes: `assetImage('eggs',
rarity)` (src/core/images.ts) picks the files up as soon as they exist, and the
two currently-failing assertions in `tests/images.test.ts` (common and mythic
present-file cases) go green again.

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

Plus a new "Egg rarities" section in `docs/assets/prompts.md` recording the
final prompts (that file declares itself the source of truth for regenerating
assets).

## Visual spec

- **Silhouette:** one shared upright cartoon egg shape across all six rarities.
  Rarity is expressed through shell color, pattern, and escalating effects —
  never through a different silhouette.
- **Composition:** centered, large readable shape (used as an 80px embed
  thumbnail and as the hatch-reveal hero). Transparent background, matching the
  old floating look; at most a subtle ground shadow.
- **Style:** the shared style block from `docs/assets/prompts.md` (glossy
  cartoon mobile-game art, bold dark outlines, vibrant saturated colors, cel
  shading, no text/characters/UI), so eggs and expedition-site art stay one
  family.
- **Shell colors track the embed accent colors** in
  `src/modules/hatchery/embeds.ts` so the thumbnail matches the embed sidebar.

| Rarity | Shell | Flair |
|---|---|---|
| common | gray-white (~#95a5a6) | brown speckles |
| uncommon | moss green (~#2ecc71) | leaf pattern |
| rare | ocean blue (~#3498db) | wave sheen, water droplets |
| epic | violet (~#9b59b6) | crystal facets, soft glow |
| legendary | gold (~#f1c40f) | engraved runes, radiant rays |
| mythic | obsidian black | glowing orange lava cracks |

Flair intensity escalates up the ladder: common is flat and plain; mythic is
dramatic. Mythic is locked to the obsidian-and-lava motif because the
`volcano_core` site art was generated to match the previous mythic egg.

## Pipeline

Generation runs on Higgsfield Nano Banana Pro (reference-chain workflow for
silhouette consistency):

1. Generate the **common** egg on a plain solid background (clean matting).
2. **Checkpoint:** user approves silhouette and style before any further
   generation.
3. Generate the other five as image-edits referencing the approved common egg
   ("same egg, reskin shell to …"), preserving silhouette and framing.
4. `remove_background` on each result → download → verify transparency →
   resize to 1024×1024.
5. Record final prompts in `docs/assets/prompts.md`.
6. Run the test suite; commit assets + docs together.

## Error handling / risks

- **Background removal vs. glow:** matting may clip soft glow effects
  (legendary rays, mythic embers). Fallback: regenerate on a flat dark-neutral
  background with glow kept tight to the shell, then re-mat.
- **Silhouette drift in edits:** if an edit changes the egg shape, regenerate
  that rarity from the reference again rather than accepting drift.
- **Absent-art degradation:** already handled — `assetImage` returns null for
  missing files and embeds render without art, so partial progress never
  breaks the bot.

## Testing

- Existing `tests/images.test.ts` covers the present-file path (common,
  mythic) and the missing-file null path; no new tests needed — this change
  restores the fixture files the suite already asserts on.
- Manual check: hatch-reveal hero and shop/hatchery thumbnails render each
  rarity on Discord dark theme.
