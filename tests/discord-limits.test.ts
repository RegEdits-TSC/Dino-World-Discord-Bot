import { describe, it, expect } from 'vitest';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { validateMessagePayload, validateAutocompleteChoices } from './lib/discord-limits.js';

const ok = (p: unknown) => expect(() => validateMessagePayload(p, 'test')).not.toThrow();
const bad = (p: unknown, re: RegExp) => expect(() => validateMessagePayload(p, 'test')).toThrow(re);

describe('validateMessagePayload', () => {
  it('accepts typical payloads', () => {
    ok('plain string reply');
    ok({ content: 'hi' });
    ok({ embeds: [new EmbedBuilder().setTitle('t').setDescription('d')] });
    ok({ components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('a:b:1').setLabel('Go').setStyle(ButtonStyle.Primary))] });
    ok({ embeds: [{ title: 'raw object embed' }] });
  });
  it('rejects content over 2000 chars (string and object form)', () => {
    bad('x'.repeat(2001), /content/);
    bad({ content: 'x'.repeat(2001) }, /content/);
  });
  it('rejects more than 10 embeds', () => {
    bad({ embeds: Array.from({ length: 11 }, () => ({ title: 't' })) }, /embeds/);
  });
  it('rejects per-embed field violations', () => {
    bad({ embeds: [{ title: 'x'.repeat(257) }] }, /title/);
    bad({ embeds: [{ description: 'x'.repeat(4097) }] }, /description/);
    bad({ embeds: [{ fields: Array.from({ length: 26 }, (_, i) => ({ name: `n${i}`, value: 'v' })) }] }, /fields/);
    bad({ embeds: [{ fields: [{ name: '', value: 'v' }] }] }, /name/);
    bad({ embeds: [{ fields: [{ name: 'n', value: 'x'.repeat(1025) }] }] }, /value/);
    bad({ embeds: [{ footer: { text: 'x'.repeat(2049) } }] }, /footer/);
  });
  it('rejects combined embed text over 6000 chars', () => {
    const big = { description: 'x'.repeat(4000) };
    bad({ embeds: [big, big] }, /6000/);
  });
  it('rejects component violations', () => {
    const row = (n: number) => ({ components: Array.from({ length: n }, (_, i) => ({ custom_id: `c${i}`, label: 'b', style: 2 })) });
    bad({ components: Array.from({ length: 6 }, () => row(1)) }, /rows/);
    bad({ components: [row(6)] }, /buttons/);
    bad({ components: [{ components: [{ custom_id: 'x'.repeat(101), label: 'b', style: 2 }] }] }, /custom_id/);
  });
});

describe('validateAutocompleteChoices', () => {
  const bad = (c: unknown, re: RegExp) => expect(() => validateAutocompleteChoices(c, 'ac')).toThrow(re);
  it('accepts a normal choice list', () => {
    expect(() => validateAutocompleteChoices(
      [{ name: 'Ferns — 10 cash', value: 'ferns' }, { name: '#3', value: 3 }], 'ac')).not.toThrow();
  });
  it('rejects more than 25 choices', () => {
    bad(Array.from({ length: 26 }, (_, i) => ({ name: `n${i}`, value: i })), /25/);
  });
  it('rejects bad names and long string values', () => {
    bad([{ name: '', value: 'v' }], /name/);
    bad([{ name: 'x'.repeat(101), value: 'v' }], /name/);
    bad([{ name: 'n', value: 'x'.repeat(101) }], /value/);
  });
});
