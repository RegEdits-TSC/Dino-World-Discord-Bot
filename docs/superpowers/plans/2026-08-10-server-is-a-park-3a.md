# Spec 3a — The Social Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen `/top` with two derived metrics on batched reads, give every park a curated showcase (motto + featured dino), and let players find parks without knowing a @handle.

**Architecture:** Three independent slices. (1) `src/modules/leaderboards/service.ts` stops calling a scoring function once per candidate and instead issues one read per source table, grouped into `Map<userId, number>` in JS. (2) Migration 0012 adds `users.motto` and `users.featured_dino_id`; a new `src/modules/park/showcase.ts` owns validation and read-time resolution, and `dashboardPayload` renders both. (3) A new `src/modules/park/visit.ts` owns "somebody else's park as a payload" and the tour ring, and is called from three places: `/park view user:`, a `park:tour` button, and a `top:visit` button on the leaderboard.

**Tech Stack:** TypeScript (ESM NodeNext), discord.js v14, drizzle-orm over better-sqlite3 (synchronous), vitest, drizzle-kit for migrations.

## Global Constraints

Every task's requirements implicitly include this section.

- **ESM NodeNext:** every relative import carries a `.js` extension.
- **DB access is synchronous** drizzle/better-sqlite3 — `.get()` / `.all()` / `.run()`, never awaited.
- **Time is `ctx.now()`, randomness is `ctx.rng()`** — never `Date.now()` / `Math.random()`.
- **No aggregate SQL.** `src/` has never used `groupBy`, `count()`, `sum()`, `countDistinct`, `selectDistinct`, `.having()`, `.limit()`, or a partial `.select({ … })` projection. Do not introduce one. Read rows with `.all()` and aggregate in JS. `inArray` **is** an established helper and needs no justification.
- **`emojiTag` is never called at module scope** — the app-emoji map loads after client ready, so a module-level constant would freeze the unicode fallback permanently. Call it inside the function body.
- **Never pass a possibly-empty emoji tag to `ButtonBuilder.setEmoji`** — it throws on `''` rather than degrading. Put the glyph in the label text.
- **Embed art is wired with `attach(embed, payload, slot, assetImage(...))`** — never `payload.files = [...]`, which `tests/images.test.ts` bans outright with a source regex.
- **Autocomplete providers** only ever call `i.respond` (never `reply`/`defer`), never call `getOrCreateUser`, and are read-only. Labels use plain unicode emoji, never `emojiTag`.
- **Component customIds** are `<prefix>:<action>[:<id>...]`. Any client-supplied segment is validated, never coerced.
- **Test gate order:** `npm test` (vitest, no typechecking) then `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) — the latter is the ONLY gate that sees `tests/` and `scripts/`. Run both before every commit.
- **Do not change** `expect(body).toHaveLength(26)` (tests/contract.test.ts), `expect(r.commands().length).toBe(26)` / `expect(ALL_MODULES).toHaveLength(15)` (tests/registry-load.test.ts), or tests/config.test.ts. This spec adds no module and no top-level command.
- **Commit messages** are plain Conventional Commits with no attribution trailer or footer of any kind.

---

### Task 1: Batched score builders

**Files:**
- Modify: `src/modules/leaderboards/service.ts`
- Test: `tests/leaderboards.test.ts`

**Interfaces:**
- Consumes: `schema.dinos`, `schema.battleProgress`, `schema.speciesSeen`, `schema.achievementClaims`; `RARITY_WEIGHT` from `src/data/progression.js`; `allSpecies`, `getSpecies` from `src/data/species/index.js`.
- Produces: `collectionScores(ctx: Ctx, userIds?: string[]): Map<string, number>`, `starScores(ctx: Ctx, userIds?: string[]): Map<string, number>`, `legacyScores(ctx: Ctx, userIds?: string[]): Map<string, number>`. Omitting `userIds` reads the whole table (a global board); passing it scopes with `inArray` (a server board); passing `[]` reads nothing and returns an empty map.

- [ ] **Step 1: Write the failing tests**

Append to `tests/leaderboards.test.ts`. Add the imports it needs to the existing import block at the top of the file:

```ts
import { collectionScores, starScores, legacyScores } from '../src/modules/leaderboards/service.js';
import { legacyPoints } from '../src/modules/park/ranks.js';
```

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/leaderboards.test.ts`
Expected: FAIL — `collectionScores is not a function` (and the same for `starScores` / `legacyScores`).

- [ ] **Step 3: Implement the builders**

In `src/modules/leaderboards/service.ts`, widen the two existing imports and add the builders directly below `collectionScore`:

```ts
import { allSpecies, getSpecies } from '../../data/species/index.js';
```

```ts
/**
 * One read per source table, grouped in JS — never a query per user. This is
 * src/core/locks.ts's batch-per-user rule widened to batch-per-BOARD: `scored()`
 * used to call collectionScore once per candidate, so a global collection board
 * cost one query per player on the roster.
 *
 * `userIds` scopes a SERVER board through the same `inArray` predicate the candidate
 * query already uses; omitted, the whole table is read for a global one; `[]` reads
 * nothing at all.
 *
 * Deliberately NOT a GROUP BY. Nothing in src/ has ever used groupBy/count()/sum(),
 * every read here is `.all()` plus JS aggregation, and SUM() over an empty row set
 * returns SQL NULL where `.reduce(…, 0)` returns 0 — which would turn a fresh
 * account's legacy points into NaN, and `NaN >= threshold` is false, so the rank
 * would read as "no rank" rather than fail visibly.
 */
export function collectionScores(ctx: Ctx, userIds?: string[]): Map<string, number> {
  const rows = userIds === undefined
    ? ctx.db.select().from(schema.dinos).all()
    : userIds.length
      ? ctx.db.select().from(schema.dinos).where(inArray(schema.dinos.userId, userIds)).all()
      : [];
  const owned = new Map<string, Set<string>>();
  for (const d of rows) {
    let set = owned.get(d.userId);
    if (!set) { set = new Set(); owned.set(d.userId, set); }
    set.add(d.speciesId);
  }
  const out = new Map<string, number>();
  for (const [userId, species] of owned) {
    let total = 0;
    // getSpecies THROWS on an id not in the roster, exactly as collectionScore does —
    // parity is the point, so this is deliberately not guarded.
    for (const id of species) total += RARITY_WEIGHT[getSpecies(id).rarity];
    out.set(userId, total);
  }
  return out;
}

export function starScores(ctx: Ctx, userIds?: string[]): Map<string, number> {
  const rows = userIds === undefined
    ? ctx.db.select().from(schema.battleProgress).all()
    : userIds.length
      ? ctx.db.select().from(schema.battleProgress).where(inArray(schema.battleProgress.userId, userIds)).all()
      : [];
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.userId, (out.get(r.userId) ?? 0) + r.stars);
  return out;
}

/**
 * The board-wide twin of legacyPoints (src/modules/park/ranks.ts). The two must agree
 * for any given user — a board that disagrees with the rank on the player's own park
 * card is worse than no board.
 */
export function legacyScores(ctx: Ctx, userIds?: string[]): Map<string, number> {
  const seenRows = userIds === undefined
    ? ctx.db.select().from(schema.speciesSeen).all()
    : userIds.length
      ? ctx.db.select().from(schema.speciesSeen).where(inArray(schema.speciesSeen.userId, userIds)).all()
      : [];
  const claimRows = userIds === undefined
    ? ctx.db.select().from(schema.achievementClaims).all()
    : userIds.length
      ? ctx.db.select().from(schema.achievementClaims).where(inArray(schema.achievementClaims.userId, userIds)).all()
      : [];
  const out = new Map<string, number>();
  // dexProgress counts the seen set INTERSECTED with the live roster, so a retired
  // species id contributes nothing. earnedTierCount, by contrast, is a plain row
  // count with no filter against ACHIEVEMENTS — matching each one exactly is what
  // keeps this in agreement with legacyPoints.
  const roster = new Set(allSpecies().map((s) => s.id));
  for (const r of seenRows) {
    if (!roster.has(r.speciesId)) continue;
    out.set(r.userId, (out.get(r.userId) ?? 0) + 1);
  }
  for (const r of claimRows) out.set(r.userId, (out.get(r.userId) ?? 0) + 1);
  for (const [userId, stars] of starScores(ctx, userIds)) {
    out.set(userId, (out.get(userId) ?? 0) + stars);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/leaderboards.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/leaderboards/service.ts tests/leaderboards.test.ts
git commit -m "feat(leaderboards): add batched per-board score builders"
```

---

