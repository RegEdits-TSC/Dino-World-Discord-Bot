import { describe, it, expect } from 'vitest';
import { Image, createCanvas } from '@napi-rs/canvas';
import { EmbedBuilder, type AttachmentBuilder } from 'discord.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assetImage, attach, dinoImage } from '../src/core/images.js';
import { CAMPAIGN } from '../src/data/battle/chapters/index.js';
import { allSpecies } from '../src/data/species/index.js';
import { WORLD_EVENTS } from '../src/data/world-events.js';
import type { Archetype, Diet } from '../src/data/types.js';

function srcFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? srcFiles(p) : e.name.endsWith('.ts') ? [p] : [];
  });
}

// Registers checks from the FILESYSTEM, not from src/ or a data table. A hardcoded
// list or a scrape can only ever prove "what it names, exists" — a file nobody named
// (a -vN variant, a portrait banked for a chapter that doesn't exist as data yet)
// gets zero checking and the suite stays green. Reading the directory means a file is
// checked because it EXISTS.
function namesUnder(kind: string): string[] {
  return readdirSync(resolve(process.cwd(), 'assets/images', kind))
    .filter((f) => f.endsWith('.webp'))
    .map((f) => f.replace(/\.webp$/, ''));
}

// Extracted so the predicate can be tested against SYNTHETIC input (see 'banner art'
// below) rather than only the live banner set. No -vN banner is committed yet, so a
// mutated or broken regex here would match zero real files either way — same as the
// correct one — and go undetected by anything that only reads assets/images/banners.
const isVariantName = (n: string) => /-v\d+$/.test(n);

// BANNERS is SCRAPED from src/, never hand-typed. A hand-typed list can only
// ever verify that what exists, exists: it stayed green when daily/embeds.ts
// referenced 'daily' and 'achievements' banners neither of which had a shipped
// file, because assetImage null-degrades and nothing in the list said they
// were supposed to exist. Two static reference forms carry a banner name:
// (1) a call `assetImage('banners', <name>)` — <name> may be a plain literal
// OR a ternary between two literals (care/index.ts's `neglected ? 'care_neglect'
// : 'care'`, battles/embeds.ts's `outcome.won ? 'battle_victory' :
// 'battle_defeat'`), so every quoted string after the match, not just the
// literal second-argument position, has to count; and (2) a HELP_TOPICS
// `art: { kind: 'banners', name: '<name>' }` descriptor
// (src/modules/help/index.ts) — a shape no assetImage-call regex can see at
// all. A THIRD form, world/embeds.ts's
// `` assetImage('banners', `event-${e.id}`) ``, is a template literal no
// static scrape can resolve to a name; those are covered separately below by
// looping WORLD_EVENTS. Rooted at src/ ONLY: tests/images.test.ts itself calls
// assetImage('banners', 'no-such-banner') in a null-degrade test above, and
// scraping tests/ would demand that nonexistent file exist and fail on the
// spot.
function scrapeBannerNames(): string[] {
  const names = new Set<string>();
  for (const file of srcFiles(resolve(process.cwd(), 'src'))) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const callIdx = line.indexOf("assetImage('banners'");
      if (callIdx !== -1) {
        for (const m of line.slice(callIdx).matchAll(/'([^']*)'/g)) {
          if (m[1] !== 'banners') names.add(m[1]);
        }
      }
      const topic = line.match(/kind:\s*'banners'\s*,\s*name:\s*'([^']+)'/);
      if (topic) names.add(topic[1]);
    }
  }
  return [...names].sort();
}

const BANNERS = scrapeBannerNames();

