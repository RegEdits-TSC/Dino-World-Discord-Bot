import { describe, it, expect, vi } from 'vitest';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fightFrames, chaptersPayload, energyLine, type ChaptersView, type FramePayload } from '../src/modules/battles/embeds.js';
import type { FightOutcome } from '../src/modules/battles/service.js';
import type { BeatSummary } from '../src/data/battle/resolve.js';
import { CAMPAIGN, STAGES, type ProgressMap } from '../src/data/battle/chapters/index.js';
import { ENERGY_REGEN_MS } from '../src/data/battle/constants.js';
import { validateMessagePayload } from './lib/discord-limits.js';
import { assetImage } from '../src/core/images.js';

// Portrait presence is mocked, never staged on disk. vitest runs test FILES in
// parallel forks, so a writeFileSync/rmSync fixture on a committed asset path
// (this file used to stub the coastal portrait) can be observed — or deleted —
// by another file mid-run. `portraits: false` is also the only fixture left for
// the null-degrade branch: every boss stage ships a portrait now.
//
// For every other kind, assetImage stays a pass-through spy (calls the real
// implementation) wrapped in vi.fn, so the two chaptersPayload degrade-path
// tests below can still override exactly one queued call via
// mockImplementationOnce to force a miss without touching real asset files.
//
// `dinos: false` has to be expressed on dinoImage rather than on assetImage: fightFrames
// resolves the lead enemy through dinoImage, whose own two assetImage lookups are
// module-internal and are therefore never routed through the spy below. Mocked on
// dinoImage it keeps working, and it stays out of the assetImage once-queue entirely, so
// the two chaptersPayload tests below keep their 1st-call/2nd-call identity.
const art = vi.hoisted(() => ({ portraits: true, sites: true, dinos: true }));
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return {
    ...actual,
    // `seed` is forwarded, never dropped: fightFrames seeds its site banner and its
    // outcome banner on the viewer, and a spy that truncated the argument list would
    // hand every one of those calls back the BASE file — turning the -vN pins below
    // into assertions that pass no matter what the source does.
    assetImage: vi.fn((kind: Parameters<typeof actual.assetImage>[0], name: string, seed?: string) => {
      // `sites: false` models a deploy with no chapter art (docs/ops.md: every
      // asset is individually optional) — the only way F1 ends up with no files.
      if (kind === 'sites' && !art.sites) return null;
      if (kind !== 'battles') return actual.assetImage(kind, name, seed);   // chapter banners/thumbs stay real
      if (!art.portraits) return null;
      const fileName = `${name}.webp`;
      return { file: new AttachmentBuilder(Buffer.from('portrait'), { name: fileName }), url: `attachment://${fileName}` };
    }),
    // Pass-through by default, so every frame test still resolves the real archetype art.
    // `dinos: false` is the same fixture the assetImage branch used to provide — without
    // it F1 always has a file and the replay contract below stops testing the no-art case
    // it exists to test.
    dinoImage: vi.fn((speciesId: string, archetype: string, diet: string) =>
      (art.dinos ? actual.dinoImage(speciesId, archetype, diet) : null)),
  };
});

const bossId = STAGES.get('coastal_dig_boss')!.boss!.bossId;

const beats: [BeatSummary, BeatSummary] = [
  { title: '⚔️ Clash!', lines: ['Rexy bites Compy for 24 (crit!)'] },
  { title: '💥 Climax', lines: ['Compy is KO’d!'] },
];
function makeOutcome(over: Partial<FightOutcome> = {}): FightOutcome {
  return {
    result: { won: true, rounds: 5, squadKos: 0, squadSurvivors: ['Rexy'], beats, finalHp: {} },
    stars: 3, firstClear: true, won: true,
    rewards: { cash: 120, food: { foodId: 'fish', qty: 2 }, shards: 5, xpPerDino: [40] },
    bossEgg: null, energyAfter: 9, energyUpdatedAtMs: 600_000,
    squad: [{ dinoId: 1, name: 'Rexy', speciesId: 'tyrannosaurus', level: 2 }],
    stageId: 'coastal_dig_1',
    ...over,
  };
}
const skipStub = () => null;