### Task 2: Rewire `scored()` onto the builders, with a query-count guard

**Files:**
- Modify: `src/modules/leaderboards/service.ts`
- Test: `tests/leaderboards.test.ts`

**Interfaces:**
- Consumes: `collectionScores` / `starScores` / `legacyScores` from Task 1.
- Produces: `Metric` widened to `'rating' | 'cash' | 'collection' | 'legacy' | 'stars'`. `topPlayers` and `playerRank` keep their exact current signatures and return shapes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/leaderboards.test.ts`. Add `import type { Db } from '../src/core/db/index.js';` to the import block.

```ts
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

function boardOf(size: number) {
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
  return countingCtx(base);
}

describe('leaderboard query cost', () => {
  // Driven through topPlayers, NOT the /top command: the command's footer branch calls
  // playerRank, which runs scored() a second time, and that branch flips between the two
  // fixture sizes (the caller is inside the top 10 at 3 players and outside it at 30) —
  // so a command-level count would differ for a reason that is not the N+1.
  const cost = (size: number, metric: 'cash' | 'collection' | 'legacy' | 'stars') => {
    const board = boardOf(size);
    topPlayers(board.ctx, metric, 'global', null);
    return board.queries();
  };

  // Exact numbers, not just equality: a rewrite that reads every table twice would be
  // equally wasteful at both sizes and would pass an equality-only assertion.
  it.each([
    ['cash', 1],          // the candidate scan alone
    ['stars', 2],         // + battle_progress
    ['collection', 2],    // + dinos
    ['legacy', 4],        // + species_seen, achievement_claims, battle_progress
  ] as const)('costs a fixed %s queries whatever the roster size', (metric, expected) => {
    expect(cost(3, metric)).toBe(expected);
    expect(cost(30, metric)).toBe(expected);
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/leaderboards.test.ts`
Expected: FAIL — the `legacy` / `stars` metrics are not assignable to `Metric` at runtime they score `undefined`, and `costs a fixed collection queries` reports 4 (1 users + 3 per-user `collectionScore` reads) at size 3 and 31 at size 30.

- [ ] **Step 3: Widen `Metric` and rewrite `scored()`**

Replace the `Metric` type and the whole `scored` function in `src/modules/leaderboards/service.ts`:

```ts
export type Metric = 'rating' | 'cash' | 'collection' | 'legacy' | 'stars';
```

```ts
function scored(
  ctx: Ctx, metric: Metric, scope: Scope, guildId: string | null,
): Array<{ userId: string; displayName: string; value: number }> {
  // Candidate set: server scope = users seen in this guild (via user_guilds); global = all users.
  // memberIds stays undefined for a global board, which is what tells the score builders
  // below to read a whole table rather than an inArray-scoped slice.
  let users: Array<typeof schema.users.$inferSelect>;
  let memberIds: string[] | undefined;
  if (scope === 'server') {
    if (!guildId) { users = []; memberIds = []; }
    else {
      memberIds = ctx.db.select().from(schema.userGuilds)
        .where(eq(schema.userGuilds.guildId, guildId)).all().map((g) => g.userId);
      users = memberIds.length
        ? ctx.db.select().from(schema.users).where(inArray(schema.users.discordId, memberIds)).all()
        : [];
    }
  } else {
    users = ctx.db.select().from(schema.users).all();
  }
  // One read per source table, never one per candidate — see the builders above. This
  // replaces the old `collectionScore(ctx, u.discordId)` call inside the map, which cost
  // a query per player and was the documented v1-scale limitation here.
  // Limitation kept as-is: `rating` reads the stored parkRating without settling each
  // ranked user's escapes first (settling everyone on every read would be expensive), so
  // a board rating can lag an unsettled escape until that user next interacts.
  // Note: parkRating is stored ×100 (stars×100); formatValue in index.ts divides for display.
  const byUser = metric === 'collection' ? collectionScores(ctx, memberIds)
    : metric === 'legacy' ? legacyScores(ctx, memberIds)
    : metric === 'stars' ? starScores(ctx, memberIds)
    : null;
  const rows = users.map((u) => ({
    userId: u.discordId,
    displayName: u.displayName || u.discordId,
    value: metric === 'cash' ? u.cash
      : metric === 'rating' ? u.parkRating
      : byUser!.get(u.discordId) ?? 0,
  }));
  rows.sort((a, b) => b.value - a.value);
  return rows;
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run tests/leaderboards.test.ts && npm test`
Expected: PASS — including the four exact query-cost pins.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/leaderboards/service.ts tests/leaderboards.test.ts
git commit -m "perf(leaderboards): score a board in a fixed number of queries"
```

---

### Task 3: `/top` gains the `legacy` and `stars` metrics

**Files:**
- Modify: `src/modules/leaderboards/index.ts`
- Test: `tests/leaderboards.test.ts`

**Interfaces:**
- Consumes: the widened `Metric` from Task 2.
- Produces: nothing new for later tasks; `/top`'s builder now offers five metric choices.

- [ ] **Step 1: Write the failing test**

```ts
describe('/top new metrics', () => {
  beforeEach(() => { ctx = makeCtx(); });

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

  it('offers exactly the five metrics the service knows', () => {
    const json = leaderboardsModule.commands[0].data.toJSON() as {
      options?: Array<{ name: string; choices?: Array<{ value: string }> }>;
    };
    const metric = json.options!.find((o) => o.name === 'metric')!;
    expect(metric.choices!.map((c) => c.value))
      .toEqual(['rating', 'cash', 'collection', 'legacy', 'stars']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/leaderboards.test.ts -t "new metrics"`
Expected: FAIL — `fakeCommand /top: fixture option 'metric'` accepts the key but the builder has no `legacy` choice, so the choices assertion fails and the title assertion reads `undefined` from `metricLabel`.

- [ ] **Step 3: Add the choices and the labels**

In `src/modules/leaderboards/index.ts`, replace the `metric` option and `metricLabel`:

```ts
        .addStringOption((o) => o.setName('metric').setDescription('Rank by').setRequired(true)
          .addChoices(
            { name: 'rating', value: 'rating' },
            { name: 'cash', value: 'cash' },
            { name: 'collection', value: 'collection' },
            { name: 'legacy', value: 'legacy' },
            { name: 'stars', value: 'stars' },
          ))
```

```ts
// Never call emojiTag at module scope — the app-emoji map loads after the
// client is ready, so a module-level constant would freeze the unicode
// fallback forever. Compute the label per call instead.
function metricLabel(metric: Metric): string {
  return {
    rating: `${emojiTag('dw_star')} Rating`,
    cash: `${emojiTag('dw_cash')} Cash`,
    collection: '🦕 Collection',
    legacy: '🏛️ Legacy',
    stars: '⭐ Battle Stars',
  }[metric];
}
```

`formatValue` is unchanged and must stay unchanged: only `rating` divides by 100. Both new metrics are plain integers and fall through to `toLocaleString()`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/leaderboards.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/leaderboards/index.ts tests/leaderboards.test.ts
git commit -m "feat(leaderboards): rank by legacy standing and battle stars"
```

---

### Task 4: Migration 0012 — `users.motto` and `users.featured_dino_id`

**Files:**
- Modify: `src/core/db/schema.ts`
- Create: `drizzle/0012_park_showcase.sql`, `drizzle/meta/0012_snapshot.json` (both emitted by drizzle-kit)
- Modify: `drizzle/meta/_journal.json` (appended by drizzle-kit)
- Test: `tests/migration.test.ts`

**Interfaces:**
- Produces: `schema.users.motto` (`text`, NOT NULL, default `''`) and `schema.users.featuredDinoId` (`integer`, nullable, **no foreign key**). Both readable off the `User` row type (`typeof schema.users.$inferSelect`) with no further plumbing.

- [ ] **Step 1: Add the columns to the schema**

In `src/core/db/schema.ts`, insert immediately **before** `lastCollectAt` — the position every new users column has taken since `alertsEnabled`:

```ts
  // The showcase a visitor sees on your park card. `motto` is free text; mention
  // injection is already dead because src/index.ts sets allowedMentions: { parse: [] }
  // client-wide, the same shield /park rename relies on — do not add a second
  // sanitiser here, it would only be a second thing to keep in sync.
  motto: text('motto').notNull().default(''),
  // Deliberately NO foreign key to dinos.id: a featured dino can be sold, traded away
  // or reset, and a dangling reference must resolve to "no feature" rather than error.
  // Same reasoning as breedings.parentA/parentB. Resolution happens at read time in
  // src/modules/park/showcase.ts; nothing sweeps this column.
  featuredDinoId: integer('featured_dino_id'),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate --name=park_showcase`

This writes three artifacts, **all of which must be committed**: `drizzle/0012_park_showcase.sql`, `drizzle/meta/0012_snapshot.json`, and a new entry appended to `drizzle/meta/_journal.json`. The snapshot is what the next `generate` diffs against, so it is never optional. Let drizzle-kit stamp the journal's `when` — it must exceed 0011's `1786359939806`, and an entry that does not silently never runs.

- [ ] **Step 3: Read the emitted SQL by eye**

Run: `cat drizzle/0012_park_showcase.sql`

Expected, exactly two `ALTER TABLE` statements:

```sql
ALTER TABLE `users` ADD `motto` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `featured_dino_id` integer;
```

If drizzle-kit instead emits a `__new_users` / `DROP TABLE` **recreate**, stop: delete the generated `.sql`, hand-write the two `ALTER TABLE` lines above in its place, and keep the generated snapshot and journal entry. Reading this file is the only gate against an unnecessary recreate — no test can tell a well-formed recreate from an ALTER. Do not let an editor add a trailing newline; 0011 ends at the `;`.

- [ ] **Step 4: Write the failing migration test**

Append to `tests/migration.test.ts`:

```ts
describe('0012 park showcase via the real drizzle migrator (production path)', () => {
  it('adds motto and featured_dino_id and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig12-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    // The regex and the journal filter must widen together. Copy-pasting 0011's
    // /^00(0[0-9]|10).*\.sql$/ here would omit 0011 from the scratch folder while every
    // assertion below still passed — green for the wrong reason, against a 0010 baseline.
    for (const f of readdirSync(DRIZZLE).filter((f) => /^00(0[0-9]|1[01]).*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 11);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0011 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      const rows = sqlite.prepare(`SELECT discord_id, motto, featured_dino_id FROM users`).all();
      expect(rows).toEqual([{ discord_id: 'u1', motto: '', featured_dino_id: null }]);
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
      // No foreign key on featured_dino_id: an id naming no dino must be storable, because
      // a featured dino can be sold at any time and nothing sweeps the column.
      expect(() => sqlite.prepare(`UPDATE users SET featured_dino_id = 9999 WHERE discord_id = 'u1'`).run())
        .not.toThrow();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Run the migration tests**

Run: `npx vitest run tests/migration.test.ts && npm test`
Expected: PASS. `makeCtx` runs the real migrations on every call, so a broken 0012 fails the entire suite, not just this file.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/core/db/schema.ts drizzle/0012_park_showcase.sql drizzle/meta/0012_snapshot.json drizzle/meta/_journal.json tests/migration.test.ts
git commit -m "feat(db): add park motto and featured dino columns"
```

---

### Task 5: The showcase service

**Files:**
- Create: `src/modules/park/showcase.ts`
- Test: `tests/showcase.test.ts`

**Interfaces:**
- Consumes: `schema.users`, `schema.dinos`; `getSpecies` from `src/data/species/index.js`.
- Produces: `MAX_MOTTO` (80), `class ShowcaseError extends Error`, `setMotto(ctx, userId, motto: string | null): string`, `setFeaturedDino(ctx, userId, dinoId: number | null): Species | null`, `interface Featured { name: string; archetype: string; diet: string }`, `featuredFor(ctx, user: { discordId: string; featuredDinoId: number | null }): Featured | null`.

- [ ] **Step 1: Write the failing tests**

Create `tests/showcase.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { setMotto, setFeaturedDino, featuredFor, ShowcaseError, MAX_MOTTO } from '../src/modules/park/showcase.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

const row = (id = 'u1') =>
  ctx.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!;
const addDino = (userId = 'u1', speciesId = 'triceratops') =>
  ctx.db.insert(schema.dinos)
    .values({ userId, speciesId, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).returning().get();

describe('setMotto', () => {
  it('trims and stores', () => {
    expect(setMotto(ctx, 'u1', '  Where the big ones live  ')).toBe('Where the big ones live');
    expect(row().motto).toBe('Where the big ones live');
  });

  it('blank and null both clear it', () => {
    setMotto(ctx, 'u1', 'something');
    expect(setMotto(ctx, 'u1', '   ')).toBe('');
    expect(row().motto).toBe('');
    setMotto(ctx, 'u1', 'again');
    expect(setMotto(ctx, 'u1', null)).toBe('');
    expect(row().motto).toBe('');
  });

  it('rejects an over-length motto and stores nothing', () => {
    // The builder caps input at 80 too, but the service guard is the real one: a client
    // that ignores the builder still reaches this, and only this is reachable from a test.
    expect(() => setMotto(ctx, 'u1', 'x'.repeat(MAX_MOTTO + 1))).toThrow(ShowcaseError);
    expect(row().motto).toBe('');
  });

  it('accepts exactly the maximum length', () => {
    expect(setMotto(ctx, 'u1', 'x'.repeat(MAX_MOTTO))).toHaveLength(MAX_MOTTO);
  });
});

describe('setFeaturedDino', () => {
  it('stores an owned dino and returns its species', () => {
    const d = addDino();
    expect(setFeaturedDino(ctx, 'u1', d.id)!.id).toBe('triceratops');
    expect(row().featuredDinoId).toBe(d.id);
  });

  it('null clears it', () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    expect(setFeaturedDino(ctx, 'u1', null)).toBeNull();
    expect(row().featuredDinoId).toBeNull();
  });

  it('rejects a dino owned by someone else and stores nothing', () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    const theirs = addDino('u2');
    expect(() => setFeaturedDino(ctx, 'u1', theirs.id)).toThrow(ShowcaseError);
    expect(row().featuredDinoId).toBeNull();
  });

  it('rejects a dino id that does not exist', () => {
    expect(() => setFeaturedDino(ctx, 'u1', 9999)).toThrow(ShowcaseError);
  });
});

describe('featuredFor', () => {
  it('resolves to the archetype and diet the art is keyed on', () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    expect(featuredFor(ctx, row())).toEqual({ name: 'Triceratops', archetype: 'tank', diet: 'herbivore' });
  });

  it('prefers the nickname over the species name', () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    ctx.db.update(schema.dinos).set({ nickname: 'Trixie' }).where(eq(schema.dinos.id, d.id)).run();
    expect(featuredFor(ctx, row())!.name).toBe('Trixie');
  });

  it('reads back as no feature once the dino is sold', () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    ctx.db.delete(schema.dinos).where(eq(schema.dinos.id, d.id)).run();
    // A dangling id is not an error — it is simply no feature. Nothing sweeps this column,
    // so read-time resolution is the ONLY thing standing between a sold dino and a broken card.
    expect(featuredFor(ctx, row())).toBeNull();
    expect(row().featuredDinoId).toBe(d.id);   // and the stale id is deliberately left alone
  });

  it('reads back as no feature once the dino is traded away', () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    ctx.db.update(schema.dinos).set({ userId: 'u2' }).where(eq(schema.dinos.id, d.id)).run();
    expect(featuredFor(ctx, row())).toBeNull();
  });

  it('is null when nothing is featured', () => {
    expect(featuredFor(ctx, row())).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/showcase.test.ts`
Expected: FAIL — `Cannot find module '../src/modules/park/showcase.js'`.

- [ ] **Step 3: Implement the service**

Create `src/modules/park/showcase.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { getSpecies } from '../../data/species/index.js';
import type { Species } from '../../data/types.js';

/** Matches the builder's .setMaxLength(80) on /park motto. */
export const MAX_MOTTO = 80;

export class ShowcaseError extends Error {}

/** Trims, validates, stores. Blank or null clears. Returns what was stored. */
export function setMotto(ctx: Ctx, userId: string, motto: string | null): string {
  const trimmed = motto?.trim() ?? '';
  if (trimmed.length > MAX_MOTTO) throw new ShowcaseError(`Mottos are at most ${MAX_MOTTO} characters.`);
  ctx.db.update(schema.users).set({ motto: trimmed })
    .where(eq(schema.users.discordId, userId)).run();
  return trimmed;
}

/**
 * Feature one dino, or clear with null. Ownership is checked HERE as well as in
 * featuredFor below — two checks on purpose: this one makes featuring someone else's
 * dino a visible error rather than a silent no-op, and the read-time one handles the
 * dino changing hands afterwards, which no amount of set-time checking can prevent.
 */
export function setFeaturedDino(ctx: Ctx, userId: string, dinoId: number | null): Species | null {
  if (dinoId === null) {
    ctx.db.update(schema.users).set({ featuredDinoId: null })
      .where(eq(schema.users.discordId, userId)).run();
    return null;
  }
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, dinoId), eq(schema.dinos.userId, userId))).get();
  if (!dino) throw new ShowcaseError('You do not own that dino.');
  ctx.db.update(schema.users).set({ featuredDinoId: dinoId })
    .where(eq(schema.users.discordId, userId)).run();
  return getSpecies(dino.speciesId);
}

/** What the card renders: a display name plus the archetype×diet key the art uses. */
export interface Featured { name: string; archetype: string; diet: string }

/**
 * Resolve the stored id to something renderable, or null.
 *
 * A featured dino can be sold, traded away or wiped by adminReset between being set and
 * being rendered, and nothing sweeps the column — so a dangling id must read back as "no
 * feature" rather than error. Same tolerance a retired decor kind gets from
 * matchedKindCount. The stale id is deliberately left in place: clearing it here would
 * make a read path a write path.
 */
export function featuredFor(
  ctx: Ctx, user: { discordId: string; featuredDinoId: number | null },
): Featured | null {
  if (user.featuredDinoId === null) return null;
  const dino = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, user.featuredDinoId), eq(schema.dinos.userId, user.discordId))).get();
  if (!dino) return null;
  const species = getSpecies(dino.speciesId);
  return { name: dino.nickname ?? species.name, archetype: species.archetype, diet: species.diet };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/showcase.test.ts`
Expected: PASS. (`src/data/species/triceratops.ts` is `diet: 'herbivore', archetype: 'tank'`, so `tank-herbivore` is the art key the assertion expects — verified, not assumed.)

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/showcase.ts tests/showcase.test.ts
git commit -m "feat(park): add motto and featured-dino showcase service"
```

---

### Task 6: `withParkImage` appends instead of assigning

**Files:**
- Modify: `src/modules/park/embeds.ts:67-72`
- Test: `tests/park-view-image.test.ts`

**Interfaces:**
- Produces: `withParkImage<T extends { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }>(payload: T, png: Buffer): T & { files: AttachmentBuilder[] }` — the generic constraint gains `files?`, which is what lets the spread read the incoming array.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('withParkImage')` block in `tests/park-view-image.test.ts`, and add `import { AttachmentBuilder } from 'discord.js';` to that file's imports:

```ts
  // Task 7 makes dashboardPayload call attach() for the featured dino's thumbnail.
  // This function used to ASSIGN files, so that upload would have vanished on both
  // /park view branches — no error, no failing test, just a dangling attachment:// URL.
  it('keeps files the payload already carried, park.png last', () => {
    const u = getOrCreateUser(ctx, 'a', 'A');
    const base = dashboardPayload(u, [], 0, 0, 0);
    const existing = new AttachmentBuilder(Buffer.from([9]), { name: 'tank-herbivore.webp' });
    const out = withParkImage({ ...base, files: [existing] }, Buffer.from([1, 2, 3]));
    // Call order is upload order — several tests across the suite pin files by name.
    expect(out.files.map((f) => f.name)).toEqual(['tank-herbivore.webp', 'park.png']);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-view-image.test.ts`
Expected: FAIL — `expected [ 'park.png' ] to deeply equal [ 'tank-herbivore.webp', 'park.png' ]`.

- [ ] **Step 3: Make it append**

Replace `withParkImage` in `src/modules/park/embeds.ts`:

```ts
// Set a rendered PNG as the embed's image and attach it. Mutates the (freshly built)
// embed in place and preserves components (e.g. the Collect button).
//
// APPENDS to `files` rather than assigning. dashboardPayload now calls attach() for the
// featured dino's thumbnail, and the old assignment would have silently dropped that
// upload at both /park view call sites and at /help topic:park, leaving a dangling
// attachment:// URL in the embed with no error and no failing test. park.png goes last,
// so call order stays upload order.
export function withParkImage<T extends { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }>(
  payload: T, png: Buffer,
): T & { files: AttachmentBuilder[] } {
  payload.embeds[0].setImage('attachment://park.png');
  return { ...payload, files: [...(payload.files ?? []), new AttachmentBuilder(png, { name: 'park.png' })] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/park-view-image.test.ts && npm test`
Expected: PASS — including the pre-existing `expect(out.components).toBe(base.components)`, which the spread still satisfies.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/embeds.ts tests/park-view-image.test.ts
git commit -m "fix(park): withParkImage appends files instead of replacing them"
```

---

### Task 7: The dashboard renders motto and featured dino

**Files:**
- Modify: `src/modules/park/embeds.ts` (imports, `dashboardPayload`)
- Test: `tests/park.test.ts`

**Interfaces:**
- Consumes: `Featured` from `src/modules/park/showcase.js` (Task 5); `assetImage`, `attach` from `src/core/images.js`.
- Produces: `dashboardPayload`'s `opts` gains `motto?: string` and `featured?: Featured | null`; its return type becomes `{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }`, declared explicitly rather than inferred.

- [ ] **Step 1: Write the failing tests**

Append to `tests/park.test.ts` (it already imports `dashboardPayload` and `getOrCreateUser`):

```ts
describe('dashboard showcase', () => {
  const fieldsOf = (p: { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }) =>
    p.embeds[0].toJSON().fields!;

  it('renders the motto under the world-event header, not instead of it', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 0, 0, 0, { motto: 'Where the big ones live' });
    const desc = p.embeds[0].toJSON().description!;
    expect(desc).toContain('Where the big ones live');
    // The description slot already carries eventHeaderLine; a plain setDescription would
    // have replaced it, and no existing test reads the embed to notice.
    expect(desc.split('\n')).toHaveLength(2);
  });

  it('omits the motto line entirely when there is none', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 0, 0, 0, {});
    expect(p.embeds[0].toJSON().description!.split('\n')).toHaveLength(1);
  });

  it('names the featured dino and attaches its archetype art as the thumbnail', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 0, 0, 0, {
      featured: { name: 'Trixie', archetype: 'tank', diet: 'herbivore' },
    });
    expect(fieldsOf(p).find((f) => f.name === '🦖 Featured')!.value).toBe('Trixie');
    // assets/images/dinos/tank-herbivore.webp ships in the repo, so this exercises the
    // real attach path — the URL without the file (or vice versa) is the broken-image bug.
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://tank-herbivore.webp');
    expect(p.files).toHaveLength(1);
  });

  it('ships no files and no Featured field when nothing is featured', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, [], 0, 0, 0, {});
    expect(fieldsOf(p).some((f) => f.name === '🦖 Featured')).toBe(false);
    // Not [] — attach() on a null ref never creates the array at all, and two other test
    // files pin exactly this distinction elsewhere in the suite.
    expect(p.files).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/park.test.ts -t "dashboard showcase"`
Expected: FAIL — `motto`/`featured` are not assignable to the `opts` type, and there is no thumbnail.

- [ ] **Step 3: Render both**

In `src/modules/park/embeds.ts`, add to the import block:

```ts
import { assetImage, attach } from '../../core/images.js';
import type { Featured } from './showcase.js';
```

Widen the `opts` parameter:

```ts
  opts: { atRiskCount?: number; capped?: boolean; mismatchCount?: number; foodLine?: string; earnedTiers?: number; legacyRank?: LegacyTier | null; motto?: string; featured?: Featured | null; now?: number } = {},
```

Replace the `.setDescription(...)` call with a composed description:

```ts
    // The world-event header owns this slot; the motto is appended BENEATH it rather
    // than replacing it. A second .setDescription anywhere downstream would silently
    // delete the header, and tests/world-module.test.ts checks anyModRelevant, not the
    // embed, so nothing would notice.
    .setDescription([
      eventHeaderLine(opts.now ?? 0, PARK_HEADER_KEYS),
      opts.motto ? `*“${opts.motto}”*` : '',
    ].filter(Boolean).join('\n'))
```

Add the conditional field beside the existing Achievements / Legacy ones:

```ts
  if (opts.featured) {
    embed.addFields({ name: '🦖 Featured', value: opts.featured.name, inline: true });
  }
```

Replace the return with an explicitly typed payload plus the thumbnail attach:

```ts
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('park:collect').setEmoji(emojiTag('dw_cash')).setLabel(`Collect ${pending.toLocaleString()}`).setStyle(ButtonStyle.Success),
  );
  // Explicit type, not inferred: `files` must be optional so attach() can create it, and
  // withParkImage's generic now reads it back.
  const payload: {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[];
  } = { embeds: [embed], components: [row] };
  // The ternary guards on DOMAIN data (is anything featured), so it stays outside attach —
  // "nothing featured" is not an asset miss. Same shape as shop's `best ? … : null`.
  attach(embed, payload, 'thumbnail',
    opts.featured ? assetImage('dinos', `${opts.featured.archetype}-${opts.featured.diet}`) : null);
  return payload;
```

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run tests/park.test.ts && npm test`
Expected: PASS. `tests/park.test.ts:205` reaches `p.components[0]` for the Collect button — unchanged, because the row is still the only component and still first.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/embeds.ts tests/park.test.ts
git commit -m "feat(park): show the motto and featured dino on the dashboard"
```

---

### Task 8: `/park motto`

**Files:**
- Modify: `src/modules/park/index.ts` (builder, imports, switch)
- Test: `tests/showcase.test.ts`

**Interfaces:**
- Consumes: `setMotto`, `ShowcaseError` from `./showcase.js`.
- Produces: a `/park motto` subcommand with one optional String option `text`, `.setMaxLength(80)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/showcase.test.ts`, adding `import { fakeCommand, replyText } from './harness.js';` and `import { parkModule } from '../src/modules/park/index.js';` to its imports:

```ts
describe('/park motto', () => {
  const run = async (options?: Record<string, string>) => {
    const i = fakeCommand({ name: 'park', sub: 'motto', user: 'u1', options });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('sets the motto and says so', async () => {
    const i = await run({ text: 'Where the big ones live' });
    expect(row().motto).toBe('Where the big ones live');
    expect(replyText(i.replies[0])).toContain('Where the big ones live');
  });

  it('omitting the option clears it', async () => {
    setMotto(ctx, 'u1', 'something');
    const i = await run();
    expect(row().motto).toBe('');
    expect(replyText(i.replies[0]).toLowerCase()).toContain('cleared');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/showcase.test.ts -t "/park motto"`
Expected: FAIL — `fakeCommand: /park has no subcommand 'motto'`, thrown at construction by `builderSpec`.

- [ ] **Step 3: Add the subcommand**

In `src/modules/park/index.ts`, add to the import block:

```ts
import { setMotto, setFeaturedDino, ShowcaseError } from './showcase.js';
```

Add to the `/park` builder chain, after the `landmark` subcommand:

```ts
        .addSubcommand((s) => s.setName('motto').setDescription('The line visitors see on your park card')
          .addStringOption((o) => o.setName('text').setDescription('Up to 80 characters — leave blank to clear').setRequired(false).setMaxLength(80)))
```

Add a `case` to the switch, before `case 'view':`:

```ts
          case 'motto': {
            try {
              const saved = setMotto(ctx, i.user.id, i.options.getString('text'));
              await i.reply({ content: saved ? `📣 Motto set to **${saved}**.` : '📣 Motto cleared.' });
            } catch (e) {
              if (e instanceof ShowcaseError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              else throw e;
            }
            return;
          }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/showcase.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/index.ts tests/showcase.test.ts
git commit -m "feat(park): add /park motto"
```

---

### Task 9: `/park feature` and the first `/park` autocomplete

**Files:**
- Modify: `src/modules/park/index.ts` (builder, switch, new `autocomplete` on the `/park` CommandDef)
- Modify: `tests/contract.test.ts` (`AUTOCOMPLETE_OPTIONS`)
- Test: `tests/showcase.test.ts`

**Interfaces:**
- Consumes: `setFeaturedDino`, `ShowcaseError` (imported in Task 8); `matches`, `emptyRow`, `respondRanked`, `dinoLabel` from `src/core/autocomplete.js` (already imported by this module); `getSpecies`.
- Produces: a `/park feature` subcommand with one optional Integer option `dino`, `.setAutocomplete(true)`, and the first `autocomplete?()` the `/park` CommandDef has ever had.

- [ ] **Step 1: Add the contract manifest entry**

`/park` has no entry in `AUTOCOMPLETE_OPTIONS` today — this creates the first. In `tests/contract.test.ts`, add beside the other park-module entries:

```ts
  'park feature': ['dino'],
```

The check is bidirectional and fails both ways: a flagged builder option missing from the manifest fails, and a manifest entry with no flagged option fails. Do **not** change the `toHaveLength(26)` on line 50 — a subcommand is an option inside an existing command, not a new one.

- [ ] **Step 2: Write the failing tests**

Append to `tests/showcase.test.ts`, adding `import { fakeAutocomplete } from './harness.js';`:

```ts
describe('/park feature', () => {
  const run = async (options?: Record<string, number>) => {
    const i = fakeCommand({ name: 'park', sub: 'feature', user: 'u1', options });
    await parkModule.commands[0].execute(ctx, i.asChatInput());
    return i;
  };

  it('features an owned dino', async () => {
    const d = addDino();
    const i = await run({ dino: d.id });
    expect(row().featuredDinoId).toBe(d.id);
    expect(replyText(i.replies[0])).toContain('Triceratops');
  });

  it('omitting the option clears it', async () => {
    const d = addDino();
    setFeaturedDino(ctx, 'u1', d.id);
    const i = await run();
    expect(row().featuredDinoId).toBeNull();
    expect(replyText(i.replies[0]).toLowerCase()).toContain('cleared');
  });

  it("refuses someone else's dino ephemerally and stores nothing", async () => {
    getOrCreateUser(ctx, 'u2', 'Other');
    const theirs = addDino('u2');
    const i = await run({ dino: theirs.id });
    expect(row().featuredDinoId).toBeNull();
    expect(replyText(i.replies[0])).toContain('do not own');
  });

  it('suggests the caller\'s dinos and creates no user row for a stranger', async () => {
    addDino();
    const i = fakeAutocomplete({ name: 'park', sub: 'feature', user: 'nobody', focused: { name: 'dino', value: '' } });
    await parkModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    // A provider must never call getOrCreateUser: a row per keystroke is the bug the
    // provider contract exists to prevent.
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'nobody')).get()).toBeUndefined();
    expect(i.replies[0]).toEqual([{ name: 'No dinos — hatch an egg first', value: 0 }]);
  });

  it('offers an escaped dino as a valid target', async () => {
    const d = addDino();
    ctx.db.update(schema.dinos).set({ escapedAt: 1 }).where(eq(schema.dinos.id, d.id)).run();
    const i = fakeAutocomplete({ name: 'park', sub: 'feature', user: 'u1', focused: { name: 'dino', value: '' } });
    await parkModule.commands[0].autocomplete!(ctx, i.asAutocomplete());
    // Featuring neither consumes nor moves a dino, so escape state is irrelevant here —
    // the same reasoning /dino rename's provider records.
    expect((i.replies[0] as Array<{ value: number }>).map((c) => c.value)).toEqual([d.id]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/showcase.test.ts tests/contract.test.ts`
Expected: FAIL — `fakeCommand: /park has no subcommand 'feature'`, and contract fails with `park feature option 'dino' should set .setAutocomplete(true)`.

- [ ] **Step 4: Add the subcommand, the case, and the provider**

In `src/modules/park/index.ts`, add to the builder chain after `motto`:

```ts
        .addSubcommand((s) => s.setName('feature').setDescription('Feature one dino on your park card')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search; leave blank to clear').setRequired(false).setAutocomplete(true)))
```

Add a `case` before `case 'view':`:

```ts
          case 'feature': {
            try {
              const species = setFeaturedDino(ctx, i.user.id, i.options.getInteger('dino'));
              await i.reply({
                content: species
                  ? `🦖 Featured **${species.name}** on your park card.`
                  : '🦖 Featured dino cleared.',
              });
            } catch (e) {
              if (e instanceof ShowcaseError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
              else throw e;
            }
            return;
          }
```

Add an `autocomplete` to the `/park` CommandDef, directly after its `execute` (this is the first one `/park` has ever had):

```ts
      async autocomplete(ctx, i) {
        // /park's only autocompleting option, on `feature`. Provider contract: i.respond
        // only, never getOrCreateUser (no row creation on a keystroke), read-only.
        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        if (!dinos.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
        const q = String(i.options.getFocused());
        const now = ctx.now();
        await respondRanked(i, dinos
          .map((d) => ({ d, species: getSpecies(d.speciesId) }))
          .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
          // Every owned dino is valid: featuring neither consumes nor moves one, so an
          // escaped or unassigned dino is a fine target — the /dino rename reasoning.
          .map(({ d, species }) => ({ value: d.id, label: dinoLabel(d, species, now), valid: true })));
      },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/showcase.test.ts tests/contract.test.ts && npm test`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/index.ts tests/contract.test.ts tests/showcase.test.ts
git commit -m "feat(park): add /park feature with dino autocomplete"
```

---

### Task 10: The visit builder and the tour ring

**Files:**
- Create: `src/modules/park/visit.ts`
- Test: `tests/visit.test.ts`

**Interfaces:**
- Consumes: `dashboardPayload`, `withParkImage` from `./embeds.js`; `featuredFor` from `./showcase.js`; `settleEscapes` from `./escapes.js`; `legacyRank` from `./ranks.js`; `earnedTierCount` from `../daily/service.js`; `buildParkSnapshot` from `./snapshot.js`; `renderPark` from `../../core/render/client.js`.
- Produces: `interface VisitPayload { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }`, `tourRing(ctx: Ctx): string[]`, `nextInRing(ctx: Ctx, afterUserId: string): string | null`, `visitPayload(ctx: Ctx, targetUserId: string): Promise<VisitPayload | null>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/visit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { setMotto, setFeaturedDino } from '../src/modules/park/showcase.js';
import { tourRing, nextInRing, visitPayload } from '../src/modules/park/visit.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

const player = (id: string, rating: number) => {
  getOrCreateUser(ctx, id, id.toUpperCase());
  ctx.db.update(schema.users).set({ parkRating: rating }).where(eq(schema.users.discordId, id)).run();
};

describe('tourRing', () => {
  it('orders by rating desc with discordId as the tiebreak', () => {
    player('b', 500); player('a', 500); player('c', 900);
    expect(tourRing(ctx)).toEqual(['c', 'a', 'b']);
  });

  it('skips a park with no rating', () => {
    player('a', 100); player('empty', 0);
    expect(tourRing(ctx)).toEqual(['a']);
  });
});

describe('nextInRing', () => {
  it('wraps at the end', () => {
    player('a', 300); player('b', 200);
    expect(nextInRing(ctx, 'a')).toBe('b');
    expect(nextInRing(ctx, 'b')).toBe('a');
  });

  it('returns the same park when it is the only one', () => {
    player('a', 300);
    expect(nextInRing(ctx, 'a')).toBe('a');
  });

  it('is null when nobody qualifies', () => {
    player('empty', 0);
    expect(nextInRing(ctx, 'empty')).toBeNull();
  });

  it('restarts at the top for a park that has left the ring', () => {
    player('a', 300); player('gone', 0);
    // Reachable without forging anything: a rating can drop, or adminReset can zero it,
    // while a Next park button minted for that park is still live on an old message.
    expect(nextInRing(ctx, 'gone')).toBe('a');
  });
});

describe('visitPayload', () => {
  it('is null for a player with no park row', async () => {
    expect(await visitPayload(ctx, 'nobody')).toBeNull();
  });

  it('carries the target\'s showcase and no Collect button', async () => {
    player('a', 300);
    const d = ctx.db.insert(schema.dinos)
      .values({ userId: 'a', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 })
      .returning().get();
    setMotto(ctx, 'a', 'Where the big ones live');
    setFeaturedDino(ctx, 'a', d.id);
    const p = (await visitPayload(ctx, 'a'))!;
    expect(p.embeds[0].toJSON().description).toContain('Where the big ones live');
    // park:collect carries NO user id, so a viewer clicking it would collect their OWN
    // income from a message about someone else's park. It must never reach this payload.
    expect(JSON.stringify(p)).not.toContain('park:collect');
  });

  it('keeps the featured dino\'s file — the drop the old branch made', async () => {
    player('a', 300);
    const d = ctx.db.insert(schema.dinos)
      .values({ userId: 'a', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 })
      .returning().get();
    setFeaturedDino(ctx, 'a', d.id);
    const p = (await visitPayload(ctx, 'a'))!;
    // The embed points at attachment://<archetype>-<diet>.webp; without the file it is a
    // dangling URL, which renders as a broken image and throws nothing.
    expect(p.embeds[0].toJSON().thumbnail?.url).toBeDefined();
    expect(p.files!.some((f) => f.name === p.embeds[0].toJSON().thumbnail!.url.replace('attachment://', ''))).toBe(true);
  });

  it('mints a Next park button for the next ring member', async () => {
    player('a', 300); player('b', 200);
    const p = (await visitPayload(ctx, 'a'))!;
    expect(JSON.stringify(p)).toContain('park:tour:b');
  });

  it('mints no button when the ring is empty', async () => {
    getOrCreateUser(ctx, 'a', 'A');   // rating 0 — has a row, not in the ring
    const p = (await visitPayload(ctx, 'a'))!;
    expect(p.components).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/visit.test.ts`
Expected: FAIL — `Cannot find module '../src/modules/park/visit.js'`.

- [ ] **Step 3: Implement the visit builder**

Create `src/modules/park/visit.ts`:

```ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { settleEscapes } from './escapes.js';
import { earnedTierCount } from '../daily/service.js';
import { legacyRank } from './ranks.js';
import { featuredFor } from './showcase.js';
import { dashboardPayload, withParkImage } from './embeds.js';
import { buildParkSnapshot } from './snapshot.js';
import { renderPark } from '../../core/render/client.js';
import { foodEmoji } from '../../core/emojis.js';
import { FOODS, type FoodId } from '../../data/foods.js';

export interface VisitPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
}

/**
 * Every park worth visiting, best rating first, discordId as the tiebreak so the order is
 * TOTAL and stable between clicks — `scored()` deliberately has no tiebreak, but a tour
 * that reorders mid-walk would revisit and skip parks, so this one does.
 *
 * parkRating > 0 filters out anyone who ran one command and left: a tour must never land
 * on an empty lot.
 */
export function tourRing(ctx: Ctx): string[] {
  return ctx.db.select().from(schema.users).all()
    .filter((u) => u.parkRating > 0)
    .sort((a, b) => b.parkRating - a.parkRating
      || (a.discordId < b.discordId ? -1 : a.discordId > b.discordId ? 1 : 0))
    .map((u) => u.discordId);
}

/** The next park after `afterUserId`, wrapping at the end. Null when the ring is empty. */
export function nextInRing(ctx: Ctx, afterUserId: string): string | null {
  const ring = tourRing(ctx);
  if (!ring.length) return null;
  const idx = ring.indexOf(afterUserId);
  // A park that has LEFT the ring (rating dropped, adminReset) has no position, and a
  // button minted for it can still be live on an old message — so restart at the top
  // rather than dead-ending.
  return idx === -1 ? ring[0] : ring[(idx + 1) % ring.length];
}

/**
 * Somebody else's park, read-only. Null when they have no park row at all.
 *
 * Builds its OWN components rather than filtering dashboardPayload's, because the two
 * things that must happen here pull in opposite directions: `components` must be dropped
 * (park:collect carries no user id, so a viewer clicking it would collect the CLICKER's
 * income from a message about another player) while `files` must be KEPT (the featured
 * dino's upload, or the embed holds a dangling attachment:// URL). The old
 * `const base = { embeds: payload.embeds }` in /park view did both — correctly for one,
 * silently wrong for the other.
 *
 * Settles the TARGET's escapes, which is what makes the rendered park accurate. It writes
 * nothing for the viewer — no getOrCreateUser, no row minted for a passer-by.
 */
export async function visitPayload(ctx: Ctx, targetUserId: string): Promise<VisitPayload | null> {
  const exists = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, targetUserId)).get();
  if (!exists) return null;
  settleEscapes(ctx, targetUserId);
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, targetUserId)).get()!;
  const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, targetUserId)).all();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, targetUserId)).all();
  const escaped = dinos.filter((d) => d.escapedAt !== null).length;
  const inv = ctx.economy.getFoodInventory(targetUserId);
  const foodLine = (Object.entries(inv) as Array<[FoodId, number]>)
    .map(([id, q]) => `${foodEmoji(id)}${FOODS[id].name} ×${q}`).join(' · ') || 'none — /shop food';
  const built = dashboardPayload(user, lots, dinos.length, 0, escaped, {
    foodLine,
    earnedTiers: earnedTierCount(ctx, targetUserId),
    legacyRank: legacyRank(ctx, targetUserId),
    motto: user.motto,
    featured: featuredFor(ctx, user),
    now: ctx.now(),
  });
  const payload: VisitPayload = { embeds: built.embeds, components: [] };
  if (built.files) payload.files = built.files;
  const next = nextInRing(ctx, targetUserId);
  if (next) {
    // The customId carries the park to go TO, not the one on screen — so the handler
    // renders parts[2] directly and mints the next hop from there. No owner id: this is
    // public and read-only, and the segment is a target, never an owner.
    payload.components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`park:tour:${next}`)
        .setLabel('Next park ▶').setStyle(ButtonStyle.Secondary),
    ));
  }
  let png: Buffer | undefined;
  try { png = await renderPark(buildParkSnapshot(ctx, targetUserId)); } catch { png = undefined; }
  return png ? withParkImage(payload, png) : payload;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/visit.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/visit.ts tests/visit.test.ts