describe('assetImage', () => {
  it('returns an attachment ref for a present file', () => {
    const img = assetImage('eggs', 'common');
    expect(img).not.toBeNull();
    expect(img!.url).toBe('attachment://common.webp');
    expect(img!.file.name).toBe('common.webp');
  });
  it('returns null for a missing file', () => {
    expect(assetImage('eggs', 'no-such-rarity')).toBeNull();
    expect(assetImage('sites', 'no-such-site-banner')).toBeNull();
  });
  it('caches existence checks (same answer on repeat calls)', () => {
    expect(assetImage('eggs', 'mythic')).not.toBeNull();
    expect(assetImage('eggs', 'mythic')).not.toBeNull();
  });
  it('accepts the banners kind and null-degrades when absent', () => {
    expect(assetImage('banners', 'no-such-banner')).toBeNull();
  });
  it('ships every banner image listed in BANNERS', () => {
    for (const name of BANNERS) {
      const img = assetImage('banners', name);
      expect(img, name).not.toBeNull();
      expect(img!.url).toBe(`attachment://${name}.webp`);
    }
  });
  it('accepts the battles kind and null-degrades when absent', () => {
    expect(assetImage('battles', 'no-such-portrait')).toBeNull();
  });
  it('accepts the hatch kind and null-degrades when absent', () => {
    expect(assetImage('hatch', 'no-such-crack')).toBeNull();
  });
  it('accepts the dinos kind and null-degrades when absent', () => {
    expect(assetImage('dinos', 'no-such-archetype')).toBeNull();
  });
});

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
    expect(embed.toJSON().image?.url).toBe('attachment://common.webp');
    expect(embed.toJSON().thumbnail).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['common.webp']);
  });

  it('sets the thumbnail slot and attaches its file together', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'thumbnail', assetImage('eggs', 'common'));
    expect(embed.toJSON().thumbnail?.url).toBe('attachment://common.webp');
    expect(embed.toJSON().image).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['common.webp']);
  });

  it('appends rather than assigns, so two calls both survive in call order', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'thumbnail', assetImage('eggs', 'epic'));
    attach(embed, payload, 'image', assetImage('banners', 'eggs_incubator'));
    expect(embed.toJSON().thumbnail?.url).toBe('attachment://epic.webp');
    expect(embed.toJSON().image?.url).toBe('attachment://eggs_incubator.webp');
    expect(payload.files!.map((f) => f.name)).toEqual(['epic.webp', 'eggs_incubator.webp']);
  });

  it("appends onto a pre-initialised files array (revealPayload's shape)", () => {
    const embed = new EmbedBuilder().setTitle('t');
    const payload: { files: AttachmentBuilder[]; attachments: never[] } = { files: [], attachments: [] };
    attach(embed, payload, 'image', assetImage('hatch', 'rare-crack'));
    expect(payload.files.map((f) => f.name)).toEqual(['rare-crack.webp']);
    expect(payload.attachments).toEqual([]);
  });

  it('a missing asset between two present ones leaves the others untouched', () => {
    const { embed, payload } = blank();
    attach(embed, payload, 'thumbnail', assetImage('eggs', 'epic'));
    attach(embed, payload, 'image', assetImage('banners', 'no-such-banner'));
    expect(embed.toJSON().thumbnail?.url).toBe('attachment://epic.webp');
    expect(embed.toJSON().image).toBeUndefined();
    expect(payload.files!.map((f) => f.name)).toEqual(['epic.webp']);
  });
});

