# Content Volume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship expedition sites and battle chapters 5-6, ten new species, and the 10★ rating rescale that creates room to gate them.

**Architecture:** Three independent layers land in order. First the rating rescale — a constants-only change in `src/data/progression.ts` plus a data-only migration that doubles the two stored rating columns. Then content data — decor, species, sites, chapters — each of which is a pure data file plus its registry entry. Finally the assets and copy that existing machine gates demand: two emoji SVGs (required by `tests/emoji-assets.test.ts` for every expedition site) and six WebP images (required by `tests/images.test.ts` for every campaign chapter). No new module, no new command, no schema change.

**Tech Stack:** TypeScript ESM/NodeNext, discord.js v14, better-sqlite3 + Drizzle (synchronous), vitest, `@napi-rs/canvas`.

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()` — never `Date.now()`/`Math.random()`.
- DB access is synchronous drizzle (`.get()`/`.all()`/`.run()`), never awaited.
- Currency only via `ctx.economy.apply`; every currency+item flow in one `ctx.db.transaction`.
- No attribution to Claude, AI, or any tool in commits, code comments, or docs.
- `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) is the only gate that typechecks `tests/` and `scripts/` — run it before every commit touching those.
- `NPC_LEVEL_SANITY_CAP` stays **12**. Never raise it to accommodate content.
- `COLLECTION_TARGET` stays **190**. Never make it a live sum over `allSpecies()`.
- New rating scale is **1000**; every gate quoted below is on that scale.
- Biome tag for the lab family is **`containment`**, never `facility`.

---

### Task 1: Rating rescale constants and the collection clamp

**Files:**
- Modify: `src/data/progression.ts`
- Modify: `src/modules/park/rating.ts:12,24-25`
- Modify: `src/data/trade.ts:1`
- Test: `tests/rating.test.ts:11-25`

**Interfaces:**
- Consumes: nothing.
- Produces: `COLLECTION_TARGET = 190`, `RATING_SCALE = 1000`, `LOT_SLOT_THRESHOLDS` (7 entries), `SHOP_CEILING` at 700/400/200/0, `MYTHIC_UNLOCK_RATING = 800`, `TRADE_MIN_RATING = 400`. `recomputeRating(ctx, userId)` keeps its `{ rating, highWater }` return shape.

- [ ] **Step 1: Rewrite the gating assertions to the new scale**

Replace `tests/rating.test.ts` lines 11-25 with:

```ts
  it('lotSlots grows 3→10 across thresholds', () => {
    expect(lotSlots(0)).toBe(3);
    expect(lotSlots(100)).toBe(4);
    expect(lotSlots(800)).toBe(8);
    expect(lotSlots(950)).toBe(10);
    expect(lotSlots(9999)).toBe(10);
  });
  it('siteUnlocked / shopCeiling / mythicUnlocked read high-water', () => {
    expect(siteUnlocked(300, 299)).toBe(false);
    expect(siteUnlocked(300, 300)).toBe(true);
    expect(shopCeiling(0)).toBe('uncommon');
    expect(shopCeiling(250)).toBe('rare');
    expect(shopCeiling(400)).toBe('epic');
    expect(shopCeiling(700)).toBe('legendary');
    expect(mythicUnlocked(799)).toBe(false);
    expect(mythicUnlocked(800)).toBe(true);
  });
  it('rating is scaled to 1000 and never exceeds it', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    for (const s of ['tyrannosaurus', 'mosasaurus', 'indominus', 'indoraptor']) {
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: s, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    }
    const { rating } = recomputeRating(ctx, 'u1');
    expect(rating).toBeGreaterThan(0);
    expect(rating).toBeLessThanOrEqual(1000);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/rating.test.ts`
Expected: FAIL — `lotSlots(100)` returns 5 (old thresholds), `shopCeiling(250)` returns `'epic'`, `mythicUnlocked(800)` is already true at 400.

- [ ] **Step 3: Rewrite the constants**

Replace the body of `src/data/progression.ts` below the `RARITY_WEIGHT`/`RATING_WEIGHTS`/`PARK_TARGET` block:

```ts
export const PARK_TARGET = 40;
// Frozen at the rarity-weight sum of the 30-species roster this shipped with.
// Deliberately NOT a live sum over allSpecies(): a live denominator taxes every
// existing player's rating each time a species ships. New species are alternate
// paths to the same target, which is why the caller clamps at 1.
export const COLLECTION_TARGET = 190;
export const RATING_SCALE = 1000;
export const BASE_LOT_SLOTS_FALLBACK = 3;
export const LOT_SLOT_THRESHOLDS = [100, 200, 400, 600, 800, 880, 950];   // high-water for slots 4..10
export const SHOP_CEILING: Array<{ atLeast: number; ceiling: Rarity }> = [
  { atLeast: 700, ceiling: 'legendary' },
  { atLeast: 400, ceiling: 'epic' },
  { atLeast: 200, ceiling: 'rare' },
  { atLeast: 0, ceiling: 'uncommon' },
];
export const MYTHIC_UNLOCK_RATING = 800;
```

Leave `siteUnlocked`, `lotSlots`, `shopCeiling`, `mythicUnlocked` untouched — they read the constants.

- [ ] **Step 4: Apply the clamp and the scale in rating.ts**

In `src/modules/park/rating.ts`, delete the `allSpecies` import and the `TOTAL_SPECIES_WEIGHT` const on line 12, add `COLLECTION_TARGET, RATING_SCALE` to the `progression.js` import, and replace the two computation lines:

```ts
  const collection = Math.min(1, ownedWeight / COLLECTION_TARGET);
```

```ts
  const rating = Math.round(RATING_SCALE * (
    RATING_WEIGHTS.collection * collection + RATING_WEIGHTS.park * park + RATING_WEIGHTS.comfort * comfort));
```

The `Math.min(1, …)` is load-bearing: once Task 6 lands, owned weight can exceed 190.

- [ ] **Step 5: Double the trade gate**

In `src/data/trade.ts:1`: `export const TRADE_MIN_RATING = 400;        // 4★ live rating, both sides`

- [ ] **Step 6: Run the rating test**

Run: `npx vitest run tests/rating.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. If it reports an unused `allSpecies` import in `rating.ts`, remove it.

- [ ] **Step 8: Commit**

```bash
git add src/data/progression.ts src/modules/park/rating.ts src/data/trade.ts tests/rating.test.ts
git commit -m "feat: rescale park rating to a 1000-point scale