git commit -m "feat(park): add the shared visit payload and tour ring"
```

---

### Task 11: `park:tour` and rewiring `/park view user:`

**Files:**
- Modify: `src/modules/park/index.ts` (the other-player view branch, the `park` ComponentDef)
- Test: `tests/park-view-image.test.ts`, `tests/visit.test.ts`

**Interfaces:**
- Consumes: `visitPayload` from `./visit.js`.
- Produces: the `park:tour:<targetUserId>` component action.

- [ ] **Step 1: Write the failing tests**

Replace the existing `viewing another park is read-only` test in `tests/park-view-image.test.ts` with:

```ts
  it('viewing another park is read-only — one embed, no Collect button', async () => {
    getOrCreateUser(ctx, 'u1', 'U1');
    getOrCreateUser(ctx, 'other', 'Other');
    const cmd = fakeCommand({ name: 'park', sub: 'view', user: 'u1', options: { user: 'other' } });
    await parkModule.commands[0].execute(ctx, cmd.asChatInput());
    const reply = cmd.replies[0] as { embeds: unknown[] };
    expect(reply.embeds).toHaveLength(1);
    // Was `expect(reply.components).toBeUndefined()`. Discovery puts a Next park button
    // here, so the assertion moves to the property it was actually protecting: this
    // message must never carry park:collect, which has no user id in its customId.
    expect(JSON.stringify(reply)).not.toContain('park:collect');
  });