describe('banner art', () => {
  // BANNERS is a LOWER BOUND (see scrapeBannerNames above): a scrape that silently
  // finds nothing would make it.each([]) register zero tests below and this whole
  // guard would go dark with the suite still green. Assert it actually found
  // something, and separately (below) that it found everything committed.
  it('the scrape found at least one banner name — a silent scrape failure disables every check below', () => {
    expect(BANNERS.length, 'scrapeBannerNames() found nothing — did the call pattern change?').toBeGreaterThan(0);
  });

  // Closes the loop the scrape cannot close on its own: BANNERS can only prove
  // "what it found, exists" (a lower bound). This proves the reverse — every
  // non-event banner actually committed under assets/images/banners is also
  // referenced somewhere the scrape can see — catching an orphaned file just as
  // readily as a wrapped call or a switch to double quotes would silently starve
  // the scrape on the other side.
  it('references every committed non-event banner (guards the scrape itself)', () => {
    const onDisk = readdirSync(resolve(process.cwd(), 'assets/images/banners'))
      .filter((f) => f.endsWith('.webp') && !f.startsWith('event-'))
      .map((f) => f.replace(/\.webp$/, ''))
      // A `-vN` variant is another face of its base, not a banner of its own. It is
      // deliberately unreferenced from src/ until the resolver ships (spec 6b);
      // tests/asset-variants.test.ts is what proves its base exists.
      .map((n) => n.replace(/-v\d+$/, ''));
    expect([...new Set(onDisk)].filter((n) => !BANNERS.includes(n))).toEqual([]);
  });

  // The predicate itself, not the live file set: no -vN banner exists on disk yet, so
  // a floor assertion built on the current banner set would read the same before and
  // after a broken regex. Synthetic input is what makes this fail under mutation.
  // event-blood_moon and battle_victory are real committed banners that must NOT
  // match, so an over-matching predicate fails here too, not just an under-matching
  // one.
  it('the variant predicate selects variants and nothing else', () => {
    expect(['care', 'care-v2', 'care-v10', 'event-blood_moon', 'battle_victory']
      .filter(isVariantName)).toEqual(['care-v2', 'care-v10']);
  });

  // Discord scales an embed image to the embed width, so an off-size banner
  // letterboxes or crops; 1536×1024 matches the site banners already shipping.
  // Covers all 33 committed banners, not just the 24 the static scrape can see:
  // event-<id> names come from a template literal (world/embeds.ts) no scrape can
  // resolve, so they are appended here from WORLD_EVENTS directly — same
  // cross-check precedent as the CAMPAIGN/WORLD_EVENTS loops in "the committed
  // asset set" below. Without this, a future event banner committed unfitted (the
  // generator's native output is 1264×848) would letterbox on the /world hub with
  // this suite green.
  const DIMENSION_CHECKED_BANNERS = [
    ...new Set([
      ...BANNERS,
      ...WORLD_EVENTS.map((e) => `event-${e.id}`),
      // Variants are unreferenced from src/ until spec 6b, so neither the scrape nor
      // WORLD_EVENTS can see them. An unfitted variant would letterbox on the /world
      // hub exactly like an unfitted base, so register it from disk instead.
      ...namesUnder('banners').filter(isVariantName),
    ]),
  ];
  it.each(DIMENSION_CHECKED_BANNERS)('%s is 1536×1024', async (name) => {
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/banners', `${name}.webp`));
    await img.decode();
    expect(img.width).toBe(1536);
    expect(img.height).toBe(1024);
  });

  // The dimension case for this banner is REGISTERED by the it.each above, not written
  // by hand — DIMENSION_CHECKED_BANNERS is built from BANNERS, which is scraped from
  // src/. That is exactly why this test exists: a wiring form scrapeBannerNames cannot
  // read (a call wrapped across two lines, double quotes, a template literal) silently
  // drops the name out of that loop, registering zero cases for it with the suite still
  // green. Assert the name is IN the scrape, then read the file directly so a
  // committed-but-unfitted banner fails here even if the loop is somehow starved.
  it('guests is scrape-visible and ships at 1536×1024', async () => {
    expect(BANNERS, 'banners/guests is not reachable by scrapeBannerNames').toContain('guests');
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/banners', 'guests.webp'));
    await img.decode();
    expect(img.width).toBe(1536);
    expect(img.height).toBe(1024);
  });

  // Same reasoning as the guests case above: the it.each loop's case for this name is
  // REGISTERED from the scrape, so a wiring form scrapeBannerNames cannot read would
  // register zero cases for it and go dark with the suite green.
  it('dex is scrape-visible and ships at 1536×1024', async () => {
    expect(BANNERS, 'banners/dex is not reachable by scrapeBannerNames').toContain('dex');
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/banners', 'dex.webp'));
    await img.decode();
    expect(img.width).toBe(1536);
    expect(img.height).toBe(1024);
  });

  // Same reasoning as the two cases above: the it.each loop's case for this name is
  // registered from the scrape, so a wiring form scrapeBannerNames cannot read would
  // register zero cases for it and go dark with the suite still green.
  it('landmark is scrape-visible and ships at 1536×1024', async () => {
    expect(BANNERS, 'banners/landmark is not reachable by scrapeBannerNames').toContain('landmark');
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/banners', 'landmark.webp'));
    await img.decode();
    expect(img.width).toBe(1536);
    expect(img.height).toBe(1024);
  });
});

