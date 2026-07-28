import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fightFrames, chaptersPayload, energyLine, type ChaptersView } from '../src/modules/battles/embeds.js';
import type { FightOutcome } from '../src/modules/battles/service.js';
import type { BeatSummary } from '../src/data/battle/resolve.js';
import { STAGES, type ProgressMap } from '../src/data/battle/chapters/index.js';
import { ENERGY_REGEN_MS } from '../src/data/battle/constants.js';
import { validateMessagePayload } from './lib/discord-limits.js';
import { assetImage } from '../src/core/images.js';

// assetImage is a pass-through spy by default (calls the real implementation),
// so every test in this file except the two chaptersPayload degrade-path
// tests below is unaffected. Those two override exactly one queued call via
// mockImplementationOnce to force a miss without touching real asset files.
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return { ...actual, assetImage: vi.fn(actual.assetImage) };
});

// Stub portrait so the thumbnail wiring is testable: assetImage only checks
// existence, and this beforeAll runs before any assetImage call on the path.
const bossId = STAGES.get('coastal_dig_boss')!.boss!.bossId;
const portraitPath = resolve(process.cwd(), 'assets/images/battles', `${bossId}-portrait.png`);
beforeAll(() => { writeFileSync(portraitPath, 'stub'); });
afterAll(() => { rmSync(portraitPath, { force: true }); });

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

