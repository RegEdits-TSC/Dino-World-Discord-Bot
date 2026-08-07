import { describe, it, expect } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { worldModule } from '../src/modules/world/index.js';
import { eventHeaderLine, anyModRelevant } from '../src/modules/world/embeds.js';
import { NEUTRAL_MODS } from '../src/data/world-events.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { parkModule } from '../src/modules/park/index.js';
import { PARK_HEADER_KEYS } from '../src/modules/park/embeds.js';
import { shopModule, SHOP_VIEW_HEADER_KEYS } from '../src/modules/shop/index.js';
import { expeditionsModule, EXPEDITION_START_HEADER_KEYS, EXPEDITION_CLAIM_HEADER_KEYS } from '../src/modules/expeditions/index.js';
import { startExpedition } from '../src/modules/expeditions/service.js';
import { battlesModule } from '../src/modules/battles/index.js';
import { BATTLE_CHAPTERS_HEADER_KEYS } from '../src/modules/battles/embeds.js';

type EmbedJson = {
  title?: string;
  description?: string;
  fields?: Array<{ name: string; value: string }>;
  footer?: { text: string };
};
type EmbedPayload = { embeds: Array<{ toJSON(): EmbedJson }>; files?: unknown[] };

const DAY = 86_400_000;
const cmd = worldModule.commands[0];

describe('/world', () => {
  it('names the calm day and lists no effects', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    const i = fakeCommand({ name: 'world', user: 'u1' });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toContain('Clear Skies');
    expect(embed.fields![0].value).toContain('Nothing out of the ordinary');
    // No art has shipped yet (Task 12) — assetImage null-degrades, so the
    // payload must never carry a files array, not even an empty one.
    expect(payload.files).toBeUndefined();
  });

  it('spells out every effect of an eventful day in plain language', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });     // heat_wave
    const i = fakeCommand({ name: 'world', user: 'u1' });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.title).toContain('Heat Wave');
    expect(embed.fields![0].value).toContain('Park income +20%');
    expect(embed.fields![0].value).toContain('Feeding costs 30% more food');
    // No raw multipliers ever reach the player.
    expect(embed.fields![0].value).not.toContain('1.3');
  });

  it('names tomorrow but not its numbers', async () => {
    const ctx = makeCtx({ nowMs: 4 * DAY });     // day 5 is heat_wave
    const i = fakeCommand({ name: 'world', user: 'u1' });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.footer!.text).toBe('Tomorrow: Heat Wave');
    expect(embed.footer!.text).not.toContain('%');
  });

  it('reports the season and its day', async () => {
    const ctx = makeCtx({ nowMs: 35 * DAY });
    const i = fakeCommand({ name: 'world', user: 'u1' });
    await cmd.execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.fields!.find((f) => f.name === 'Season')!.value).toBe('Dry — day 6 of 30');
  });

  it('stays inside Discord limits on the busiest event', async () => {
    // Blood Moon has three effect lines; the payload validator in the fake
    // throws on a limit breach, so simply executing is the assertion.
    const ctx = makeCtx({ nowMs: 7 * DAY });
    const i = fakeCommand({ name: 'world', user: 'u1' });
    await cmd.execute(ctx, i.asChatInput());
    expect(i.replies).toHaveLength(1);
  });
});

describe('eventHeaderLine', () => {
  it('says so when nothing on this screen is affected', () => {
    expect(eventHeaderLine(5 * DAY, ['eggPrice', 'foodPrice']))
      .toContain('no effect here today');
  });
  it('lists the effects when the screen is affected', () => {
    expect(eventHeaderLine(38 * DAY, ['eggPrice', 'sellCash']))
      .toContain('Eggs cost 30% less');
  });

  it('treats a 0-neutral field as relevant when the event moves it off zero', () => {
    // blood_moon (day 7) sets energyCostDelta: -1, whose own neutral is 0, not
    // 1 — a check that reads "0 or 1 means neutral" misses this entirely.
    expect(eventHeaderLine(7 * DAY, ['energyCostDelta']))
      .toContain('Every stage costs 1 less energy');
  });

  it('treats a 0-neutral field pinned to the OTHER shape\'s neutral value (1) as relevant', () => {
    // The bug this guards: comparing a raw value against the literals 1 and 0
    // (instead of against NEUTRAL_MODS) misreads energyCostDelta === 1 as
    // neutral, because 1 also happens to be the neutral value for most OTHER
    // fields. No shipped WORLD_EVENTS entry sets energyCostDelta to 1 — the
    // only live fixture is blood_moon's -1, which the old literal check also
    // got right (-1 is neither 1 nor 0), so that fixture alone cannot
    // discriminate this bug. worldEventFor is pure and deterministic and this
    // plan never mocks src/core/world.js, so the boundary value is exercised
    // directly against the exported pure predicate with a synthetic EventMods
    // instead — the same pattern tests/world-effects.test.ts uses for
    // expeditionFeeFor/roundCharge boundaries no shipped multiplier reaches.
    expect(anyModRelevant({ ...NEUTRAL_MODS, energyCostDelta: 1 }, ['energyCostDelta'])).toBe(true);
  });
});

