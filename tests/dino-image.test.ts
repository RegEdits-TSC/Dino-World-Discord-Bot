import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AttachmentBuilder } from 'discord.js';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dinoImage } from '../src/core/images.js';
import { animalsPayload } from '../src/modules/park/embeds.js';
import { duelResultPayload } from '../src/modules/duels/embeds.js';
import { resolveDuel } from '../src/modules/duels/service.js';
import { dexViewPayload } from '../src/modules/dex/embeds.js';
import { revealPayload } from '../src/modules/hatchery/embeds.js';
import { fightFrames } from '../src/modules/battles/embeds.js';
import type { FightOutcome } from '../src/modules/battles/service.js';
import type { BeatSummary } from '../src/data/battle/resolve.js';
import { getSpecies } from '../src/data/species/index.js';
import { STAGES, rosterFor } from '../src/data/battle/chapters/index.js';

// dinoImage is mocked here, NOT assetImage. dinoImage calls assetImage from inside
// src/core/images.ts, and that module-internal call resolves against the module's own
// local binding — vi.mock only replaces what IMPORTERS see, so a mocked assetImage
// leaves dinoImage's two lookups running against the real filesystem and nothing about
// "which id did this call site pass?" becomes observable. Mocking dinoImage does make it
// observable: the ref is named after the SPECIES id, so a call site still passing
// `${archetype}-${diet}` as the first argument renders a different URL and fails here.
// Same vi.mock + importOriginal idiom as tests/battles-embeds.test.ts. Nothing is written
// under assets/images — vitest runs test FILES in parallel forks, so a writeFileSync or
// rmSync on a committed asset path can be observed, or deleted, by another file mid-run.
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return {
    ...actual,
    dinoImage: vi.fn((speciesId: string, _archetype: string, _diet: string) => {
      const fileName = `${speciesId}.webp`;
      return { file: new AttachmentBuilder(Buffer.from('dino'), { name: fileName }), url: `attachment://${fileName}` };
    }),
  };
});

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); vi.clearAllMocks(); });

/** Insert a dino for `user` and return its row id. `.returning().get()` is the repo idiom. */
function addDino(user: string, speciesId: string, battleXp = 0): number {
  return ctx.db.insert(schema.dinos)
    .values({ userId: user, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0, battleXp })
    .returning().get().id;
}

// Featured left dashboardPayload for the Animals tab in the same task that split the
// Park tab out of the old /park view card (see tests/park.test.ts's identical
// Trixie/triceratops fixture, retargeted the same way).
describe('animalsPayload routes the featured dino through dinoImage', () => {
  it('passes the featured species id, not just its archetype and diet', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 0, {
      featured: { name: 'Trixie', speciesId: 'triceratops', archetype: 'tank', diet: 'herbivore' },
    });
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['triceratops', 'tank', 'herbivore']]);
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://triceratops.webp');
    // Two files now, not one: animalsPayload always attaches the roster banner first
    // (call order is upload order), then the featured dino's art second.
    expect(p.files!.map((f) => f.name)).toEqual(['dino_roster.webp', 'triceratops.webp']);
  });

  it('never calls dinoImage when nothing is featured — that ternary guards domain data', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 0, {});
    expect(dinoImage).not.toHaveBeenCalled();
    // Not undefined: unlike the old single-card dashboard, animalsPayload always attaches
    // the roster banner regardless of whether anything is featured.
    expect(p.files!.map((f) => f.name)).toEqual(['dino_roster.webp']);
  });
});

describe('duelResultPayload routes the winning lead through dinoImage', () => {
  it('passes the lead member species id off the real squad', () => {
    getOrCreateUser(ctx, 'a', 'A');
    getOrCreateUser(ctx, 'b', 'B');
    addDino('a', 'tyrannosaurus', 3200);
    addDino('b', 'triceratops', 0);
    const out = resolveDuel(ctx, 'a', 'b', 'ghost');
    const payload = duelResultPayload(out);
    const lead = out.result === 'loss' ? out.squads.defender[0] : out.squads.challenger[0];
    expect(vi.mocked(dinoImage).mock.calls).toEqual([[lead.speciesId, lead.archetype, lead.diet]]);
    // Still EXACTLY ONE *dino* ref: two would collide on a shared basename and attach never
    // dedupes. The duel banner is a second, distinctly-named file riding alongside it — call
    // order is upload order, so the dino thumbnail stays files[0] and the banner is files[1].
    expect(payload.files!.map((f) => f.name)).toEqual([`${lead.speciesId}.webp`, 'duel.webp']);
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${lead.speciesId}.webp`);
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://duel.webp');
  });
});

describe('dexViewPayload routes the entry art through dinoImage', () => {
  it('passes the species id of the entry being viewed', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dexViewPayload(ctx, 'u1', 'triceratops');
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['triceratops', 'tank', 'herbivore']]);
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://triceratops.webp');
    expect(p.files!.map((f) => f.name)).toEqual(['triceratops.webp']);
  });
});

describe('revealPayload routes the hatched species through dinoImage', () => {
  it('passes the hatched species id and keeps the crack on the real assetImage path', () => {
    // eggId 6 (a literal invented for this test — no real egg row is in scope
    // here) seeds the crack: rare's hash for id 6 lands on -v4, not the base.
    const species = getSpecies('velociraptor');
    const p = revealPayload(species, 6);
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['velociraptor', species.archetype, species.diet]]);
    expect(p.embeds[0].toJSON().image?.url).toBe('attachment://rare-crack-v4.webp');
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://velociraptor.webp');
    // Call order is upload order, and only dinoImage is mocked — the crack is still real.
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack-v4.webp', 'velociraptor.webp']);
    expect(p.attachments).toEqual([]);
  });
});

describe('fightFrames routes the lead enemy through dinoImage', () => {
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

  it('passes the rosterFor lead species id on a non-boss stage, on every frame', () => {
    const stage = STAGES.get('coastal_dig_1')!;
    // rosterFor is the single source of truth for who is fielded — never re-derived.
    const lead = getSpecies(rosterFor(stage, 1)[0].speciesId);
    const frames = fightFrames(makeOutcome(), skipStub);
    expect(vi.mocked(dinoImage).mock.calls).toEqual([[lead.id, lead.archetype, lead.diet]]);
    for (const f of frames) {
      expect(f.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${lead.id}.webp`);
    }
    // The F1/F4 upload contract is unchanged: files on the two attaching frames only.
    expect(frames[0].files!.map((f) => f.name)).toContain(`${lead.id}.webp`);
    expect(frames[1].files).toBeUndefined();
    expect(frames[2].files).toBeUndefined();
    expect(frames[3].files!.map((f) => f.name)).toContain(`${lead.id}.webp`);
  });

  it('never calls dinoImage on a boss stage — a boss is a named individual, never a species stand-in', () => {
    const frames = fightFrames(
      makeOutcome({ stageId: 'coastal_dig_boss', bossEgg: { rarity: 'rare' } }), skipStub);
    expect(dinoImage).not.toHaveBeenCalled();
    const bossId = STAGES.get('coastal_dig_boss')!.boss!.bossId;
    expect(frames[3].embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${bossId}-portrait.webp`);
  });
});