```

Append to `tests/visit.test.ts`, adding `import { fakeButton } from './harness.js';` and `import { parkModule } from '../src/modules/park/index.js';`:

```ts
describe('park:tour', () => {
  const click = async (customId: string, user = 'viewer') => {
    const i = fakeButton({ customId, user });
    await parkModule.components.find((c) => c.prefix === 'park')!.execute(ctx, i.asInteraction() as never);
    return i;
  };

  it('renders the target park and advances the button', async () => {
    player('a', 300); player('b', 200);
    const i = await click('park:tour:b');
    expect(JSON.stringify(i.replies[0])).toContain('park:tour:a');   // wrapped
  });

  it('creates no user row for the clicker', async () => {
    player('a', 300);
    await click('park:tour:a', 'stranger');
    // A public button must never mint an account for a passer-by. The router's own
    // touchPresence is the only writer on this path, and it updates existing rows only.
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'stranger')).get())
      .toBeUndefined();
  });

  it('answers ephemerally for a target with no park', async () => {
    player('a', 300);
    const i = await click('park:tour:ghost');
    expect(JSON.stringify(i.replies[0])).toContain('no park yet');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/visit.test.ts tests/park-view-image.test.ts`
Expected: FAIL — the `park:tour` clicks produce no reply at all (the `park` handler falls off the end of `execute` for an unrecognised action).

- [ ] **Step 3: Rewire the view branch and add the handler**

In `src/modules/park/index.ts`, add to the import block:

```ts
import { visitPayload } from './visit.js';
```

Replace the whole other-player view branch with:

```ts
        const targetUser = i.options.getUser('user');
        if (targetUser && targetUser.id !== i.user.id) {
          // The existence check stays ahead of the defer: "no park yet" is an ephemeral
          // reply, and deferReply would commit this interaction to a public one.
          const targetRow = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, targetUser.id)).get();
          if (!targetRow) { await i.reply({ content: 'That player has no park yet.', flags: MessageFlags.Ephemeral }); return; }
          await i.deferReply();
          await i.editReply((await visitPayload(ctx, targetUser.id))!);
          return;
        }