Every gate doubles and the collection denominator becomes a frozen
COLLECTION_TARGET instead of a live sum over the species list, so shipping a
species no longer shrinks every existing player's rating. Owned weight can now
exceed the target, hence the clamp."
```

The rest of the suite is red after this commit. Tasks 2-4 close it.

---

### Task 2: Migration 0007 doubles the stored ratings

**Files:**
- Create: `drizzle/0007_rating_rescale.sql` (via drizzle-kit)
- Modify: `drizzle/meta/_journal.json` and `drizzle/meta/0007_snapshot.json` (both written by drizzle-kit — never by hand)
- Modify: `tests/migration.test.ts:139`
- Test: `tests/migration.test.ts` (new describe block)

**Interfaces:**
- Consumes: Task 1's constants.
- Produces: nothing importable. `migrateDb(db)` behaviour changes: it now doubles `users.park_rating` and `users.rating_high_water` on any database that has not yet applied 0007.

- [ ] **Step 1: Generate the empty custom migration**

Run: `npx drizzle-kit generate --custom --name rating_rescale`

This is a data-only `UPDATE` with no schema diff, so plain `drizzle-kit generate` emits nothing. `--custom` writes all three artifacts together: the SQL file, `meta/0007_snapshot.json`, and the `_journal.json` entry. Never hand-write any of them — the snapshot is what the next `generate` diffs against.

Confirm it produced `drizzle/0007_rating_rescale.sql` and that `drizzle/meta/_journal.json` now ends with an entry at `"idx": 7`.

- [ ] **Step 2: Write the migration body**

Replace the placeholder comment line in `drizzle/0007_rating_rescale.sql` with:

```sql
-- Rating moved from a 500-point scale to 1000, and every gate doubled with it.
-- rating_high_water is the column that matters: it is monotonic and gates lot
-- slots, site and chapter unlocks, the shop ceiling, and Mythic, so a player
-- below their historic peak would never recover it by playing. park_rating
-- self-heals on the next recomputeRating.
UPDATE users SET park_rating = park_rating * 2, rating_high_water = rating_high_water * 2;
```

- [ ] **Step 3: Write the failing production-path test**

Append to `tests/migration.test.ts`, modelled on the 0006 block at line 248:

```ts
describe('0007 rating rescale via the real drizzle migrator (production path)', () => {
  it('doubles both stored rating columns on a populated database', () => {
    // Reach the 0006 schema via a scratch folder holding migrations 0000-0006, seed a
    // parent user AND a child dino row, then let the real migrateDb apply 0007 exactly
    // as the bot does at startup. An empty-DB run or a raw-SQL replay would pass even
    // if the journal entry were missing, which is the failure this test exists to catch.
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig7-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[0-6].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 6);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });          // apply 0000-0006 only

    sqlite.prepare(`INSERT INTO users (discord_id, park_rating, rating_high_water, last_collect_at_ms, created_at_ms)
                    VALUES ('u1', 300, 410, 0, 0), ('u2', 0, 0, 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      const rows = sqlite.prepare(`SELECT discord_id, park_rating, rating_high_water FROM users ORDER BY discord_id`).all() as
        Array<{ discord_id: string; park_rating: number; rating_high_water: number }>;
      expect(rows[0]).toEqual({ discord_id: 'u1', park_rating: 600, rating_high_water: 820 });
      expect(rows[1]).toEqual({ discord_id: 'u2', park_rating: 0, rating_high_water: 0 });
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Fix the 0002 test that this migration now perturbs**

`migrateDb` always applies the FULL production folder, not just the migration under test, so the 0002 block's seeded `rating_high_water = 210` is doubled by 0007 before it is read back. At `tests/migration.test.ts:139`:

```ts
      // 0007 (the rating rescale) also runs on this path — migrateDb always applies the
      // full folder — so the preserved value comes back doubled. The assertion's purpose
      // is unchanged: it proves the 0002 users rebuild copies unrelated columns through
      // rather than resetting them to defaults.
      expect(preserved.rating_high_water).toBe(210 * 2);
```

- [ ] **Step 5: Run the migration tests**

Run: `npx vitest run tests/migration.test.ts`
Expected: PASS, including the new 0007 block.

- [ ] **Step 6: Prove the test can fail**

Temporarily comment out the `UPDATE` line in `drizzle/0007_rating_rescale.sql`, re-run, and confirm the new test goes red at `park_rating: 600`. Restore the line and re-run to green. A migration test that passes with an empty migration is worthless.

- [ ] **Step 7: Commit**

```bash
git add drizzle/ tests/migration.test.ts
git commit -m "feat: migrate stored ratings onto the 1000-point scale

rating_high_water is monotonic and gates lot slots, site and chapter unlocks,
the shop ceiling, and Mythic, so it never recovers on its own if left on the old
scale. Pinned by a production-path test that runs the real migrator against a
seeded parent and child row."
```

---

### Task 3: Retune the trade and mythic gate fixtures

**Files:**
- Modify: `tests/trading.test.ts:15,26,214`, `tests/autocomplete-trading.test.ts:26,154`, `tests/autocomplete-shop.test.ts:46,69`, `tests/autocomplete-hatchery.test.ts:82,140`, `tests/hatchery.test.ts:345,364,386,440,456,519,545`, `tests/shop.test.ts:152,170,189`, `tests/stats-sites.test.ts:214,224,250`, `tests/journeys.test.ts:198,231`, `tests/admin.test.ts:88`, `tests/shards.test.ts:77,84`
- Modify: `scripts/test-live.ts:77,105,197`

**Interfaces:**
- Consumes: `TRADE_MIN_RATING` from `src/data/trade.js`, `MYTHIC_UNLOCK_RATING` from `src/data/progression.js`.
- Produces: nothing.

- [ ] **Step 1: See the damage**

Run: `npx vitest run`
Expected: FAIL across the files listed above. `createTrade` gates on the live `parkRating` column (`src/modules/trading/service.ts:18-19`), so every fixture seeding 200 now throws `TradeError`; every fixture seeding `ratingHighWater: 400` for a Mythic purchase now fails the 800 gate.

- [ ] **Step 2: Seed the trade fixtures from the constant, not a literal**

In each file listed, add the import and replace the literal. Do not hardcode 400 — the idiom already in use at `tests/daily-roll.test.ts:138` is what keeps the next rescale from touching 21 sites:

```ts
import { TRADE_MIN_RATING } from '../src/data/trade.js';
```

```ts
ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).where(eq(schema.users.discordId, 'u1')).run();
```

Update any trailing `// both at 2★` comments to `4★`. `tests/trading.test.ts:48` seeds 150 to sit *below* the gate — it is still below 400, so leave the value and reword the comment.

- [ ] **Step 3: Raise the mythic fixtures**

`tests/shards.test.ts:77` → `ratingHighWater: 800`; `:84` → `799` (it is the reject-boundary case — 399 would still throw under an 800 gate and stop pinning anything). `tests/stats-sites.test.ts:250`, `tests/hatchery.test.ts:386`, `tests/hatchery.test.ts:545` → `800`.

- [ ] **Step 4: Fix the live gallery script**

`scripts/test-live.ts:77` seeds `{ parkRating: 200, ratingHighWater: 400 }` and lines 105 and 197 restore `parkRating: 200` after a recompute. Under a 400 gate the top-level `createTrade` at line 106 throws outside any try/catch and the whole gallery aborts before posting anything. Import the constant and use it at all three sites:

```ts
import { TRADE_MIN_RATING } from '../src/data/trade.js';
```

Set `ratingHighWater` at line 77 to `800` so the `/mythic` case still clears its gate.

- [ ] **Step 5: Run the suite and typecheck**

Run: `npx vitest run` then `npm run typecheck`
Expected: the files in this task pass. `tests/expeditions.test.ts`, `tests/autocomplete-expeditions.test.ts`, `tests/battle-content.test.ts`, `tests/journeys.test.ts` and `tests/hatchery.test.ts:544` are still red — Tasks 4 and 8 own those.

- [ ] **Step 6: Commit**

```bash
git add tests/ scripts/test-live.ts
git commit -m "test: seed rating fixtures from the gate constants

Twenty-one fixtures hardcoded 200 or 400 to clear the trade and Mythic gates.
Seeding from TRADE_MIN_RATING and MYTHIC_UNLOCK_RATING instead means the next
threshold change does not touch them. test-live.ts had the same literals and
would have aborted the gallery at seed time."
```

---

### Task 4: Rescale the user-facing star copy

**Files:**
- Modify: `src/modules/trading/service.ts:66,67,106`
- Modify: `src/modules/shop/shards.ts:63`
- Modify: `src/modules/help/index.ts:37,43,69`
- Modify: `src/modules/hatchery/index.ts:73`
- Test: `tests/hatchery.test.ts:544`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `/mythic`'s builder description changes, which is why Task 16 requires a redeploy.

- [ ] **Step 1: Point the test at the new copy**

`tests/hatchery.test.ts:544`: `expect(replyText(gated.replies[0])).toContain('8★');`

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/hatchery.test.ts -t 'mythic'`
Expected: FAIL — the reply still says `4★`.

- [ ] **Step 3: Rewrite the six strings**

| file:line | old | new |
|---|---|---|
| `trading/service.ts:66` | `You need a 2★ park rating to trade.` | `You need a 4★ park rating to trade.` |
| `trading/service.ts:67` | `That player needs a 2★ park rating to trade.` | `That player needs a 4★ park rating to trade.` |
| `trading/service.ts:106` | `Both players must be at 2★ to complete the trade.` | `Both players must be at 4★ to complete the trade.` |
| `shop/shards.ts:63` | `Reach 4★ park rating to unlock Mythic purchases.` | `Reach 8★ park rating to unlock Mythic purchases.` |
| `help/index.ts:37` | ``spend 500 shards on a Mythic egg (needs 4★ rating).`` | `…(needs 8★ rating).` |
| `hatchery/index.ts:73` | `.setDescription('Spend 500 shards on a Mythic egg (needs 4★)')` | `…(needs 8★)')` |

`help/index.ts:43` (the site chain) and `:69` (the "4 chapters" line) quote *content*, not star thresholds — they are handled in Task 15, once that content exists.

- [ ] **Step 4: Run the hatchery tests**

Run: `npx vitest run tests/hatchery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules tests/hatchery.test.ts
git commit -m "fix: quote the new star thresholds in player-facing copy

Six strings hardcoded the old 5-star scale, including the /mythic command
description, which makes this a builder change requiring a redeploy."
```

---

### Task 5: Marine and containment decor, with a biome coverage guard

**Files:**
- Modify: `src/data/decor.ts`
- Modify: `src/data/species/mosasaurus.ts`, `src/data/species/indominus.ts`, `src/data/species/indoraptor.ts`
- Test: `tests/roster.test.ts` (new test)

**Interfaces:**
- Consumes: nothing.
- Produces: `DECOR` gains `kelp_bed`, `hydrothermal_vent`, `containment_fence`, `floodlight_rig`. Biome vocabulary gains `marine` and `containment`.

- [ ] **Step 1: Write the failing coverage guard**

Append to `tests/roster.test.ts`:

```ts
import { DECOR } from '../src/data/decor.js';

describe('biome vocabulary', () => {
  // paddockFit (src/core/clock.ts:47) reaches 1.0 only when a decor kind on the lot
  // shares a biomeTag with the species, so a species carrying a tag no decor offers
  // is capped at 0.75 comfort forever — and a typo ('Marine' for 'marine') ships
  // exactly that with every other test still green.
  it('every species biome tag is offered by at least one decor kind', () => {
    const offered = new Set(Object.values(DECOR).flatMap((d) => d.biomeTags));
    for (const s of allSpecies()) {
      for (const tag of s.biomeTags) {
        expect(offered, `${s.id} wants biome '${tag}' but no decor offers it`).toContain(tag);
      }
    }
  });
});
```

This assertion is deliberately one-directional. The reverse — every decor tag is wanted by some species — fails immediately on `ice_block`'s orphan `tundra` tag, which is knowingly left in place.

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/roster.test.ts`
Expected: PASS. It guards today's roster and only bites once Step 3's retags land without decor.

- [ ] **Step 3: Add the four decor kinds**

Append to `DECOR` in `src/data/decor.ts`:

```ts
  kelp_bed:          { kind: 'kelp_bed', name: 'Kelp Bed', biomeTags: ['marine'], cost: 900 },
  hydrothermal_vent: { kind: 'hydrothermal_vent', name: 'Hydrothermal Vent', biomeTags: ['marine'], cost: 1_100 },
  containment_fence: { kind: 'containment_fence', name: 'Containment Fence', biomeTags: ['containment'], cost: 1_000 },
  floodlight_rig:    { kind: 'floodlight_rig', name: 'Floodlight Rig', biomeTags: ['containment'], cost: 1_200 },
```

- [ ] **Step 4: Retag three existing species, additively**

```ts
// mosasaurus.ts
  biomeTags: ['coast', 'marine'],
// indominus.ts and indoraptor.ts
  biomeTags: ['volcanic', 'containment'],
```

Additive, never replacing: dropping `coast` or `volcanic` would silently cut comfort for every player whose paddock is decorated with tide pools or lava rock.

- [ ] **Step 5: Prove the guard bites**

Temporarily change `kelp_bed`'s tag to `'Marine'` and re-run `npx vitest run tests/roster.test.ts`. Expected: FAIL naming `mosasaurus`. Restore it and re-run to green.

- [ ] **Step 6: Run the park and clock suites**

Run: `npx vitest run tests/park.test.ts tests/clock.test.ts`
Expected: PASS — `paddockFit` reads tags generically, so no existing comfort changes.

- [ ] **Step 7: Commit**

```bash
git add src/data/decor.ts src/data/species tests/roster.test.ts
git commit -m "feat: add marine and containment decor

Nine of the ten incoming species carry only one of these two biome tags, so
without matching decor they could never exceed 0.75 comfort. Retags on the three
existing species are additive so no shipped paddock loses its match."
```

---

### Task 6: Ten new species

**Files:**
- Create: `src/data/species/{archelon,elasmosaurus,tylosaurus,kronosaurus,ankylodocus,scorpios_rex,stegoceratops,liopleurodon,spinoraptor,ultimasaurus}.ts`
- Modify: `src/data/species/index.ts`
- Test: `tests/roster.test.ts:4,8-10` (new clamp test in `tests/rating.test.ts`)

**Interfaces:**
- Consumes: Task 5's biome tags.
- Produces: ten `Species` records registered in `ALL`. `allSpecies()` returns 40; live rarity-weight sum becomes 296 against the frozen 190 target.

- [ ] **Step 1: Retune the roster expectations**

`tests/roster.test.ts:4`:

```ts
const EXPECTED = { common: 8, uncommon: 8, rare: 8, epic: 8, legendary: 5, mythic: 3 } as const;
```

Lines 8-10: `has exactly 40 species with unique ids`, `toHaveLength(40)`, `.size).toBe(40)`.

Leave the other tests in the file alone: no new species is common, so the archetype-spread test is untouched; `getSpecies` round-trips species whose rarity does not change; the `biomeTags.length > 0` check passes for the new tags.

- [ ] **Step 2: Add the clamp test**

Append to `tests/rating.test.ts`'s `recomputeRating` describe:

```ts
  it('collection is clamped at the frozen target, so extra species never overflow it', () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    // 296 points of rarity weight now exist against a COLLECTION_TARGET of 190,
    // so a deep collection must saturate the term rather than exceeding it.
    for (const s of ['indominus', 'indoraptor', 'ultimasaurus', 'tyrannosaurus', 'mosasaurus',
      'quetzalcoatlus', 'liopleurodon', 'spinoraptor']) {
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: s, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    }
    // 3 mythic (96) + 5 legendary (80) = 176 … add two epics to cross 190.
    for (const s of ['kronosaurus', 'scorpios_rex']) {
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: s, hunger: 100, lastFedAt: 0, hatchedAt: 0 }).run();
    }
    const { rating } = recomputeRating(ctx, 'u1');
    // collection saturated at 1.0 → 0.40 × 1000 = 400 from that term alone, and the
    // park and comfort terms are unassigned/zero here.
    expect(rating).toBe(400);
  });
