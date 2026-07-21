import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { topPlayers, collectionScore } from '../src/modules/leaderboards/service.js';
import { leaderboardsModule } from '../src/modules/leaderboards/index.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx();
  for (const u of ['a', 'b', 'c']) getOrCreateUser(ctx, u, u.toUpperCase());
  ctx.economy.apply('a', { cash: 100 }, 'seed', 0);     // a: 600
  ctx.economy.apply('b', { cash: 5_000 }, 'seed', 0);   // b: 5,500
  ctx.economy.apply('c', { cash: 900 }, 'seed', 0);     // c: 1,400
});
const addDino = (user: string, speciesId: string) =>
  ctx.db.insert(schema.dinos).values({ userId: user, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();

describe('collectionScore', () => {
  it('sums rarity weights over distinct species', () => {
    addDino('a', 'triceratops');    // common = 1
    addDino('a', 'triceratops');    // dup — still 1 distinct
    addDino('a', 'tyrannosaurus');  // legendary = 16
    expect(collectionScore(ctx, 'a')).toBe(1 + 16);
  });
});

describe('topPlayers', () => {
  it('ranks by cash desc (global)', () => {
    const top = topPlayers(ctx, 'cash', 'global', null);
    expect(top.map((r) => r.userId)).toEqual(['b', 'c', 'a']);   // 5500, 1400, 600
    expect(top[0].value).toBe(5_500);
  });
  it('server scope only includes users seen in that guild', () => {
    // only a and c have interacted in guild g1
    ctx.db.insert(schema.userGuilds).values({ userId: 'a', guildId: 'g1', lastSeenAt: 0 }).run();
    ctx.db.insert(schema.userGuilds).values({ userId: 'c', guildId: 'g1', lastSeenAt: 0 }).run();
    const top = topPlayers(ctx, 'cash', 'server', 'g1');
    expect(top.map((r) => r.userId)).toEqual(['c', 'a']);        // b excluded (not in g1)
  });
  it('server scope with no guild returns empty (not a global ranking)', () => {
    expect(topPlayers(ctx, 'cash', 'server', null)).toEqual([]);
  });
  it('ranks by collection desc', () => {
    addDino('a', 'tyrannosaurus');  // 16
    addDino('b', 'triceratops');    // 1
    const top = topPlayers(ctx, 'collection', 'global', null);
    expect(top[0].userId).toBe('a');
  });
});

describe('/top command', () => {
  it('/top cash returns an embed ranking', async () => {
    const i = fakeCommand({ name: 'top', user: 'a', options: { metric: 'cash', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ data: { description?: string } }> };
    const desc = payload.embeds[0].data.description!;
    expect(desc).toMatch(/^\*\*1\.\*\* B/);                      // b has the most cash → ranked first
    expect(desc.indexOf('B')).toBeLessThan(desc.indexOf('C'));   // b before c
    expect(desc.indexOf('C')).toBeLessThan(desc.indexOf('A'));   // c before a
  });
});
