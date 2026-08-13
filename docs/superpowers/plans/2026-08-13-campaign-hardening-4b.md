# Campaign Hardening 4b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop world events from making campaign bosses unwinnable, and make a Legacy rank permanent once earned.

**Architecture:** Three independent deliverables. The balance test harness gains an `EventMods` parameter and a new assertion under Blood Moon; the two late bosses are re-tuned on `hpMult` so they clear it; and a monotone `users.legacy_rank_best` column makes `legacyRank` return `max(stored, computed)`. No new content, no art, no emoji, no command builder change.

**Tech Stack:** TypeScript (ESM NodeNext), vitest, drizzle + better-sqlite3, discord.js.

**Spec:** `docs/superpowers/specs/2026-08-13-campaign-hardening-4b-design.md`

## Global Constraints

Every task's requirements implicitly include all of these.

- **ESM NodeNext:** every relative import carries a `.js` extension, including in tests.
- **HP is the exposure knob, attack is the threat knob.** Re-tune bosses on `hpMult` only. `atkMult` was measured and rejected: at 1.05 it clears the Blood Moon floor but sends neutral traited to 1.0000, breaching the ≤0.99 finale ceiling and breaking the monotone ladder. Do not touch `atkMult` or `npcLevel`.
- **`npcLevel` stays at 11 with `levelBonus` 1** (effective 12 = `NPC_LEVEL_SANITY_CAP`). The cap does not move, for any reason.
- **Under an event, assert only the traited floor (≥0.85).** Requiring the untraited floor under Blood Moon is unsatisfiable without flattening the late campaign — see spec §3.
- **Tune at 400 seeds**, because that is what the test uses and what decides pass/fail. Confirm at 3,000 and 10,000, and quote the seed count honestly in any comment.
- **`legacyRank` must return `max(stored, computed)`**, never the stored value alone.
- **Never fold the `legacyRankBest` write into `legacyRank`.** `src/modules/park/visit.ts` calls it for another player's id.
- **`LEGACY_TIERS` does not change.** This plan ships persistence, not a retune.
- **`npm run typecheck` is the only gate that sees test files.** `npm test` transpiles without typechecking.
- Commit messages must not mention Claude, AI, or any tool, and carry no `Co-Authored-By` trailer.

---

## File Structure

**Modified — tests (1 file):**
- `tests/battle-balance.test.ts` — `npcsOf` gains a mods parameter; new Blood Moon describe block

**Modified — battle data (2 files):**
- `src/data/battle/chapters/abyssal_trench.ts` — boss `hpMult` and its comment
- `src/data/battle/chapters/containment_site.ts` — boss `hpMult` and its comment

**Created — migration (1 file):**
- `drizzle/0014_legacy_rank_best.sql`

**Modified — persistence (3 files):**
- `drizzle/meta/_journal.json` — the 0014 entry
- `src/core/db/schema.ts` — the `legacyRankBest` column
- `src/modules/park/ranks.ts` — `legacyRank` reads the high-water mark; new `bumpLegacyBest`

**Modified — call sites (2 files):**
- `src/modules/park/index.ts` — `/park view` bumps
- `src/modules/dex/embeds.ts` — `/dex list` bumps
- `src/modules/park/visit.ts` — **deliberately NOT modified**

**Modified — docs (2 files):**
- `docs/gameplay.md`, repo `CLAUDE.md`

---

## Task 1: Event-aware balance harness and the boss re-tune

The harness change and the re-tune are one deliverable: the new assertion is red until the bosses move, so splitting them would leave the suite red at a task boundary.

**Files:**
- Test: `tests/battle-balance.test.ts`
- Modify: `src/data/battle/chapters/abyssal_trench.ts`, `src/data/battle/chapters/containment_site.ts`

**Interfaces:**
- Consumes: `NEUTRAL_MODS` and `WORLD_EVENTS` from `../src/data/world-events.js`; `type EventMods` from the same module. `EventMods.enemyHp` is a multiplier, 1 on every event except Blood Moon, which is 1.15.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Thread mods through the NPC builder**

In `tests/battle-balance.test.ts`, add to the imports:

```ts
import { NEUTRAL_MODS, WORLD_EVENTS, type EventMods } from '../src/data/world-events.js';
```