```

- [ ] **Step 3: Run both and watch them fail**

Run: `npx vitest run tests/roster.test.ts tests/rating.test.ts`
Expected: FAIL — 30 species, and `getSpecies('ultimasaurus')` throws `Unknown species`.

- [ ] **Step 4: Write the ten species files**

One file each, matching the existing one-record format exactly:

```ts
// archelon.ts
import type { Species } from '../types.js';
export const archelon: Species = {
  id: 'archelon', name: 'Archelon', rarity: 'uncommon', diet: 'carnivore', archetype: 'support',
  biomeTags: ['marine', 'coast'], flavor: 'A sea turtle the size of a car, and just as unbothered.',
};
```

```ts
// elasmosaurus.ts
export const elasmosaurus: Species = {
  id: 'elasmosaurus', name: 'Elasmosaurus', rarity: 'rare', diet: 'carnivore', archetype: 'swift',
  biomeTags: ['marine'], flavor: 'Half of it is neck, and all of it is hungry.',
};
// tylosaurus.ts
export const tylosaurus: Species = {
  id: 'tylosaurus', name: 'Tylosaurus', rarity: 'rare', diet: 'carnivore', archetype: 'bruiser',
  biomeTags: ['marine'], flavor: 'Rams its prey at speed, then eats what is left.',
};
// kronosaurus.ts
export const kronosaurus: Species = {
  id: 'kronosaurus', name: 'Kronosaurus', rarity: 'epic', diet: 'carnivore', archetype: 'tank',
  biomeTags: ['marine'], flavor: 'A skull longer than a diver, armoured like a hull.',
};
// ankylodocus.ts
export const ankylodocus: Species = {
  id: 'ankylodocus', name: 'Ankylodocus', rarity: 'epic', diet: 'herbivore', archetype: 'tank',
  biomeTags: ['containment'], flavor: 'Armoured plating on a very long frame. Patient. Immovable.',
};
// scorpios_rex.ts
export const scorpiosRex: Species = {
  id: 'scorpios_rex', name: 'Scorpios rex', rarity: 'epic', diet: 'carnivore', archetype: 'swift',
  biomeTags: ['containment'], flavor: 'A shelved prototype that never agreed to be shelved.',
};
// stegoceratops.ts
export const stegoceratops: Species = {
  id: 'stegoceratops', name: 'Stegoceratops', rarity: 'epic', diet: 'herbivore', archetype: 'support',
  biomeTags: ['containment'], flavor: 'Plates, frill, and horns. The lab could not choose, so it kept all three.',
};
// liopleurodon.ts
export const liopleurodon: Species = {
  id: 'liopleurodon', name: 'Liopleurodon', rarity: 'legendary', diet: 'carnivore', archetype: 'bruiser',
  biomeTags: ['marine'], flavor: 'Four paddle limbs and a bite that folds steel.',
};
// spinoraptor.ts
export const spinoraptor: Species = {
  id: 'spinoraptor', name: 'Spinoraptor', rarity: 'legendary', diet: 'carnivore', archetype: 'bruiser',
  biomeTags: ['containment'], flavor: 'Sail, claws, and pack instinct. The worst of three donors.',
};
// ultimasaurus.ts
export const ultimasaurus: Species = {
  id: 'ultimasaurus', name: 'Ultimasaurus', rarity: 'mythic', diet: 'carnivore', archetype: 'tank',
  biomeTags: ['containment'], flavor: 'Every apex trait the lab had on file, in one animal.',
};
```

Each file needs the `import type { Species } from '../types.js';` line shown in the first example.

- [ ] **Step 5: Register them**

In `src/data/species/index.ts`, add the ten imports and extend `ALL`. Keep the array's existing rarity-grouped layout:

```ts
  archelon, elasmosaurus, tylosaurus,
  kronosaurus, ankylodocus, scorpiosRex, stegoceratops,
  liopleurodon, spinoraptor,
  ultimasaurus,
