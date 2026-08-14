import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand, testRegistry } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { rollSeason, claimSeason } from '../src/modules/daily/season.js';
import { rollDailyQuests, questProgress } from '../src/modules/daily/service.js';
import { dailyRouterHooks } from '../src/modules/daily/hooks.js';
import { SEASON_DAYS } from '../src/core/world.js';

const DAY = 86_400_000;
const S1 = 689 * SEASON_DAYS * DAY;

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); ctx.setNow(S1); getOrCreateUser(ctx, 'p', 'P'); });

// Run a command through its handler, then the postDispatch hook, exactly as
// routeInteraction does.
async function dispatch(name: string) {
  const i = fakeCommand({ name, user: 'p' });
  await testRegistry.findCommand(name)!.execute(ctx, i.asChatInput());
  await dailyRouterHooks.postDispatch!(ctx, i.asChatInput(), { command: name });
  return i;
}

describe('season rung hint', () => {
  it('hints once when a rung is unlocked and unclaimed', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    const i = await dispatch('world');
    expect(i.replies).toHaveLength(2);
    expect(JSON.stringify(i.replies[1])).toContain('/season');
  });

  it('does not hint about the screen the player is already reading', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);
    const i = await dispatch('season');
    expect(i.replies).toHaveLength(1);
  });

  it('does not hint when nothing is unlocked', async () => {
    rollSeason(ctx, 'p');
    const i = await dispatch('world');
    expect(i.replies).toHaveLength(1);
  });

  it('does not hint again once the rung is claimed', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);
    claimSeason(ctx, 'p');
    const i = await dispatch('world');
    expect(i.replies).toHaveLength(1);
  });

  // The anti-fatigue rule: a quest and a rung completing on one action share ONE followUp.
  it('combines a quest hint and a rung hint into a single followUp', async () => {
    rollSeason(ctx, 'p');
    rollDailyQuests(ctx, 'p');
    // Complete whichever quest the deterministic board rolled, by pushing its stat past
    // baseline + target, and unlock a season rung with the same counter movement.
    const board = questProgress(ctx, 'p');
    for (const v of board) track(ctx, 'p', v.def.stat, v.row.target + 1);
    track(ctx, 'p', 'expeditions_claimed', 10);
    const i = await dispatch('world');
    expect(i.replies).toHaveLength(2);
    const hint = JSON.stringify(i.replies[1]);
    expect(hint).toContain('/daily');
    expect(hint).toContain('/season');
  });
});
