import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { fightFrames, chaptersPayload, energyLine, type ChaptersView } from '../src/modules/battles/embeds.js';
import type { FightOutcome } from '../src/modules/battles/service.js';
import type { BeatSummary } from '../src/data/battle/resolve.js';
import { STAGES, type ProgressMap } from '../src/data/battle/chapters/index.js';
import { ENERGY_REGEN_MS } from '../src/data/battle/constants.js';
import { validateMessagePayload } from './lib/discord-limits.js';

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
    const normal = fightFrames(makeOutcome(), skipStub);
    for (const f of normal) expect(f.embeds[0].toJSON().thumbnail).toBeUndefined();
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