```

Note `scorpios_rex`'s exported binding is `scorpiosRex` — the id is snake_case, the binding is camelCase, matching the file's own convention.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/roster.test.ts tests/rating.test.ts tests/images.test.ts`
Expected: PASS. `images.test.ts`'s "every species resolves to a shipped archetype image" passes because all eight archetype×diet images already exist — `archelon` is the first species to use `support-carnivore`.

- [ ] **Step 7: Commit**

```bash
git add src/data/species tests/roster.test.ts tests/rating.test.ts
git commit -m "feat: add ten species for the trench and the lab

Roster goes 30 to 40, weighted toward the top tiers the new chapters field.
Archelon is the first species to use the support-carnivore art that has shipped
unused since the archetype keying landed. Live rarity weight is now 296 against
a frozen 190 target, so the collection term saturates rather than overflowing."
```

---

### Task 7: Site emoji for the two new sites

**Files:**
- Create: `assets/emojis/svg/dw_site_abyssal_trench.svg`, `assets/emojis/svg/dw_site_containment_site.svg`
- Create: `assets/emojis/png/dw_site_abyssal_trench.png`, `assets/emojis/png/dw_site_containment_site.png` (generated)
- Modify: `src/core/emojis.ts:12-13`
- Modify: `tests/emojis.test.ts:37-51`
- Modify: `docs/ops.md:64` (two counts), `docs/assets/prompts.md:1002`

**Interfaces:**
- Consumes: nothing.
- Produces: `EMOJI_FALLBACK.dw_site_abyssal_trench` and `.dw_site_containment_site`. `siteMarker()` (`src/modules/expeditions/index.ts:17-20`) resolves them.

This task must land **before** Task 8. `tests/emoji-assets.test.ts:128` iterates `Object.keys(EXPEDITION_SITES)` and demands a committed SVG per site, so adding the sites first turns the suite red.

- [ ] **Step 1: Extend the pinned name list**

`tests/emojis.test.ts:37` — retitle to `covers exactly the 43 spec names` and insert both names in sorted position: `dw_site_abyssal_trench` sorts before `dw_site_amber_ridge`, and `dw_site_containment_site` between `dw_site_coastal_dig` and `dw_site_frozen_cliffs`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/emojis.test.ts`
Expected: FAIL — `EMOJI_FALLBACK` has 41 keys, the expectation now lists 43.

- [ ] **Step 3: Add the fallbacks**

In `src/core/emojis.ts`, extend the site block:

```ts
  dw_site_volcano_core: '🌋', dw_site_coastal_dig: '🐚',
  dw_site_amber_ridge: '🟠', dw_site_frozen_cliffs: '❄️',
  dw_site_abyssal_trench: '🌊', dw_site_containment_site: '🧪',
```

Without a fallback, `siteMarker` returns `''` and the two endgame sites are the only ones with no icon in every expedition embed title.

- [ ] **Step 4: Author the two SVGs**

64×64 viewBox, flat vector, thick dark outline — match `dw_site_frozen_cliffs.svg` in construction. Two hard constraints:

- **Under 2% pure `#000000`** among opaque pixels (`MAX_BLACK_SHARE`, `tests/emoji-assets.test.ts:19`). Use a dark navy (`#0b2233`) or dark slate for outlines, never `#000000`. A dark abyssal palette is the likeliest family yet to trip this.
- **Never `<ellipse fill="url(#grad)">` with default `gradientUnits`** — resvg renders it solid black. Use `gradientUnits="userSpaceOnUse"` with `y1`/`y2` set to the ellipse's own pre-transform bbox, or use `polygon`/`rect`/`circle`, which are unaffected.

`dw_site_abyssal_trench.svg` — a V-shaped trench cleft between two dark shelves, pale vent glow at the bottom:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f7fa8"/><stop offset="1" stop-color="#0b2233"/></linearGradient></defs>
  <rect x="4" y="8" width="56" height="48" rx="6" fill="url(#g)" stroke="#0b2233" stroke-width="3"/>
  <polygon points="4,34 22,34 32,56 42,34 60,34 60,56 4,56" fill="#08161f" stroke="#0b2233" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="32" cy="47" r="5" fill="#ffb648" opacity="0.85"/>
  <polyline points="14,20 22,16 30,20" fill="none" stroke="#bfe6ff" stroke-width="2.5" opacity="0.7"/>
</svg>
```

`dw_site_containment_site.svg` — a fenced enclosure with a warning chevron:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="6" y="10" width="52" height="44" rx="5" fill="#3d4a58" stroke="#1b2530" stroke-width="3"/>
  <rect x="12" y="16" width="40" height="32" fill="#c8d6e0" stroke="#1b2530" stroke-width="2.5"/>
  <polygon points="32,20 46,44 18,44" fill="#f2c230" stroke="#1b2530" stroke-width="2.5" stroke-linejoin="round"/>
  <rect x="30" y="27" width="4" height="9" fill="#1b2530"/>
  <rect x="30" y="38" width="4" height="4" fill="#1b2530"/>
</svg>
```

- [ ] **Step 5: Render the PNGs**

Run: `npm run build-emojis`
Expected: two new 128×128 PNGs under `assets/emojis/png/`.

- [ ] **Step 6: Verify the rendered pixels**

Run: `npx vitest run tests/emoji-assets.test.ts tests/emojis.test.ts`
Expected: PASS. If the black-share assertion fails, lighten the outline colour — do not raise `MAX_BLACK_SHARE`.

- [ ] **Step 7: Bump the machine-checked emoji counts**

`tests/docs-assets.test.ts:13-18` scrapes `/(\d+)\s+(?:custom |application )?emojis/` from `docs/ops.md` and `docs/assets/prompts.md` and asserts every quoted number equals the committed SVG count. Change all three literals from 41 to 43: `docs/ops.md:64` (twice — "uploads the 41 custom emojis" and "deletes + recreates all 41 emojis") and `docs/assets/prompts.md:1002` ("The 41 application emojis").

Add prompt rows for both new emoji under `## Emoji icons` in `docs/assets/prompts.md`, describing the two designs above.

- [ ] **Step 8: Run the docs gate**

Run: `npx vitest run tests/docs-assets.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add assets/emojis src/core/emojis.ts tests/emojis.test.ts docs/ops.md docs/assets/prompts.md
git commit -m "feat: add site emoji for the trench and the containment site

Every expedition site is required by test to ship a dw_site_* SVG, a unicode
fallback, and a rendered PNG, so these land before the sites themselves."
```

---

### Task 8: The two expedition sites

**Files:**
- Modify: `src/data/sites.ts`
- Test: `tests/expeditions.test.ts:26`, `tests/autocomplete-expeditions.test.ts:14,18-22,31`

**Interfaces:**
- Consumes: Task 7's emoji, Task 1's rescaled gates.
- Produces: `EXPEDITION_SITES.abyssal_trench` and `.containment_site`. Chapter ids in Task 10-11 must equal these keys.

- [ ] **Step 1: Retune the site-count assertion**

`tests/expeditions.test.ts:26` — `listSites(400)` no longer returns 4 under the rescaled gates:

```ts
    expect(listSites(950).length).toBe(6);
```

- [ ] **Step 2: Retune the autocomplete expectations**

`tests/autocomplete-expeditions.test.ts:14` — raise the fixture from `ratingHighWater: 150` to `300`, preserving the test's intent (Amber Ridge unlocked, everything above locked). Line 18's id list grows to all six in `EXPEDITION_SITES` insertion order, valid first:

```ts
    expect(rows.map((r) => r.value)).toEqual(['coastal_dig', 'amber_ridge', 'frozen_cliffs', 'volcano_core',
      'abyssal_trench', 'containment_site']);
```

Lines 19-20 keep their current unlocked labels (Coastal Dig and Amber Ridge are both unlocked again at 300). The locked labels rescale — the label is built from `(s.unlockRating / 100).toFixed(1)` at `src/modules/expeditions/index.ts:52`:

```ts
    expect(rows[2].name).toBe('🧭 Frozen Cliffs — LOCKED, needs ★5.0');
    expect(rows[3].name).toBe('🧭 Volcano Core — LOCKED, needs ★8.0');
```