```

Add a branch to the `park` ComponentDef, after the `action === 'dinos'` block:

```ts
        if (action === 'tour') {
          // NO owner check on purpose: a park visit is public and read-only, and `uid`
          // here is the TARGET park, not an owner. Turning this into an ownership check
          // would make Next park work only for the player whose park is on screen.
          const payload = await visitPayload(ctx, uid);
          if (!payload) { await i.reply({ content: 'That player has no park yet.', flags: MessageFlags.Ephemeral }); return; }
          // attachments: [] — the message being replaced carries the previous park's
          // uploads, and this payload brings its own.
          await i.update({ ...payload, attachments: [] });
          return;
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/visit.test.ts tests/park-view-image.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/index.ts tests/visit.test.ts tests/park-view-image.test.ts
git commit -m "feat(park): tour parks with a Next park button"
```

---

### Task 12: Visit buttons on `/top`

**Files:**
- Modify: `src/modules/leaderboards/index.ts`
- Test: `tests/leaderboards.test.ts`

**Interfaces:**
- Consumes: `visitPayload` from `../park/visit.js`.
- Produces: the `top` component prefix (the leaderboards module's first), serving `top:visit:<targetUserId>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/leaderboards.test.ts`, adding `import { fakeButton } from './harness.js';`:

```ts
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

  it('creates no user row for the clicker', async () => {
    getOrCreateUser(ctx, 'a', 'A');
    ctx.db.update(schema.users).set({ parkRating: 300 }).where(eq(schema.users.discordId, 'a')).run();
    await click('top:visit:a', 'stranger');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'stranger')).get())
      .toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/leaderboards.test.ts -t "visit"`
Expected: FAIL — no `top:visit:` customId in the payload, and `components.find((c) => c.prefix === 'top')` is `undefined`.

- [ ] **Step 3: Add the row and the handler**

In `src/modules/leaderboards/index.ts`, widen the imports:

```ts
import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { visitPayload } from '../park/visit.js';
```

The existing `import type { AttachmentBuilder } from 'discord.js';` stays as-is and is what types the payload's `files?`. Do not add `MessageFlags` — this handler answers publicly, and an unused import fails the build.

Add the row builder beside `metricLabel` / `formatValue`:

```ts
// Up to five Visit buttons, one per top row — discovery starts from the board you are
// already reading. Discord allows five buttons per action row and the board shows ten.
// Unlike pageRow these carry NO viewer id: the message is public and the path is
// read-only, so the id segment is the TARGET park, not an owner. Worst case is 31 of
// Discord's 100 customId characters ('top:visit:' plus a 20-digit snowflake).
// No setEmoji anywhere here — a tag that resolves to '' throws rather than degrading.
function visitRow(rows: Array<{ userId: string }>) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...rows.slice(0, 5).map((r, idx) =>
      new ButtonBuilder().setCustomId(`top:visit:${r.userId}`)
        .setLabel(`Visit #${idx + 1}`).setStyle(ButtonStyle.Secondary)),
  );
}
```

Change the payload declaration and the reply in `execute`:

```ts
        const payload: {
          embeds: EmbedBuilder[];
          components: ActionRowBuilder<ButtonBuilder>[];
          files?: AttachmentBuilder[];
        } = { embeds: [embed], components: rows.length ? [visitRow(rows)] : [] };
        attach(embed, payload, 'image', assetImage('banners', 'leaderboards'));
        await i.reply(payload);