describe('world header lines', () => {
  it('appears on /park view with only the income effect', async () => {
    const ctx = makeCtx({ nowMs: 5 * DAY });   // heat_wave
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Heat Wave');
    expect(embed.description).toContain('Park income +20%');
  });

  it('appears on /shop view with only the price effects', async () => {
    const ctx = makeCtx({ nowMs: 18 * DAY });  // bumper_harvest
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'shop', sub: 'view', user: 'u1' });
    await shopModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Bumper Harvest');
    expect(embed.description).toContain('Food costs 40% less');
  });

  it('appears on /expedition start with the dig effects', async () => {
    const ctx = makeCtx({ nowMs: 10 * DAY });  // amber_storm: expeditionMs + expeditionFee
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'expedition', sub: 'start', user: 'u1', guild: 'g1', options: { site: 'coastal_dig' } });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Amber Storm');
    expect(embed.description).toContain('Expeditions finish 25% sooner');
  });

  it('/expedition start says nothing is unusual on a day whose only effects are priced at claim time', async () => {
    // Fossil Rush (day 14) sets ONLY expeditionCash and expeditionOddsShift —
    // both excluded from the start header on purpose (Finding 1: those two
    // are sampled fresh at claim time, so advertising them at dispatch could
    // announce a payout a later UTC-midnight crossing no longer matches).
    // This is the case that pins the whole point of the fix: if either
    // payout key were ever added back to EXPEDITION_START_HEADER_KEYS, this
    // test would start showing "Expeditions pay 50% more cash" instead.
    const ctx = makeCtx({ nowMs: 14 * DAY });  // fossil_rush
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'expedition', sub: 'start', user: 'u1', guild: 'g1', options: { site: 'coastal_dig' } });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Fossil Rush');
    expect(embed.description).toContain('no effect here today');
  });

  it('/expedition claim says nothing is unusual on a calm day', async () => {
    const ctx = makeCtx({ nowMs: 0 });         // clear_skies
    getOrCreateUser(ctx, 'u1', 'Reg');
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 16 * 60_000);       // past coastal_dig's 15-minute duration
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Clear Skies');
    expect(embed.description).toContain('no effect here today');
  });

  it('/expedition claim names both payout effects on Fossil Rush', async () => {
    // Fossil Rush (day 14) sets ONLY expeditionCash/expeditionOddsShift — the
    // exact two keys this screen owns, and the two EXPEDITION_START_HEADER_KEYS
    // deliberately excludes. This is the case that proves the claim header
    // does its job: on this exact day, /expedition start (tested above) shows
    // "no effect here today" while /expedition claim shows both lines.
    const ctx = makeCtx({ nowMs: 14 * DAY });  // fossil_rush
    getOrCreateUser(ctx, 'u1', 'Reg');
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 16 * 60_000);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Fossil Rush');
    expect(embed.description).toContain('Expeditions pay 50% more cash');
    expect(embed.description).toContain('Expedition eggs come back one rarity step worse');
  });

  it('/expedition claim says nothing is unusual on Amber Storm, whose effects are dispatch-time only', async () => {
    // Amber Storm (day 10) sets ONLY expeditionMs/expeditionFee — the two keys
    // EXPEDITION_START_HEADER_KEYS owns and EXPEDITION_CLAIM_HEADER_KEYS does
    // not. This is the leak-proof case: it proves the claim screen names
    // payout keys ONLY, and never bleeds the dispatch-time keys /expedition
    // start already showed for this same dig.
    const ctx = makeCtx({ nowMs: 10 * DAY });  // amber_storm
    getOrCreateUser(ctx, 'u1', 'Reg');
    startExpedition(ctx, 'u1', 'coastal_dig', 'g1');
    ctx.setNow(ctx.now() + 16 * 60_000);       // > 15min * 0.75 (amber_storm's shortened duration)
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1', guild: 'g1' });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Amber Storm');
    expect(embed.description).toContain('no effect here today');
  });

  it('appears on /battle chapters with the combat effects', async () => {
    const ctx = makeCtx({ nowMs: 7 * DAY });   // blood_moon
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'battle', sub: 'chapters', user: 'u1' });
    await battlesModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Blood Moon');
    expect(embed.description).toContain('Battle XP');
  });

  it('still renders on a calm day, saying nothing is unusual', async () => {
    const ctx = makeCtx({ nowMs: 0 });
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Clear Skies');
    expect(embed.description).toContain('no effect here today');
  });
});