Line 31's LOCKED count goes from 3 to 4 (Frozen Cliffs, Volcano Core, Abyssal Trench, Containment Site).

- [ ] **Step 3: Run and watch them fail**

Run: `npx vitest run tests/expeditions.test.ts tests/autocomplete-expeditions.test.ts`
Expected: FAIL — only four sites exist.

- [ ] **Step 4: Add the two sites**

Append to `EXPEDITION_SITES` in `src/data/sites.ts`:

```ts
  abyssal_trench: { id: 'abyssal_trench', name: 'Abyssal Trench', unlockRating: 880, durationMs: 12 * H, cost: 40_000,
    eggOdds: [{ rarity: 'rare', weight: 25 }, { rarity: 'epic', weight: 45 }, { rarity: 'legendary', weight: 29 }, { rarity: 'mythic', weight: 1 }], bonusCash: [8_000, 20_000], bonusFood: [40, 90] },
  containment_site: { id: 'containment_site', name: 'Containment Site', unlockRating: 950, durationMs: 24 * H, cost: 100_000,
    eggOdds: [{ rarity: 'epic', weight: 35 }, { rarity: 'legendary', weight: 63 }, { rarity: 'mythic', weight: 2 }], bonusCash: [20_000, 50_000], bonusFood: [80, 180] },
```

Both keep the Volcano Core shape where the dig costs more cash than it returns — the egg is the payoff.

- [ ] **Step 5: Run the expedition and emoji suites**

Run: `npx vitest run tests/expeditions.test.ts tests/autocomplete-expeditions.test.ts tests/emoji-assets.test.ts`
Expected: PASS. The emoji suite is the one that proves Task 7 landed first.

- [ ] **Step 6: Commit**

```bash
git add src/data/sites.ts tests/
git commit -m "feat: add the Abyssal Trench and Containment Site digs

Gated at 8.8 and 9.5 stars on the rescaled ladder, with 12h and 24h durations.
Both cost more cash than they return, so the egg odds are the reason to run
them."
```

---

### Task 9: Banner, thumb, and boss portrait art

**Files:**
- Create: `assets/images/sites/abyssal_trench-banner.webp`, `abyssal_trench-thumb.webp`, `containment_site-banner.webp`, `containment_site-thumb.webp`
- Create: `assets/images/battles/boss-abyssal_trench-portrait.webp`, `boss-containment_site-portrait.webp`
- Modify: `docs/assets/prompts.md`

**Interfaces:**
- Consumes: Task 8's site ids.
- Produces: the six files `tests/images.test.ts` requires once Tasks 10-11 add the chapters. `assetImage('sites', '<id>-banner')`, `('sites', '<id>-thumb')`, `('battles', 'boss-<id>-portrait')` all resolve.

This task must land **before** Tasks 10-11: `tests/images.test.ts:272-275` loops `CAMPAIGN` asserting a banner and a thumb per chapter, and `PORTRAIT_BOSS_IDS` at line 151 asserts a 1024×1024 transparent portrait per boss.

- [ ] **Step 1: Generate the two banners**

Higgsfield, 1536×1024, matching the existing site banners' painterly style. Prompts:

- **Abyssal Trench** — "A deep-ocean trench floor lit only by hydrothermal vents, black basalt shelves dropping into darkness, orange vent glow and drifting particulate, a research submersible's lamp raking across the rock, cold blue-black palette, cinematic wide establishing shot, painterly concept art, no text, no logos."
- **Containment Site** — "A rain-slick research compound at night behind heavy electrified fencing, floodlight towers cutting through mist, a breached inner paddock gate hanging open, warning chevrons on concrete, cold teal and sodium-amber palette, cinematic wide establishing shot, painterly concept art, no text, no logos."

Then: `node scripts/fit-art.mjs banner <src> assets/images/sites/<id>-banner.webp`

- [ ] **Step 2: Generate the two thumbs**

Square 1024×1024 opaque crops of the same scenes — a tighter framing, not a cutout. Target exactly 1024×1024 (the shipped `volcano_core-thumb` is a legacy 1254×1254 outlier; do not copy it). Save as WebP q95 to `assets/images/sites/<id>-thumb.webp`.

- [ ] **Step 3: Generate the two boss portraits**

Subjects: **Mosasaurus** for `boss-abyssal_trench-portrait`, **Spinoraptor** for `boss-containment_site-portrait` (a sail-backed raptor hybrid — spinosaurid sail and snout on a heavy raptor frame). Include the battles-specific no-glow rule from `docs/assets/prompts.md:617-621` verbatim in the prompt: off-silhouette glow survives matting as floating islands or a halo.

Process them with the **one-off pass documented at `docs/assets/prompts.md:628-633`**, not `scripts/fit-art.mjs cutout`:

1. remove background
2. alpha threshold below 32
3. three-pass luminance defringe
4. keep only the largest connected region
5. fit and centre on the whole silhouette bbox at a **24px** margin on a 1024×1024 transparent canvas

`fit-art.mjs cutout` fits to 31px and would ship these visibly smaller than the four existing boss portraits. Verify every border pixel is transparent and exactly one connected region survives.

- [ ] **Step 4: Add the prompt rows**

`docs/assets/prompts.md` is the regeneration source of truth and `tests/battle-content.test.ts` asserts every `bossId` appears in it. Add rows for all six files under the existing site and boss-portrait sections, following the format already used there, and update the boss-portrait section's stated count from four to six.

- [ ] **Step 5: Verify the assets**

Run: `npx vitest run tests/images.test.ts`
Expected: PASS. The CAMPAIGN-derived loops still only cover four chapters at this point; the new files are verified by Tasks 10-11.

Manually confirm dimensions:

```bash
node -e "const {Image}=require('@napi-rs/canvas');const fs=require('fs');(async()=>{for(const p of ['assets/images/sites/abyssal_trench-banner.webp','assets/images/sites/abyssal_trench-thumb.webp','assets/images/battles/boss-abyssal_trench-portrait.webp']){const i=new Image();i.src=fs.readFileSync(p);await i.decode();console.log(p,i.width,i.height);}})()"
```

Expected: `1536 1024`, `1024 1024`, `1024 1024`.

- [ ] **Step 6: Pin the margin convention**

The 24px-versus-31px divergence is documented in `scripts/fit-art.mjs`, `docs/assets/prompts.md`, and `CLAUDE.md`, and enforced nowhere — which is why it is easy to ship a portrait through the wrong pass. Extend `expectTransparentCutout` in `tests/images.test.ts` to measure it:

```ts
  // Two cutout families diverge by 7px on purpose: the boss portraits and eggs came
  // from a one-off pass at 24px, hatch cracks and dino art from fit-art.mjs at 31px.
  // Nothing enforced it until now, so a portrait run through the wrong pass shipped
  // visibly smaller than its siblings and every size/corner assertion still passed.
  const px = c.getImageData(0, 0, 1024, 1024).data;
  let minX = 1024, minY = 1024, maxX = -1, maxY = -1;
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      if (px[(y * 1024 + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const margin = Math.min(minX, minY, 1023 - maxX, 1023 - maxY);
  const expected = kind === 'battles' ? 24 : 31;
  expect(Math.abs(margin - expected), `${name} margin ${margin}, expected ~${expected}`).toBeLessThanOrEqual(1);
```

Run: `npx vitest run tests/images.test.ts`
Expected: PASS for all six existing portraits and both new ones. If a new portrait lands at 31px, it went through `fit-art.mjs cutout` — redo Step 3 with the one-off pass.

- [ ] **Step 7: Commit**

```bash
git add assets/images docs/assets/prompts.md tests/images.test.ts
git commit -m "feat: add art for the trench and containment site

Two banners, two thumbs, and two boss portraits. The portraits use the one-off
24px whole-bbox pass the other boss art uses, not fit-art.mjs cutout, which fits
to 31px and would ship them smaller than their four siblings."
```

---

### Task 10: Chapter 5 — Abyssal Trench

**Files:**
- Create: `src/data/battle/chapters/abyssal_trench.ts`
- Modify: `src/data/battle/chapters/index.ts:5-8,36`
- Test: `tests/battle-content.test.ts:16,35,36,101,108-111`

**Interfaces:**
- Consumes: Task 6's species, Task 8's site key, Task 9's art.
- Produces: `abyssalTrench: ChapterDef` exported and appended to `CAMPAIGN`. `STAGES` grows to 25 entries.

- [ ] **Step 1: Retune the campaign pins**

In `tests/battle-content.test.ts`: append `'abyssal_trench'` to the id array at line 16; change `seen.size` and `STAGES.size` at lines 35-36 to `25`; change the shard total at line 101 to `132` (93 + 39) and its trailing `// margin today: 407` comment to `368`; append `'legendary'` to the `eggRarity` array and `'boss-abyssal_trench'` to the `bossId` array at lines 108-111.