```

Replace the module's empty `components: []` with:

```ts
  components: [
    {
      prefix: 'top',
      async execute(ctx, i) {
        const [, action, targetId] = i.customId.split(':');
        // Unknown actions absorb rather than erroring — the dex/ach/alert discipline, so
        // a customId shape from an older deploy never shows "This interaction failed".
        if (action !== 'visit') { await i.deferUpdate(); return; }
        // deferReply + editReply, never i.update: the leaderboard these buttons sit on
        // must survive the click. Rendering a park runs a worker render, so the defer is
        // also what keeps this inside Discord's 3-second window.
        await i.deferReply();
        const payload = await visitPayload(ctx, targetId);
        if (!payload) { await i.editReply({ content: 'That player has no park yet.' }); return; }
        await i.editReply(payload);
      },
    },
  ],
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/leaderboards.test.ts && npm test`
Expected: PASS. `tests/registry-load.test.ts` still passes: the registry throws only on a **duplicate** component prefix, and no module uses `top`.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/leaderboards/index.ts tests/leaderboards.test.ts
git commit -m "feat(leaderboards): visit a park straight from the board"
```

---

### Task 13: `adminReset` clears the showcase

**Files:**
- Modify: `src/modules/admin/service.ts:83-88`
- Test: `tests/admin.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

`tests/admin.test.ts` already has `let ctx: ReturnType<typeof makeCtx>;` with
`beforeEach(() => { ctx = makeCtx(); });` at the top, and already imports `eq`,
`schema`, `getOrCreateUser` and `adminReset`. Add one import:

```ts
import { setMotto, setFeaturedDino } from '../src/modules/park/showcase.js';
```

Then append this `it` inside the existing `describe('adminReset')` block (it has no
shared seed of its own — each `it` calls `getOrCreateUser` itself):

```ts
  it('reset clears the park showcase', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const d = ctx.db.insert(schema.dinos)
      .values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 })
      .returning().get();
    setMotto(ctx, 'u1', 'Where the big ones live');
    setFeaturedDino(ctx, 'u1', d.id);
    adminReset(ctx, 'u1');
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.motto).toBe('');
    // featuredFor would already resolve a stale id to null, but SQLite reuses ids after a
    // delete (the table has no AUTOINCREMENT keyword), so a reset account's next hatch can
    // land on the very id left behind and silently re-feature a dino nobody chose.
    expect(row.featuredDinoId).toBeNull();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/admin.test.ts -t "showcase"`
Expected: FAIL — `expected 'Where the big ones live' to be ''`.

- [ ] **Step 3: Extend the reset**

In `src/modules/admin/service.ts`, extend the existing `users` update and its comment block:

```ts
    // alertsEnabled is deliberately NOT reset. Every other column here is progress or a
    // cosmetic default; this one is communication consent. Restoring it would start
    // DMing a player who explicitly opted out.
    // landmarkTier is progress (a prestige cosmetic the player paid for), not communication
    // consent, so it IS reset.
    // motto and featuredDinoId are cosmetic defaults like parkName, so they reset too. The
    // featured id matters more than it looks: featuredFor already resolves a dangling id to
    // null, but SQLite reuses row ids after a delete, so a stale id surviving a reset can be
    // re-hit by the account's next hatch and silently feature a dino nobody chose.
    ctx.db.update(schema.users).set({
      cash: 500, shards: 0, parkRating: 0, ratingHighWater: 0, parkName: 'New Park',
      shardsWindowStart: 0, shardsWindowEarned: 0, lastCollectAt: ctx.now(),
      energy: ENERGY_CAP, energyUpdatedAt: ctx.now(),
      questStreak: 0, questStreakBest: 0, lastQuestClaimAt: 0, landmarkTier: 0,
      motto: '', featuredDinoId: null,
    }).where(eq(schema.users.discordId, targetId)).run();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/admin.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/admin/service.ts tests/admin.test.ts
