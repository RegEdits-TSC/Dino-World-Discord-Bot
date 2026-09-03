import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';
import { hubCardPayload } from '../src/modules/hub/embeds.js';
import { rankSignals } from '../src/modules/hub/rank.js';
import type { HubSignal } from '../src/modules/hub/types.js';

const fieldsOf = (p: ReturnType<typeof hubCardPayload>) => p.embeds[0].toJSON().fields ?? [];

function sig(overrides: Partial<HubSignal> & Pick<HubSignal, 'id' | 'section' | 'text'>): HubSignal {
  return { lossAtMs: null, ...overrides };
}

describe('hubCardPayload', () => {
  it('renders exactly one field per section that has rows, and omits sections with none', () => {
    const signals: HubSignal[] = [
      sig({ id: 'r1', section: 'ready', text: 'An egg is ready to hatch.' }),
      sig({ id: 'a1', section: 'attention', text: 'A dino is hungry.' }),
    ];
    const p = hubCardPayload(signals, 'u1');
    const fields = fieldsOf(p);
    expect(fields).toHaveLength(2);
    expect(fields.map((f) => f.name)).toEqual(['Ready now', 'Needs you']);
    expect(fields.find((f) => f.name === 'Ready now')!.value).toBe('An egg is ready to hatch.');
    // claim, waiting, goals had no rows — never an empty field for them.
    expect(fields.some((f) => ['Ready to claim', 'Waiting on', 'Working toward'].includes(f.name))).toBe(false);
  });

  it('still renders a caught-up view with only goals rows', () => {
    const signals: HubSignal[] = [
      sig({ id: 'g1', section: 'goals', text: 'Reach 500 rating to unlock the next lot.' }),
    ];
    // Flat, not wrapped in expect(...).not.toThrow(): a wrapper swallows WHICH assertion
    // broke and reports every failure as the same "expected function not to throw".
    const p = hubCardPayload(signals, 'u1');
    expect(p.embeds).toHaveLength(1);
    expect(fieldsOf(p).length).toBeGreaterThanOrEqual(1);
  });

  it('orders the button row by rankSignals, not by input order', () => {
    const signals: HubSignal[] = [
      sig({
        id: 'mid', section: 'attention', text: 'Mid-urgency.', lossAtMs: 5000,
        control: { customId: 'hub:mid:u1', label: 'Mid', style: ButtonStyle.Primary },
      }),
      sig({
        id: 'urgent', section: 'attention', text: 'Most urgent.', lossAtMs: 100,
        control: { customId: 'hub:urgent:u1', label: 'Urgent', style: ButtonStyle.Danger },
      }),
      sig({
        id: 'never', section: 'goals', text: 'No deadline.', lossAtMs: null,
        control: { customId: 'hub:never:u1', label: 'Whenever', style: ButtonStyle.Secondary },
      }),
    ];
    // Input order (mid, urgent, never) must differ from ranked order for this case to be
    // non-vacuous — rankSignals sorts by lossAtMs ascending with null last, so ranked order
    // here is (urgent, mid, never), which is NOT the input order.
    const ranked = rankSignals(signals);
    expect(ranked.map((s) => s.id)).not.toEqual(signals.map((s) => s.id));

    const p = hubCardPayload(signals, 'u1');
    const buttonRow = p.components![0].toJSON().components as Array<{ custom_id: string }>;
    expect(buttonRow.map((c) => c.custom_id)).toEqual(ranked.map((s) => s.control!.customId));
  });

  it('renders text-only rows as text but never mints a button for them', () => {
    const signals: HubSignal[] = [
      sig({ id: 'escaped', section: 'attention', text: 'A Raptor escaped its lot!' }),
      sig({ id: 'trade', section: 'waiting', text: 'A trade offer expires soon.' }),
      sig({
        id: 'actionable', section: 'ready', text: 'An egg is ready.',
        control: { customId: 'hub:hatch:u1', label: 'Hatch', style: ButtonStyle.Success },
      }),
    ];
    const p = hubCardPayload(signals, 'u1');
    const fields = fieldsOf(p);
    expect(fields.find((f) => f.name === 'Needs you')!.value).toBe('A Raptor escaped its lot!');
    expect(fields.find((f) => f.name === 'Waiting on')!.value).toBe('A trade offer expires soon.');

    const buttonRow = p.components![0].toJSON().components as Array<{ custom_id: string }>;
    expect(buttonRow).toHaveLength(1);
    expect(buttonRow[0].custom_id).toBe('hub:hatch:u1');
  });

  it('always includes Refresh, alone in its own row, carrying the owner uid', () => {
    const p = hubCardPayload([], 'u42');
    const rows = p.components!.map((r) => r.toJSON().components as Array<{ custom_id: string }>);
    const refreshRow = rows.find((r) => r.some((c) => c.custom_id === 'hub:refresh:u42'));
    expect(refreshRow).toBeDefined();
    expect(refreshRow).toHaveLength(1);
  });

  it('never puts more than five buttons in a row or more than five rows, even with nine actionable signals', () => {
    const signals: HubSignal[] = Array.from({ length: 9 }, (_, i) =>
      sig({
        id: `s${i}`, section: 'ready', text: `Row ${i}.`, lossAtMs: i * 1000,
        control: { customId: `hub:action:${i}:u1`, label: `Action ${i}`, style: ButtonStyle.Primary },
      }));
    const p = hubCardPayload(signals, 'u1');
    expect(p.components!.length).toBe(2);
    for (const row of p.components!) {
      expect(row.toJSON().components.length).toBeLessThanOrEqual(5);
    }
  });

  it('ships no files, undefined rather than an empty array', () => {
    const p = hubCardPayload([sig({ id: 'r1', section: 'ready', text: 'x' })], 'u1');
    expect(p.files).toBeUndefined();
  });
});
