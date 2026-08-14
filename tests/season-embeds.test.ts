import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { rollSeason, seasonView, claimSeason } from '../src/modules/daily/season.js';
import { seasonPayload, seasonClaimPayload } from '../src/modules/daily/season-embeds.js';
import { SEASON_DAYS } from '../src/core/world.js';

const DAY = 86_400_000;
const S1 = 689 * SEASON_DAYS * DAY;

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); ctx.setNow(S1); getOrCreateUser(ctx, 'p', 'P'); });

describe('seasonPayload', () => {
  it('titles the season by its display number, not its storage index', () => {
    rollSeason(ctx, 'p');
    const json = seasonPayload(seasonView(ctx, 'p')!, 'p').embeds[0].toJSON();
    expect(json.title).toContain('Season 1');
    expect(json.title).not.toContain('689');
  });

  it('carries the season index in the claim button\'s customId', () => {
    rollSeason(ctx, 'p');
    const row = seasonPayload(seasonView(ctx, 'p')!, 'p').components![0].toJSON() as {
      components: Array<{ custom_id: string }>;
    };
    expect(row.components[0].custom_id).toBe('season:claim:p:689');
  });

  it('shows the per-source breakdown and the days remaining', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 3);
    const json = seasonPayload(seasonView(ctx, 'p')!, 'p').embeds[0].toJSON();
    const text = JSON.stringify(json);
    expect(text).toContain('Expeditions');
    // The rungs field always renders "**225** — 8,000 cash, 15 shards" (rung 3's reward),
    // so a bare toContain('15') would pass even with zero expedition points — assert the
    // actual breakdown line instead: 3 expeditions x 5 points = 15, against its 250 cap.
    expect(text).toContain('Expeditions **15**/250');
    expect(text).toContain('30 days left');
  });
});

describe('seasonClaimPayload', () => {
  it('names every reward the claim actually paid', () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 45);   // 225 = rungs 1-3
    const text = JSON.stringify(seasonClaimPayload(claimSeason(ctx, 'p')).embeds[0].toJSON());
    expect(text).toContain('17,000');
    expect(text).toContain('15');
    expect(text).toContain('Royal Greens');
  });
});