git commit -m "fix(admin): reset clears the park showcase"
```

---

### Task 14: Documentation

**Files:**
- Modify: `docs/commands.md`, `docs/gameplay.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Update `docs/commands.md`**

Add two rows after the `/park landmark` row (line 19), matching the existing three-column format:

```markdown
| `/park motto` | The line visitors see on your park card | Up to 80 characters. Leave the option blank to clear it |
| `/park feature` | Feature one of your dinos on your park card | Shows its name and art to anyone visiting. Leave the option blank to clear it. An escaped dino is still a valid choice |
```

Amend the `/park view` row's notes to mention the **Next park** button on another player's park, and replace the `/top` row (line 112) with:

```markdown
| `/top` | Leaderboards by rating, cash, collection, legacy standing, or battle stars | Server or global scope. Up to five **Visit** buttons open the ranked players' parks |
```

- [ ] **Step 2: Update `docs/gameplay.md`**

Add a short section covering: what a motto and featured dino are and that both are cosmetic; that a featured dino which is sold or traded simply stops showing (nothing breaks, nothing needs re-setting); that visiting is read-only and reachable either from `/top`'s Visit buttons or by `/park view user:`; and that **Next park** walks parks in rating order, skipping parks with no rating. State plainly that there is no way to hide a park from discovery, since parks have always been viewable by @handle.

