import { Image } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RARITY } from '../../data/rarity.js';
import type { Rarity } from '../../data/types.js';

export interface ParkArt {
  ground: Image | null;
  platePaddock: Image | null;
  plateFacility: Image | null;
  lotIcons: Record<string, Image | null>;
  dinoChips: Record<Rarity, Image | null>;
}

// Lot kind -> SVG basename. Not mechanical: hatchery_lab -> dw_lot_hatchery and
// visitor_center -> dw_lot_visitor defeat any prefix/suffix rule. Kinds absent
// here stay unmapped on purpose, so drawTile falls back to lotIcon()'s glyph.
const LOT_ICON_SVG: Record<string, string> = {
  carnivore_paddock: 'dw_lot_carnivore',
  herbivore_paddock: 'dw_lot_herbivore',
  food_court: 'dw_lot_food_court',
  hatchery_lab: 'dw_lot_hatchery',
  visitor_center: 'dw_lot_visitor',
  gene_lab: 'dw_lot_genelab',
};

function nullChips(): Record<Rarity, Image | null> {
  return { common: null, uncommon: null, rare: null, epic: null, legendary: null, mythic: null };
}

export const EMPTY_ART: ParkArt = {
  ground: null, platePaddock: null, plateFacility: null,
  lotIcons: {}, dinoChips: nullChips(),
};

// SVG only. @napi-rs/canvas decodes SVG buffers synchronously, so there is nothing to await — which
// is what lets the synchronous renderer draw these. A raster (PNG or WebP) through this path would
// silently draw a blank rectangle with no error (see CLAUDE.md); use the internal raster loader in
// loadParkArt for those.
export function loadSvgImage(absPath: string): Image | null {
  try {
    const img = new Image();
    img.src = readFileSync(absPath);
    return img;
  } catch { return null; }
}

// WebP decodes asynchronously exactly like PNG — verified: setting `src` and drawing in the same
// tick yields an all-zero canvas. The await below is load-bearing, not ceremony.
async function loadRasterImage(absPath: string): Promise<Image | null> {
  try {
    const img = new Image();
    img.src = readFileSync(absPath);
    await img.decode();
    return img;
  } catch { return null; }
}

// Never rejects: each read has its own catch so one missing file cannot sink its siblings, and the
// whole call is the worker's top-level await — a rejection there permanently costs /park view its
// image (client.ts terminates and nulls the worker, then respawns another doomed one).
export async function loadParkArt(): Promise<ParkArt> {
  const raster = (name: string) => loadRasterImage(resolve(process.cwd(), 'assets/images/park', name));
  const svg = (name: string) => loadSvgImage(resolve(process.cwd(), 'assets/emojis/svg', `${name}.svg`));

  const [ground, platePaddock, plateFacility] = await Promise.all([
    raster('ground.webp'), raster('plate-paddock.webp'), raster('plate-facility.webp'),
  ]);

  const lotIcons: Record<string, Image | null> = {};
  for (const [kind, file] of Object.entries(LOT_ICON_SVG)) lotIcons[kind] = svg(file);

  const dinoChips = nullChips();
  for (const r of Object.keys(RARITY) as Rarity[]) dinoChips[r] = svg(`dw_dino_${r}`);

  return { ground, platePaddock, plateFacility, lotIcons, dinoChips };
}