describe('site art dimensions', () => {
  // Registered from disk rather than from CAMPAIGN: the forward direction (every
  // CAMPAIGN site HAS a banner and a thumb) is already covered by 'resolves every
  // asset kind the bot references' below. This is the reverse and stricter check —
  // every committed file, including any banked ahead of its chapter's data, ships at
  // the right size for its family.
  const SITE_FILES = namesUnder('sites');
  it('found site art', () => expect(SITE_FILES.length).toBeGreaterThanOrEqual(14));
  it.each(SITE_FILES)('%s ships at its family size', async (name) => {
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/sites', `${name}.webp`));
    await img.decode();
    if (name.includes('-banner')) {
      expect([img.width, img.height], name).toEqual([1536, 1024]);
    } else {
      // volcano_core-thumb is a known 1254×1254 outlier that predates the WebP
      // conversion; docs/assets/prompts.md records it as an open item. Every other
      // thumb is square at 1024 — assert squareness for all, and 1024 for the rest.
      expect(img.width, name).toBe(img.height);
      if (name !== 'volcano_core-thumb') expect(img.width, name).toBe(1024);
    }
  });
});

describe('gene lab banner prompts', () => {
  // Same precedent as the dino archetype prompts test below: prompts.md is the
  // regeneration source of truth, so a shipped banner with no prompt row is
  // unreproducible.
  it('documents a regeneration prompt for both Gene Lab banners', () => {
    const prompts = readFileSync(new URL('../docs/assets/prompts.md', import.meta.url), 'utf8');
    for (const name of ['banners/gene_lab.webp', 'banners/gene_splice.webp']) {
      expect(prompts, name).toContain(name);
    }
  });
});

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
  // Two cutout families diverge by 7px on purpose: the boss portraits and eggs came
  // from a one-off pass at 24px, hatch cracks and dino art from fit-art.mjs at 31px.
  // Nothing enforced it until now, so a portrait run through the wrong pass shipped
  // visibly smaller than its siblings and every size/corner assertion still passed.
  const px = c.getImageData(0, 0, 1024, 1024).data;
  let minX = 1024, minY = 1024, maxX = -1, maxY = -1;
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      if (px[(y * 1024 + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const margin = Math.min(minX, minY, 1023 - maxX, 1023 - maxY);
  const expected = kind === 'battles' ? 24 : 31;
  expect(Math.abs(margin - expected), `${name} margin ${margin}, expected ~${expected}`).toBeLessThanOrEqual(1);
}

// Registered from DISK, not from CAMPAIGN: spec 6a banks portraits for chapters that
// do not exist as data yet (PORTRAIT_BOSS_IDS = CAMPAIGN.map(...) cannot see them), and
// a CAMPAIGN-derived list would give them zero checking. The forward direction — every
// CAMPAIGN boss HAS a portrait — is covered separately by 'resolves every asset kind
// the bot references' below.
const PORTRAIT_FILES = namesUnder('battles');

describe('boss portrait art', () => {
  it('found boss portraits', () => expect(PORTRAIT_FILES.length).toBeGreaterThanOrEqual(7));
  it.each(PORTRAIT_FILES)('%s is a 1024×1024 transparent cutout',
    (name) => expectTransparentCutout('battles', name));
});

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;

describe('egg art', () => {
  // eggs/ had no dimension, corner-transparency or margin check at all before spec 6a
  // — the expectTransparentCutout kind union excludes it (eggs share boss portraits'
  // 24px margin family per docs/assets/prompts.md, but with an egg-axis bias that the
  // symmetric min/max margin measurement in expectTransparentCutout isn't shaped for,
  // so this stays a simpler dimension + corner check rather than widening that helper).
  // Registered from disk so every rarity AND every future -vN variant is covered.
  const EGG_FILES = namesUnder('eggs');
  it('found egg art', () => expect(EGG_FILES.length).toBeGreaterThanOrEqual(6));
  it.each(EGG_FILES)('%s is 1024×1024 with transparent corners', async (name) => {
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/eggs', `${name}.webp`));
    await img.decode();
    expect(img.width, name).toBe(1024);
    expect(img.height, name).toBe(1024);
    const canvas = createCanvas(1024, 1024);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]] as const) {
      expect(c.getImageData(x, y, 1, 1).data[3], `${name} corner ${x},${y}`).toBe(0);
    }
  });
});

