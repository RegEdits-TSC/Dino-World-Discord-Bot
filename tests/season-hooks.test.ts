import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand, fakeButton, testRegistry } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { rollSeason, claimSeason, seasonView } from '../src/modules/daily/season.js';
import { rollDailyQuests, questProgress } from '../src/modules/daily/service.js';
import { dailyRouterHooks } from '../src/modules/daily/hooks.js';
import { SEASON_DAYS } from '../src/core/world.js';
import { routeInteraction } from '../src/core/router.js';
import { ModuleRegistry } from '../src/core/modules.js';
import type { ComponentDef } from '../src/core/modules.js';

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

  // The finding this fix round exists for: a bare "unlocked && !claimed" existence
  // check re-fires on nearly every dispatch for as long as the reward sits unclaimed
  // (up to a 30-day season). The hint must be one-shot per newly-unlocked rung, via the
  // stored hintedRung high-water mark — not merely suppressed once claimed.
  it('does not hint again on a second dispatch after the unlocking one', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    const i1 = await dispatch('world');
    expect(i1.replies).toHaveLength(2);            // the unlocking dispatch hints
    const i2 = await dispatch('world');
    expect(i2.replies).toHaveLength(1);            // nothing new since; no re-hint
  });

  it('hints again once a further rung unlocks past the last hinted one', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    await dispatch('world');                        // hints, stamps hintedRung = 0
    track(ctx, 'p', 'expeditions_claimed', 15);   // +75 = 125 = rung 2 unlocks too
    const i2 = await dispatch('world');
    expect(i2.replies).toHaveLength(2);
    expect(JSON.stringify(i2.replies[1])).toContain('/season');
  });

  it('claiming an already-hinted rung does not re-hint', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    await dispatch('world');                        // hints, stamps hintedRung = 0
    claimSeason(ctx, 'p');
    const i2 = await dispatch('world');
    expect(i2.replies).toHaveLength(1);
  });

  it('a new season re-arms the hint', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    await dispatch('world');                        // hints for season 689, stamps hintedRung = 0
    ctx.setNow(S1 + SEASON_DAYS * DAY);             // roll into the next season
    rollSeason(ctx, 'p');                           // fresh row: hintedRung defaults to -1
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1 again, this season
    const i2 = await dispatch('world');
    expect(i2.replies).toHaveLength(2);
    expect(JSON.stringify(i2.replies[1])).toContain('/season');
  });

  // Established pattern from tests/daily-hooks.test.ts's 'ach'/'daily' prefix tests:
  // a synthetic component under the exempt prefix, dispatched through the real router
  // so preDispatch/postDispatch both run.
  it('a button under the season prefix never triggers the hint, even unlocking a rung', async () => {
    rollSeason(ctx, 'p');
    const seasonComponent: ComponentDef = {
      prefix: 'season',
      async execute(ctx2, i) {
        track(ctx2, i.user.id, 'expeditions_claimed', 10);   // 50 = rung 1, unlocked, unclaimed
        await i.update({ content: 'x' });
      },
    };
    const registry = new ModuleRegistry([{ name: 'm', commands: [], components: [seasonComponent] }], { m: true });
    const b = fakeButton({ customId: 'season:page:p', user: 'p' });
    await routeInteraction(ctx, registry, b.asInteraction(), dailyRouterHooks);
    expect(b.replies).toHaveLength(1);   // only the button's own update; no hint followUp
  });

  // Mirrors the quest side's equivalent test in tests/daily-hooks.test.ts: the
  // hintedRung stamp must happen strictly after the followUp send succeeds, so a failed
  // send leaves the hint owed rather than silently consumed. Uses routeInteraction (not
  // the dispatch() helper above) because postDispatch itself has no try/catch of its
  // own — routeInteraction's is what a thrown followUp needs to land inside.
  it('does not stamp hintedRung if the followUp send itself fails, leaving the hint owed', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    const i = fakeCommand({ name: 'world', user: 'p' });
    const interaction = i.asInteraction() as unknown as { followUp(payload: unknown): Promise<void> };
    interaction.followUp = async () => { throw new Error('discord unavailable'); };
    await expect(routeInteraction(ctx, testRegistry, i.asInteraction(), dailyRouterHooks)).resolves.toBeUndefined();
    expect(i.replies).toHaveLength(1);   // only the command's own reply; the failed followUp never landed
    expect(seasonView(ctx, 'p')!.hintedRung).toBe(-1);
  });
});