// Mirrors discord.js MessagePayload on a message edit: a frame carrying `files`
// (or an explicit `attachments` array) REPLACES the message's whole attachment
// set; a frame carrying neither leaves the previous uploads in place. Fed a
// sequence of frames, returns what is still live on the message after the last.
function liveAfter(frames: FramePayload[]): string[] {
  let live: string[] = [];
  for (const frame of frames) {
    const own = (frame.files ?? []).map((f) => f.name!);
    live = frame.files || frame.attachments ? own : [...live, ...own];
  }
  return live;
}

describe('fightFrames', () => {
  it('returns 4 valid frames; files attach on F1 and F4 only', () => {
    const frames = fightFrames(makeOutcome(), skipStub, 'u1');
    expect(frames).toHaveLength(4);
    for (const f of frames) validateMessagePayload(f, 'frame');
    expect(frames[0].files?.length).toBeGreaterThan(0);   // coastal_dig banner ships
    expect(frames[1].files).toBeUndefined();
    expect(frames[2].files).toBeUndefined();
    // F4 replaces the whole attachment set, so it re-uploads the thumb it shows.
    // coastal_dig_1's weakest-first roster leads with compsognathus, which ships its
    // own portrait as of Task 10 — it no longer falls back to swift-carnivore.
    // fightFrames seeds its site banner and its outcome banner on the VIEWER, so these
    // pin the faces 'u1' — the id every fightFrames call in this file passes — resolves
    // to. The species thumb takes no seed and is unchanged. The site banner is seeded
    // too, but coastal_dig-banner hashes to index 0 for 'u1' and index 0 IS the base
    // file, so no assertion on that name anywhere in this file had to move.
    expect(frames[3].files?.map((f) => f.name)).toEqual(['battle_victory-v3.webp', 'compsognathus.webp']);
    expect(frames[0].attachments).toEqual([]);   // F1 and F4 both replace the whole set
    expect(frames[3].attachments).toEqual([]);
    expect(frames[3].embeds[0].toJSON().image?.url).toBe('attachment://battle_victory-v3.webp');
    expect(frames[3].embeds[0].toJSON().thumbnail?.url).toBe('attachment://compsognathus.webp');
  });
  it('F2/F3 come straight from the result beats', () => {
    const frames = fightFrames(makeOutcome(), skipStub, 'u1');
    expect(frames[1].embeds[0].toJSON().title).toBe('⚔️ Clash!');
    expect(frames[1].embeds[0].toJSON().description).toContain('Rexy bites');
    expect(frames[2].embeds[0].toJSON().title).toBe('💥 Climax');
  });
  it('F4 shows shards only on first clear and always the real energy countdown', () => {
    const first = fightFrames(makeOutcome(), skipStub, 'u1')[3].embeds[0].toJSON();
    expect(JSON.stringify(first.fields)).toContain('shards');
    expect(JSON.stringify(first.fields)).toContain('⚡ 9/10');
    // Real next-energy countdown from the settled stamp, not a static cadence note.
    expect(JSON.stringify(first.fields)).toContain(`+1 <t:${(600_000 + ENERGY_REGEN_MS) / 1000}:R>`);
    expect(first.description).toContain('⭐⭐⭐');
    const repeat = fightFrames(makeOutcome({ firstClear: false, stars: 2,
      rewards: { cash: 120, food: null, shards: 0, xpPerDino: [40] } }), skipStub, 'u1')[3].embeds[0].toJSON();
    expect(JSON.stringify(repeat.fields)).not.toContain('shards');
  });
  it('loss frame shows defeat, empty stars, consolation XP only', () => {
    const f4 = fightFrames(makeOutcome({ won: false, stars: 0, firstClear: false, bossEgg: null,
      result: { won: false, rounds: 30, squadKos: 1, squadSurvivors: [], beats, finalHp: {} },
      rewards: { cash: 0, food: null, shards: 0, xpPerDino: [10] } }), skipStub, 'u1')[3].embeds[0].toJSON();
    expect(f4.title).toContain('Defeat');
    expect(f4.description).toContain('☆☆☆');
    expect(JSON.stringify(f4.fields)).not.toContain('cash');
    expect(JSON.stringify(f4.fields)).toContain('+10 battle XP');
  });
  it('boss stages thumbnail the portrait; non-boss stages thumbnail the lead enemy archetype', () => {
    const boss = fightFrames(makeOutcome({ stageId: 'coastal_dig_boss', bossEgg: { rarity: 'rare' } }), skipStub, 'u1');
    expect(boss[2].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.webp`);
    expect(boss[3].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.webp`);
    expect(boss[0].files?.map((f) => f.name)).toContain(`${bossId}-portrait.webp`);
    expect(boss[3].files?.map((f) => f.name)).toContain(`${bossId}-portrait.webp`);   // re-uploaded, not re-referenced
    expect(boss[1].files).toBeUndefined();
    // A boss stage never carries archetype art: the boss is a named individual,
    // and rosterFor's lead entry on a 1-dino squad is the boss itself. compsognathus
    // ships its own portrait as of Task 10, so this checks for that filename now
    // rather than the swift-carnivore fallback it used to share.
    expect(boss[0].files?.map((f) => f.name)).not.toContain('compsognathus.webp');
    expect(JSON.stringify(boss[3].embeds[0].toJSON().fields)).toContain('egg');
    // The rendered enemy line, not just the thumbnail/files wiring, names the boss.
    const enemiesField = boss[0].embeds[0].toJSON().fields!.find((f) => f.name === 'Enemies')!.value;
    expect(enemiesField).toContain('👑 Old Riptooth');
    // coastal_dig_1's weakest-first roster leads with compsognathus (swift/carnivore),
    // which ships its own portrait as of Task 10 — no longer the shared archetype art.
    const normal = fightFrames(makeOutcome(), skipStub, 'u1');
    for (const f of normal) expect(f.embeds[0].toJSON().thumbnail?.url).toBe('attachment://compsognathus.webp');
  });
  it('the non-boss thumbnail is computed per stage from rosterFor[0], not a constant', () => {
    // coastal_dig_2 leads with othnielia (swift/herbivore), coastal_dig_3 with
    // microceratus (support/herbivore) — different keys down the same code path.
    // Both ship their own portrait as of Task 10, so this now pins the species
    // filename rather than the shared archetype fallback each used to resolve to.
    const s2 = fightFrames(makeOutcome({ stageId: 'coastal_dig_2' }), skipStub, 'u1');
    expect(s2[0].embeds[0].toJSON().thumbnail?.url).toBe('attachment://othnielia.webp');
    const s3 = fightFrames(makeOutcome({ stageId: 'coastal_dig_3' }), skipStub, 'u1');
    expect(s3[0].embeds[0].toJSON().thumbnail?.url).toBe('attachment://microceratus.webp');
    expect(s3[0].files?.map((f) => f.name)).toContain('microceratus.webp');
  });
  it('boss stage with no portrait art degrades cleanly: no thumbnail anywhere, no portrait file, banner still ships', () => {
    // No boss stage lacks committed art any more, so the absent-art branch is
    // pinned by forcing assetImage('battles', …) to null — the project rule is
    // that missing art degrades, never throws.
    const noPortraitBossId = STAGES.get('amber_ridge_boss')!.boss!.bossId;
    art.portraits = false;
    try {
      const frames = fightFrames(
        makeOutcome({ stageId: 'amber_ridge_boss', bossEgg: { rarity: 'epic' } }), skipStub, 'u1');
      expect(frames).toHaveLength(4);
      for (const f of frames) validateMessagePayload(f, 'frame-no-portrait');
      for (const f of frames) expect(f.embeds[0].toJSON().thumbnail).toBeUndefined();
      expect(frames[0].files?.map((f) => f.name)).not.toContain(`${noPortraitBossId}-portrait.webp`);
      expect(frames[0].files?.map((f) => f.name)).toContain('amber_ridge-banner-v3.webp');   // chapter banner still ships
    } finally {
      art.portraits = true;
    }
  });
  it('calls the skip callback for frames 0-2 and attaches returned rows; F4 has no row', () => {
    const seen: number[] = [];
    const frames = fightFrames(makeOutcome(), (idx) => {
      seen.push(idx);
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('battle:skip:u1:1').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary));
    }, 'u1');
    expect(seen).toEqual([0, 1, 2]);
    expect(frames[0].components).toHaveLength(1);
    expect(frames[3].components).toHaveLength(0);   // the module appends the again row (it owns userId)
  });
  it('replay contract: F1 clears the previous fight\'s F4 banner even when it has no art of its own', () => {
    // `battle:again` calls presentFight again on the SAME message, so fight 2's F1
    // lands on the message fight 1's F4 last wrote — and F4 replaces the whole
    // attachment set with the outcome banner. On a deploy with no chapter art F1
    // carries no files; if it also carried no `attachments` key, Discord would keep
    // fight 1's outcome banner alive under F1-F3, whose embeds reference
    // nothing. F1's `attachments: []` must therefore be unconditional, not
    // `if (files.length)`.
    art.sites = false;
    art.dinos = false;
    try {
      const first = fightFrames(makeOutcome(), skipStub, 'u1');
      const replay = fightFrames(makeOutcome(), skipStub, 'u1');
      expect(first[0].files).toBeUndefined();               // no chapter art in this deploy
      expect(first[0].attachments).toEqual([]);             // ...the set is replaced regardless
      expect(liveAfter(first)).toEqual(['battle_victory-v3.webp']);
      // The decisive step: nothing stale survives into the replay's F1-F3.
      expect(liveAfter([...first, replay[0]])).toEqual([]);
      expect(liveAfter([...first, ...replay.slice(0, 3)])).toEqual([]);
      for (const f of replay.slice(0, 3)) expect(f.embeds[0].toJSON().image).toBeUndefined();
    } finally {
      art.sites = true;
      art.dinos = true;
    }
  });
  // Mirrors discord.js MessagePayload: a payload carrying `files` (or an explicit
  // `attachments` array) REPLACES the message's whole attachment set; a payload
  // carrying neither leaves the previous uploads in place (see liveAfter above).
  const assertFrameContract = (stageId: string, bossEgg: FightOutcome['bossEgg'], expectedLive: string[]) => {
    const frames = fightFrames(makeOutcome({ stageId, bossEgg }), skipStub, 'u1');
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
    assertFrameContract('coastal_dig_boss', { rarity: 'rare' }, ['battle_victory-v3.webp', `${bossId}-portrait.webp`]);
  });
  it('frame contract (non-boss stage): the archetype thumb is uploaded by both attaching frames', () => {
    // coastal_dig_1's lead enemy, compsognathus, ships its own portrait as of Task 10.
    assertFrameContract('coastal_dig_1', null, ['battle_victory-v3.webp', 'compsognathus.webp']);
  });
});

