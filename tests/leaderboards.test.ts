import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand, fakeButton, replyText } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { topPlayers, collectionScore, playerRank, collectionScores, starScores, legacyScores } from '../src/modules/leaderboards/service.js';
import { leaderboardsModule } from '../src/modules/leaderboards/index.js';
import { schema } from '../src/core/db/index.js';
import { legacyPoints } from '../src/modules/park/ranks.js';
import { rollSeason, seasonPoints } from '../src/modules/daily/season.js';
import { track } from '../src/core/stats.js';
import type { Db } from '../src/core/db/index.js';

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

describe('leaderboards visuals', () => {
  it('/top attaches the leaderboards banner image and file together', async () => {
    // assets/images/banners/leaderboards.webp ships in the repo, so this exercises
    // the real attached path — asserting the URL without the file (or vice versa)
    // is exactly the broken-image bug this test guards against.
    const i = fakeCommand({ name: 'top', user: 'a', options: { metric: 'cash', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as { embeds: Array<{ toJSON(): { image?: { url: string } } }>; files?: unknown[] };
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://leaderboards.webp');
    expect(payload.files).toHaveLength(1);
  });
});

describe('playerRank', () => {
  beforeEach(() => { ctx = makeCtx(); }); // discard the outer describe's pre-seeded users
  // New users start with cash 500 (schema default); apply deltas on top.
  const seed = (id: string, extraCash: number) => {
    getOrCreateUser(ctx, id, id);
    if (extraCash > 0) ctx.economy.apply(id, { cash: extraCash }, 'seed', 0);
  };
  it('ranks with the same ordering as topPlayers', () => {
    seed('a', 200); seed('b', 100); seed('c', 0);   // cash: 700 / 600 / 500
    expect(playerRank(ctx, 'cash', 'global', null, 'b')).toEqual({ rank: 2, value: 600 });
  });
  it('returns null for an unknown user', () => {
    expect(playerRank(ctx, 'cash', 'global', null, 'nobody')).toBeNull();
  });
  it('/top adds a your-rank footer when the caller is outside the shown rows', async () => {
    for (let n = 0; n < 11; n++) seed(`rich${n}`, 1_000 + n);
    seed('poorest', 0);
    const i = fakeCommand({ name: 'top', user: 'poorest', options: { metric: 'cash', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { footer?: { text: string } } }> }).embeds[0].toJSON();
    expect(embed.footer?.text).toMatch(/^Your rank: #12 — /);
  });
  it('/top has no footer when the caller is in the top rows', async () => {
    seed('rich', 9_999);
    const i = fakeCommand({ name: 'top', user: 'rich', options: { metric: 'cash', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { footer?: { text: string } } }> }).embeds[0].toJSON();
    expect(embed.footer).toBeUndefined();
  });
});

describe('batched score builders', () => {
  beforeEach(() => { ctx = makeCtx(); });   // discard the outer a/b/c seed

  const user = (id: string) => getOrCreateUser(ctx, id, id.toUpperCase());
  const dino = (id: string, speciesId: string) =>
    ctx.db.insert(schema.dinos).values({ userId: id, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();

  it('collectionScores agrees with collectionScore for every user', () => {
    user('a'); user('b');
    dino('a', 'triceratops'); dino('a', 'triceratops'); dino('a', 'tyrannosaurus');
    dino('b', 'triceratops');
    const batched = collectionScores(ctx);
    expect(batched.get('a')).toBe(collectionScore(ctx, 'a'));
    expect(batched.get('b')).toBe(collectionScore(ctx, 'b'));
    expect(batched.get('a')).toBe(1 + 16);   // distinct species only: common 1 + legendary 16
  });

  it('collectionScores omits a user with no dinos rather than scoring them 0', () => {
    user('a');
    // The caller supplies the 0 (scored() does `?? 0`); the builder reports only what it saw.
    expect(collectionScores(ctx).has('a')).toBe(false);
  });

  it('starScores sums battle stars per user', () => {
    user('a');
    ctx.db.insert(schema.battleProgress).values({ userId: 'a', stageId: 's1', stars: 3 }).run();
    ctx.db.insert(schema.battleProgress).values({ userId: 'a', stageId: 's2', stars: 2 }).run();
    expect(starScores(ctx).get('a')).toBe(5);
  });

  it('legacyScores agrees with legacyPoints for the same user', () => {
    user('a');
    ctx.db.insert(schema.speciesSeen).values({ userId: 'a', speciesId: 'triceratops', firstAt: 0 }).run();
    ctx.db.insert(schema.speciesSeen).values({ userId: 'a', speciesId: 'tyrannosaurus', firstAt: 0 }).run();
    ctx.db.insert(schema.achievementClaims).values({ userId: 'a', trackId: 't', tier: 0, claimedAt: 0 }).run();
    ctx.db.insert(schema.battleProgress).values({ userId: 'a', stageId: 's1', stars: 3 }).run();
    expect(legacyScores(ctx).get('a')).toBe(legacyPoints(ctx, 'a'));
    expect(legacyScores(ctx).get('a')).toBe(2 + 1 + 3);
  });

  // dexProgress intersects species_seen with the LIVE roster, so a retired id contributes
  // nothing. A plain row count here would inflate both dex progress and legacy points, and
  // the board would disagree with the park card that already shows the rank.
  it('legacyScores ignores a species_seen row naming a species not in the roster', () => {
    user('a');
    ctx.db.insert(schema.speciesSeen).values({ userId: 'a', speciesId: 'triceratops', firstAt: 0 }).run();
    ctx.db.insert(schema.speciesSeen).values({ userId: 'a', speciesId: 'retired-species', firstAt: 0 }).run();
    expect(legacyScores(ctx).get('a')).toBe(1);
    expect(legacyScores(ctx).get('a')).toBe(legacyPoints(ctx, 'a'));
  });

  it('scopes to the given ids, and reads nothing for an empty list', () => {
    user('a'); user('b');
    dino('a', 'triceratops'); dino('b', 'tyrannosaurus');
    expect([...collectionScores(ctx, ['a']).keys()]).toEqual(['a']);
    expect(collectionScores(ctx, []).size).toBe(0);
  });
});

// There is no query-counting precedent anywhere in this suite — this proxy is written
// from scratch. It intercepts `select` only: every read in src/ goes through
// ctx.db.select(), and inserts/updates are irrelevant to the N+1 this guards.
function countingCtx(base: ReturnType<typeof makeCtx>) {
  let queries = 0;
  const db = new Proxy(base.db, {
    get(target, prop, receiver) {
      if (prop === 'select') {
        return (...args: unknown[]) => {
          queries += 1;
          return (target.select as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Db;
  return { ctx: { ...base, db }, queries: () => queries };
}

// `guildId` seeds exactly ONE guild member (p0) regardless of roster size — that single
// fixed membership count, against a varying total roster, is what proves a server-scoped
// board's query cost tracks neither the guild's member count nor the roster's non-member
// count (see the server-scope it.each below).
function boardOf(size: number, guildId?: string) {
  const base = makeCtx();
  for (let n = 0; n < size; n++) {
    getOrCreateUser(base, `p${n}`, `P${n}`);
    base.db.insert(schema.dinos)
      .values({ userId: `p${n}`, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    base.db.insert(schema.speciesSeen)
      .values({ userId: `p${n}`, speciesId: 'triceratops', firstAt: 0 }).run();
    base.db.insert(schema.achievementClaims)
      .values({ userId: `p${n}`, trackId: 't', tier: 0, claimedAt: 0 }).run();
    base.db.insert(schema.battleProgress)
      .values({ userId: `p${n}`, stageId: 's1', stars: 3 }).run();
  }
  if (guildId) {
    base.db.insert(schema.userGuilds).values({ userId: 'p0', guildId, lastSeenAt: 0 }).run();
  }
  return countingCtx(base);
}

describe('leaderboard query cost', () => {
  // Driven through topPlayers, NOT the /top command: the command's footer branch calls
  // playerRank, which runs scored() a second time, and that branch flips between the two
  // fixture sizes (the caller is inside the top 10 at 3 players and outside it at 30) —
  // so a command-level count would differ for a reason that is not the N+1.
  const cost = (size: number, metric: 'cash' | 'collection' | 'legacy' | 'stars' | 'duels' | 'season') => {
    const board = boardOf(size);
    topPlayers(board.ctx, metric, 'global', null);
    return board.queries();
  };

  // Exact numbers, not just equality: a rewrite that reads every table twice would be
  // equally wasteful at both sizes and would pass an equality-only assertion.
  it.each([
    ['cash', 1],          // the candidate scan alone
    ['duels', 1],         // duel_rating rides on the users row — no extra read
    ['stars', 2],         // + battle_progress
    ['collection', 2],    // + dinos
    ['legacy', 4],        // + species_seen, achievement_claims, battle_progress
    ['season', 3],         // + season_progress, user_stats
  ] as const)('costs a fixed %s queries whatever the roster size', (metric, expected) => {
    expect(cost(3, metric)).toBe(expected);
    expect(cost(30, metric)).toBe(expected);
  });

  // The server path costs exactly one query more than the global case above: scored()
  // reads user_guilds to resolve memberIds before it can even build the users slice.
  // Both fixture sizes seed the SAME single guild member (see boardOf) — what varies is
  // only the roster's non-member count, which is what proves the extra user_guilds read,
  // the users slice, and the metric's own source-table read(s) all stay flat whether 1 of
  // 3 or 1 of 30 players is actually in the guild.
  const serverCost = (size: number, metric: 'cash' | 'collection' | 'legacy' | 'stars' | 'duels' | 'season') => {
    const board = boardOf(size, 'g1');
    topPlayers(board.ctx, metric, 'server', 'g1');
    return board.queries();
  };

  it.each([
    ['cash', 2],           // user_guilds + the candidate scan
    ['duels', 2],
    ['stars', 3],          // + battle_progress
    ['collection', 3],     // + dinos
    ['legacy', 5],         // + species_seen, achievement_claims, battle_progress
    ['season', 4],          // + user_guilds
  ] as const)('costs a fixed %s queries for a server-scoped board whatever the roster size', (metric, expected) => {
    expect(serverCost(3, metric)).toBe(expected);
    expect(serverCost(30, metric)).toBe(expected);
  });

  // The "whatever the roster size" case above proves the count is flat, but it cannot by
  // itself prove the metric's own read is actually memberIds-SCOPED: collectionScores /
  // legacyScores / starScores cost exactly one `.select()` call whether that one member is
  // read through an inArray predicate or the whole table is read unscoped — a single query
  // either way. The one place the two genuinely diverge is an EMPTY membership: each
  // builder short-circuits to zero queries when handed `[]` (e.g. collectionScores's
  // `userIds.length ? … : []`), but a regression that passed `undefined` instead of
  // `memberIds` would still scan the whole table even then. Scoping to a guild with no
  // members at all is what actually exercises that branch.
  it.each([
    ['cash', 1],           // user_guilds only — no candidates, no further reads
    ['duels', 1],
    ['stars', 1],
    ['collection', 1],
    ['legacy', 1],
    ['season', 1],          // user_guilds only — both season reads short-circuit on []
  ] as const)('costs no extra %s queries for a server-scoped board with zero guild members', (metric, expected) => {
    const board = boardOf(3, 'g1');   // seeds p0 into g1 — 'g2' below has no members at all
    expect(topPlayers(board.ctx, metric, 'server', 'g2')).toEqual([]);
    expect(board.queries()).toBe(expected);
  });
});

describe('new metrics', () => {
  beforeEach(() => { ctx = makeCtx(); });

  it('ranks by legacy desc', () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    ctx.db.insert(schema.battleProgress).values({ userId: 'a', stageId: 's1', stars: 3 }).run();
    ctx.db.insert(schema.battleProgress).values({ userId: 'b', stageId: 's1', stars: 1 }).run();
    const top = topPlayers(ctx, 'legacy', 'global', null);
    expect(top.map((r) => r.userId)).toEqual(['a', 'b']);
    expect(top[0].value).toBe(3);
  });

  it('ranks by stars desc and scores an unbattled player 0 rather than NaN', () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    ctx.db.insert(schema.battleProgress).values({ userId: 'a', stageId: 's1', stars: 2 }).run();
    const top = topPlayers(ctx, 'stars', 'global', null);
    expect(top.map((r) => [r.userId, r.value])).toEqual([['a', 2], ['b', 0]]);
  });

  it('server scope still excludes users outside the guild on a new metric', () => {
    getOrCreateUser(ctx, 'a', 'A'); getOrCreateUser(ctx, 'b', 'B');
    ctx.db.insert(schema.userGuilds).values({ userId: 'a', guildId: 'g1', lastSeenAt: 0 }).run();
    ctx.db.insert(schema.battleProgress).values({ userId: 'a', stageId: 's1', stars: 2 }).run();
    ctx.db.insert(schema.battleProgress).values({ userId: 'b', stageId: 's1', stars: 3 }).run();
    expect(topPlayers(ctx, 'stars', 'server', 'g1').map((r) => r.userId)).toEqual(['a']);
  });

  it('/top legacy renders a ranking with an integer value', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    ctx.db.insert(schema.battleProgress).values({ userId: 'a', stageId: 's1', stars: 3 }).run();
    const i = fakeCommand({ name: 'top', user: 'a', options: { metric: 'legacy', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { title?: string; description?: string } }> }).embeds[0].toJSON();
    expect(embed.title).toContain('Legacy');
    // Not '0.0' — only `rating` divides by 100, and a legacy score rendered on the
    // rating path would read 0.0 for every player below 100 points.
    expect(embed.description).toBe('**1.** A — 3');
  });

  it('/top stars renders battle stars', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    ctx.db.insert(schema.battleProgress).values({ userId: 'a', stageId: 's1', stars: 2 }).run();
    const i = fakeCommand({ name: 'top', user: 'a', options: { metric: 'stars', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { title?: string; description?: string } }> }).embeds[0].toJSON();
    expect(embed.title).toContain('Battle Stars');
    expect(embed.description).toBe('**1.** A — 2');
  });

  it('offers exactly the seven metrics the service knows', () => {
    const json = leaderboardsModule.commands[0].data.toJSON() as {
      options?: Array<{ name: string; choices?: Array<{ value: string }> }>;
    };
    const metric = json.options!.find((o) => o.name === 'metric')!;
    expect(metric.choices!.map((c) => c.value))
      .toEqual(['rating', 'cash', 'collection', 'legacy', 'stars', 'duels', 'season']);
  });

  it('ranks live season points, agreeing with the /season hub', () => {
    const base = makeCtx();
    base.setNow(689 * 30 * 86_400_000);
    for (const id of ['a', 'b']) getOrCreateUser(base, id, id.toUpperCase());
    rollSeason(base, 'a'); rollSeason(base, 'b');
    track(base, 'a', 'expeditions_claimed', 10);   // 50
    track(base, 'b', 'expeditions_claimed', 4);    // 20
    const rows = topPlayers(base, 'season', 'global', null);
    expect(rows.map((r) => [r.userId, r.value])).toEqual([['a', 50], ['b', 20]]);
    expect(rows[0].value).toBe(seasonPoints(base, 'a'));
  });

  // Rows are retained per season (badgeAt on a past row is a permanent record), so a
  // player who has played more than one season has more than one season_progress row.
  // seasonScores must score them off the CURRENT season's row only — an unfiltered read
  // would return the whole history and let table order pick an arbitrary baseline. The
  // stale row here is inserted AFTER the live one specifically so an unfiltered read
  // (which would iterate both and last-write-wins into the output map) lets the stale
  // headStart of 999 clobber the correct live total of 50, rather than happening to agree
  // with it by coincidence of insertion order.
  it('scores off the current season only, never a past row on the same player', () => {
    const base = makeCtx();
    base.setNow(689 * 30 * 86_400_000);
    getOrCreateUser(base, 'a', 'A');
    rollSeason(base, 'a');
    track(base, 'a', 'expeditions_claimed', 10);   // 50 points this season
    // A stale row from the previous season, inserted after the live one.
    base.db.insert(schema.seasonProgress).values({
      userId: 'a', seasonIndex: 688, baselines: {}, headStart: 999, createdAt: 0,
    }).run();
    const rows = topPlayers(base, 'season', 'global', null);
    expect(rows.map((r) => [r.userId, r.value])).toEqual([['a', 50]]);
  });

  it('/top duels ranks by the stored Elo as a whole number', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    ctx.db.update(schema.users).set({ duelRating: 1180 }).where(eq(schema.users.discordId, 'a')).run();
    const i = fakeCommand({ name: 'top', user: 'a', options: { metric: 'duels', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { title?: string; description?: string } }> }).embeds[0].toJSON();
    expect(embed.title).toContain('Duel');
    // Never '11.8': only rating is stored ×100.
    expect(embed.description).toContain('1,180');
  });
});

describe('/top visit buttons', () => {
  beforeEach(() => { ctx = makeCtx(); });

  const board = async (n: number) => {
    for (let k = 0; k < n; k++) {
      getOrCreateUser(ctx, `p${k}`, `P${k}`);
      ctx.db.update(schema.users).set({ cash: 1_000 - k, parkRating: 100 })
        .where(eq(schema.users.discordId, `p${k}`)).run();
    }
    const i = fakeCommand({ name: 'top', user: 'p0', options: { metric: 'cash', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('mints one Visit button per row, capped at five', async () => {
    const i = await board(8);
    const ids = JSON.stringify(i.replies[0]).match(/top:visit:p\d+/g)!;
    // Discord allows five buttons per action row; the board shows ten.
    expect(ids).toEqual(['top:visit:p0', 'top:visit:p1', 'top:visit:p2', 'top:visit:p3', 'top:visit:p4']);
  });

  it('mints exactly as many buttons as there are rows when fewer than five', async () => {
    const i = await board(2);
    expect(JSON.stringify(i.replies[0]).match(/top:visit:p\d+/g)).toEqual(['top:visit:p0', 'top:visit:p1']);
  });

  it('always has at least the caller to visit, because /top creates their row', async () => {
    const i = fakeCommand({ name: 'top', user: 'nobody', options: { metric: 'cash', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, i.asChatInput());
    // `execute` opens with getOrCreateUser, so `rows` is never empty on a reachable path —
    // the `rows.length ? [visitRow(rows)] : []` guard exists for the shape, not for a case
    // a player can actually produce. Asserting the caller's own button is what pins that.
    expect(JSON.stringify(i.replies[0])).toContain('top:visit:nobody');
  });
});

describe('top:visit', () => {
  beforeEach(() => { ctx = makeCtx(); });

  const click = async (customId: string, user = 'viewer') => {
    const i = fakeButton({ customId, user });
    await leaderboardsModule.components.find((c) => c.prefix === 'top')!.execute(ctx, i.asInteraction() as never);
    return i;
  };

  it('renders that park as a new message, leaving the board intact', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    ctx.db.update(schema.users).set({ parkRating: 300 }).where(eq(schema.users.discordId, 'a')).run();
    const i = await click('top:visit:a');
    // deferReply + editReply, never i.update: the leaderboard the button sits on must
    // survive the click.
    expect(i.deferOpts).toHaveLength(1);
    expect((i.replies[0] as { embeds?: unknown[] }).embeds).toHaveLength(1);
  });

  it('absorbs an unknown action instead of erroring', async () => {
    const i = await click('top:whatever:a');
    expect(i.deferOpts).toHaveLength(1);
    expect(i.replies).toHaveLength(0);
  });

  it('answers ephemerally for a target with no park, never publicly', async () => {
    const i = await click('top:visit:ghost');
    // The existence check runs ahead of the defer: deferReply commits the interaction to a
    // PUBLIC message, so answering after it broadcast the miss to the channel. Both sibling
    // surfaces (/park view user:, park:tour) answer this condition ephemerally.
    expect(i.deferOpts).toHaveLength(0);
    expect(replyText(i.replies[0])).toContain('no park yet');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('creates no user row for the clicker', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    ctx.db.update(schema.users).set({ parkRating: 300 }).where(eq(schema.users.discordId, 'a')).run();
    await click('top:visit:a', 'stranger');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'stranger')).get())
      .toBeUndefined();
  });
});