describe('each header call site\'s key array is individually load-bearing', () => {
  // anyModRelevant is an OR across keys, and eventHeaderLine then prints the
  // event's entire UNFILTERED effects array once any one key is relevant. So
  // an end-to-end test picked on a real fixture day can only prove "at least
  // one of my keys overlaps this day's event" — never "this exact key set is
  // correct" — whenever the fixture day happens to move more than one of a
  // call site's keys at once (bumper_harvest moves both eggPrice and
  // foodPrice; amber_storm moves both expeditionMs and expeditionFee;
  // blood_moon moves all three of energyCostDelta/battleXp/enemyHp). These
  // tests isolate each key individually with a synthetic EventMods that
  // changes ONLY that one field off NEUTRAL_MODS, straight against the
  // exported anyModRelevant — the same pattern already used above for the
  // energyCostDelta boundary, never a mock of src/core/world.js.
  //
  // Each test imports the call site's REAL exported key array (PARK_HEADER_KEYS
  // etc.) rather than a hand-copied literal, so if a key is ever dropped from
  // the production array, the corresponding expect below flips from true to
  // false and fails — unlike the fixture-day tests above, most of which would
  // stay green (see the fail-then-revert note in the task report).

  it('park: income alone trips the header; an unrelated field does not', () => {
    expect(anyModRelevant({ ...NEUTRAL_MODS, income: 1.2 }, PARK_HEADER_KEYS)).toBe(true);
    expect(anyModRelevant({ ...NEUTRAL_MODS, eggPrice: 0.7 }, PARK_HEADER_KEYS)).toBe(false);
  });

  it('shop view: each of eggPrice/foodPrice/sellCash individually trips the header', () => {
    expect(anyModRelevant({ ...NEUTRAL_MODS, eggPrice: 0.7 }, SHOP_VIEW_HEADER_KEYS)).toBe(true);
    expect(anyModRelevant({ ...NEUTRAL_MODS, foodPrice: 0.6 }, SHOP_VIEW_HEADER_KEYS)).toBe(true);
    // sellCash never appears alone in the shipped roster — market_panic (its
    // only carrier) also moves eggPrice — which is exactly why this needs a
    // synthetic mods object rather than a second fixture day.
    expect(anyModRelevant({ ...NEUTRAL_MODS, sellCash: 0.8 }, SHOP_VIEW_HEADER_KEYS)).toBe(true);
    expect(anyModRelevant({ ...NEUTRAL_MODS, energyCostDelta: -1 }, SHOP_VIEW_HEADER_KEYS)).toBe(false);
  });

  it('expedition start: each of expeditionMs/expeditionFee individually trips the header; the claim-time-only keys never do', () => {
    expect(anyModRelevant({ ...NEUTRAL_MODS, expeditionMs: 0.75 }, EXPEDITION_START_HEADER_KEYS)).toBe(true);
    expect(anyModRelevant({ ...NEUTRAL_MODS, expeditionFee: 2 }, EXPEDITION_START_HEADER_KEYS)).toBe(true);
    // Finding 1: expeditionCash/expeditionOddsShift are sampled at CLAIM time
    // (service.ts), so the start header must stay silent about them even when
    // they're the only fields an event moves — this pins that exclusion.
    expect(anyModRelevant({ ...NEUTRAL_MODS, expeditionCash: 1.5 }, EXPEDITION_START_HEADER_KEYS)).toBe(false);
    expect(anyModRelevant({ ...NEUTRAL_MODS, expeditionOddsShift: -1 }, EXPEDITION_START_HEADER_KEYS)).toBe(false);
  });

  it('expedition claim: each of expeditionCash/expeditionOddsShift individually trips the header; the dispatch-time-only keys never do', () => {
    expect(anyModRelevant({ ...NEUTRAL_MODS, expeditionCash: 1.5 }, EXPEDITION_CLAIM_HEADER_KEYS)).toBe(true);
    expect(anyModRelevant({ ...NEUTRAL_MODS, expeditionOddsShift: -1 }, EXPEDITION_CLAIM_HEADER_KEYS)).toBe(true);
    // Mirror image of the expedition-start test above: expeditionMs/expeditionFee
    // are locked in at DISPATCH time, so the claim header must stay silent
    // about them even when they're the only fields an event moves.
    expect(anyModRelevant({ ...NEUTRAL_MODS, expeditionMs: 0.75 }, EXPEDITION_CLAIM_HEADER_KEYS)).toBe(false);
    expect(anyModRelevant({ ...NEUTRAL_MODS, expeditionFee: 2 }, EXPEDITION_CLAIM_HEADER_KEYS)).toBe(false);
  });

  it('battle chapters: each of energyCostDelta/battleXp/enemyHp individually trips the header', () => {
    expect(anyModRelevant({ ...NEUTRAL_MODS, energyCostDelta: -1 }, BATTLE_CHAPTERS_HEADER_KEYS)).toBe(true);
    expect(anyModRelevant({ ...NEUTRAL_MODS, battleXp: 1.5 }, BATTLE_CHAPTERS_HEADER_KEYS)).toBe(true);
    expect(anyModRelevant({ ...NEUTRAL_MODS, enemyHp: 1.15 }, BATTLE_CHAPTERS_HEADER_KEYS)).toBe(true);
    expect(anyModRelevant({ ...NEUTRAL_MODS, income: 1.2 }, BATTLE_CHAPTERS_HEADER_KEYS)).toBe(false);
  });
});