function progressWith(entries: Array<[string, number]>): ProgressMap {
  return new Map(entries.map(([id, stars]) => [id, { stars, firstClearedAt: 1 }]));
}
const baseView = (over: Partial<ChaptersView> = {}): ChaptersView => ({
  progress: new Map(), ratingHighWater: 0, energy: 10, energyUpdatedAtMs: 0, ...over,
});

describe('chaptersPayload', () => {
  it('page 0: stage 1 open with empty stars, later stages locked, nav row wired', () => {
    const p = chaptersPayload('u1', 0, baseView());
    validateMessagePayload(p, 'chapters');
    const embed = p.embeds[0].toJSON();
    expect(embed.title).toContain('Chapter 1');
    const stages = embed.fields!.find((f) => f.name === 'Stages')!.value.split('\n');
    expect(stages[0].startsWith('☆☆☆')).toBe(true);
    expect(stages[1].startsWith('🔒')).toBe(true);
    const nav = p.components[0].toJSON().components as Array<{ custom_id: string; disabled?: boolean }>;
    expect(nav[0].custom_id).toBe('battle:chapter:u1:-1');
    expect(nav[0].disabled).toBe(true);
    expect(nav[1].custom_id).toBe('battle:chapter:u1:1');
    expect(nav[1].disabled).toBeFalsy();
  });
  it('carries the chapter banner AND thumb — both referenced, both uploaded', () => {
    // chapterId === siteId, so both site assets are legal here. This pins the
    // append: assigning payload.files twice would drop the banner file while the
    // embed still points at attachment://coastal_dig-banner.webp.
    const p = chaptersPayload('u1', 0, baseView());
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://coastal_dig-banner.webp');
    expect(embed.thumbnail?.url).toBe('attachment://coastal_dig-thumb.webp');
    const names = p.files!.map((f) => f.name);
    expect(names).toContain('coastal_dig-banner.webp');
    expect(names).toContain('coastal_dig-thumb.webp');
    expect(names).toHaveLength(2);   // nothing uploaded that the embed does not reference
  });
  it('chaptersPayload still ships the thumb when the banner is missing', () => {
    // Degrade path 1/2: the two assetImage lookups are independent `if`
    // blocks — a miss on the banner call must not suppress the thumb.
    vi.mocked(assetImage).mockImplementationOnce(() => null);   // banner call (1st) -> missing
    const p = chaptersPayload('u1', 0, baseView());
    const embed = p.embeds[0].toJSON();
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail?.url).toBe('attachment://coastal_dig-thumb.webp');
    expect(p.files!.map((f) => f.name)).toEqual(['coastal_dig-thumb.webp']);
  });
  it('chaptersPayload still ships the banner when the thumb is missing', async () => {
    // Degrade path 2/2: the mirror case — a miss on the thumb call must not
    // suppress the banner that was already appended to payload.files.
    const { assetImage: realAssetImage } = await vi.importActual<typeof import('../src/core/images.js')>('../src/core/images.js');
    vi.mocked(assetImage)
      .mockImplementationOnce((...args) => realAssetImage(...args))   // banner call (1st) -> real, seed forwarded
      .mockImplementationOnce(() => null);                                 // thumb call (2nd) -> missing
    const p = chaptersPayload('u1', 0, baseView());
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://coastal_dig-banner.webp');
    expect(embed.thumbnail).toBeUndefined();
    expect(p.files!.map((f) => f.name)).toEqual(['coastal_dig-banner.webp']);
  });
  it('locked chapter renders locked', () => {
    const embed = chaptersPayload('u1', 1, baseView()).embeds[0].toJSON();
    expect(embed.title).toContain('🔒');
  });
  it('cleared stages show earned stars and unlock the next stage', () => {
    const view = baseView({ progress: progressWith([['coastal_dig_1', 2]]) });
    const stages = chaptersPayload('u1', 0, view).embeds[0].toJSON()
      .fields!.find((f) => f.name === 'Stages')!.value.split('\n');
    expect(stages[0].startsWith('⭐⭐☆')).toBe(true);
    expect(stages[1].startsWith('☆☆☆')).toBe(true);
  });
  it('energy line: countdown below cap, full at cap', () => {
    expect(energyLine(10, 0)).toBe('⚡ 10/10 · full');
    expect(energyLine(7, 600_000)).toBe(`⚡ 7/10 · +1 <t:${(600_000 + ENERGY_REGEN_MS) / 1000}:R>`);
  });
  it('a locked star-gated chapter names the star requirement and the player\'s own progress', () => {
    const view: ChaptersView = {
      progress: new Map([['coastal_dig_1', { stars: 2, firstClearedAt: 1 }]]),
      ratingHighWater: 1_000, energy: 10, energyUpdatedAtMs: 0, now: 0,
    };
    const idx = CAMPAIGN.findIndex((c) => c.id === 'founders_park');
    const desc = chaptersPayload('u1', idx, view).embeds![0].toJSON().description!;
    expect(desc).toContain('2/75 campaign stars');
    expect(desc).not.toContain('park rating');
  });
  it('a locked star-gated chapter still names the boss requirement when the star gate alone is already met', () => {
    // The chapter CARD is reachable by pressing Next ▶ alone, which satisfies
    // no gate — so a player can be farming stars elsewhere while repeatedly
    // losing to the chapter 6 boss (a loss records stars: 0 and never stamps
    // firstClearedAt). That leaves the star requirement met (87 >= 75) while
    // chapterUnlocked still returns false on the unmet boss precondition, and
    // the lock line must say so rather than reporting only the star count.
    const entries: Array<[string, number]> = [];
    for (const ch of CAMPAIGN.slice(0, 6)) {
      for (const stage of ch.stages) {
        if (stage.id === 'containment_site_boss') continue;   // never cleared
        entries.push([stage.id, 3]);
      }
    }
    const view: ChaptersView = {
      progress: progressWith(entries), ratingHighWater: 1_000, energy: 10, energyUpdatedAtMs: 0, now: 0,
    };
    const idx = CAMPAIGN.findIndex((c) => c.id === 'founders_park');
    const desc = chaptersPayload('u1', idx, view).embeds![0].toJSON().description!;
    expect(desc).toContain('beat the previous chapter\'s boss');
    expect(desc).toContain('87/75 campaign stars');
  });
  it('a locked rating-gated chapter still names park rating', () => {
    const view: ChaptersView = {
      progress: new Map(), ratingHighWater: 0, energy: 10, energyUpdatedAtMs: 0, now: 0,
    };
    const idx = CAMPAIGN.findIndex((c) => c.id === 'volcano_core');
    const desc = chaptersPayload('u1', idx, view).embeds![0].toJSON().description!;
    expect(desc).toContain('park rating');
    expect(desc).not.toContain('campaign stars');
  });
});