Change `npcsOf` and `winRate` to take mods. The multiplication order and the `Math.round` must match `src/modules/battles/service.ts:109` exactly — `s.hp * hpMult * enemyHp`, rounded once at the end — so the test models the real pipeline rather than an approximation:

```ts
function npcsOf(stage: StageDef, mods: EventMods = NEUTRAL_MODS): Combatant[] {
  return rosterFor(stage, 3).map((e, i) => {
    const sp = getSpecies(e.speciesId);
    const s = statsFor(e.speciesId, stage.npcLevel + (e.boss?.levelBonus ?? 0));
    // Same order and rounding as src/modules/battles/service.ts:109.
    const hp = Math.round(s.hp * (e.boss?.hpMult ?? 1) * mods.enemyHp);
    return {
      key: `n${i}`, name: `N${i}`, speciesId: e.speciesId, archetype: sp.archetype,
      maxHp: hp, hp, atk: Math.round(s.atk * (e.boss?.atkMult ?? 1)),
      def: s.def, spd: s.spd, side: 1 as const,
    };
  });
}

function winRate(stage: StageDef, traits: string[], runs = 400, mods: EventMods = NEUTRAL_MODS): number {
  let won = 0;
  for (let seed = 0; seed < runs; seed++) {
    if (resolveBattle(squadOf('tyrannosaurus', traits), npcsOf(stage, mods), mulberry32(seed)).won) won++;
  }
  return won / runs;
}
```

Both parameters default to `NEUTRAL_MODS`, so every existing call site and every existing assertion is unchanged.

- [ ] **Step 2: Run the file and confirm nothing moved**

Run: `npx vitest run tests/battle-balance.test.ts`
Expected: PASS, all tests. The defaults mean this refactor is behaviour-neutral. If anything fails here, the parameter threading is wrong — fix it before adding the new assertion.

- [ ] **Step 3: Add the failing Blood Moon assertion**

Append a new `describe` block at the end of `tests/battle-balance.test.ts`:

```ts
// Blood Moon is the only event that touches combat: enemyHp 1.15, applied to every
// enemy including escorts (src/modules/battles/service.ts:109). It runs roughly one
// day in eight, and before this guard existed nothing in the suite ever measured a
// boss under an event — chapters 5 and 6 sat at 0.50 and 0.40 traited on those days,
// far under the floor every other day asserts.
//
// Only the TRAITED floor is asserted here. Requiring >=0.40 untraited under the event
// too is unsatisfiable without flattening the late campaign: the configurations that
// reach it push neutral untraited rates out of monotone order. Blood Moon stays a real
// difficulty spike — it also pays +50% battle XP and -1 energy — but a prepared squad
// can always win.
describe('boss difficulty under world events', () => {
  const BLOOD_MOON = WORLD_EVENTS.find((e) => e.id === 'blood_moon')!;
  const MODS: EventMods = { ...NEUTRAL_MODS, ...BLOOD_MOON.mods };

  it.each(BOSS_STAGES)('$chapter boss stays winnable for a traited squad under Blood Moon', ({ stage }) => {
    const rate = winRate(stage, ['savage'], 400, MODS);
    expect(rate, `Blood Moon traited win rate ${rate}`).toBeGreaterThanOrEqual(0.85);
  });
});
```

- [ ] **Step 4: Run it and confirm exactly two bosses fail**

Run: `npx vitest run tests/battle-balance.test.ts -t 'under Blood Moon'`
Expected: FAIL on **Abyssal Trench** (≈0.5000) and **Containment Site** (≈0.4025). The other four pass — Volcano Core sits at ≈0.9200 and needs no change.

If any of the first four fail, stop and report: the mods spread is picking up something beyond `enemyHp`.

- [ ] **Step 5: Re-tune the Abyssal Trench boss**

In `src/data/battle/chapters/abyssal_trench.ts`, change the boss `hpMult` from `1.3` to **`0.78`**.

Replace the boss comment block with:

