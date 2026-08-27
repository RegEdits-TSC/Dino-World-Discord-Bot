import { describe, it, expect } from 'vitest';
import { sideEffectFor, knownSideEffectFor, UNRECOGNISED_SIDE_EFFECT } from '../src/data/tx-reasons.js';

describe('sideEffectFor', () => {
  it('names what a charge left behind', () => {
    expect(sideEffectFor('build:paddock_plains')).toMatch(/lot still stands/i);
    expect(sideEffectFor('landmark:3')).toMatch(/landmark tier/i);
    expect(sideEffectFor('sell:triceratops')).toMatch(/destroyed/i);
    expect(sideEffectFor('splice:12')).toMatch(/irreversible/i);
  });

  it('reads the prefix, not the whole reason', () => {
    expect(sideEffectFor('upgrade:hatchery_lab:5')).toBe(sideEffectFor('upgrade:paddock_plains:2'));
  });

  it('fails CLOSED on an unrecognised prefix', () => {
    // A blank note and "no side effect" are indistinguishable to a tired operator, and new
    // spend paths will ship without an entry here. The tool must say it does not know.
    expect(sideEffectFor('brand-new-feature:7')).toMatch(/unrecognised — check manually/i);
  });

  it('does not read prototype keys as entries', () => {
    // sideEffectFor treats prototype-shaped keys as unrecognised rather than as entries,
    // relying on Object.hasOwn to gate access. This protects against accidental collision
    // with inherited properties.
    expect(sideEffectFor('constructor:1')).toMatch(/unrecognised/i);
    expect(sideEffectFor('__proto__:1')).toMatch(/unrecognised/i);
  });

  it('says a reversal row left nothing behind', () => {
    expect(sideEffectFor('reverse')).toBe('—');
  });

  it('distinguishes a real entry from the fallback, which sideEffectFor alone cannot', () => {
    // The admin surfaces drop the fallback on a payout while keeping every genuine entry, so
    // they need the two told apart. Reading it back out of sideEffectFor by comparing against
    // the fallback STRING would work today and break silently the moment that wording is
    // edited — which is why the distinction lives in the return type instead.
    expect(knownSideEffectFor('sell:triceratops')).toMatch(/does not bring it back/i);
    expect(knownSideEffectFor('brand-new-feature:7')).toBeNull();
    // And the convenience wrapper still collapses the two, exactly as before.
    expect(sideEffectFor('brand-new-feature:7')).toBe(UNRECOGNISED_SIDE_EFFECT);
    expect(sideEffectFor('sell:triceratops')).toBe(knownSideEffectFor('sell:triceratops'));
  });
});
