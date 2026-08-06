import { describe, it, expect } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { worldModule } from '../src/modules/world/index.js';
import { eventHeaderLine } from '../src/modules/world/embeds.js';

type EmbedJson = {
  title?: string;
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
});