```ts
      boss: {
        // hpMult 0.78, down from 1.3, so this boss clears the traited floor under Blood
        // Moon (enemyHp 1.15) as well as under neutral mods — see the event guard in
        // tests/battle-balance.test.ts. Measured at 400 seeds, the count that test uses:
        // Blood Moon traited 0.9225, neutral traited 1.0000, neutral untraited 0.9225.
        // Confirm at 3,000 and 10,000 before changing this number.
        //
        // This is deliberately below 1.0, retiring the "boss multipliers never fall
        // below 1.0" convention these files used to state. atkMult was the obvious way
        // to preserve it and was measured and rejected: at 1.05 it clears the Blood Moon
        // floor but lands neutral traited at 1.0000, which breaches the finale ceiling on
        // Containment Site and breaks the monotone ladder. Cutting attack removes the
        // threat outright; cutting HP keeps the boss hitting just as hard and shortens
        // how long the squad is exposed to it. HP is the exposure knob, attack is the
        // threat knob, and only exposure has usable range here. atkMult stays at 1.25.
        //
        // 0.9225 untraited sits between Volcano Core's 0.9300 and Containment Site's
        // 0.8800, holding the campaign's monotonic ladder. Scale 0.65 also clears the
        // event floor but lands at 0.8550, BELOW Containment Site, which inverts the
        // ladder — the two late bosses must be tuned together, not independently.
```

Keep the existing `bossId` / `title` / `speciesId` / `atkMult` lines and the closing brace exactly as they are.

- [ ] **Step 6: Re-tune the Containment Site boss**

In `src/data/battle/chapters/containment_site.ts`, change the boss `hpMult` from `2.15` to **`1.72`**.

Replace the boss comment block with:

```ts
      boss: {
        // hpMult 1.72, down from 2.15, so this boss clears the traited floor under Blood
        // Moon (enemyHp 1.15) as well as under neutral mods — see the event guard in
        // tests/battle-balance.test.ts. Measured at 400 seeds, the count that test uses:
        // Blood Moon traited 0.8650, neutral traited 0.9725, neutral untraited 0.8800.
        //
        // The previous comment here claimed a "3,000-seed check: traited 0.90, untraited
        // 0.44". That was wrong: 0.44 is the 10,000-seed figure and the true 3,000-seed
        // untraited rate was 0.4310. Quote the seed count a number was actually measured
        // at, or the next author tunes against a figure that does not exist.
        //
        // This is the campaign's current finale (CAMPAIGN's last chapter), so its neutral
        // traited rate also has a <=0.99 upper bound; 0.9725 leaves real margin. atkMult
        // stays at 1.2 — see the Abyssal Trench boss comment for why attack is the wrong
        // lever for event compensation.
        //
        // 0.8800 untraited stays below Abyssal Trench's 0.9225, holding the monotonic
        // ladder. The two late bosses must be tuned together: fixing either alone breaks
        // the monotonicity assertion on the other.
```

Keep the existing `bossId` / `title` / `speciesId` / `atkMult` lines and the closing brace exactly as they are.

- [ ] **Step 7: Run the whole balance file**

Run: `npx vitest run tests/battle-balance.test.ts`
Expected: PASS, every test — the four neutral assertions and the new event one.

The numbers to expect, and what each guard is checking:

| chapter | neutral traited | neutral untraited | Blood Moon traited |
| --- | --- | --- | --- |
| Volcano Core | 0.9950 | 0.9300 | 0.9200 |
| Abyssal Trench | 1.0000 | 0.9225 | 0.9225 |
| Containment Site | 0.9725 | 0.8800 | 0.8650 |

Monotone untraited: `0.9300 ≥ 0.9225 ≥ 0.8800`. Finale ceiling: `0.9725 ≤ 0.99`. Every traited figure ≥ 0.85.

If a measured rate differs from the table by more than ±0.02, stop and report rather than adjusting `hpMult` until it goes green — a mismatch means the harness is not modelling the pipeline correctly, which is the defect this task exists to prevent.

- [ ] **Step 8: Confirm stability at higher seed counts**

