import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton, replyText, testRegistry } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { track } from '../src/core/stats.js';
import { rollSeason } from '../src/modules/daily/season.js';
import { SEASON_DAYS } from '../src/core/world.js';

const DAY = 86_400_000;
const S1 = 690 * SEASON_DAYS * DAY;   // season 1, day 1 (SEASON_EPOCH is 690)

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); ctx.setNow(S1); getOrCreateUser(ctx, 'p', 'P'); });

const run = async (i: ReturnType<typeof fakeCommand>) =>
  testRegistry.findCommand('season')!.execute(ctx, i.asChatInput());

const click = async (customId: string, user: string) => {
  const i = fakeButton({ customId, user });
  await testRegistry.findComponent(customId)!.execute(ctx, i.asInteraction() as never);
  return i;
};

describe('/season', () => {
  it('rolls the season and replies with the hub', async () => {
    const i = fakeCommand({ name: 'season', user: 'p' });
    await run(i);
    expect(ctx.db.select().from(schema.seasonProgress).all()).toHaveLength(1);
    expect(JSON.stringify(i.replies[0])).toContain('Season 1');
  });
});

describe('season:claim', () => {
  it('refuses a click from someone who is not the owner', async () => {
    rollSeason(ctx, 'p');
    const i = await click('season:claim:p:690', 'intruder');
    expect(replyText(i.replies[0])).toContain('Not your season');
    expect(ctx.db.select().from(schema.seasonClaims).all()).toHaveLength(0);
  });

  // The stale-button guard. An open card from last season must not pay this season.
  it('refuses a stale season index', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);
    const i = await click('season:claim:p:689', 'p');
    expect(replyText(i.replies[0])).toContain('season has ended');
    expect(ctx.db.select().from(schema.seasonClaims).all()).toHaveLength(0);
  });

  it('refuses a non-integer season segment', async () => {
    rollSeason(ctx, 'p');
    for (const bad of ['abc', '689.5', '']) {
      const i = await click(`season:claim:p:${bad}`, 'p');
      expect(replyText(i.replies[0]), bad).toContain('season has ended');
    }
    expect(ctx.db.select().from(schema.seasonClaims).all()).toHaveLength(0);
  });

  it('pays the unlocked rungs on a valid click', async () => {
    rollSeason(ctx, 'p');
    track(ctx, 'p', 'expeditions_claimed', 10);   // 50 = rung 1
    const before = ctx.db.select().from(schema.users)
      .where(eq(schema.users.discordId, 'p')).get()!.cash;
    await click('season:claim:p:690', 'p');
    expect(ctx.db.select().from(schema.users)
      .where(eq(schema.users.discordId, 'p')).get()!.cash).toBe(before + 3_000);
  });

  it('says so when nothing is claimable', async () => {
    rollSeason(ctx, 'p');
    const i = await click('season:claim:p:690', 'p');
    expect(replyText(i.replies[0])).toContain('Nothing to claim');
  });

  it('absorbs an unknown action rather than erroring', async () => {
    rollSeason(ctx, 'p');
    const i = await click('season:bogus:p:690', 'p');
    expect(i.replies).toHaveLength(0);
  });
});
