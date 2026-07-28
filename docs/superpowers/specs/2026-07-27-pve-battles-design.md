# PvE Battles — Biome Campaign Design

**Date:** 2026-07-27
**Status:** Approved for planning

## Summary

A PvE battle campaign for Dino World: 4 chapters themed to the existing
expedition sites, 5 stages each (the 5th is a chapter boss), fought with
squads of 1–3 dinos. Fights auto-resolve deterministically from
`ctx.rng()` and play back as a 4-frame cinematic embed edited in place
over ~8 seconds with a Skip button. Progression is per-dino battle XP
plus per-stage 0–3 star ratings; attempts are gated by a regenerating
energy pool. Rewards use existing currencies (cash/food/XP; shards on
first clears; a high-rarity egg on each boss first-clear). Campaign
content is pure declarative data validated by tests, so future chapters
ship as data-only PRs with zero engine changes.

Architecture direction: content-pipeline (chapters as data files gated
by a content-validation test) with a pure, Ctx-free battle resolver as
the engine boundary.

## Goals

- Add a repeatable, energy-gated PvE loop that exercises the collection
  (rarity/archetype squad building) and care (escaped dinos can't fight)
  systems.
- Keep every persistence decision on a verified in-repo precedent
  (shards window → energy; ratingHighWater/progression.ts → battleXp +
  derived level; claimExpedition one-txn → fight commit; buyMythicEgg /
  expedition egg inserts → boss egg).
- Make future content drops data-only: new chapter = one data file + an
  index import + art PNGs + prompts.md rows, with a content test as the
  gate.

## Non-goals (v1)

- PvP, endless ladder, interactive turn-based mode.
- Abilities, status effects, boss gimmicks beyond stat multipliers.
- Battle level feeding park rating (parallel track only).
- Full-energy notification / any scheduler involvement.
- Persisted battle history/transcripts.
- New emoji work.

## Data model (all additive; migration 0002)

- `users` gains `energy: integer('energy').notNull().default(10)` and
  `energyUpdatedAt: integer('energy_updated_at_ms').notNull().default(0)`,
  plus `check('energy_nonneg', energy >= 0)` beside the existing
  cash/shards checks.
- `dinos` gains `battleXp: integer('battle_xp').notNull().default(0)`.
  XP only — level is always derived by pure `battleLevel(xp)`; no stored
  level column to drift (ratingHighWater precedent).
- New table `battle_progress`:
  `userId` (FK → users.discordId), `stageId`, `stars` (0–3, CHECK),
  `firstClearedAt` (nullable ms), `attempts` (default 0);
  `primaryKey(userId, stageId)`.
- No boss column anywhere: the boss is the chapter's last stage.
  "Chapter N+1 unlocked" ⇔ chapter N's boss stage row has
  `firstClearedAt` — AND-ed with the site's existing `unlockRating`
  high-water gate so campaign pacing tracks the rest of the game.
- `eggs.source` enum widens to `['expedition','shop','trade','admin','battle']`.
  TypeScript-only — the generated DDL has no CHECK on `source`; verify
  `drizzle-kit generate` emits nothing for it.
- Admin integration (silently breaks otherwise; both get regression
  tests): `adminFastForward` shifts `energyUpdatedAt` backward with the
  other time columns; `adminReset` restores `energy = 10`,
  `energyUpdatedAt = ctx.now()` and deletes the user's
  `battle_progress` rows.
- Migration test extends the populated-DB "production path" block:
  seed parent + child rows, run the real `migrateDb` (repo FK gotcha
  rule, even though this migration is additive).

## Stats and combat

### One stat function for both sides

`statsFor(speciesId, level)` → `{hp, atk, def, spd}` =
`BATTLE_BASE[rarity][stat] × ARCHETYPES[archetype][stat] × (1 + 0.08·(level−1))`,
floored.

- `BATTLE_BASE: Record<Rarity, BattleStats>` lives in
  `src/data/battle/stats.ts` — a new table, never widening
  `RarityStats` (tests/data.test.ts pins `RARITY` with `toEqual`).
  Scaling ≈ ×1.45 per rarity tier (e.g. common `{hp 60, atk 12, def 6,
  spd 10}`); exact numbers are balance surface tuned during
  implementation.
- `archetype: 'bruiser' | 'tank' | 'swift' | 'support'` becomes a
  **required** field on the `Species` interface — tsc enforces all 30
  species files. Assignments hand-curated thematically (raptors swift,
  ceratopsians/ankylosaurs tank, large theropods bruiser, hadrosaurs
  support…). Multipliers (tunable):
  bruiser `{hp 1.0, atk 1.3, def 0.85, spd 1.0}`,
  tank `{hp 1.35, atk 0.8, def 1.4, spd 0.75}`,
  swift `{hp 0.85, atk 1.1, def 0.85, spd 1.45}`,
  support `{hp 1.0, atk 0.85, def 1.0, spd 1.1}`.
- NPCs are only `{speciesId, npcLevel}` and get stats through the
  identical `statsFor` — no hand-written NPC stat blocks ever; one
  balance retune propagates to every authored stage. Bosses apply
  data-declared `hpMult`/`atkMult`/`levelBonus` on top.

### Resolution

`resolveBattle(squad: Combatant[], npcs: Combatant[], rng): BattleResult`
— pure, synchronous, Ctx-free, deterministic given the rng stream.

- Initiative: spd descending; ties stable by side-then-index.
- Targeting: attack the lowest-HP living enemy (deterministic
  focus-fire; rng surface stays small).
- Damage: `max(1, round(atk × (0.85 + 0.30·rng()) − def × 0.5))`;
  10% crit chance ×1.5 via rng.
- Support archetype: after attacking, heals the lowest-HP living ally
  for 25% of damage dealt.
- Hard cap 30 rounds; exhaustion = player loss.
- Stars — pure `starsFor(result)`: 3★ = win with zero squad KOs;
  2★ = win with ≤1 KO or within 12 rounds; 1★ = any other win;
  0 = loss.
- `BattleResult` carries a structured event log chunked into
  presentation beats, plus per-dino survival for the star line.

## Energy

- Constants in `src/data/battle/constants.ts`: `ENERGY_CAP = 10`,
  `ENERGY_REGEN_MS = 10 min` (full refill 100 min).
- Lazy settle copied from the shards-window pattern (`sellDino`):
  settle in locals — `ticks = floor((now − updatedAt) / REGEN_MS)`,
  `energy = min(CAP, energy + ticks)`, `updatedAt += ticks × REGEN_MS`
  (preserves fractional progress), snap `updatedAt = now` at cap (no
  banked overflow) — then persist settled values minus the stage's
  `energyCost` inside the fight transaction.
- Stage costs are content data validated to 1..3 (1 normal, 2
  late-chapter, 3 boss).
- Insufficient energy → ephemeral `BattleError` with a `<t:…:R>`
  next-energy countdown.
- Display is read-only compute (previewSell precedent):
  `⚡ 7/10 · +1 in 6m` in `/battle chapters` footer and frame F4.

## XP and levels

- `battleLevel(xp)` over an exported cumulative threshold array in
  `stats.ts`; cap level 10. Level scales all four stats +8%/level
  (max +72% at cap — below one rarity tier, rarity stays king).
- Win XP = stage base × `[1.0, 1.25, 1.5]` by stars, split evenly
  across the squad (remainder to slot 1); losses pay 25% consolation.
- Written with plain `ctx.db.update` inside the fight transaction —
  XP is not wallet currency (hunger-write precedent).
- Battle level does not feed park rating in v1; no `recomputeRating`
  obligation on XP grants.

## Fight flow and rewards (commit-before-present)

Execute order: `getOrCreateUser` → `settleEscapes` (escaped dinos can't
fight) → validate stage/chapter gates + squad ownership → settle energy
in locals → `resolveBattle` → **ONE `ctx.db.transaction`**:

1. Persist settled energy − cost.
2. On win: one `ctx.economy.apply(userId, {cash, foods, shards},
   'battle:<stageId>', now)` — cash/food scaled ×`[1.0, 1.25, 1.5]` by
   stars; **shards only when this run sets `firstClearedAt`** (never on
   repeats — no faucet beside `SHARD_DAILY_CAP`; self-capping by content
   volume).
3. `battle_progress` upsert: `stars = max(old, new)`, `attempts + 1`,
   `firstClearedAt = old ?? now`.
4. `battleXp` increments per squad member.
5. Boss first-clear only: insert egg `{rarity: boss.eggRarity,
   speciesId: boss.eggSpeciesId (string | null per boss — pinned trophy
   or roll-at-hatch), source: 'battle'}`.

Losses commit energy + consolation XP only. `economy.apply`'s nested
transaction composes with the outer one (better-sqlite3 savepoints —
the exact `sellDino` shape). `recomputeRating` is not called: rewards
touch no rating inputs; a hatched boss egg triggers it later through
the existing hatch path.

## Cinematic presenter

All state committed **before** any Discord I/O; then:

- `await i.deferReply()` → 4 frames via `editReply`, ~2.5 s beats
  (~8 s total): F1 matchup card + chapter banner, F2 mid-fight
  highlights (biggest hits/crits/heals), F3 climax (KOs, final blow;
  boss portrait thumbnail on boss stages), F4 result — win/loss, ★
  line, itemized rewards, energy remaining.
- New `ctx.sleep(ms): Promise<void>` on `Ctx` — real `setTimeout` in
  `src/index.ts`, instant-resolve stub in `makeCtx` and
  `scripts/test-live.ts` (3 construction sites).
- Skip: frames 1–3 carry one owner-locked button
  `battle:skip:<userId>:<presentationId>` (in-process counter). The
  handler owner-checks, `i.update()`s straight to F4, and flags a
  module-level `Map<presentationId, {final, skipped}>`; the frame loop
  checks the flag before each edit and bails. Map entry deleted in
  `finally`. Safe only under the standing one-bot-instance-per-token
  rule.
- F4 carries `battle:again:<userId>:<stageId>` — re-fight shortcut that
  re-runs the full fight path (including energy check) on the same
  message via `deferUpdate`.
- Failure fallback: the frame loop is try/caught — an `editReply`
  failure or restart mid-broadcast loses animation frames only, never
  state. Frame payload files attach on the first `editReply` only.
- 4 PATCHes / 8 s is well under the ~5/5 s webhook bucket; interaction
  tokens live 15 min.

## Command surface

One new module `battles` (fresh component prefix `battle`), one slash
command `/battle` (commands 19→20, modules 10→11):

- `/battle chapters` — campaign overview, one chapter per page,
  owner-locked nav buttons `battle:chapter:<userId>:<index>`, per-stage
  unicode ★ line, energy footer.
- `/battle fight stage:<autocomplete, required> dino1:<autocomplete,
  required> [dino2] [dino3]` — squad 1–3; the NPC side is the first N
  of the stage's authored 3-enemy roster (authored weakest-first).

Autocomplete (repo provider contract): stage provider is read-only,
guards on the user row existing (no row creation on keystrokes), lists
unlocked stages ranked playable-first, unicode-only labels like
`⭐⭐ Coastal Dig 3 — Shorebreak (⚡1)`; dino providers guard the row
before `settleEscapes` (it crashes for unknown users), exclude escaped
dinos, label `Lv.4 Rexy (tank)`. No `emojiTag` in labels; no
`setEmoji` anywhere in the module. All autocompleting options
registered in `contract.test.ts`; `HELP_TOPICS` gains a `battles`
topic.

## Content format

Content lives only in `src/data/battle/`:

- `constants.ts` — energy + star multipliers.
- `stats.ts` — `BATTLE_BASE`, `ARCHETYPES`, level thresholds,
  `statsFor`, `battleLevel`.
- `chapters/` — one file per chapter (`coastal_dig.ts` …
  `volcano_core.ts`) + `index.ts` exporting ordered
  `CAMPAIGN: ChapterDef[]` and a `STAGES` map (mirrors
  `species/index.ts`).

Shapes:

```ts
interface ChapterDef {
  id: string;      // MUST equal an EXPEDITION_SITES key — this single
                   // invariant derives the banner asset, the
                   // unlockRating co-gate, and the theme
  name: string;
  stages: StageDef[];   // 5, last is the boss
}
interface StageDef {
  id: string;           // `${chapterId}_${n}` or `${chapterId}_boss`
  name: string;
  energyCost: 1 | 2 | 3;
  npcLevel: number;
  enemies: [{ speciesId }, { speciesId }, { speciesId }]; // weakest-first
  rewards: { cash: number; food?: { foodId: FoodId; qty: number }; xp: number }; // 1★ base
  firstClearShards: number;
  boss?: BossDef;
}
interface BossDef {
  bossId: string;       // derives battles/<bossId>-portrait.png
  title: string;
  speciesId: string;
  levelBonus: number;
  hpMult: number;       // typically ~2.5
  atkMult: number;      // typically ~1.2
  eggRarity: Rarity;
  eggSpeciesId: string | null;  // pinned trophy or roll-at-hatch
}
```

4 chapters keyed to the 4 expedition sites in `unlockRating` order:
coastal_dig → amber_ridge → frozen_cliffs → volcano_core; 20 stages
total; boss eggs ramp rare → epic → legendary → legendary by chapter
(no mythic egg from battles — it would undercut the 500-shard mythic
purchase; the final boss may pin a thematic legendary species instead). NPC rosters are
hand-authored (verified: species `biomeTags` cannot cover
frozen_cliffs/amber_ridge, so derivation is impossible) — authors pick
*who*, never *how strong* beyond `npcLevel`.

Gating is pure functions beside the data: `stageUnlocked` (previous
stage stars ≥ 1), `chapterUnlocked` (prior chapter's boss
`firstClearedAt` AND `siteUnlocked(site.unlockRating, highWater)`).
Chapter 1 stage 1 open to everyone.

`tests/battle-content.test.ts` machine-gates every content invariant:
chapter ids ⊆ site keys; stage ids globally unique and prefix-correct;
boss last and exactly one per chapter; every speciesId/foodId exists;
enemies length 3; energyCost 1..3; npcLevel ≤ level cap; rewards and
shards monotonically nondecreasing across chapter order; total campaign
shards sanity-bounded vs the mythic price; **every bossId has a
matching entry in docs/assets/prompts.md** (string-contains check keeps
art docs in lockstep). Adding chapter 5 = new data file + index import
+ PNGs + prompt rows; engine and module untouched.

## Art integration (Higgsfield)

- Chapter banners: free on day one — reuse existing
  `assetImage('sites', '<chapterId>-banner')` (1536×1024, all 4 exist);
  legal because the content test enforces `chapterId === siteId`.
- Boss portraits: widen the `assetImage` kind union to
  `'eggs' | 'sites' | 'banners' | 'battles'`, new
  `assets/images/battles/` directory, `<bossId>-portrait.png`
  1024×1024 transparent, used as `setThumbnail` on F3/F4 of boss
  stages. Null-degrade everywhere — the campaign ships fully playable
  with zero battle art.
- `docs/assets/prompts.md` gains a "Battle bosses" section following
  the existing structure: file-target table, shared glossy-cartoon
  style block, the hard no-glow transparency rule verbatim, and the
  reference-chain workflow so the 4 portraits read as a set. Portraits
  generated on Higgsfield after merge, dropped in as a pure asset
  commit.

## Testing

1. **Unit (pure):** `statsFor` monotonic in rarity/level, archetype
   multipliers; `battleLevel` threshold-exact + cap; resolver
   determinism (same mulberry32 seed → identical result), star
   boundaries (0-KO, round-12, timeout-loss), support-heal and crit
   arms; energy settle math (fractional-tick preservation, cap snap).
2. **Content:** `battle-content.test.ts` per above — the gate for
   future data-only PRs. `roster.test.ts` gains archetype validity
   across all 30 species.
3. **Service (makeCtx):** fight commits atomically; first-clear shards
   paid exactly once; star upsert takes max; boss egg source
   `'battle'`; insufficient-energy throws with no writes; loss pays
   consolation XP only; `adminFastForward`/`adminReset` energy
   regressions; populated-DB migration test (parent + child rows, real
   `migrateDb`).
4. **Harness:** `/battle fight` with zero-delay `ctx.sleep` — exactly 4
   `editReply` frames, all payloads auto-validated against Discord
   limits, F4 skipless; skip button owner-lock rejection + mid-loop
   short-circuit; autocomplete providers (unknown user → empty, escaped
   dino excluded, unicode labels).
5. **Journey:** grant eggs → hatch squad → `/battle chapters` (ch.2
   locked) → clear ch.1 to boss → boss egg arrives → ch.2 unlocked →
   drain energy to `BattleError` → `setNow(+100 min)` → full again.
6. **Registration counts:** `registry-load.test.ts` (modules 10→11,
   commands 19→20), `config.test.ts` modules object,
   `contract.test.ts` autocomplete map, help topic.
7. **Live gallery:** `scripts/test-live.ts` gains cases posting all 4
   cinematic frames, the chapters embed, and a boss frame to
   `TEST_CHANNEL_ID` (REST-only).

## Rollout

1. Schema edits → `drizzle-kit generate` → inspect migration 0002:
   pure ALTER/CREATE only; confirm the `eggs.source` widening emits
   nothing (if a table-recreate ever appears, the populated-DB FK
   protocol applies).
2. Data layer: `archetype` on `Species` + 30 species edits +
   `src/data/battle/*` + content/stat/roster tests.
3. Resolver + unit tests (pure, lands before any Discord surface).
4. Module (`index`/`service`/`embeds`) + `ctx.sleep` in
   `core/context.ts` + `makeCtx` stub + `assetImage` kind + admin
   service columns.
5. Registration checklist: `modules.json`, `ALL_MODULES`,
   registry-load/config count bumps, `contract.test.ts`,
   `HELP_TOPICS`.
6. Full offline suite green.
7. Docs same change: README command table, repo CLAUDE.md notes
   (`ctx.sleep` contract, commit-before-present invariant,
   `chapterId === siteId` invariant), prompts.md boss section.
8. Operator: `npm run deploy-commands` once, restart the single bot
   instance (migration auto-applies on boot), `npm run test:live`
   frame-gallery pass.
9. Art trails at leisure: 4 boss portraits via Higgsfield into
   `assets/images/battles/`.

## Known risks (accepted)

- Deterministic focus-fire + fixed rosters → fights against the same
  stage feel samey once outstatted; replay value rests on the reward
  loop, not tactics. Accepted for v1; interactive mode is a possible
  future round.
- 20 hand-authored stages × npcLevel × star thresholds is untested
  balance surface; the deterministic resolver enables an offline
  balance-sim pass against real squad stats before ship, and repeat
  rewards must be spreadsheet-checked against expedition cash/hr.
- Boss identity caps at stat multipliers; the first gimmick-boss
  request breaks the zero-engine-change promise.
- In-memory skip state and presentation counter are single-instance
  only (existing repo invariant) and evaporate on restart mid-cinematic
  (dead button, cosmetic only).
- `ctx.sleep` is a cross-cutting Ctx change (3 construction sites
  today; every future Ctx consumer must provide it).
- The squad-scaling slice (first N of 3 enemies) makes small squads
  cheaper per energy unless rosters are ordered carefully — authoring
  convention, only partially machine-checkable.