The boss `eggSpeciesId` assertion at line 111 currently checks `bosses.slice(0, 3)` are null and `bosses[3]` is `'tyrannosaurus'`. Add:

```ts
    expect(bosses[4].eggSpeciesId).toBe('mosasaurus');
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/battle-content.test.ts`
Expected: FAIL — CAMPAIGN has four chapters.

- [ ] **Step 3: Write the chapter**

```ts
import type { ChapterDef } from './index.js';

// Chapter 5 — Abyssal Trench (unlockRating 880). Marine reptiles, escalating from
// the rare plesiosaurs on the shelf to the legendary hunters in the dark. The boss
// is legendary-base on purpose: player power is capped at level 10 and one combat
// trait, so a mythic-base boss is unwinnable rather than hard.
export const abyssalTrench: ChapterDef = {
  id: 'abyssal_trench',
  name: 'Abyssal Trench',
  tagline: 'The pressure down here kills faster than the teeth.',
  stages: [
    {
      id: 'abyssal_trench_1', name: 'The Drop-Off', energyCost: 1, npcLevel: 10,
      enemies: [{ speciesId: 'elasmosaurus' }, { speciesId: 'tylosaurus' }, { speciesId: 'kronosaurus' }],
      rewards: { cash: 460, xp: 165 }, firstClearShards: 6,
    },
    {
      id: 'abyssal_trench_2', name: 'Kelp Gloom', energyCost: 1, npcLevel: 10,
      enemies: [{ speciesId: 'tylosaurus' }, { speciesId: 'kronosaurus' }, { speciesId: 'liopleurodon' }],
      rewards: { cash: 520, xp: 180 }, firstClearShards: 6,
    },
    {
      id: 'abyssal_trench_3', name: 'Hydrothermal Vents', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'kronosaurus' }, { speciesId: 'liopleurodon' }, { speciesId: 'mosasaurus' }],
      rewards: { cash: 580, food: { foodId: 'fish', qty: 3 }, xp: 195 }, firstClearShards: 6,
    },
    {
      id: 'abyssal_trench_4', name: 'The Black Smoker', energyCost: 2, npcLevel: 11,
      enemies: [{ speciesId: 'kronosaurus' }, { speciesId: 'mosasaurus' }, { speciesId: 'liopleurodon' }],
      rewards: { cash: 650, xp: 215 }, firstClearShards: 7,
    },
    {
      id: 'abyssal_trench_boss', name: 'Sovereign of the Trench', energyCost: 3, npcLevel: 11,
      enemies: [{ speciesId: 'kronosaurus' }, { speciesId: 'liopleurodon' }, { speciesId: 'mosasaurus' }],
      rewards: { cash: 750, food: { foodId: 'fish', qty: 5 }, xp: 240 }, firstClearShards: 14,
      boss: {
        bossId: 'boss-abyssal_trench', title: 'The Trench Sovereign', speciesId: 'mosasaurus',
        levelBonus: 1, hpMult: 2.8, atkMult: 1.25, eggRarity: 'legendary', eggSpeciesId: 'mosasaurus',
      },
    },
  ],
};
```

`levelBonus: 1` keeps `npcLevel + levelBonus` at 12, the sanity cap. `fish` is the tier-1 carnivore food (`src/data/foods.ts:14`) — the trench pays the cheap tier, the lab pays `prime_steak`.

- [ ] **Step 4: Register it**

`src/data/battle/chapters/index.ts`: add `import { abyssalTrench } from './abyssal_trench.js';` and append to `CAMPAIGN`.

- [ ] **Step 5: Run the content and image suites**

Run: `npx vitest run tests/battle-content.test.ts tests/images.test.ts`
Expected: PASS — the image suite now checks `sites/abyssal_trench-{banner,thumb}` and `battles/boss-abyssal_trench-portrait`, all shipped in Task 9.

- [ ] **Step 6: Commit**

```bash
git add src/data/battle/chapters tests/battle-content.test.ts
git commit -m "feat: add the Abyssal Trench campaign chapter

Five stages of marine reptiles behind an 8.8-star gate and the Volcano Core boss
clear. The boss is legendary-base and capped at level 12 so it stays winnable by
a squad a level-10 player can actually field."
```

---

### Task 11: Chapter 6 — Containment Site

**Files:**
- Create: `src/data/battle/chapters/containment_site.ts`
- Modify: `src/data/battle/chapters/index.ts`
- Test: `tests/battle-content.test.ts` (same pins as Task 10)

**Interfaces:**
- Consumes: Tasks 6, 8, 9.
- Produces: `containmentSite: ChapterDef`. `STAGES` reaches 30 entries — which is what breaks the autocomplete in Task 13.

- [ ] **Step 1: Retune the pins again**

Append `'containment_site'` to the id array; `seen.size`/`STAGES.size` → `30`; shard total → `177` and the margin comment → `323`; append `'legendary'` and `'boss-containment_site'` to the boss arrays; add:

```ts
    expect(bosses[5].eggSpeciesId).toBe('spinoraptor');
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/battle-content.test.ts`
Expected: FAIL — CAMPAIGN has five chapters.

- [ ] **Step 3: Write the chapter**

```ts
import type { ChapterDef } from './index.js';

// Chapter 6 — Containment Site (unlockRating 950). The lab's own hybrids, loose.
// Escorts stay epic-tier on the boss stage: simulation showed the escorts dominate
// the outcome far more than the boss's own multipliers do.
export const containmentSite: ChapterDef = {
  id: 'containment_site',
  name: 'Containment Site',
  tagline: 'Everything here was built on purpose. Nothing here stayed put.',
  stages: [
    {
      id: 'containment_site_1', name: 'Quarantine Wing', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'stegoceratops' }, { speciesId: 'ankylodocus' }, { speciesId: 'scorpios_rex' }],
      rewards: { cash: 850, xp: 260 }, firstClearShards: 7,
    },
    {
      id: 'containment_site_2', name: 'Gene Vault', energyCost: 1, npcLevel: 11,
      enemies: [{ speciesId: 'ankylodocus' }, { speciesId: 'scorpios_rex' }, { speciesId: 'stegoceratops' }],
      rewards: { cash: 950, xp: 280 }, firstClearShards: 7,
    },
    {
      id: 'containment_site_3', name: 'Paddock Nine', energyCost: 1, npcLevel: 12,
      enemies: [{ speciesId: 'stegoceratops' }, { speciesId: 'scorpios_rex' }, { speciesId: 'spinoraptor' }],
      rewards: { cash: 1_050, food: { foodId: 'prime_steak', qty: 3 }, xp: 300 }, firstClearShards: 7,
    },
    {
      id: 'containment_site_4', name: 'Perimeter Breach', energyCost: 2, npcLevel: 12,
      enemies: [{ speciesId: 'scorpios_rex' }, { speciesId: 'ankylodocus' }, { speciesId: 'spinoraptor' }],
      rewards: { cash: 1_200, xp: 330 }, firstClearShards: 8,
    },
    {
      id: 'containment_site_boss', name: 'Asset 47', energyCost: 3, npcLevel: 11,
      enemies: [{ speciesId: 'scorpios_rex' }, { speciesId: 'stegoceratops' }, { speciesId: 'spinoraptor' }],
      rewards: { cash: 1_400, food: { foodId: 'prime_steak', qty: 5 }, xp: 370 }, firstClearShards: 16,
      boss: {
        bossId: 'boss-containment_site', title: 'Asset 47', speciesId: 'spinoraptor',
        levelBonus: 1, hpMult: 3.0, atkMult: 1.2, eggRarity: 'legendary', eggSpeciesId: 'spinoraptor',
      },
    },
  ],
};
```

The boss stage drops to `npcLevel: 11` deliberately — escorts at 11, boss at 12 — because the boss is the threat, not the escorts.

- [ ] **Step 4: Register it**

Add the import and append to `CAMPAIGN` in `src/data/battle/chapters/index.ts`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: `tests/battle-content.test.ts` and `tests/images.test.ts` pass. `tests/battles-autocomplete.test.ts` may still pass (its fixture is a fresh user) — Task 13 adds the case that catches the 30-stage truncation.

- [ ] **Step 6: Commit**

```bash
git add src/data/battle/chapters tests/battle-content.test.ts
git commit -m "feat: add the Containment Site campaign chapter

The campaign's finale: five stages of lab hybrids behind a 9.5-star gate.
First-clear shards across the whole campaign now total 177, still far under the
500-shard Mythic price."
```

---

### Task 12: Pin the boss difficulty with a win-rate band

**Files:**
- Create: `tests/battle-balance.test.ts`
- Modify: `src/data/battle/chapters/abyssal_trench.ts`, `containment_site.ts` (only if the bands fail)

