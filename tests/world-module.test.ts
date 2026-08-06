import { describe, it, expect } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { worldModule } from '../src/modules/world/index.js';
import { eventHeaderLine, anyModRelevant } from '../src/modules/world/embeds.js';
import { NEUTRAL_MODS } from '../src/data/world-events.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { parkModule } from '../src/modules/park/index.js';
import { shopModule } from '../src/modules/shop/index.js';
import { expeditionsModule } from '../src/modules/expeditions/index.js';
import { battlesModule } from '../src/modules/battles/index.js';

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
    const ctx = makeCtx({ nowMs: 10 * DAY });  // amber_storm
    getOrCreateUser(ctx, 'u1', 'Reg');
    const i = fakeCommand({ name: 'expedition', sub: 'start', user: 'u1', guild: 'g1', options: { site: 'coastal_dig' } });
    await expeditionsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as EmbedPayload;
    const embed = payload.embeds[0].toJSON();
    expect(embed.description).toContain('Amber Storm');
    expect(embed.description).toContain('Expeditions finish 25% sooner');
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