describe('hatch crack art', () => {
  // Registered from disk, not from RARITIES, so a future -vN variant gets the same
  // dimension and corner-transparency bar as the six base cracks. The multi-region
  // flood-fill guard just below stays keyed to RARITIES on purpose — see its own
  // comment.
  const CRACK_FILES = namesUnder('hatch');
  it('found crack art', () => expect(CRACK_FILES.length).toBeGreaterThanOrEqual(6));
  // 1024×1024 transparent, same square as the eggs they are edited from — NOT
  // banner-sized, so they never belong in the BANNERS size loop above.
  it.each(CRACK_FILES)('%s ships at 1024x1024 with transparent corners', async (name) => {
    const ref = assetImage('hatch', name);
    expect(ref, name).not.toBeNull();
    expect(ref!.url).toBe(`attachment://${name}.webp`);
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/images/hatch', `${name}.webp`));
    await img.decode();
    expect(img.width).toBe(1024);
    expect(img.height).toBe(1024);
    const canvas = createCanvas(img.width, img.height);
    const c2d = canvas.getContext('2d');
    c2d.drawImage(img, 0, 0);
    const px = c2d.getImageData(0, 0, img.width, img.height).data;
    for (const [x, y] of [[0, 0], [1023, 0], [0, 1023], [1023, 1023]] as const) {
      expect(px[(y * img.width + x) * 4 + 3], `corner ${x},${y}`).toBe(0);
    }
  });

  // The multi-region guard below is DELIBERATELY still keyed to the six base RARITIES,
  // never to CRACK_FILES: its assertion (multiRegion.length > 0) is evaluated ACROSS
  // THE WHOLE SET, so widening it to include every -vN variant would let a base crack
  // lose its falling shell fragments while a variant kept them, and the guard would
  // still pass. Keeping it on the fixed base set is what makes it actually test the
  // fragments, not just "some file somewhere has more than one region".
  // The cracks are the one cutout family that MUST keep several disconnected
  // alpha regions: the prompt asks for shell fragments falling away, and a
  // fragment clear of the nest is its own opaque island. prompts.md's egg pass
  // opens with "keep only the largest connected region" and verifies "exactly
  // one connected region" — applying either step here silently deletes the
  // fragments and leaves a plain open egg, which every size/corner check above
  // still passes. This is the gate for that: a blanket single-region pass over
  // the set takes the count below to 0. Individual cracks may legitimately land
  // at one region (`mythic` does), so the assertion is on the set, not per file.
  it('keeps the falling shell fragments — the set is not reduced to one region each', async () => {
    const counts: Record<string, number> = {};
    for (const rarity of RARITIES) {
      const img = new Image();
      img.src = readFileSync(resolve(process.cwd(), 'assets/images/hatch', `${rarity}-crack.webp`));
      await img.decode();
      const canvas = createCanvas(img.width, img.height);
      const c2d = canvas.getContext('2d');
      c2d.drawImage(img, 0, 0);
      const px = c2d.getImageData(0, 0, img.width, img.height).data;
      const w = img.width, total = w * img.height;
      const seen = new Uint8Array(total);
      const stack = new Int32Array(total);
      let regions = 0;
      for (let start = 0; start < total; start++) {
        if (seen[start] || px[start * 4 + 3] === 0) continue;
        regions++;
        let top = 0;
        stack[top++] = start;
        seen[start] = 1;
        while (top > 0) {
          const p = stack[--top];
          const x = p % w;
          if (x > 0 && !seen[p - 1] && px[(p - 1) * 4 + 3] !== 0) { seen[p - 1] = 1; stack[top++] = p - 1; }
          if (x < w - 1 && !seen[p + 1] && px[(p + 1) * 4 + 3] !== 0) { seen[p + 1] = 1; stack[top++] = p + 1; }
          if (p >= w && !seen[p - w] && px[(p - w) * 4 + 3] !== 0) { seen[p - w] = 1; stack[top++] = p - w; }
          if (p + w < total && !seen[p + w] && px[(p + w) * 4 + 3] !== 0) { seen[p + w] = 1; stack[top++] = p + w; }
        }
      }
      counts[rarity] = regions;
    }
    const multiRegion = RARITIES.filter((r) => counts[r] > 1);
    expect(multiRegion.length, `region counts: ${JSON.stringify(counts)}`).toBeGreaterThan(0);
  });
});