**Interfaces:**
- Consumes: Tasks 10-11.
- Produces: a regression gate on every boss stage. No exported symbols.

Today nothing would fail on a 0%-win boss. That is how the first draft of this design — Indominus at level 14 with ×3.0 HP — reached the spec stage before simulation caught it.

- [ ] **Step 1: Write the balance test**

```ts
import { describe, it, expect } from 'vitest';
import { CAMPAIGN, rosterFor, type StageDef } from '../src/data/battle/chapters/index.js';
import { statsFor } from '../src/data/battle/stats.js';
import { LEVEL_CAP } from '../src/data/battle/constants.js';
import { resolveBattle, type Combatant } from '../src/data/battle/resolve.js';
import { getSpecies } from '../src/data/species/index.js';
import { mulberry32 } from '../src/core/rolls.js';

// The strongest squad a player can actually field: three level-capped legendary
// bruisers. Mythics exist but cost 500 shards each against a 60/day sell cap, so
// a boss that only a triple-mythic roster can beat is a paywall, not a fight.
function squadOf(speciesId: string, traits: string[]): Combatant[] {
  const sp = getSpecies(speciesId);
  return [0, 1, 2].map((k) => {
    const s = statsFor(speciesId, LEVEL_CAP, traits);
    return {
      key: `p${k}`, name: `P${k}`, speciesId, archetype: sp.archetype,
      maxHp: s.hp, hp: s.hp, atk: s.atk, def: s.def, spd: s.spd, side: 0 as const,
    };
  });
}

function npcsOf(stage: StageDef): Combatant[] {
  return rosterFor(stage, 3).map((e, i) => {
    const sp = getSpecies(e.speciesId);
    const s = statsFor(e.speciesId, stage.npcLevel + (e.boss?.levelBonus ?? 0));
    const hp = Math.round(s.hp * (e.boss?.hpMult ?? 1));
    return {
      key: `n${i}`, name: `N${i}`, speciesId: e.speciesId, archetype: sp.archetype,
      maxHp: hp, hp, atk: Math.round(s.atk * (e.boss?.atkMult ?? 1)),
      def: s.def, spd: s.spd, side: 1 as const,
    };
  });
}

function winRate(stage: StageDef, traits: string[], runs = 400): number {
  let won = 0;
  for (let seed = 0; seed < runs; seed++) {
    if (resolveBattle(squadOf('tyrannosaurus', traits), npcsOf(stage), mulberry32(seed)).won) won++;
  }
  return won / runs;
}

const BOSS_STAGES = CAMPAIGN.map((c) => ({ chapter: c.name, stage: c.stages[4] }));

describe('boss difficulty bands', () => {
  it.each(BOSS_STAGES)('$chapter boss is beatable by a traited legendary squad', ({ stage }) => {
    const rate = winRate(stage, ['savage']);
    expect(rate, `traited win rate ${rate}`).toBeGreaterThanOrEqual(0.85);
    expect(rate, `traited win rate ${rate}`).toBeLessThanOrEqual(0.99);
  });

  it.each(BOSS_STAGES)('$chapter boss still threatens an untraited legendary squad', ({ stage }) => {
    const rate = winRate(stage, []);
    expect(rate, `untraited win rate ${rate}`).toBeGreaterThanOrEqual(0.40);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/battle-balance.test.ts`
Expected: the four existing bosses pass comfortably. If either new boss lands outside its band, continue to Step 3; if both pass, skip to Step 4.

- [ ] **Step 3: Tune to the band**

Adjust `atkMult` first — incoming damage is what wipes a squad, and it dominates the outcome. Reference measurements from the design's simulation pass: at a fixed level, `hpMult 3.0 / atkMult 1.0` won 10.1% while `hpMult 2.0 / atkMult 1.3` won 3.6%, so trimming HP alone does not move a fight. Change one multiplier at a time, re-run, and stop as soon as both bands hold. Do not raise `NPC_LEVEL_SANITY_CAP` and do not touch `LEVEL_CAP`.

- [ ] **Step 4: Prove the test can fail**

Temporarily set the Containment boss's `hpMult` to `9.0` and re-run. Expected: FAIL on the traited band. Restore and re-run to green.

- [ ] **Step 5: Commit**

```bash
git add tests/battle-balance.test.ts src/data/battle/chapters
git commit -m "test: pin every boss inside a measured win-rate band

Nothing previously failed on an unwinnable boss. The bands run the real
resolveBattle over seeded rng against the strongest squad a level-capped player
can field, so a future chapter cannot ship a fight that cannot be won."
```

---

### Task 13: Stop the stage picker truncating at 25

**Files:**
- Modify: `src/modules/battles/index.ts:174-190`
- Test: `tests/battles-autocomplete.test.ts`

**Interfaces:**
- Consumes: Task 11's 30 stages.
- Produces: no signature change. The provider's emission order changes to newest-chapter-first.

`respondRanked` hard-slices at `MAX_CHOICES = 25` (`src/core/autocomplete.ts:26-29`). Six chapters × 5 stages = 30, so a fully-progressed player's empty-query picker silently drops the last five entries — precisely the Containment Site stages.

- [ ] **Step 1: Write the failing test**

```ts
  it('stage: the newest chapter survives the 25-choice slice for a fully unlocked player', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    // Unlock everything the way a real endgame player does: rating high-water past the
    // last gate, and a 1-star first clear on every stage. Chapter unlocks need only a
    // 1-star boss clear, so this player still emits all 30 entries.
    ctx.db.update(schema.users).set({ ratingHighWater: 1000 }).where(eq(schema.users.discordId, 'u1')).run();
    for (const ch of CAMPAIGN) {
      for (const s of ch.stages) {
        ctx.db.insert(schema.battleProgress)
          .values({ userId: 'u1', stageId: s.id, stars: 1, firstClearedAt: 1, attempts: 1 }).run();
      }
    }
    const fake = fakeAutocomplete({ name: 'battle', sub: 'fight', user: 'u1', focused: { name: 'stage', value: '' } });
    await battleCmd.autocomplete!(ctx, fake.asAutocomplete());
    const choices = fake.replies[0] as Choice[];
    expect(choices).toHaveLength(25);
    const last = CAMPAIGN[CAMPAIGN.length - 1];
    for (const s of last.stages) {
      expect(choices.map((c) => c.value), `${s.id} dropped by the 25-choice slice`).toContain(s.id);
    }
  });
```