The test runs 400 seeds. Confirm the tuning is not an artefact of that sample by temporarily raising the run count in a scratch run — pass `3000` and then `10000` as `winRate`'s third argument for the two re-tuned bosses — and check every band still holds. Revert any temporary edit before committing; do not raise the count in the committed test, which would slow the suite for no gain.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS. `tests/battle-content.test.ts` asserts nothing about `hpMult`, so nothing else should move.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add tests/battle-balance.test.ts src/data/battle/chapters/abyssal_trench.ts src/data/battle/chapters/containment_site.ts
git commit -m "fix: keep late bosses winnable under Blood Moon"
```

---

## Task 2: The `legacy_rank_best` column

Migration only. No behaviour change yet — `legacyRank` still ignores the column, so the suite stays green throughout.

**Files:**
- Create: `drizzle/0014_legacy_rank_best.sql`
- Modify: `drizzle/meta/_journal.json`, `src/core/db/schema.ts`
- Test: `tests/migration.test.ts`

**Interfaces:**
- Produces: `schema.users.legacyRankBest`, a `notNull` integer defaulting to 0, available to Task 3.

- [ ] **Step 1: Write the migration**

This repo has no `drizzle-kit generate` script — migrations are hand-authored SQL plus a journal entry. Create `drizzle/0014_legacy_rank_best.sql` containing exactly one line, matching the shape of `drizzle/0011_landmark_tier.sql`:

```sql
ALTER TABLE `users` ADD `legacy_rank_best` integer DEFAULT 0 NOT NULL;
```

This is a plain column add, not a table recreate, so the `foreign_keys` bracketing in `migrateDb` is not load-bearing here.

- [ ] **Step 2: Register it in the journal**

In `drizzle/meta/_journal.json`, append to the `entries` array, after the `0013_duels` object:

```json
    {
      "idx": 14,
      "version": "6",
      "when": 1786600000000,
      "tag": "0014_legacy_rank_best",
      "breakpoints": true
    }
```

Add the comma after the `0013_duels` closing brace. The `when` value is a plain timestamp and is not read for ordering — `idx` is — so the exact number does not matter as long as it is an integer.

- [ ] **Step 3: Add the column to the schema**

In `src/core/db/schema.ts`, add to the `users` table beneath `ratingHighWater` (line 10):

```ts
  legacyRankBest: integer('legacy_rank_best').notNull().default(0),
```

- [ ] **Step 4: Write a test that the migration applies and defaults**

Add to `tests/migration.test.ts`:

```ts
  it('adds legacy_rank_best defaulting to 0 for existing rows', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const row = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(row.legacyRankBest).toBe(0);
  });
```

If `makeCtx`, `getOrCreateUser`, `schema` or `eq` are not already imported in that file, add them — `makeCtx` from `./harness.js`, `getOrCreateUser` from `../src/modules/park/service.js`, `schema` from `../src/core/db/index.js`, `eq` from `drizzle-orm`.

- [ ] **Step 5: Run it**

Run: `npx vitest run tests/migration.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test`
Expected: PASS. Every existing row gets 0 and nothing reads the column yet.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add drizzle/0014_legacy_rank_best.sql drizzle/meta/_journal.json src/core/db/schema.ts tests/migration.test.ts
git commit -m "feat: add the legacy rank high-water column"
```

---

## Task 3: `legacyRank` reads the high-water mark

**Files:**
- Modify: `src/modules/park/ranks.ts`, `src/modules/park/index.ts`, `src/modules/dex/embeds.ts`
- Test: `tests/ranks.test.ts`

**Interfaces:**
- Consumes: `schema.users.legacyRankBest` from Task 2.
- Produces: `bumpLegacyBest(ctx: Ctx, userId: string): void` exported from `src/modules/park/ranks.ts`. `legacyRank(ctx, userId)` keeps its existing signature and return type `LegacyTier | null`, but now resolves against `max(stored, computed)`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/ranks.test.ts`:

```ts
describe('legacy rank persistence', () => {
  it('returns the stored best when the live total has dropped', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    // Curator is 65 points. Store that as the earned best, with no live points at all.
    ctx.db.update(schema.users).set({ legacyRankBest: 65 })
      .where(eq(schema.users.discordId, 'u1')).run();
    expect(legacyPoints(ctx, 'u1')).toBe(0);
    expect(legacyRank(ctx, 'u1')!.title).toBe('Curator');
  });

  it('prefers the live total when it exceeds the stored best', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ legacyRankBest: 15 })
      .where(eq(schema.users.discordId, 'u1')).run();
    for (const s of allSpecies().slice(0, 35)) recordSpeciesSeen(ctx, 'u1', s.id);
    // 35 live points beats a stored 15, so the live value wins.
    expect(legacyRank(ctx, 'u1')!.title).toBe('Keeper');
  });

  it('bumpLegacyBest latches the live total and never lowers it', () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    for (const s of allSpecies().slice(0, 35)) recordSpeciesSeen(ctx, 'u1', s.id);
    bumpLegacyBest(ctx, 'u1');
    const after = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(after.legacyRankBest).toBe(35);

    // A later call with a LOWER live total must not move it down.
    ctx.db.delete(schema.speciesSeen).where(eq(schema.speciesSeen.userId, 'u1')).run();
    expect(legacyPoints(ctx, 'u1')).toBe(0);
    bumpLegacyBest(ctx, 'u1');
    const later = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!;
    expect(later.legacyRankBest).toBe(35);
  });
});
```

Add `bumpLegacyBest` to the existing import from `../src/modules/park/ranks.js`, and `eq` from `drizzle-orm` if not already imported.

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run tests/ranks.test.ts -t 'legacy rank persistence'`
Expected: FAIL — `bumpLegacyBest` is not exported, and the first case returns `null` because `legacyRank` ignores the stored column.