describe('attach adoption', () => {
  // The point of attach() is that "set the slot" and "attach the file" cannot
  // drift apart. A hand-rolled `payload.files = [...]` IS that drift, and it
  // shipped three defects in round 2 — so the idiom is banned outright.
  // fightFrames' deliberate exceptions build their arrays as locals
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
    // world/embeds.ts builds this name from a template literal
    // (`` `event-${e.id}` ``), which no static scrape can resolve — so unlike
    // BANNERS above, world event banners are cross-checked here by looping the
    // data source directly, same precedent as the CAMPAIGN loop just above.
    for (const ev of WORLD_EVENTS) {
      expect(assetImage('banners', `event-${ev.id}`), `banners/event-${ev.id}`).not.toBeNull();
    }
  });
});

// Exhaustive in BOTH directions: `satisfies Record<Archetype, 0>` rejects a
// missing key and an unknown one, so adding an archetype or a diet fails
// typecheck here before it can ship without art.
const ARCHETYPES = Object.keys(
  { bruiser: 0, tank: 0, swift: 0, support: 0 } satisfies Record<Archetype, 0>) as Archetype[];
const DIETS = Object.keys({ herbivore: 0, carnivore: 0 } satisfies Record<Diet, 0>) as Diet[];
const DINO_ART_KEYS = ARCHETYPES.flatMap((a) => DIETS.map((d) => `${a}-${d}`));

// The 8 rarest species — the five legendaries and the three mythics — each ship a
// per-species OVERRIDE portrait that dinoImage() prefers over the archetype×diet
// art they used to share. HAND-TYPED on purpose: deriving this from rarity would
// silently demand a new raster the moment a legendary or mythic species ships,
// which is exactly the "adding a species is a data-only change" guarantee the
// fixed 8-file archetype set exists to keep. Adding a ninth hero portrait is an
// edit here, deliberately.
const HERO_SPECIES = [
  'indominus', 'indoraptor', 'liopleurodon', 'mosasaurus',
  'quetzalcoatlus', 'spinoraptor', 'tyrannosaurus', 'ultimasaurus',
].sort();

// Enumerated from DISK, never from HERO_SPECIES: a hand-typed list can only prove
// that what exists, exists (the same reason scrapeBannerNames above is a scrape).
// Reading the directory is what makes a stray or misspelled file — dinos/t-rex.webp,
// dinos/gift-shop.webp — visible, instead of it null-degrading into an imageless
// embed forever with this suite green.
const DINO_ART_FILES = readdirSync(resolve(process.cwd(), 'assets/images/dinos'))
  .filter((f) => f.endsWith('.webp'))
  .map((f) => f.replace(/\.webp$/, ''))
  .sort();
const SPECIES_IDS = new Set(allSpecies().map((s) => s.id));

// Art banked ahead of its species data (spec 6a). Each of these ships a portrait so
// that adding the species later stays a data-only change. This is an explicit
// allowlist, not a relaxation: a misspelled filename is in neither this list nor
// SPECIES_IDS, so it still fails — the guard keeps its full protective value.
// When a species here ships as data, delete its entry; SPECIES_IDS will cover it.
// Declared here (not down by 'dino art file names', where it is also used) because
// SPECIES_ART_FILES below needs it in scope — a `const` used before its own
// declaration is a TDZ ReferenceError, not a hoist.
const BANKED_SPECIES_ART = [
  'amargasaurus', 'apatosaurus', 'concavenator', 'corythosaurus', 'dimorphodon',
  'herrerasaurus', 'nodosaurus', 'sinoceratops', 'styracosaurus', 'suchomimus',
  'troodon', 'utahraptor',
];

// Includes banked art: a portrait for a species that does not exist yet must meet the
// same bar as one that does, or the bank is 12 files nobody ever checked.
const SPECIES_ART_FILES = DINO_ART_FILES.filter(
  (n) => SPECIES_IDS.has(n) || BANKED_SPECIES_ART.includes(n),
);

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

  // Same precedent as the archetype case above and tests/battle-content.test.ts's
  // bossId cross-check: prompts.md is the regeneration source of truth, so a
  // shipped raster with no prompt row is unreproducible.
  it('documents a regeneration prompt for all 8 hero species portraits', () => {
    const prompts = readFileSync(new URL('../docs/assets/prompts.md', import.meta.url), 'utf8');
    expect(HERO_SPECIES).toHaveLength(8);
    expect(prompts).toContain('## Hero species portraits');
    for (const id of HERO_SPECIES) expect(prompts, id).toContain(`dinos/${id}.webp`);
  });
});

