import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const svgCount = readdirSync(resolve(process.cwd(), 'assets/emojis/svg')).filter((f) => f.endsWith('.svg')).length;
// Base banners only: a `-vN` file is another face of an existing banner, not a new
// one, so it must not move the figure quoted in prompts.md. Counting files instead
// of banners would make the prose churn on every variant with nothing gained.
const bannerCount = readdirSync(resolve(process.cwd(), 'assets/images/banners'))
  .filter((f) => f.endsWith('.webp') && !/-v\d+\.webp$/.test(f)).length;
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

  // This branch had to hand-fix exactly this drift once already ("fifteen" -> "twenty-six"), the same
  // failure this whole file exists to catch after an emoji count drifted silently. A word-spelled
  // numeral ("twenty-six") can't be regexed, which is why the two banner-count mentions in prompts.md
  // were switched to digits alongside this test. The emoji regex above and this one target disjoint
  // words ("emojis" vs "banners"), so neither line can accidentally satisfy the other's check.
  it('every banner count quoted in prompts.md equals the number of committed banner files', () => {
    const quoted = [...prompts.matchAll(/(\d+)\s+(?:embed |wide )?banners/g)].map((m) => Number(m[1]));
    expect(quoted.length, 'no banner count found in prompts.md — did the wording change?').toBeGreaterThan(0);
    for (const n of quoted) expect(n).toBe(bannerCount);
  });

  it('prompts.md carries a regeneration target for every generated park raster', () => {
    for (const f of [
      'park/ground.webp', 'park/ground-wet.webp', 'park/ground-dry.webp', 'park/ground-cold.webp',
      'park/plate-paddock.webp', 'park/plate-facility.webp',
      'park/landmark-a.webp', 'park/landmark-b.webp', 'park/landmark-c.webp',
      'park/attraction-picnic_lawn.webp', 'park/attraction-gift_shop.webp',
      'park/attraction-viewing_platform.webp', 'park/attraction-amber_carousel.webp',
      'park/attraction-sky_gondola.webp', 'park/attraction-grand_atrium.webp',
    ]) {
      expect(prompts, `prompts.md is missing the regeneration target ${f}`).toContain(f);
    }
  });
});