- [ ] **Step 3: Implement both functions**

In `src/modules/park/ranks.ts`, replace `legacyRank` with:

```ts
/**
 * The highest tier reached, or null below the first threshold.
 *
 * Resolves against max(stored, computed), never the stored value alone. The column is a
 * SAFETY NET, not a source of truth: whenever the live total is higher — the normal case —
 * it wins, so the rank is always at least what the player has actually earned. That is
 * what makes a missed bumpLegacyBest call harmless; the stored value only ever matters
 * when the computed value DROPS, which is the case it exists to cover.
 */
export function legacyRank(ctx: Ctx, userId: string): LegacyTier | null {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  const points = Math.max(user?.legacyRankBest ?? 0, legacyPoints(ctx, userId));
  let out: LegacyTier | null = null;
  for (const tier of LEGACY_TIERS) if (points >= tier.points) out = tier;
  return out;
}

/**
 * Latch the live total into the monotone high-water column.
 *
 * Deliberately NOT folded into legacyRank: src/modules/park/visit.ts calls that for
 * ANOTHER player's id, so a write there would mutate the row of a user who took no
 * action. Call this only on paths where the acting user owns the row.
 */
export function bumpLegacyBest(ctx: Ctx, userId: string): void {
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, userId)).get();
  if (!user) return;
  const best = Math.max(user.legacyRankBest, legacyPoints(ctx, userId));
  if (best === user.legacyRankBest) return;
  ctx.db.update(schema.users).set({ legacyRankBest: best })
    .where(eq(schema.users.discordId, userId)).run();
}
```

`eq` and `schema` are already imported at the top of this file.

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run tests/ranks.test.ts`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 5: Call the bump from the two owner paths**

In `src/modules/park/index.ts`, immediately before the `dashboardPayload` call at line 199, add:

```ts
        bumpLegacyBest(ctx, i.user.id);
```

In `src/modules/dex/embeds.ts`, immediately before the `legacyRank` call at line 51, add:

```ts
  bumpLegacyBest(ctx, userId);
```

Add `bumpLegacyBest` to each file's existing import from the ranks module.

**Do not touch `src/modules/park/visit.ts`.** It calls `legacyRank(ctx, targetUserId)` for a player who is not the viewer. It keeps working correctly and unchanged: it displays `max(stored, computed)` for the target, which is the right number, and writes nothing.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/modules/park/ranks.ts src/modules/park/index.ts src/modules/dex/embeds.ts tests/ranks.test.ts
git commit -m "feat: make an earned legacy rank permanent"
```

---

## Task 4: Documentation