describe('dino archetype art', () => {
  it.each(DINO_ART_KEYS)('%s is a 1024×1024 transparent cutout',
    (key) => expectTransparentCutout('dinos', key));
  // The whole point of keying on archetype×diet: every species resolves without
  // new art. Archelon is the first species to use support-carnivore, which
  // shipped unused until this round — it needed zero new art, same as any
  // other species landing on an already-used combination.
  it('every species resolves to a shipped archetype image', () => {
    for (const s of allSpecies()) {
      expect(assetImage('dinos', `${s.archetype}-${s.diet}`), s.id).not.toBeNull();
    }
  });
});

describe('hero species art', () => {
  // it.each over an EMPTY array registers zero tests and goes dark with the suite
  // still green — the same failure mode the banner-scrape guard above exists for.
  // This case is what makes a missing or short hero-portrait set red. The reverse
  // direction — a dinos/ file that is neither an archetype-diet pair nor a real
  // species id — is covered once, by 'dino art file names' below, not duplicated here.
  // Was an exact-set assertion against an 8-name list. Spec 6a banks a portrait for
  // every species, so the set is no longer fixed — but the eight originals must still
  // be present, and every file must still be a real species id. The per-file quality
  // bar is enforced by the it.each below, which registers from disk.
  it('still ships every hero portrait', () => {
    for (const id of HERO_SPECIES) {
      expect(SPECIES_ART_FILES, `hero portrait ${id} went missing`).toContain(id);
    }
  });

  // The gap this closes: expectTransparentCutout was reachable for the dinos kind
  // ONLY through it.each(DINO_ART_KEYS) — an 8-name list derived from the Archetype
  // and Diet type unions — so a per-species override file inherited NO dimension, no
  // corner-transparency and NO margin checking at all. 31px here, matching the
  // archetype set these render beside in the same embeds; never the boss portraits'
  // 24px (expectTransparentCutout picks the number off `kind`).
  it.each(SPECIES_ART_FILES)('%s is a 1024×1024 transparent cutout at the 31px margin',
    (name) => expectTransparentCutout('dinos', name));

  // The archetype×diet set must stay complete: it is what a species with no committed
  // portrait falls back to, and it is what keeps "adding a species is a data-only
  // change" true. The old companion assertion — that non-hero species ship NO file of
  // their own — was removed deliberately in spec 6a, which banks a portrait for every
  // species. After 6a the fallback arm is reachable only for species with no committed
  // file, i.e. future ones; the 'dinoImage' describe below covers that arm directly,
  // with a synthetic id that can never gain committed art of its own.
  it('every species still resolves to a shipped archetype image', () => {
    for (const s of allSpecies()) {
      expect(assetImage('dinos', `${s.archetype}-${s.diet}`), s.id).not.toBeNull();
    }
  });
});

describe('dinoImage', () => {
  // No mocking in this block. dinoImage calls assetImage from inside the same module,
  // so vi.mock on src/core/images.js would replace what importers see and leave both of
  // dinoImage's own lookups untouched — the branches have to be proved against committed
  // files instead. Nothing is ever staged or deleted under assets/images: vitest runs
  // test files in parallel forks and another file can observe the write mid-run.
  it('falls back to the archetype×diet file when no species file is committed', () => {
    // A synthetic id that can never gain committed art, so this stays true when the
    // hero-species portraits ship.
    const ref = dinoImage('no-such-species', 'bruiser', 'carnivore');
    expect(ref).not.toBeNull();
    expect(ref!.url).toBe('attachment://bruiser-carnivore.webp');
    expect(ref!.file.name).toBe('bruiser-carnivore.webp');
  });

  it('prefers the species file when one is committed', () => {
    // The override branch, exercised with a name that IS committed under
    // assets/images/dinos. The archetype arguments name a DIFFERENT, equally committed
    // file, so a fallback-only implementation returns tank-herbivore.webp and fails.
    const ref = dinoImage('bruiser-carnivore', 'tank', 'herbivore');
    expect(ref).not.toBeNull();
    expect(ref!.url).toBe('attachment://bruiser-carnivore.webp');
  });

  it('returns null when neither the species nor the archetype file exists', () => {
    expect(dinoImage('no-such-species', 'no-such-archetype', 'carnivore')).toBeNull();
  });

  it('resolves every species in the live roster — adding a species still needs no art', () => {
    for (const s of allSpecies()) {
      expect(dinoImage(s.id, s.archetype, s.diet), s.id).not.toBeNull();
    }
  });
});

