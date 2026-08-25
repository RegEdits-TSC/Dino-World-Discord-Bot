import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Variant files are `<base>-v2.webp`, `-v3.webp`, `-v4.webp` beside an untouched
// `<base>.webp`. The `v` is load-bearing: no committed filename and no species id
// contains a digit or a `-v` suffix, so `-vN` can never be mistaken for part of a
// base name. A bare `-2` would carry no such guarantee for future ids.
export function parseVariant(name: string): { base: string; n: number } | null {
  const m = /^(.+)-v(\d+)$/.exec(name);
  if (!m) return null;
  return { base: m[1]!, n: Number(m[2]) };
}

const KINDS = ['eggs', 'sites', 'banners', 'battles', 'hatch', 'dinos'] as const;

function namesIn(kind: string): string[] {
  return readdirSync(resolve(process.cwd(), 'assets/images', kind))
    .filter((f) => f.endsWith('.webp'))
    .map((f) => f.replace(/\.webp$/, ''));
}

// Detect orphaned variant files (variants whose base does not exist).
// Used by both directory-scanning and synthetic test cases.
function findOrphans(names: string[]): string[] {
  const bases = new Set(names.filter((n) => parseVariant(n) === null));
  return names
    .map((n) => ({ n, v: parseVariant(n) }))
    .filter((e) => e.v !== null && !bases.has(e.v.base))
    .map((e) => e.n);
}

describe('parseVariant', () => {
  it('splits a variant into its base and number', () => {
    expect(parseVariant('care-v2')).toEqual({ base: 'care', n: 2 });
    expect(parseVariant('rare-crack-v4')).toEqual({ base: 'rare-crack', n: 4 });
    expect(parseVariant('coastal_dig-banner-v3')).toEqual({
      base: 'coastal_dig-banner',
      n: 3,
    });
  });

  it('returns null for a base name', () => {
    expect(parseVariant('care')).toBeNull();
    expect(parseVariant('boss-coastal_dig-portrait')).toBeNull();
  });
});

describe('committed variants', () => {
  // The guard this file exists for. It passes vacuously while no variant is
  // committed, which is why parseVariant is unit-tested above — otherwise a broken
  // parser would make this loop silently inspect nothing.
  it.each(KINDS)('every %s variant has a committed base file', (kind) => {
    const names = namesIn(kind);
    const orphans = findOrphans(names);
    expect(
      orphans,
      `variant files with no base in ${kind}: ${orphans.join(', ')}`
    ).toEqual([]);
  });

  it.each(KINDS)('%s variant numbers start at 2 and have no gaps', (kind) => {
    const byBase = new Map<string, number[]>();
    for (const n of namesIn(kind)) {
      const v = parseVariant(n);
      if (v)
        byBase.set(v.base, [...(byBase.get(v.base) ?? []), v.n].sort((a, b) => a - b));
    }
    for (const [base, ns] of byBase) {
      expect(ns, `${kind}/${base} variant numbering`).toEqual(
        Array.from({ length: ns.length }, (_, i) => i + 2)
      );
    }
  });
});

describe('variant orphan detection', () => {
  it('rejects a variant whose base is missing (synthetic, no files touched)', () => {
    const names = ['care', 'care-v2', 'collectt-v2'];
    const orphans = findOrphans(names);
    expect(orphans).toEqual(['collectt-v2']);
  });
});