**Files:**
- Modify: `docs/gameplay.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the final behaviour from Tasks 1–3.

- [ ] **Step 1: Make the gameplay promise accurate**

`docs/gameplay.md` says of Legacy rank: *"Nothing is spent or consumed to earn a rank, and nothing can ever be lost — it's simply recalculated from what you've already done, each time it's shown."* That is now structurally true rather than incidentally true. Append to that sentence:

```
The highest rank you have ever reached is also recorded, so a rank you have earned
stays yours even if the way points are counted changes in a later update.
```

- [ ] **Step 2: Document the Blood Moon guarantee**

In `docs/gameplay.md`'s world-event section, in Blood Moon's entry, add:

```
Enemies are tougher on a Blood Moon, but never unwinnable: a squad with the right
traits can still clear any boss in the campaign.
```

Do not quote win-rate percentages in player-facing docs — they are tuning figures, not player information.

- [ ] **Step 3: Update the repo CLAUDE.md**

Append to the battles bullet:

```
`tests/battle-balance.test.ts` asserts boss win rates under BOTH neutral mods and
Blood Moon (`enemyHp` 1.15, the only event that touches combat). Under an event only
the TRAITED floor (>=0.85) is asserted — requiring the untraited floor there too is
unsatisfiable without flattening the late campaign. Compensating a boss for an event
multiplier goes on `hpMult`, NEVER `atkMult`: cutting attack removes the threat and
lands neutral traited at 1.0000, breaching the finale ceiling and breaking the
monotone ladder, while cutting HP keeps the boss hitting as hard and shortens
exposure. HP is the exposure knob, attack is the threat knob. The two late bosses
must be re-tuned TOGETHER — the monotonicity assertion couples them, so fixing one
alone breaks the other. This retired the old "boss multipliers never fall below 1.0"
convention; Abyssal Trench's `hpMult` is 0.78 deliberately.
```

Append to the legacy-rank bullet:

```
`legacyRank` resolves `max(stored legacyRankBest, computed legacyPoints)`, never the
stored value alone — the column is a safety net, so a missed write is harmless and
only matters when the computed value DROPS. The write lives in a separate
`bumpLegacyBest(ctx, userId)` and must NEVER be folded into `legacyRank`, because
`src/modules/park/visit.ts` calls that for another player's id and would otherwise
mutate the row of a user who took no action.
```

- [ ] **Step 4: Sweep for stale claims**

Run: `rg -n "never fall below 1\.0|2\.15|1\.3" src/data/battle/chapters/ docs/ CLAUDE.md`

Read every hit. Any surviving statement that boss multipliers cannot fall below 1.0 must be gone or corrected — Task 1 retired that convention.

- [ ] **Step 5: Run the full gate**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: clean.

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add docs/gameplay.md CLAUDE.md
git commit -m "docs: record the event floor and rank persistence"
```

---

## Task 5: Verification

**Files:** none modified.

- [ ] **Step 1: Confirm the new guards fail on the defects they cover**

Temporarily set the Abyssal Trench boss `hpMult` back to `1.3` and run:

Run: `npx vitest run tests/battle-balance.test.ts -t 'under Blood Moon'`
Expected: FAIL on Abyssal Trench at ≈0.5000.

Revert, then temporarily make `legacyRank` return the computed value only and run:

Run: `npx vitest run tests/ranks.test.ts -t 'legacy rank persistence'`
Expected: FAIL on the stored-best case.

Revert both. A guard nobody has watched fail is not yet a guard.

- [ ] **Step 2: Full offline gate**

Run: `npm run typecheck` — clean. Run it FIRST; it is the only gate that sees test files.
Run: `npm test` — record the file and test totals. The pre-work baseline was 100 files / 1592 tests.
Run: `npm run build` — clean.
Run: `git status --short` — clean.

- [ ] **Step 3: Confirm the shipping shape**

Run: `git diff --stat <base>..HEAD`

Confirm no file under `assets/` changed, no `src/data/species/` file changed, and exactly one `.sql` file was added. This spec ships a migration but no content, no art and no emoji.

- [ ] **Step 4: Operator steps**

These touch the live bot and are the operator's to run, not this task's:

1. Back up the DB — **all three files**, `.db`, `-wal` and `-shm`. The WAL routinely dwarfs the `.db` here, so a `.db`-only copy loses committed data.
2. `npm run build`, then restart the single bot instance. Migration 0014 applies on boot. Exactly one process per token.
3. `npm run test:live`.

No `deploy-commands` — no builder changed. No `deploy-emojis` — no new emoji.

---

## Notes for the implementer

**The two late bosses are coupled.** If you find yourself changing one `hpMult` and re-running, expect the monotonicity assertion to fail on the other. That is the test working, not a flake — spec §4 has the worked example.

**If a measured win rate disagrees with this plan's table by more than ±0.02, stop and report.** Every figure here was measured against the real resolver. A disagreement means the harness is not modelling `service.ts` correctly, which is exactly the defect Task 1 exists to prevent — do not tune until the number matches.

**`legacyMaxPoints()` has zero callers in `src/`.** It exists for the test and the prose. Do not wire it into anything.
