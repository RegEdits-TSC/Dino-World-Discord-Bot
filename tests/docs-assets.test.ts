import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svgCount = readdirSync(resolve(process.cwd(), 'assets/emojis/svg')).filter((f) => f.endsWith('.svg')).length;
const ops = readFileSync(resolve(process.cwd(), 'docs/ops.md'), 'utf8');
const prompts = readFileSync(resolve(process.cwd(), 'docs/assets/prompts.md'), 'utf8');

describe('docs track the committed assets', () => {
  // The operator docs quoted "21 emojis" while 33 were committed, because nothing checked. The count
  // matters operationally: deploy-emojis is the only irreversible live write in the deploy, and the
  // runbook uses this number to tell the operator what a lost manifest.json would recreate.
  it('every emoji count quoted in the docs equals the number of committed SVGs', () => {
    const quoted = [...ops.matchAll(/(\d+)\s+(?:custom |application )?emojis/g), ...prompts.matchAll(/(\d+)\s+(?:custom |application )?emojis/g)]
      .map((m) => Number(m[1]));
    expect(quoted.length, 'no emoji count found in the docs — did the wording change?').toBeGreaterThan(0);
    for (const n of quoted) expect(n).toBe(svgCount);
  });

  it('prompts.md carries a regeneration target for every generated park raster', () => {
    for (const f of [
      'park/ground.webp', 'park/ground-wet.webp', 'park/ground-dry.webp', 'park/ground-cold.webp',
      'park/plate-paddock.webp', 'park/plate-facility.webp',
    ]) {
      expect(prompts, `prompts.md is missing the regeneration target ${f}`).toContain(f);
    }
  });
});
