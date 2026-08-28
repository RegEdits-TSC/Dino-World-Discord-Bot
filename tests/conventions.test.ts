import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('docs/conventions/manifest.json', 'utf8'));
const ruleMap = JSON.parse(
  readFileSync('docs/superpowers/plans/artifacts/2026-08-28-claude-md-rule-map.json', 'utf8')
);

describe('conventions manifest', () => {
  it('files every rule from the measured map exactly once', () => {
    const filed = new Set<string>();
    for (const d of manifest.docs) {
      for (const r of d.rules) {
        expect(filed.has(r.id), `${r.id} filed twice`).toBe(false);
        filed.add(r.id);
      }
    }
    for (const id of manifest.alwaysCore) {
      expect(filed.has(id), `${id} in both a doc and alwaysCore`).toBe(false);
      filed.add(id);
    }
    const expected = ruleMap.rules.map((r: { id: string }) => r.id).sort();
    expect([...filed].sort()).toEqual(expected);
  });

  it('holds the always-core to eight rules', () => {
    expect(manifest.alwaysCore).toHaveLength(8);
  });

  it('marks exactly the five rules that cannot be compressed to a headline', () => {
    const flagged = manifest.docs
      .flatMap((d: { rules: { id: string; bodyRequired?: boolean }[] }) => d.rules)
      .filter((r: { bodyRequired?: boolean }) => r.bodyRequired)
      .map((r: { id: string }) => r.id)
      .sort();
    expect(flagged).toEqual(
      [
        'notify-payload-omits-attachments',
        'payload-never-shared-across-two-sends',
        'one-more-face-moves-half-the-seeds',
        'no-test-proves-a-variant-is-reachable',
        'null-prototype-catalog-maps',
        'router-guard-test-evidence',
      ].sort()
    );
  });

  it('audits clean', () => {
    expect(() => execFileSync('node', ['scripts/conventions-audit.mjs'])).not.toThrow();
  });
});
