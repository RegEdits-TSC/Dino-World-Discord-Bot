import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dexViewPayload } from '../src/modules/dex/embeds.js';
import { revealPayload } from '../src/modules/hatchery/embeds.js';
import { getSpecies } from '../src/data/species/index.js';
import { dinoImage } from '../src/core/images.js';

// dinoImage is a PASS-THROUGH spy (it calls the real implementation), so every
// assertion below reads the real committed rasters off disk. Nothing here stages
// or deletes a file under assets/images/: vitest runs test FILES in parallel
// forks, so a writeFileSync/rmSync on a committed asset path can be observed —
// or deleted — by another file mid-run. The spy exists for the two things a
// real-asset read cannot show on its own: which arguments each call site passes,
// and the null-degrade branch.
//
// This mocks dinoImage and deliberately NOT assetImage. dinoImage calls
// assetImage through its own module-internal binding, which a vi.mock of the
// assetImage EXPORT cannot intercept — importOriginal() hands back the real
// dinoImage, closed over the real assetImage. Mocking assetImage here would
// queue a mockImplementationOnce that nothing ever consumes, and the degrade
// tests below would silently assert nothing.
vi.mock('../src/core/images.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/images.js')>();
  return { ...actual, dinoImage: vi.fn(actual.dinoImage) };
});

// speciesId -> `${archetype}-${diet}`: the file each hero WOULD resolve to if the
// override were dropped. Hand-typed against src/data/species/*.ts. Eight species
// collapsed onto three images before the override shipped, which is the whole
// reason this file exists.
const HERO_FALLBACK: Record<string, string> = {
  tyrannosaurus: 'bruiser-carnivore',
  spinoraptor: 'bruiser-carnivore',
  liopleurodon: 'bruiser-carnivore',
  indominus: 'bruiser-carnivore',
  mosasaurus: 'tank-carnivore',
  ultimasaurus: 'tank-carnivore',
  quetzalcoatlus: 'swift-carnivore',
  indoraptor: 'swift-carnivore',
};
const HERO_IDS = Object.keys(HERO_FALLBACK);

// The species that DO appear in existing pinned art fixtures, none of which ships
// an override — which is why nothing existing moved when the heroes landed, and
// equally why the override would otherwise ship completely untested.
const NON_HERO: Array<[string, string]> = [
  ['velociraptor', 'swift-carnivore'],
  ['triceratops', 'tank-herbivore'],
  ['compsognathus', 'swift-carnivore'],
  ['othnielia', 'swift-herbivore'],
  ['microceratus', 'support-herbivore'],
];

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => {
  ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'Reg');
  // vitest.config.ts sets neither clearMocks nor restoreMocks, so mock.calls
  // would otherwise accumulate across every case in this file.
  vi.mocked(dinoImage).mockClear();
});

describe('/dex view carries the species art override', () => {
  it.each(HERO_IDS)('%s reaches the embed as its own portrait', (id) => {
    const payload = dexViewPayload(ctx, 'u1', id);
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${id}.webp`);
    // Attach-all-or-nothing: a thumbnail URL with no matching upload renders broken.
    expect(payload.files!.map((f) => f.name)).toEqual([`${id}.webp`]);
  });

  // The half that proves it is an OVERRIDE and not a replacement: 44 species ship
  // no file of their own and must still land on the archetype art, or "adding a
  // species is a data-only change" stops being true.
  it.each(NON_HERO)('%s still resolves the shared %s art', (id, key) => {
    const payload = dexViewPayload(ctx, 'u1', id);
    expect(payload.embeds[0].toJSON().thumbnail?.url).toBe(`attachment://${key}.webp`);
    expect(payload.files!.map((f) => f.name)).toEqual([`${key}.webp`]);
  });

  // Without this, the hero cases above could pass on a call site that had simply
  // stopped resolving art at all — and the non-hero cases could pass on a call
  // site that passed the archetype key where the species id belongs, since that
  // key is itself a present file. Naming the fallback explicitly is what makes the
  // two directions independent.
  it.each(HERO_IDS)('%s no longer resolves the archetype art it used to share', (id) => {
    const url = dexViewPayload(ctx, 'u1', id).embeds[0].toJSON().thumbnail?.url;
    expect(url).not.toBe(`attachment://${HERO_FALLBACK[id]}.webp`);
  });

  it('passes the species id, archetype and diet — in that argument order', () => {
    dexViewPayload(ctx, 'u1', 'quetzalcoatlus');
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['quetzalcoatlus', 'swift', 'carnivore']]);
  });

  it('degrades to no thumbnail and no files key when neither file is present', () => {
    // Models a deploy with no dino art at all — every asset is individually
    // optional, and assetImage's null return is the contract dinoImage inherits
    // on BOTH arms: a species miss falling through to an archetype miss is null.
    vi.mocked(dinoImage).mockImplementationOnce(() => null);
    const payload = dexViewPayload(ctx, 'u1', 'tyrannosaurus');
    expect(payload.embeds[0].toJSON().thumbnail).toBeUndefined();
    // attach() is a total no-op on null — files must be undefined, never [].
    expect('files' in payload).toBe(false);
    expect(payload.files).toBeUndefined();
  });
});

describe('the hatch reveal carries the species art override', () => {
  it('a mythic hero hatches under its own portrait, beside its rarity crack', () => {
    const p = revealPayload(getSpecies('indominus'));   // mythic, bruiser/carnivore
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://mythic-crack.webp');
    expect(embed.thumbnail?.url).toBe('attachment://indominus.webp');
    // attach APPENDS and call order is upload order: crack first, portrait second.
    expect(p.files.map((f) => f.name)).toEqual(['mythic-crack.webp', 'indominus.webp']);
    // attachments: [] is load-bearing — discord.js pushes the new descriptors into
    // the array we pass, so the pre-hatch egg upload is dropped by i.update().
    expect(p.attachments).toEqual([]);
  });

  it('a legendary hero hatches under its own portrait', () => {
    const p = revealPayload(getSpecies('quetzalcoatlus'));   // legendary, swift/carnivore
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://legendary-crack.webp');
    expect(embed.thumbnail?.url).toBe('attachment://quetzalcoatlus.webp');
    expect(p.files.map((f) => f.name)).toEqual(['legendary-crack.webp', 'quetzalcoatlus.webp']);
  });

  it('a non-hero species still hatches under the shared archetype art', () => {
    const p = revealPayload(getSpecies('velociraptor'));   // rare, swift/carnivore
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://rare-crack.webp');
    expect(embed.thumbnail?.url).toBe('attachment://swift-carnivore.webp');
    expect(p.files.map((f) => f.name)).toEqual(['rare-crack.webp', 'swift-carnivore.webp']);
  });

  it('passes the species id, archetype and diet — in that argument order', () => {
    revealPayload(getSpecies('ultimasaurus'));
    expect(vi.mocked(dinoImage).mock.calls).toEqual([['ultimasaurus', 'tank', 'carnivore']]);
  });

  it('still ships the crack when the portrait is missing', () => {
    // Two files on one payload, two independent attach calls: a miss on the
    // portrait must not drop the crack attach already appended to payload.files.
    vi.mocked(dinoImage).mockImplementationOnce(() => null);
    const p = revealPayload(getSpecies('indoraptor'));
    const embed = p.embeds[0].toJSON();
    expect(embed.image?.url).toBe('attachment://mythic-crack.webp');
    expect(embed.thumbnail).toBeUndefined();
    expect(p.files.map((f) => f.name)).toEqual(['mythic-crack.webp']);
  });
});
