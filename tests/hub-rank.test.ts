import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';
import { rankSignals, MAX_HUB_BUTTONS } from '../src/modules/hub/rank.js';
import type { HubSignal } from '../src/modules/hub/types.js';

const sig = (id: string, lossAtMs: number | null, control = true): HubSignal => ({
  id,
  section: 'attention',
  text: id,
  lossAtMs,
  ...(control
    ? { control: { customId: `hub:x:${id}`, label: id, style: ButtonStyle.Primary } }
    : {}),
});

describe('rankSignals', () => {
  it('orders by what the player loses soonest, and puts deadline-less rows last', () => {
    const ranked = rankSignals([
      sig('egg', null),
      sig('season', 5_000),
      sig('escape', 1_000),
      sig('daily', null),
      sig('trade', 3_000),
    ]);
    // Whole-list equality, not a spot check on one index: a comparator that got only the
    // null handling right would still pass an assertion that merely looked at [0].
    expect(ranked.map((s) => s.id)).toEqual(['escape', 'trade', 'season', 'egg', 'daily']);
  });

  it('sorts a PAST deadline first — already losing beats about to lose', () => {
    const ranked = rankSignals([sig('soon', 10_000), sig('capped', -1), sig('none', null)]);
    expect(ranked.map((s) => s.id)).toEqual(['capped', 'soon', 'none']);
  });

  it('breaks ties by the order the caller supplied, both among nulls and among equals', () => {
    const ranked = rankSignals([
      sig('n1', null), sig('e1', 500), sig('n2', null), sig('e2', 500),
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['e1', 'e2', 'n1', 'n2']);
  });

  it('drops rows with no control — a text-only row never takes a button seat', () => {
    // The trade row and the escaped row ship without controls by design (spec §5.5). If
    // they consumed seats, the five most urgent ACTIONABLE rows would not be the five
    // rendered.
    const ranked = rankSignals([
      sig('trade-text', 1, false),
      sig('escaped-text', 2, false),
      sig('feed', 3),
    ]);
    expect(ranked.map((s) => s.id)).toEqual(['feed']);
  });

  it(`caps at MAX_HUB_BUTTONS, keeping the most urgent`, () => {
    const many = Array.from({ length: 9 }, (_, n) => sig(`s${n}`, 9 - n));
    const ranked = rankSignals(many);
    expect(ranked).toHaveLength(MAX_HUB_BUTTONS);
    expect(ranked.map((s) => s.id)).toEqual(['s8', 's7', 's6', 's5', 's4']);
  });

  it('does not mutate its argument', () => {
    const input = [sig('b', 2), sig('a', 1)];
    const before = input.map((s) => s.id);
    rankSignals(input);
    expect(input.map((s) => s.id)).toEqual(before);
  });
});
