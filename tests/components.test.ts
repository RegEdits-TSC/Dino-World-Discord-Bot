import { describe, it, expect } from 'vitest';
import type { ButtonInteraction } from 'discord.js';
import { clickedIdIsOnMessage, submittedValuesAreOnMessage } from '../src/core/components.js';
import { fakeSelect } from './harness.js';

/**
 * The shapes here mirror what discord.js hands a component handler: Message#components
 * is a TopLevelComponent[] whose ActionRows expose `customId` on each child, and whose
 * v2 container/section members nest another `components` array underneath.
 */
function click(customId: string, components: unknown): ButtonInteraction {
  return { customId, message: { components } } as unknown as ButtonInteraction;
}
const row = (...ids: string[]) => ({ type: 1, components: ids.map((id) => ({ type: 2, customId: id })) });

describe('clickedIdIsOnMessage', () => {
  it('accepts a customId the message actually carries', () => {
    expect(clickedIdIsOnMessage(click('duel:accept:a:b:9', [row('duel:accept:a:b:9', 'duel:decline:a:b:9')])))
      .toBe(true);
  });

  it('rejects a customId no button on the message carries', () => {
    expect(clickedIdIsOnMessage(click('duel:accept:a:b:9', [row('duel:accept:a:c:9', 'duel:decline:a:c:9')])))
      .toBe(false);
  });

  // Exact equality, never a prefix or substring match: every segment of the id — the
  // pair AND the expiry anchor — has to be the one the bot minted.
  it('rejects an id that merely shares a prefix with one on the message', () => {
    expect(clickedIdIsOnMessage(click('duel:accept:a:b:99999', [row('duel:accept:a:b:9')]))).toBe(false);
    expect(clickedIdIsOnMessage(click('duel:accept:a:b', [row('duel:accept:a:b:9')]))).toBe(false);
  });

  it('finds a button nested inside a container or section', () => {
    const nested = [{ type: 17, components: [{ type: 9, components: [row('park:collect')] }] }];
    expect(clickedIdIsOnMessage(click('park:collect', nested))).toBe(true);
    expect(clickedIdIsOnMessage(click('park:dinos:u:0', nested))).toBe(false);
  });

  // Fails CLOSED. A message with no components cannot authorise anything, and neither
  // can one whose components Discord did not send us.
  it('rejects when the message carries no components at all', () => {
    expect(clickedIdIsOnMessage(click('duel:accept:a:b:9', []))).toBe(false);
    expect(clickedIdIsOnMessage(click('duel:accept:a:b:9', undefined))).toBe(false);
    expect(clickedIdIsOnMessage({ customId: 'x' } as unknown as ButtonInteraction)).toBe(false);
  });

  // A link button has no customId at all, and a null must never be mistaken for a
  // caller passing an empty id.
  it('ignores components that carry no customId', () => {
    expect(clickedIdIsOnMessage(click('', [{ type: 1, components: [{ type: 2, url: 'https://x' }] }])))
      .toBe(false);
  });

  // A nullish clicked id must never match a component that also lacks one: an unset
  // `customId` property and a nullish `i.customId` both read back `undefined`, so a bare
  // `===` would treat that coincidence as a match and fail OPEN. Unreachable through the
  // router today (ModuleRegistry.findComponent splits the customId before dispatch, so a
  // nullish id throws there first), but this helper stands as a general-purpose guard and
  // must hold on its own terms.
  it('rejects a nullish clicked id even against a component that also has none', () => {
    const linkOnly = [{ type: 1, components: [{ type: 2, url: 'https://x' }] }];
    expect(clickedIdIsOnMessage(
      { customId: undefined, message: { components: linkOnly } } as unknown as ButtonInteraction,
    )).toBe(false);
    expect(clickedIdIsOnMessage(
      { customId: null, message: { components: linkOnly } } as unknown as ButtonInteraction,
    )).toBe(false);
  });
});

const asSelect = (o: { customId: string; values: string[]; options?: string[]; componentIds?: string[] }) =>
  fakeSelect({ user: 'u1', ...o }).asInteraction() as never;

describe('submittedValuesAreOnMessage', () => {
  it('accepts values the minted menu actually offered', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['a'], options: ['a', 'b'],
    }))).toBe(true);
  });

  it('rejects a value the menu never offered', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['evil'], options: ['a', 'b'],
    }))).toBe(false);
  });

  it('rejects a prototype key, which a plain-object lookup would read back truthy', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['__proto__'], options: ['a'],
    }))).toBe(false);
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['constructor'], options: ['a'],
    }))).toBe(false);
  });

  it('rejects a partially valid submission rather than accepting the good half', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['a', 'evil'], options: ['a', 'b'],
    }))).toBe(false);
  });

  it('fails closed on an empty submission and on a menu that is not on the message', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: [], options: ['a'],
    }))).toBe(false);
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['a'], options: ['a'], componentIds: [],
    }))).toBe(false);
  });

  // Not in the brief's five cases, but called out by the design rules ("a menu carrying
  // no options" is one of the three fail-closed conditions). Note this doesn't pin distinct
  // behaviour: `values.length === 0` already short-circuits before a menu is even looked
  // up, so submitted values here are always non-empty, and a non-empty values array against
  // an empty offered Set already fails the `.every` check with no help from the explicit
  // `menu.options.length === 0` clause — there is no "both sides empty, matching by
  // coincidence" state for this function to fall into. The explicit clause is genuinely
  // redundant today and is kept only as defence in depth; this test would still pass with
  // it deleted, so don't read it as proof the clause is load-bearing.
  it('fails closed on a menu that carries no options at all', () => {
    expect(submittedValuesAreOnMessage(asSelect({
      customId: 'm:pick', values: ['a'], options: [],
    }))).toBe(false);
  });
});
