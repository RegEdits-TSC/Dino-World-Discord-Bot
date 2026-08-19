import { Image } from '@napi-rs/canvas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RARITY } from '../../data/rarity.js';
import type { Rarity } from '../../data/types.js';
import type { Season } from '../world.js';
import type { LandmarkBand } from '../../data/landmarks.js';
import { ATTRACTIONS } from '../../data/attractions.js';

export interface ParkArt {
  ground: Image | null;
  // One raster per cosmetic season (src/core/world.ts's Season), drawn INSTEAD of `ground` when
  // the snapshot names a season and that season's raster loaded. Keyed exhaustively so a lookup by
  // any Season value reads back Image | null, never undefined — the same reasoning as dinoChips
  // below, and for the same failure mode: drawImage(undefined) throws exactly like
  // drawImage(null) does, costing the whole park image.
  groundBySeason: Record<Season, Image | null>;
  platePaddock: Image | null;
  plateFacility: Image | null;
  lotIcons: Record<string, Image | null>;
  dinoChips: Record<Rarity, Image | null>;
  // One raster per landmark art band (src/data/landmarks.ts). Keyed exhaustively for the
  // same reason dinoChips and groundBySeason are: a lookup by a real band must read back
  // Image | null, never undefined, because drawImage(undefined) throws exactly like
  // drawImage(null) and costs the whole park image.
  landmarks: Record<LandmarkBand, Image | null>;
  // One raster per built attraction kind (src/data/attractions.ts). Deliberately the OPEN lotIcons
  // shape, NOT the exhaustively-keyed landmarks/dinoChips/groundBySeason shape: attraction slugs are
  // not a closed union — AttractionDef.kind is a plain string and the attractions table carries no
  // SQL CHECK — and renderParkPng must tolerate a retired slug, which
  // tests/render-draw.test.ts's "renders an attraction of an unknown or retired kind without throwing"
  // machine-gates. An exhaustive Record<AttractionKind, …> would break that promise.
  //
  // The cost of the open shape: a lookup miss reads back `undefined` even though it TYPES as
  // Image | null (tsconfig sets strict but not noUncheckedIndexedAccess), so every draw site must
  // guard with `if (img)` and never `if (img !== null)` — drawImage(undefined) throws the identical
  // TypeError drawImage(null) does, and that throw costs the user the whole park image.
  attractions: Record<string, Image | null>;
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

function nullSeasons(): Record<Season, Image | null> {
  return { wet: null, dry: null, cold: null };
}

function nullLandmarks(): Record<LandmarkBand, Image | null> {
  return { a: null, b: null, c: null };
}

export const EMPTY_ART: ParkArt = {
  ground: null, groundBySeason: nullSeasons(), platePaddock: null, plateFacility: null,
  lotIcons: {}, dinoChips: nullChips(), landmarks: nullLandmarks(), attractions: {},
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

  // One kind list drives both the reads and the keys they are stored under, so a mis-paired
  // kind->image entry is not expressible by hand. That matters because the alternative — one more
  // named slot per kind in the destructure below — makes a swapped pair silent and green
  // (tests/render-park-art.test.ts:114-127 records that exact defect class for groundBySeason).
  //
  // Spread into the EXISTING Promise.all, never awaited separately: each read still goes through
  // raster() -> loadRasterImage, whose own try/catch is what makes this whole call non-rejecting, and
  // a second await would be a second chance for worker.ts's top-level await to reject — which
  // terminates and nulls the worker, costing every later /park view its image.
  const attractionKinds = Object.keys(ATTRACTIONS);

  const [ground, platePaddock, plateFacility, groundWet, groundDry, groundCold, markA, markB, markC,
    ...attractionImages] = await Promise.all([
    raster('ground.webp'), raster('plate-paddock.webp'), raster('plate-facility.webp'),
    raster('ground-wet.webp'), raster('ground-dry.webp'), raster('ground-cold.webp'),
    raster('landmark-a.webp'), raster('landmark-b.webp'), raster('landmark-c.webp'),
    ...attractionKinds.map((kind) => raster(`attraction-${kind}.webp`)),
  ]);

  const lotIcons: Record<string, Image | null> = {};
  for (const [kind, file] of Object.entries(LOT_ICON_SVG)) lotIcons[kind] = svg(file);

  const dinoChips = nullChips();
  for (const r of Object.keys(RARITY) as Rarity[]) dinoChips[r] = svg(`dw_dino_${r}`);

  // Filename is the slug verbatim, underscores and all (attraction-gift_shop.webp), so a raster named
  // attraction-gift-shop.webp resolves to null and the cell silently keeps its flat fill.
  const attractions: Record<string, Image | null> = {};
  attractionKinds.forEach((kind, i) => { attractions[kind] = attractionImages[i]; });

  return {
    ground, groundBySeason: { wet: groundWet, dry: groundDry, cold: groundCold },
    platePaddock, plateFacility, lotIcons, dinoChips,
    landmarks: { a: markA, b: markB, c: markC }, attractions,
  };
}