Import `CAMPAIGN` from `../src/data/battle/chapters/index.js` at the top of the file. The `battle_progress` columns are `userId`, `stageId`, `stars`, `firstClearedAt`, `attempts` (`src/core/db/schema.ts:77-82`) — the drizzle field is `firstClearedAt`, not the `_ms`-suffixed column name.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/battles-autocomplete.test.ts`
Expected: FAIL — the five `containment_site_*` ids are missing; the slice kept chapters 1-5 in CAMPAIGN order.

- [ ] **Step 3: Emit chapters newest-first**

In `src/modules/battles/index.ts`, iterate the campaign in reverse so the slice sheds the oldest, already-cleared chapters instead of the newest content:

```ts
          // Newest chapter first: respondRanked slices at 25 and the campaign now has 30
          // stages, so emission order decides what a player sees on an empty query. Old
          // cleared chapters are the cheapest to recover by typing; the frontier is not.
          for (const ch of [...CAMPAIGN].reverse()) {
```

Do not filter on stars — chapter unlocks need only a 1-star clear, so "skip fully 3-starred chapters" bounds nothing. Do not raise `MAX_CHOICES`; 25 is Discord's hard cap.

- [ ] **Step 4: Run the autocomplete tests**

Run: `npx vitest run tests/battles-autocomplete.test.ts`
Expected: PASS, including the existing "playable stage ranks first" test — a fresh user has only `coastal_dig_1` valid, and `respondRanked` puts valid rows first regardless of emission order.

- [ ] **Step 5: Commit**

```bash
git add src/modules/battles/index.ts tests/battles-autocomplete.test.ts
git commit -m "fix: keep the newest chapter in the stage picker

Six chapters put 30 stages through a 25-choice cap, so an endgame player's empty
query silently dropped every Containment Site stage. Emitting newest-first sheds
old cleared chapters instead, which are the ones typing recovers easily."
```

---

### Task 14: Retune two achievement tracks and gate their reachability

**Files:**
- Modify: `src/data/achievements.ts:20,25`
- Test: `tests/daily-content.test.ts`

**Interfaces:**
- Consumes: Task 11's stage count, Task 1's lot thresholds.
- Produces: no signature change. `TIER_REWARDS` is indexed by tier position, so payouts are unaffected.

- [ ] **Step 1: Write the failing reachability gate**

Append to `tests/daily-content.test.ts`:

```ts
import { STAGES } from '../src/data/battle/chapters/index.js';
import { BASE_LOT_SLOTS_FALLBACK, LOT_SLOT_THRESHOLDS } from '../src/data/progression.js';

describe('achievement reachability', () => {
  // A tier above the game's own ceiling can never be claimed. lots_built shipped
  // that way — Gold (10) and Platinum (15) against a maximum of 8 lots, worth
  // 7,500 cash and 25 shards nobody could ever collect.
  it('every top tier is actually attainable', () => {
    const ceilings: Record<string, number> = {
      stages_first_cleared: STAGES.size,
      lots_built: BASE_LOT_SLOTS_FALLBACK + LOT_SLOT_THRESHOLDS.length,
    };
    for (const track of ACHIEVEMENTS) {
      const ceiling = ceilings[track.id];
      if (ceiling === undefined) continue;
      expect(track.tiers[3], `${track.id} Platinum (${track.tiers[3]}) exceeds its ceiling ${ceiling}`)
        .toBeLessThanOrEqual(ceiling);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/daily-content.test.ts`
Expected: FAIL — `lots_built` Platinum is 15 against a ceiling of 10.

- [ ] **Step 3: Retune the two tracks**

```ts
  { id: 'stages_first_cleared', stat: 'stages_first_cleared', name: 'Explorer', tiers: [5, 10, 20, 30] },
```

```ts
  { id: 'lots_built', stat: 'lots_built', name: 'Park Architect', tiers: [3, 5, 8, 10] },
```

Explorer's Platinum stays a campaign-completion capstone at 30 stages instead of stalling at 20 of 30. Architect's ladder is rescaled under the new 10-lot ceiling rather than adding more `LOT_SLOT_THRESHOLDS`, which would be a second live capacity change. The existing strictly-ascending assertion still holds for both.

- [ ] **Step 4: Run the daily suites**

Run: `npx vitest run tests/daily-content.test.ts tests/daily-command.test.ts`
Expected: PASS. `tests/daily-command.test.ts` reads `explorerDef.tiers[3]` off the def rather than hardcoding 20, so it follows the retune.

- [ ] **Step 5: Commit**

```bash
git add src/data/achievements.ts tests/daily-content.test.ts
git commit -m "fix: make the Architect and Explorer top tiers reachable

lots_built asked for 15 lots against a hard maximum of 8, so Gold and Platinum
were unclaimable. Explorer's Platinum tracked a 20-stage campaign that is now 30.
The new gate pins both against the game's own ceilings."
```

---

### Task 15: Documentation sweep

**Files:**
- Modify: `docs/gameplay.md`, `docs/commands.md:33`, `README.md:12,21,25`, `CLAUDE.md:248-255`, `docs/assets/prompts.md:721-731`

**Interfaces:**
- Consumes: every prior task.
- Produces: nothing.

- [ ] **Step 1: Rewrite the gameplay tables**

`docs/gameplay.md`, section by section, with the values this plan shipped:

| lines | what changes |
|---|---|
| 58-70 | lot-slot table: five gates rescale to 100/200/400/600/800, plus two new rows at 880 and 950 for slots 9-10 |
| 143-155 | decor table: four new kinds, two new biome tags |
| 239-276 | roster: 30 → 40 species, per-rarity split `8/8/8/8/5/3`, diet split 18 herbivore / 22 carnivore, ten new rows |
| 414-448 | expedition table: four → six sites, gates now 0/3.0★/5.0★/8.0★/8.8★/9.5★, egg-odds rows for both new sites |
| 457-472 | campaign: four → six chapters, 20 → 30 stages, chapter gate list |
| 530-532 | campaign first-clear shard total 93 → 177 |
| 557-568 | boss table: two new rows; the stat-multiplier claim now spans ×2.5 to ×3.0 |
| 599-604 | shop rarity-ceiling table: 350/200/100 → 700/400/200 |
| 669, 1009 | trading minimum 2.0★ → 4.0★ |
| 709-720 | rating math: score out of 1000, ceiling 10.0★, and the collection denominator is a frozen 190, not the species count |
| 740-746 | best-ever paragraph: both quoted gates move |
| 876-879 | Gene Lab section repeats the 8-lot cap → 10 |

- [ ] **Step 2: Fix the remaining docs**

- `src/modules/help/index.ts:43` — the site chain becomes `Sites: Coastal Dig (15m) → Amber Ridge (1h) → Frozen Cliffs (4h) → Volcano Core (8h) → Abyssal Trench (12h) → Containment Site (24h).`
- `src/modules/help/index.ts:69` — `the campaign map: 4 chapters` → `6 chapters`
- `docs/commands.md:33` — `/mythic` note "Needs 4.0★" → "Needs 8.0★"
- `README.md:12,21,25` — species count 30 → 40, chapter count four → six
- `CLAUDE.md:248-255` — the art-keying bullet claims `support-carnivore` ships with zero species; Archelon uses it now. Update the species count in the same bullet, and record the two decisions worth not re-deriving: `COLLECTION_TARGET` is frozen deliberately, and `NPC_LEVEL_SANITY_CAP` must not be raised for content
- `docs/assets/prompts.md:721-731` — the archetype section repeats the same `support-carnivore` and 30-species claims

Leave `docs/superpowers/specs/` and `plans/` alone. They are dated historical records.

- [ ] **Step 3: Verify the docs gates**

Run: `npx vitest run tests/docs-assets.test.ts tests/images.test.ts tests/battle-content.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs README.md CLAUDE.md
git commit -m "docs: track the 10-star scale and the new content

Every count, gate, and rating claim across gameplay.md, commands.md, the README,
and the repo notes now matches what ships."
```

---

### Task 16: Full verification and the operator handoff

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: every prior task.
- Produces: a verified branch.

- [ ] **Step 1: Run everything**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all three clean. Report actual numbers — do not claim green without the output.

- [ ] **Step 2: Confirm the whole rescale landed**

```bash
grep -rn "TOTAL_SPECIES_WEIGHT" src tests
grep -rn "[^0-9]2★\|[^0-9]4★" src
```

Expected: the first returns nothing. The second returns only the strings Task 4 rewrote to `4★` in the trading module — no `2★` anywhere, and no `4★` in the shop, help, or hatchery modules.

- [ ] **Step 3: Confirm the asset set**

```bash
ls assets/images/sites assets/images/battles assets/emojis/svg | wc -l
npx vitest run tests/images.test.ts tests/emoji-assets.test.ts tests/docs-assets.test.ts
```

Expected: 12 site files, 6 boss portraits, 43 SVGs; all three suites green.

- [ ] **Step 4: Write the operator checklist into the PR body**

The following are manual, in this order, and none of them is optional:

1. `npm run build-emojis` then `npm run deploy-emojis` — 41 → 43 emoji. Commit the updated `assets/emojis/manifest.json` immediately after; note it was already dirty from the Gene Lab round.
2. `npm run deploy-commands` — **mandatory.** `/decorate item` enumerates `DECOR` via `addChoices` (`src/modules/park/index.ts:262`), so it goes 8 → 12 choices; `/mythic species` enumerates mythic species (`src/modules/hatchery/index.ts:74`), 2 → 3, and its description changed in Task 4. Exactly one bot instance per token.
3. `npm run test:live` — posts the payload gallery for cosmetic review. Task 3 already fixed the fixtures that would otherwise abort it at seed time.

- [ ] **Step 5: Final commit if anything moved**

```bash
git add -A
git commit -m "chore: verify the content-volume branch"
```

---

## Notes for the implementer

**What the machine gates actually protect.** Three test files fail the moment content lands without its assets, and they are the reason for this task order: `tests/emoji-assets.test.ts` (a `dw_site_*` SVG per expedition site — Task 7 before Task 8), `tests/images.test.ts` (a banner, a thumb, and a boss portrait per campaign chapter — Task 9 before Tasks 10-11), and `tests/docs-assets.test.ts` (every emoji count quoted in docs equals the committed SVG count).

**Mutation-test every test this plan asks you to write.** This repo has found twice that plan-authored tests are untrustworthy until proven capable of failing — and that mutation testing still misses tests that are *structurally* incapable of failing. Ask of each: what line would have to change for this to go red? Steps 2 and 6 of Task 2, Step 5 of Task 5, Step 4 of Task 12, and Step 2 of Task 13 are explicit mutation checks. Apply the same standard to anything you add.

**Do not raise a cap to make content fit.** `NPC_LEVEL_SANITY_CAP` (12), `LEVEL_CAP` (10), and `MAX_CHOICES` (25) each caught a real defect in this design. If content does not fit under one of them, the content is wrong.
