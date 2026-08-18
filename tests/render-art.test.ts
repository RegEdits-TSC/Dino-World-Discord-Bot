import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EMPTY_ART, loadParkArt, loadSvgImage } from '../src/core/render/art.js';
import { RARITY } from '../src/data/rarity.js';
import { ATTRACTIONS } from '../src/data/attractions.js';
import type { Rarity } from '../src/data/types.js';

describe('EMPTY_ART', () => {
  it('is exhaustive over every rarity with all-null entries', () => {
    expect(EMPTY_ART.ground).toBeNull();
    expect(EMPTY_ART.groundBySeason).toEqual({ wet: null, dry: null, cold: null });
    expect(EMPTY_ART.platePaddock).toBeNull();
    expect(EMPTY_ART.plateFacility).toBeNull();
    expect(EMPTY_ART.lotIcons).toEqual({});
    // `Record<Rarity, …>` is only honest if every key is actually present: a `{}` cast would let a
    // future rarity read back `undefined` and hit `drawImage(undefined)`, which throws inside the
    // render and costs that user the whole park image.
    for (const r of Object.keys(RARITY) as Rarity[]) {
      expect(Object.hasOwn(EMPTY_ART.dinoChips, r), `dinoChips missing key ${r}`).toBe(true);
      expect(EMPTY_ART.dinoChips[r]).toBeNull();
    }
    // The OPEN shape, exactly like lotIcons and deliberately unlike dinoChips/groundBySeason/landmarks:
    // attraction slugs are not a closed union, so an absent key reading back `undefined` is the
    // intended, tested behaviour (tests/render-draw.test.ts renders a `retired_kind` and requires no
    // throw). An exhaustively-keyed Record would break that promise.
    expect(EMPTY_ART.attractions).toEqual({});
  });
});

describe('loadSvgImage', () => {
  it('decodes a committed SVG with no await, and returns null for a missing file', () => {
    const img = loadSvgImage(resolve(process.cwd(), 'assets/emojis/svg/dw_cash.svg'));
    expect(img).not.toBeNull();
    expect(img!.width).toBeGreaterThan(0);
    expect(loadSvgImage(resolve(process.cwd(), 'assets/emojis/svg/dw_not_a_real_icon.svg'))).toBeNull();
  });
});

describe('loadParkArt', () => {
  it('loads every lot icon and dino chip, and leaves unknown lot kinds unmapped', async () => {
    const art = await loadParkArt();
    // The three season ground rasters share the raster loader's own Promise.all with the base
    // ground and both plates — see art.ts's loadParkArt — so a season raster going missing from
    // disk fails exactly like ground.webp going missing: silently, to null, never a rejection.
    for (const season of ['wet', 'dry', 'cold'] as const) {
      expect(art.groundBySeason[season], `no ${season} ground loaded`).not.toBeNull();
      expect(art.groundBySeason[season]!.width).toBeGreaterThan(0);
    }
    for (const kind of ['carnivore_paddock', 'herbivore_paddock', 'food_court', 'hatchery_lab', 'visitor_center']) {
      expect(art.lotIcons[kind], `no icon loaded for lot kind ${kind}`).not.toBeNull();
      expect(art.lotIcons[kind]!.width).toBeGreaterThan(0);
    }
    // hatchery_lab -> dw_lot_hatchery and visitor_center -> dw_lot_visitor defeat any prefix rule,
    // so the mapping is explicit; a kind with no entry must read back undefined and fall through to
    // lotIcon()'s 🏢/🌿 glyph rather than resolving to some near-miss file.
    expect(art.lotIcons['not_a_real_kind']).toBeUndefined();
    for (const r of Object.keys(RARITY) as Rarity[]) {
      expect(art.dinoChips[r], `no dino chip loaded for ${r}`).not.toBeNull();
    }
  });

  // The "resolves with all-null art" test below proves loadParkArt degrades cleanly when nothing is
  // on disk, but an all-null result is exactly what a MISSPELLED filename ('landmark-a.wepb') also
  // produces — that test can't tell "file missing" from "filename wrong" apart, since both resolve
  // null. This is the only assertion that reads the real committed assets/images/park/landmark-*.webp
  // files and would catch a typo in art.ts's raster('landmark-a.webp') calls.
  it('loads all three landmark bands from the real asset directory', async () => {
    const art = await loadParkArt();
    for (const band of ['a', 'b', 'c'] as const) {
      expect(art.landmarks[band], `assets/images/park/landmark-${band}.webp missing or undecodable`).not.toBeNull();
      expect(art.landmarks[band]!.width).toBeGreaterThan(0);
    }
  });

  // The kind list drives both the reads and the keys they are stored under, inside loadParkArt, so a
  // hand-swapped kind→image pairing is not expressible — the defect class
  // tests/render-park-art.test.ts:114-127 documents for groundBySeason, where a swapped pair in an
  // object literal is silent and green. No attraction raster is committed yet, so every value is null
  // today; this asserts the KEYS, which is the part that must not drift.
  it('carries one attraction slot per catalog kind, and leaves unknown slugs unmapped', async () => {
    const art = await loadParkArt();
    expect(Object.keys(art.attractions).sort()).toEqual(Object.keys(ATTRACTIONS).sort());
    // A slug with no entry must read back undefined and fall through to the flat fill, never resolve
    // to some near-miss file — the same contract lotIcons['not_a_real_kind'] is pinned on above.
    expect(art.attractions['retired_kind']).toBeUndefined();
  });

  it('resolves with all-null art instead of rejecting when nothing is on disk', async () => {
    // Every read is relative to process.cwd(), so an empty temp cwd reproduces a deploy that shipped
    // without assets/. Rejection is the failure mode that matters: worker.ts top-level-awaits this,
    // and a rejected module boot fires client.ts's 'error' handler, which terminates and nulls the
    // worker — every later /park view silently loses its image and respawns another doomed worker.
    // (vitest's default `forks` pool runs this file in a child process, where process.chdir exists.)
    const cwd = process.cwd();
    process.chdir(mkdtempSync(join(tmpdir(), 'dw-park-art-')));
    try {
      const art = await loadParkArt();
      expect(art.ground).toBeNull();
      expect(art.groundBySeason).toEqual({ wet: null, dry: null, cold: null });
      expect(art.platePaddock).toBeNull();
      expect(art.plateFacility).toBeNull();
      expect(art.lotIcons['carnivore_paddock']).toBeNull();
      expect(art.dinoChips.mythic).toBeNull();
      expect(art.landmarks).toEqual({ a: null, b: null, c: null });
      expect(art.attractions['gift_shop']).toBeNull();
    } finally {
      process.chdir(cwd);
    }
  });
});