describe('fightFrames', () => {
  it('returns 4 valid frames with attachments only on F1', () => {
    const frames = fightFrames(makeOutcome(), skipStub);
    expect(frames).toHaveLength(4);
    for (const f of frames) validateMessagePayload(f, 'frame');
    expect(frames[0].files?.length).toBeGreaterThan(0);   // coastal_dig banner ships
    expect(frames[1].files).toBeUndefined();
    expect(frames[2].files).toBeUndefined();
    expect(frames[3].files).toBeUndefined();
  });
  it('F2/F3 come straight from the result beats', () => {
    const frames = fightFrames(makeOutcome(), skipStub);
    expect(frames[1].embeds[0].toJSON().title).toBe('⚔️ Clash!');
    expect(frames[1].embeds[0].toJSON().description).toContain('Rexy bites');
    expect(frames[2].embeds[0].toJSON().title).toBe('💥 Climax');
  });
  it('F4 shows shards only on first clear and always the real energy countdown', () => {
    const first = fightFrames(makeOutcome(), skipStub)[3].embeds[0].toJSON();
    expect(JSON.stringify(first.fields)).toContain('shards');
    expect(JSON.stringify(first.fields)).toContain('⚡ 9/10');
    // Real next-energy countdown from the settled stamp, not a static cadence note.
    expect(JSON.stringify(first.fields)).toContain(`+1 <t:${(600_000 + ENERGY_REGEN_MS) / 1000}:R>`);
    expect(first.description).toContain('⭐⭐⭐');
    const repeat = fightFrames(makeOutcome({ firstClear: false, stars: 2,
      rewards: { cash: 120, food: null, shards: 0, xpPerDino: [40] } }), skipStub)[3].embeds[0].toJSON();
    expect(JSON.stringify(repeat.fields)).not.toContain('shards');
  });
  it('loss frame shows defeat, empty stars, consolation XP only', () => {
    const f4 = fightFrames(makeOutcome({ won: false, stars: 0, firstClear: false, bossEgg: null,
      result: { won: false, rounds: 30, squadKos: 1, squadSurvivors: [], beats, finalHp: {} },
      rewards: { cash: 0, food: null, shards: 0, xpPerDino: [10] } }), skipStub)[3].embeds[0].toJSON();
    expect(f4.title).toContain('Defeat');
    expect(f4.description).toContain('☆☆☆');
    expect(JSON.stringify(f4.fields)).not.toContain('cash');
    expect(JSON.stringify(f4.fields)).toContain('+10 battle XP');
  });
  it('boss stages thumbnail the portrait; normal stages never do; files still F1-only', () => {
    const boss = fightFrames(makeOutcome({ stageId: 'coastal_dig_boss', bossEgg: { rarity: 'rare' } }), skipStub);
    expect(boss[2].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.png`);
    expect(boss[3].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.png`);
    expect(boss[0].files?.map((f) => f.name)).toContain(`${bossId}-portrait.png`);
    expect(boss[1].files).toBeUndefined();
    expect(JSON.stringify(boss[3].embeds[0].toJSON().fields)).toContain('egg');
    // The rendered enemy line, not just the thumbnail/files wiring, names the boss.
    const enemiesField = boss[0].embeds[0].toJSON().fields!.find((f) => f.name === 'Enemies')!.value;
    expect(enemiesField).toContain('👑 Old Riptooth');
    const normal = fightFrames(makeOutcome(), skipStub);
    for (const f of normal) expect(f.embeds[0].toJSON().thumbnail).toBeUndefined();
  });
  it('boss stage with no portrait art degrades cleanly: no thumbnail anywhere, no portrait file, banner still ships', () => {
    // amber_ridge_boss's portrait is never stubbed on disk in this file (unlike
    // coastal_dig_boss above) — assetImage's per-path existence cache never sees
    // it as present, so this exercises the real un-stubbed production path: no
    // committed boss art anywhere under assets/images/battles/ today.
    const noPortraitBossId = STAGES.get('amber_ridge_boss')!.boss!.bossId;
    const frames = fightFrames(
      makeOutcome({ stageId: 'amber_ridge_boss', bossEgg: { rarity: 'epic' } }), skipStub);
    expect(frames).toHaveLength(4);
    for (const f of frames) validateMessagePayload(f, 'frame-no-portrait');
    for (const f of frames) expect(f.embeds[0].toJSON().thumbnail).toBeUndefined();
    expect(frames[0].files?.map((f) => f.name)).not.toContain(`${noPortraitBossId}-portrait.png`);
    expect(frames[0].files?.map((f) => f.name)).toContain('amber_ridge-banner.png');   // chapter banner still ships
  });
  it('calls the skip callback for frames 0-2 and attaches returned rows; F4 has no row', () => {
    const seen: number[] = [];
    const frames = fightFrames(makeOutcome(), (idx) => {
      seen.push(idx);
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('battle:skip:u1:1').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary));
    });
    expect(seen).toEqual([0, 1, 2]);
    expect(frames[0].components).toHaveLength(1);
    expect(frames[3].components).toHaveLength(0);   // the module appends the again row (it owns userId)
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
    // embed still points at attachment://coastal_dig-banner.png.
    const p = chaptersPayload('u1', 0, baseView());
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://coastal_dig-banner.png');
    expect(embed.thumbnail?.url).toBe('attachment://coastal_dig-thumb.png');
    const names = p.files!.map((f) => f.name);
    expect(names).toContain('coastal_dig-banner.png');
    expect(names).toContain('coastal_dig-thumb.png');
    expect(names).toHaveLength(2);   // nothing uploaded that the embed does not reference
  });
  it('chaptersPayload still ships the thumb when the banner is missing', () => {
    // Degrade path 1/2: the two assetImage lookups are independent `if`
    // blocks — a miss on the banner call must not suppress the thumb.
    vi.mocked(assetImage).mockImplementationOnce(() => null);   // banner call (1st) -> missing
    const p = chaptersPayload('u1', 0, baseView());
    const embed = p.embeds[0].toJSON();
    expect(embed.image).toBeUndefined();
    expect(embed.thumbnail?.url).toBe('attachment://coastal_dig-thumb.png');
    expect(p.files!.map((f) => f.name)).toEqual(['coastal_dig-thumb.png']);
  });
  it('chaptersPayload still ships the banner when the thumb is missing', async () => {
    // Degrade path 2/2: the mirror case — a miss on the thumb call must not
    // suppress the banner that was already appended to payload.files.
    const { assetImage: realAssetImage } = await vi.importActual<typeof import('../src/core/images.js')>('../src/core/images.js');
    vi.mocked(assetImage)
      .mockImplementationOnce((kind, name) => realAssetImage(kind, name))   // banner call (1st) -> real
      .mockImplementationOnce(() => null);                                 // thumb call (2nd) -> missing
    const p = chaptersPayload('u1', 0, baseView());
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://coastal_dig-banner.png');
    expect(embed.thumbnail).toBeUndefined();
    expect(p.files!.map((f) => f.name)).toEqual(['coastal_dig-banner.png']);
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
});