- [ ] **Step 3: Update the repo `CLAUDE.md`**

Three edits, all of which correct statements this branch makes false:

1. The `withParkImage` bullet currently says it *assigns* `files` and lists why that is harmless at its three call sites. Rewrite it: it now **appends**, `dashboardPayload` **does** call `attach()` (the featured dino thumbnail), and the live hazard has moved to the *other-player view branch*, which must forward `files` while still dropping `components` — the two drops pull in opposite directions and `src/modules/park/visit.ts` is the single place that gets it right.
2. Add a leaderboards bullet: `scored()` costs a fixed number of queries per metric (1 / 2 / 2 / 4 for cash-or-rating / stars / collection / legacy), via batched reads grouped in JS — **not** `GROUP BY`, because `src/` has never used an aggregate helper and `SUM()` over an empty set returns NULL where `.reduce(…, 0)` returns 0. Note that `legacyScores` and `legacyPoints` must agree, that the species term intersects with the live roster while the achievement term deliberately does not, and that `tests/leaderboards.test.ts` pins the exact query counts at two roster sizes.
3. Add a `/park` bullet: it now has an `autocomplete()` — its first — serving `feature`'s `dino` option, so `'park feature': ['dino']` lives in `tests/contract.test.ts`'s `AUTOCOMPLETE_OPTIONS`; and `park:tour:<targetUserId>` / `top:visit:<targetUserId>` are the repo's first customIds whose id segment is a **target rather than an owner**, so neither carries an ownership check and neither should grow one.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run typecheck`
Expected: PASS.

```bash
git add docs/commands.md docs/gameplay.md CLAUDE.md
git commit -m "docs: cover the park showcase, visiting, and the widened leaderboards"
```

---

### Task 15: Payload gallery cases for `npm run test:live`

**Files:**
- Modify: `scripts/test-live.ts`

**Interfaces:**
- Consumes: everything above. Produces: three new gallery cases.

- [ ] **Step 1: Seed the showcase on P1**

The two helpers this file already uses are `slash(moduleName, commandName, fakeCommandOpts)` and `button(moduleName, customId, user)`, both defined around line 246. Player constants `P1` and `P5` already exist, as does a `dino` binding (the one `/sell`'s case passes as `dino.id`).

Add the import:

```ts
import { setMotto, setFeaturedDino } from '../src/modules/park/showcase.js';
```

Then, in the seed block — **after** the `dino` binding is in scope, beside the existing `landmarkTier` line — add:

```ts
// The showcase makes the existing '/park view' case carry TWO files on one embed: the
// featured dino's archetype thumbnail and the rendered park PNG. That pair is exactly what
// the withParkImage append fix exists for, and nothing but looking at it proves it works.
setMotto(ctx, P1, 'Where the big ones live');
setFeaturedDino(ctx, P1, dino.id);
```

- [ ] **Step 2: Add three cases**

Append to the `cases` array, beside the other park entries:

```ts
  { title: '/top legacy — widened metric, Visit buttons on the board', run: () => slash('leaderboards', 'top', { name: 'top', user: P1, options: { metric: 'legacy', scope: 'global' } }) },
  { title: 'top:visit — P5\'s park opened straight from the board', run: () => button('leaderboards', `top:visit:${P5}`, P1) },
  { title: '/park view user:P5 — visiting: showcase kept, Next park, no Collect', run: () => slash('park', 'park', { name: 'park', sub: 'view', user: P1, options: { user: P5 } }) },
```

The gallery is for cosmetic review, so read the posted messages for two things a passing test suite cannot show: the visited-park cases must carry a **Next park** button and **no Collect button**, and `/park view` for P1 must render the dino thumbnail and the park map together rather than one replacing the other.

- [ ] **Step 3: Verify the script still typechecks**

Run: `npm run typecheck`
Expected: PASS. (`scripts/` is only in `tsconfig.test.json`, so `npm run build` would not catch a break here.)

- [ ] **Step 4: Commit**

```bash
git add scripts/test-live.ts
git commit -m "test: add showcase, visit, and widened-board cases to the live gallery"
```

---

## Operator steps

Not part of the plan's tasks — these run once, by hand, after the branch merges. **The order matters and must not be swapped.**

1. `npm run build` — the bot runs compiled output (`npm start` is `node dist/index.js`), so pulling source alone deploys nothing.
2. Take a database copy, then restart the bot. Exactly one process per token: kill the tree and confirm zero survivors first. The restart applies migration 0012.
3. `npm run deploy-commands` — `/top` gains two metric choices, `/park` gains two subcommands and its first autocompleting option.
4. `npm run test:live` — cosmetic review, including the three new cases from Task 15.

Deploying the builders before the restart would have Discord offering `/park motto` to a process whose switch has no `motto` case: it would hit the `default` arm and answer "Unknown /park subcommand."

No `deploy-emojis` — this spec ships no new emoji, and no new art (the featured dino reuses the existing eight `archetype-diet` cutouts).