// Attachment names are BASENAMES ONLY — assetImage builds `${name}.webp` with no
// `kind` prefix — so two refs on ONE payload that resolve to the same basename
// make `attachment://<name>.webp` ambiguous and one of the two embed slots
// renders the wrong picture. attach() appends and can never clobber, but it
// cannot DEDUPE, so nothing else in the suite can see this. Exhaustive by
// construction: `satisfies Record<AssetKind, 0>` rejects a missing key and an
// unknown one, so a seventh kind added to assetImage fails typecheck here before
// it can ship uncovered. assets/images/park/ is deliberately absent — those
// rasters are read by the park renderer directly and never become Discord
// attachments, so they cannot collide with anything.
type AssetKind = Parameters<typeof assetImage>[0];
const ASSET_KINDS = Object.keys({
  eggs: 0, sites: 0, banners: 0, battles: 0, hatch: 0, dinos: 0,
} satisfies Record<AssetKind, 0>) as AssetKind[];

describe('cross-kind basename collisions', () => {
  it('no two committed assets share a basename across the six assetImage kinds', () => {
    const owners = new Map<string, AssetKind[]>();
    for (const kind of ASSET_KINDS) {
      for (const file of readdirSync(resolve(process.cwd(), 'assets/images', kind))) {
        if (!file.endsWith('.webp')) continue;   // battles/ ships a .gitkeep
        const base = file.replace(/\.webp$/, '');
        const owner = owners.get(base);
        if (owner) owner.push(kind);
        else owners.set(base, [kind]);
      }
    }
    expect(owners.size, 'no assets found — wrong root?').toBeGreaterThan(0);
    const collisions = [...owners]
      .filter(([, kinds]) => kinds.length > 1)
      .map(([base, kinds]) => `${base}.webp: ${kinds.join(' + ')}`);
    expect(collisions, `rename one side — two payloads cannot both use these:\n${collisions.join('\n')}`).toEqual([]);
  });
});

// The inverse of the banner orphan check above, for the one directory with THREE
// naming families: `<archetype>-<diet>` (the fixed set of 8), `<speciesId>` (a
// committed per-species portrait, hero or ordinary), and a BANKED id (art shipped
// ahead of its species data, spec 6a). All three sides are derived — DINO_ART_KEYS
// from the real Archetype/Diet unions, SPECIES_IDS (declared above, alongside
// HERO_SPECIES) from allSpecies(), BANKED_SPECIES_ART (declared above, alongside
// SPECIES_ART_FILES) hand-typed — so a typo'd or retired name is caught here rather
// than null-degrading to an imageless embed, which is silent everywhere else.
describe('dino art file names', () => {
  it('every committed dinos/ file is an archetype-diet pair, a real species id, or banked art', () => {
    const names = readdirSync(resolve(process.cwd(), 'assets/images/dinos'))
      .filter((f) => f.endsWith('.webp'))
      .map((f) => f.replace(/\.webp$/, ''));
    expect(names.length, 'no dino art found — wrong root?').toBeGreaterThan(0);
    const strays = names.filter((n) => !DINO_ART_KEYS.includes(n)
      && !SPECIES_IDS.has(n) && !BANKED_SPECIES_ART.includes(n));
    expect(strays, `neither an archetype-diet pair, a species id, nor banked: ${strays.join(', ')}`)
      .toEqual([]);
  });

  // A banked id that has since shipped as data is dead weight in the allowlist and
  // hides a real stray behind a stale entry.
  it('no banked id has since shipped as species data', () => {
    const shipped = BANKED_SPECIES_ART.filter((id) => SPECIES_IDS.has(id));
    expect(shipped, `remove from BANKED_SPECIES_ART, now real species: ${shipped.join(', ')}`)
      .toEqual([]);
  });
});
