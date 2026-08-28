import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

// The machine gate the table never had. Before it, whether a reason was answered was a matter
// of whether someone had remembered — and most of the payout reasons had not been, `trade` and
// `admin:give` among them. A missing PAYOUT does not fall back loudly the way a missing charge
// does: sideEffectNoteFor blanks the fallback on a row that took no money, so the note simply
// disappears, and a blank is indistinguishable from "this row left nothing behind".
describe('the side-effect table against the live economy call sites', () => {
  const srcFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? srcFiles(p) : e.name.endsWith('.ts') ? [p] : [];
    });

  // Every call passes its reason as the argument immediately before the timestamp, as either a
  // plain string or a template literal whose leading segment is the prefix the table keys on.
  const REASON_ARG = /,\s*(['"`])([a-z][a-z-]*)[^'"`]*\1,\s*(?:ctx\.now\(\)|now)\s*\)/;

  it('answers every reason src/ actually emits', () => {
    const root = resolve(process.cwd(), 'src');
    const prefixes = new Set<string>();
    const unreadable: string[] = [];
    let sites = 0;
    for (const file of srcFiles(root)) {
      for (const seg of readFileSync(file, 'utf8').split('economy.apply(').slice(1)) {
        sites++;
        const m = REASON_ARG.exec(seg);
        if (m) prefixes.add(m[2]!);
        else unreadable.push(`${file.slice(root.length + 1)}: ${seg.slice(0, 100).replace(/\s+/g, ' ')}`);
      }
    }

    // A call site this scraper cannot read is a HOLE in the gate, not a pass — it would drop
    // that reason from the set and let a missing entry through unnoticed. Fail on it instead,
    // and widen the pattern in the same change that introduces the new call shape.
    expect(unreadable, `economy.apply call sites whose reason could not be read:\n${unreadable.join('\n')}`)
      .toEqual([]);
    // Non-vacuity, without pinning a count that goes stale the next time a spend path ships:
    // renaming or wrapping economy.apply would otherwise leave this scraping nothing at all
    // and passing for free. These four are read out of four different modules.
    expect(sites).toBeGreaterThan(0);
    expect([...prefixes]).toEqual(expect.arrayContaining(['collect', 'trade', 'build', 'sell']));

    const unanswered = [...prefixes].filter((p) => knownSideEffectFor(p) === null).sort();
    expect(unanswered, [
      'Every reason src/ emits needs an entry in SIDE_EFFECTS (src/data/tx-reasons.ts),',
      'payouts included. A charge with no entry at least reads "unrecognised — check',
      'manually"; a PAYOUT with no entry renders blank, and a blank tells the operator the',
      'row left nothing behind when it may have left an item, a claim or a counterparty row.',
      `unanswered: ${unanswered.join(', ')}`,
    ].join('\n')).toEqual([]);
  });
});
