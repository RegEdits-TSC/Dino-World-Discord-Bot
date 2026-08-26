# Variant Resolver (6b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the 80 variant image files that spec 6a banked and deliberately left unreferenced, so repeated surfaces stop always showing the same picture.

**Architecture:** `assetImage` gains an optional seed. Omitting it returns the base file — that default is the compatibility contract that keeps every unwired call site and every unaffected filename pin working untouched. With a seed, the pick hashes `kind:name:seed` through `hashSeed` then `mulberry32`, both existing repo primitives. Families are wired one at a time, each task carrying its own pin updates so no task leaves the suite red.

**Tech Stack:** TypeScript ESM (NodeNext), vitest, `@napi-rs/canvas` (only in tests).

## Global Constraints

- **Relative imports carry a `.js` extension.** ESM NodeNext, no exceptions.
- **Time is `ctx.now()`, randomness is `ctx.rng()`** — except variant selection, which is deliberately neither. It is a pure function of `(kind, name, seed)`. This is the one carve-out and it must be documented, not silently taken.
- **`npm run typecheck` is the gate**, not `npm run build` or `npm test`. `build` only covers `src`; `test` transpiles without typechecking.
- **Authorship:** commits authored by RegEdits. No AI/tool attribution anywhere — no `Co-Authored-By`, no "Generated with" footer, no mention of Claude/AI/assistant in any commit message, comment or document.
- **Never weaken a pin to make it pass.** Re-pointing an assertion at "whatever came back" makes it vacuous. Every updated pin asserts a specific filename for a specific seed.
- **No new asset files.** The bank is closed; generator access has ended.
- **The banner count in `prompts.md` stays 33.** `tests/docs-assets.test.ts` counts base banners only.

---

# Phase A — The resolver

## Task 1: Move `hashSeed` into core

`hashSeed` is module-private in `src/modules/daily/service.ts`, so `src/core/images.ts` cannot use it. It moves to `src/core/rolls.ts`, which already exports `mulberry32` and every other seeded-draw helper.

**This touches a live feature.** `rollDailyQuests` derives every player's daily board from this function. A changed hash silently rerolls boards in flight, and no existing test would notice. Pin the behaviour before moving it.

**Files:**
- Modify: `src/core/rolls.ts`
- Modify: `src/modules/daily/service.ts`
- Modify: `tests/rolls.test.ts`

**Interfaces:**
- Produces: `hashSeed(s: string): number` — exported from `src/core/rolls.ts`, FNV-1a 32-bit, returns an unsigned 32-bit integer.

- [ ] **Step 1: Confirm the pinned values still describe the live function**

The values in Step 2 were measured against the current private implementation at
`src/modules/daily/service.ts:16-20`. Re-derive them before trusting them — if the
function has changed since this plan was written, the pins must change with it:

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
node -e "
function hashSeed(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
for (const s of ['', 'a', 'eggs:common:42', '123456789012345678:2026-08-26', 'hatch:common-crack:42'])
  console.log(JSON.stringify(s), hashSeed(s));
"
```

Expected output, matching Step 2 exactly:

```
"" 2166136261
"a" 3826002220
"eggs:common:42" 2668734150
"123456789012345678:2026-08-26" 2511531462
"hatch:common-crack:42" 1946910649
```

Also read `src/modules/daily/service.ts:16-20` and confirm the reproduction above
is byte-for-byte the same algorithm. If it is not, the plan is stale — stop and
report rather than pinning values from a function that no longer exists.

- [ ] **Step 2: Write the failing test**

Append to `tests/rolls.test.ts`:

```ts
import { hashSeed } from '../src/core/rolls.js';

describe('hashSeed', () => {
  // Pinned BEFORE the function moved out of daily/service.ts, and measured from
  // that implementation rather than computed independently. rollDailyQuests
  // derives every player's daily board from this hash, so a changed value would
  // silently reroll boards in flight with nothing failing.
  it.each([
    ['', 2166136261],
    ['a', 3826002220],
    ['eggs:common:42', 2668734150],
    ['123456789012345678:2026-08-26', 2511531462],
    ['hatch:common-crack:42', 1946910649],
  ])('hashes %j to a pinned value', (input, expected) => {
    expect(hashSeed(input)).toBe(expected);
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['x', 'a longer string', 'banners:daily:99']) {
      const h = hashSeed(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/rolls.test.ts -t hashSeed`
Expected: FAIL — `hashSeed` is not exported from `src/core/rolls.js`.

- [ ] **Step 4: Move the function**

Cut `hashSeed` from `src/modules/daily/service.ts` and paste it into `src/core/rolls.ts` **verbatim** — do not retype it. Add `export`:

```ts
// FNV-1a, 32-bit. Turns an id-bearing string into a seed for mulberry32.
//
// Two callers with different reasons to care that this never changes:
// rollDailyQuests hashes `${userId}:${dayKey}` to derive a player's daily board,
// and assetImage hashes `${kind}:${name}:${seed}` to pick an art variant. A
// changed hash silently rerolls every board in flight and reshuffles every
// variant, with nothing failing. tests/rolls.test.ts pins known pairs.
//
// Never use the result modulo anything. FNV-1a's low bits carry less avalanche
// than a PRNG's, which is why every selection in this repo runs the hash through
// mulberry32 first and then Math.floor(rng() * n).
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
```

In `src/modules/daily/service.ts`, add the import (note the `.js` extension) and delete the local copy:

```ts
import { mulberry32, hashSeed, shuffle } from '../../core/rolls.js';
```

Check the existing import line first — `mulberry32` and `shuffle` may already be imported from there; extend it rather than adding a second import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/rolls.test.ts tests/daily.test.ts tests/daily-command.test.ts`
Expected: PASS. The daily tests are the real check — they exercise `rollDailyQuests`, which now calls the moved function.

- [ ] **Step 6: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: both green, no test count change beyond the new `hashSeed` cases.

- [ ] **Step 7: Commit**

```bash
git add src/core/rolls.ts src/modules/daily/service.ts tests/rolls.test.ts
git commit -m "Move hashSeed into core so the asset layer can use it"
```

---

## Task 2: The resolver

**Files:**
- Modify: `src/core/images.ts`
- Modify: `tests/images.test.ts`

**Interfaces:**
- Consumes: `hashSeed` and `mulberry32` from `src/core/rolls.js`.
- Produces: `assetImage(kind, name, seed?: string): ImageRef | null` — unchanged behaviour when `seed` is omitted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/images.test.ts`:

```ts
describe('variant selection', () => {
  // The compatibility contract. ~180 filename pins across the suite, and every
  // call site that never gains a seed, depend on this exact behaviour.
  it('returns the base file when no seed is given', () => {
    for (const rarity of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']) {
      expect(assetImage('eggs', rarity)!.file.name).toBe(`${rarity}.webp`);
    }
  });

  it('is deterministic — the same triple always resolves to the same file', () => {
    for (const seed of ['1', '42', 'abc']) {
      const first = assetImage('eggs', 'common', seed)!.file.name;
      for (let i = 0; i < 5; i++) {
        expect(assetImage('eggs', 'common', seed)!.file.name).toBe(first);
      }
    }
  });

  // A resolver that never returns the base, or never reaches -v4, is a real bug
  // that "it returned something" would miss entirely. eggs/common has 3 variants,
  // so all four faces must appear across enough seeds.
  it('reaches every face including the base', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(assetImage('eggs', 'common', String(i))!.file.name);
    expect([...seen].sort()).toEqual(
      ['common-v2.webp', 'common-v3.webp', 'common-v4.webp', 'common.webp'],
    );
  });

  // Why the hashed string is composite. eggs and hatch both ship 18 variants over
  // 6 bases, so a bare seed would pick the SAME index in both — egg #42 showing
  // common-v2 and then common-crack-v2. Including kind and name decorrelates them.
  // This is the property most likely to be silently lost in a refactor.
  it('decorrelates the same seed across kinds', () => {
    const eggIdx: string[] = [];
    const crackIdx: string[] = [];
    for (let i = 0; i < 200; i++) {
      eggIdx.push(assetImage('eggs', 'common', String(i))!.file.name.replace('common', ''));
      crackIdx.push(assetImage('hatch', 'common-crack', String(i))!.file.name.replace('common-crack', ''));
    }
    const agree = eggIdx.filter((v, i) => v === crackIdx[i]).length;
    // Independent picks over 4 faces agree ~25% of the time. Correlated picks
    // would agree on every single seed.
    expect(agree).toBeLessThan(120);
  });

  it('returns the base for a name with no variants, whatever the seed', () => {
    for (const seed of ['1', '2', '99', 'x']) {
      expect(assetImage('banners', 'help', seed)!.file.name).toBe('help.webp');
    }
  });

  it('returns null for a missing name even with a seed', () => {
    expect(assetImage('eggs', 'no-such-rarity', '42')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/images.test.ts -t "variant selection"`
Expected: FAIL — `assetImage` takes two arguments, so the third is a type error and the seeded cases return base files.

- [ ] **Step 3: Implement**

In `src/core/images.ts`, add the import and the variant machinery above `assetImage`:

```ts
import { hashSeed, mulberry32 } from './rolls.js';

// How many `<name>-vN.webp` siblings a base has. Counted from -v2 upward and
// stopped at the first gap, which is exactly the invariant
// tests/asset-variants.test.ts enforces: numbering starts at 2 and never skips.
// Cached per kind/name like present() caches existsSync — assets do not change
// at runtime.
const variantCounts = new Map<string, number>();

function variantCount(kind: string, name: string): number {
  const key = `${kind}/${name}`;
  let n = variantCounts.get(key);
  if (n === undefined) {
    n = 0;
    while (present(resolve(process.cwd(), 'assets/images', kind, `${name}-v${n + 2}.webp`))) n++;
    variantCounts.set(key, n);
  }
  return n;
}

// Picks which face of `name` a seed resolves to. Index 0 is the base file, so a
// base with no variants always returns itself and the seeded path agrees with the
// unseeded one wherever no variant exists.
//
// The hashed string is COMPOSITE — `kind:name:seed` — and that is load-bearing,
// not stylistic. eggs and hatch both ship 18 variants over 6 bases, so hashing a
// bare egg id would select the same index in both: egg #42 would show common-v2
// and then common-crack-v2, halving the variety for a consistency nobody can
// perceive. Same reasoning as WORLD_SALT (src/core/world.ts) and DEAL_SALT
// (src/modules/shop/service.ts), which exist to stop two features keying off one
// input from moving together.
//
// The hash goes through mulberry32 rather than `% (count + 1)`. No code in src/
// takes FNV-1a output modulo anything — its low bits carry less avalanche than a
// PRNG's, and every selection in this repo (pickBoard, rollSpeciesInRarity,
// dailyDeal) runs mulberry32 first.
function pickVariant(kind: string, name: string, seed: string): string {
  const count = variantCount(kind, name);
  if (count === 0) return name;
  const index = Math.floor(mulberry32(hashSeed(`${kind}:${name}:${seed}`))() * (count + 1));
  return index === 0 ? name : `${name}-v${index + 1}`;
}
```

Then widen `assetImage`. Keep the existing doc comment and add to it:

```ts
// `seed` is any string already in scope at the call site — an egg's row id, a
// viewer's Discord id. OMITTING IT RETURNS THE BASE FILE, and that default is a
// compatibility contract rather than a convenience: roughly 180 filename pins
// across the suite, and every call site that never gains a seed, rely on it.
export function assetImage(
  kind: 'eggs' | 'sites' | 'banners' | 'battles' | 'hatch' | 'dinos',
  name: string,
  seed?: string,
): ImageRef | null {
  const fileName = `${seed === undefined ? name : pickVariant(kind, name, seed)}.webp`;
  const abs = resolve(process.cwd(), 'assets/images', kind, fileName);
  if (!present(abs)) return null;
  return { file: new AttachmentBuilder(abs, { name: fileName }), url: `attachment://${fileName}` };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/images.test.ts`
Expected: PASS, including every pre-existing case — nothing in that file passes a seed.

- [ ] **Step 5: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: both fully green. No call site passes a seed yet, so nothing else can have moved.

- [ ] **Step 6: Commit**

```bash
git add src/core/images.ts tests/images.test.ts
git commit -m "Resolve art variants from a seed, defaulting to the base file"
```

---

# Phase B — Wiring, one family per task

Each task threads seeds into one family and updates that family's filename pins in the same commit, so the suite is green at every boundary.

**How to update a pin.** Run the code, see which variant the seed actually resolves to, and assert that exact filename. Never assert "some file" or read the value back from the code under test.

## Task 3: Eggs

**Files:**
- Modify: `src/core/notify.ts:78`, `src/modules/hatchery/index.ts:38`, `src/modules/hatchery/embeds.ts:27,83`, `src/modules/shop/index.ts:94`, `src/modules/genelab/embeds.ts:51-66`, `src/modules/genelab/index.ts:125`
- Modify: `tests/hatchery.test.ts`, `tests/shop.test.ts`, `tests/notify-handlers.test.ts`, `tests/journeys.test.ts`

**Interfaces:**
- Consumes: `assetImage(kind, name, seed?)` from Task 2.
- Produces: genelab's `claimPayload` gains an `eggId: number` field in its opts object.

- [ ] **Step 1: Thread the five zero-cost seeds**

Each of these already has the egg's row id in local scope. Add it as a third argument, stringified:

| File:line | Change |
|---|---|
| `src/core/notify.ts:78` | `assetImage('eggs', egg.rarity, String(egg.id))` |
| `src/modules/hatchery/index.ts:38` | `assetImage('eggs', egg.rarity, String(egg.id))` |
| `src/modules/hatchery/embeds.ts:27` | `assetImage('eggs', rarity, String(eggId))` |
| `src/modules/hatchery/embeds.ts:83` | `featured ? assetImage('eggs', featured.rarity, String(featured.id)) : null` |
| `src/modules/shop/index.ts:94` | `assetImage('eggs', egg.rarity, String(egg.id))` |

**Leave `src/modules/shop/index.ts:82` alone.** That is `/shop view`, which previews which rarities *can* be bought — no egg exists yet to have an identity. Seeding it from the viewer would make the preview and the egg actually bought show different pictures of the same rarity. Add a comment saying so:

```ts
// No seed: this previews what CAN be bought, so no egg exists yet to key on.
// Seeding from the viewer would make this preview disagree with the egg they buy.
attach(embed, payload, 'thumbnail', best ? assetImage('eggs', best) : null);
```

- [ ] **Step 2: Thread genelab's one-hop seed**

`claimPayload` takes an opts object with no id; its only caller has `egg.id` one frame up.

In `src/modules/genelab/embeds.ts`, add `eggId` to the opts type and use it:

```ts
export function claimPayload(opts: {
  rarity: string; traits: string[]; upgraded: boolean;
  speciesName: string | null; remaining: number; eggId: number;
}): Payload {
```

and at the `assetImage` call inside it:

```ts
attach(embed, payload, 'thumbnail', assetImage('eggs', opts.rarity, String(opts.eggId)));
```

In `src/modules/genelab/index.ts:125`, pass it — `egg` is already destructured on the line above:

```ts
await i.reply(claimPayload({ rarity: egg.rarity, /* ...existing fields... */, eggId: egg.id }));
```

- [ ] **Step 3: Find what each affected pin now resolves to**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot"
npx tsx -e "
import { assetImage } from './src/core/images.js';
for (const [rarity, id] of [['rare','1'],['common','1'],['epic','1'],['legendary','1'],['mythic','1'],['uncommon','1']])
  console.log(rarity, id, '->', assetImage('eggs', rarity, id)?.file.name);
"
```

Egg ids in tests are usually 1. Check each failing test's actual id before assuming.

- [ ] **Step 4: Run the affected tests and update each pin**

Run: `npx vitest run tests/hatchery.test.ts tests/shop.test.ts tests/notify-handlers.test.ts tests/journeys.test.ts`

For each failure, replace the expected filename with the one the seed genuinely resolves to, and add a short comment at the first updated pin in each file:

```ts
// Seeded on the egg's row id, so this is egg #1's face rather than the base.
// The variant is deterministic — the same id always resolves here.
expect(p.files!.map((f) => f.name)).toEqual(['common-v3.webp']);
```

- [ ] **Step 5: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: green. If a test outside the four files above fails, stop — it means a seed reached a path this task did not intend.

- [ ] **Step 6: Commit**

```bash
git add src/core src/modules tests
git commit -m "Seed egg art on the egg's own row id"
```

---

## Task 4: Hatch cracks

**Files:**
- Modify: `src/modules/hatchery/embeds.ts:30,49`, `src/modules/hatchery/index.ts` (the `hatch:crack` handler)
- Modify: `tests/hatchery.test.ts`, `tests/dino-image.test.ts`, `tests/species-art.test.ts`

**Interfaces:**
- Produces: `revealPayload(species: Species, eggId: number)` — signature widened.

- [ ] **Step 1: Widen `revealPayload`**

In `src/modules/hatchery/embeds.ts`:

```ts
// eggId seeds the crack art, so the shell that bursts is a face of the egg the
// player was looking at a second earlier. It is NOT the hatched dino's id: the
// egg is what cracks, and hatchEgg does not return the egg id anyway.
export function revealPayload(species: Species, eggId: number) {
```

and at line 49:

```ts
attach(embed, payload, 'image', assetImage('hatch', `${species.rarity}-crack`, String(eggId)));
```

- [ ] **Step 2: Pass it from the handler**

In `src/modules/hatchery/index.ts`'s `hatch:crack` component handler, the egg id is already parsed out of the customId (`hatch:crack:<eggId>`) into `idStr` before `hatchEgg` is called. Pass it:

```ts
await i.update(revealPayload(species, Number(idStr)));
```

Find the exact call site — it is the only `revealPayload(` call in `src/`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/hatchery.test.ts tests/dino-image.test.ts tests/species-art.test.ts`
Expected: FAIL — typecheck errors on `revealPayload(species)` calls in the tests, plus crack filename pins.

- [ ] **Step 4: Update the test call sites and pins**

Every `revealPayload(species)` in tests needs a second argument. Use a literal id and pin what it resolves to:

```bash
npx tsx -e "
import { assetImage } from './src/core/images.js';
for (const r of ['common','uncommon','rare','epic','legendary','mythic'])
  console.log(r, '->', assetImage('hatch', r + '-crack', '1')?.file.name);
"
```

Then update each pin to the real resolved name, with a comment at the first one per file explaining the seed.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add src/modules/hatchery tests
git commit -m "Seed the hatch reveal on the egg that cracked"
```

---

## Task 5: Banners

Ten banners have variants: `care`, `collect`, `dino_roster`, `eggs_incubator`, `shop_food_market`, `sell`, `gene_lab`, `battle_victory`, `battle_defeat`, `daily`. All seed on the **viewer's Discord user id**.

**Files:**
- Modify: `src/modules/care/index.ts`, `src/modules/park/index.ts`, `src/modules/park/embeds.ts`, `src/modules/park/alert-embeds.ts`, `src/modules/hatchery/embeds.ts:86`, `src/modules/shop/index.ts:83,103,160`, `src/modules/genelab/embeds.ts:33,47,63`, `src/modules/genelab/index.ts`, `src/modules/daily/embeds.ts:60,87`, `src/modules/daily/index.ts`, `src/modules/battles/embeds.ts:60`, `src/modules/battles/index.ts`, `src/core/notify.ts:95`
- Modify: the pin-bearing tests listed in Step 5

**Interfaces:**
- Produces: `fightFrames(outcome, includeSkipButton, userId: string)` — signature widened. `collectPayload(amount: number, userId: string)`. Daily's `claimPayload(result: ClaimResult, userId: string)`. Genelab's `statusPayload(rows, userId: string)`.

- [ ] **Step 1: Thread the sites where `userId` is already in scope**

These builders already take `userId` or sit in an `execute(ctx, i)` body where `i.user.id` is available. Add it as the third argument to the relevant `assetImage('banners', …)` call:

`carePayload` (care/index.ts) · `dinoListPayload` (park/index.ts) · `animalsPayload` (park/embeds.ts — use `user.discordId`) · `alertPayload` (park/alert-embeds.ts) · `eggListPayload` (hatchery/embeds.ts:86) · `/shop` view/food and `/sell` (shop/index.ts — `i.user.id`) · genelab `confirmPayload` (embeds.ts:33 — no userId; see Step 3) · daily `hubPayload` (daily/embeds.ts:60) · `breedingReadyHandler` (notify.ts:95 — `t.userId`).

- [ ] **Step 2: Widen `fightFrames` — the one real signature change**

`FightOutcome` carries no user id. `presentFight` has one a frame up, already using it for the skip and replay customIds.

In `src/modules/battles/embeds.ts`:

```ts
// userId seeds both the outcome banner and the chapter's site banner. It is not
// on FightOutcome because the fight itself does not care who is watching — the
// caller has it for the skip and replay customIds and passes it through.
export function fightFrames(outcome: FightOutcome, includeSkipButton: boolean, userId: string) {
```

Then at line 58 and 60:

```ts
const banner = assetImage('sites', `${stage.chapterId}-banner`, userId);
const outcomeBanner = assetImage('banners', outcome.won ? 'battle_victory' : 'battle_defeat', userId);
```

Update both call sites in `src/modules/battles/index.ts` — `presentFight` and the skip handler — to pass `userId`.

- [ ] **Step 3: Thread the three builders that need a new parameter**

Each is a pure display function whose caller has `i.user.id` in scope. Add a `userId: string` parameter and pass it at the call site:

- `collectPayload(amount: number, userId: string)` — `src/modules/park/index.ts`, called from the `park:collect` handler
- daily's `claimPayload(result: ClaimResult, userId: string)` — `src/modules/daily/embeds.ts:87`, called from `src/modules/daily/index.ts:54`
- genelab's `statusPayload(rows, userId: string)` — `src/modules/genelab/embeds.ts:47`, called from `src/modules/genelab/index.ts:112`

Genelab's `confirmPayload` already has `opts.aId`/`opts.bId` but no user id; add `userId` to its opts type for consistency with the other two, since its caller has `i.user.id`.

Genelab's `claimPayload` gained `eggId` in Task 3 — add `userId` alongside it for the `gene_lab` banner, keeping `eggId` for the egg thumbnail. Two seeds in one builder is correct: they key different things.

- [ ] **Step 4: Find what each pin resolves to**

```bash
npx tsx -e "
import { assetImage } from './src/core/images.js';
const ids = ['u1','user-1','123456789012345678'];
for (const b of ['care','collect','dino_roster','eggs_incubator','shop_food_market','sell','gene_lab','battle_victory','battle_defeat','daily'])
  for (const u of ids) console.log(b, u, '->', assetImage('banners', b, u)?.file.name);
"
```

Use each test's actual user id — they vary. `tests/harness.ts`'s `makeCtx` and the `fakeCommand` fixtures define them.

- [ ] **Step 5: Update the pins**

Affected files, with their pin counts on variant-bearing banner bases:

`tests/care.test.ts` (4) · `tests/dinos.test.ts` (5) · `tests/daily-command.test.ts` (2) · `tests/battles-embeds.test.ts` (several) · `tests/battles-module.test.ts` (1) · `tests/alert-embeds.test.ts` (1) · `tests/shop.test.ts` · `tests/hatchery.test.ts` · `tests/park.test.ts` (1) · `tests/park-tabs.test.ts` (1) · `tests/showcase.test.ts` (2) · `tests/dino-image.test.ts` (2) · `tests/journeys.test.ts` (2) · `tests/notify-handlers.test.ts`

Work file by file. Run one, fix its pins, move on — do not batch, or a failure in one file will mask a real regression in another.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add src tests
git commit -m "Seed banner art on the viewer, so each player gets a stable face"
```

---

## Task 6: Site banners

Seven site banners have variants. Both remaining call paths already have a user id; `fightFrames` was handled in Task 5.

**Files:**
- Modify: `src/core/notify.ts:113`, `src/modules/expeditions/index.ts:121`
- Modify: `tests/expeditions.test.ts`, `tests/notify-handlers.test.ts`

- [ ] **Step 1: Thread both seeds**

`src/core/notify.ts:113` — `t.userId` is in scope:

```ts
attach(embed, payload, 'image', assetImage('sites', `${exp.siteId}-banner`, t.userId));
```

`src/modules/expeditions/index.ts:121` — inside `execute(ctx, i)`:

```ts
attach(embed, payload, 'image', assetImage('sites', `${site.id}-banner`, i.user.id));
```

**Leave the `-thumb` calls alone.** No site thumb has variants, so a seed would be inert — and adding one implies a variety that does not exist.

- [ ] **Step 2: Run, resolve, update pins**

Run: `npx vitest run tests/expeditions.test.ts tests/notify-handlers.test.ts`

Resolve each expected name:

```bash
npx tsx -e "
import { assetImage } from './src/core/images.js';
for (const s of ['coastal_dig','amber_ridge','frozen_cliffs','volcano_core','abyssal_trench','containment_site','founders_park'])
  console.log(s, '->', assetImage('sites', s + '-banner', 'u1')?.file.name);
"
```

- [ ] **Step 3: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add src tests
git commit -m "Seed expedition site banners on the viewer"
```

---

# Phase C — Documentation

## Task 7: Record the resolver and its one carve-out

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/assets/prompts.md`

- [ ] **Step 1: Add the resolver bullet to `CLAUDE.md`**

Place it beside the existing `assetImage`/`attach` bullet:

```markdown
- Art variants resolve through `assetImage(kind, name, seed?)` (`src/core/images.ts`).
  **Omitting the seed returns the base file**, and that default is a compatibility
  contract rather than a convenience — roughly 180 filename pins across the suite
  rely on it, as does every call site that never gains a seed. With a seed, the
  pick is `mulberry32(hashSeed(`${kind}:${name}:${seed}`))` scaled over the
  variant count plus one, so index 0 is always the base.
  The hashed string is **composite on purpose**: `eggs` and `hatch` both ship 18
  variants over 6 bases, so hashing a bare egg id would select the same index in
  both — egg #42 showing `common-v2` and then `common-crack-v2` — halving the
  variety for a consistency nobody can perceive. Same reasoning as `WORLD_SALT`
  and `DEAL_SALT`. **Never take `hashSeed` modulo anything**: FNV-1a's low bits
  carry less avalanche than a PRNG's, which is why every selection in this repo
  runs it through `mulberry32` first.
  Seeds by family: **eggs and hatch on the egg's row id** (one egg keeps one
  identity from purchase to reveal), **banners and site banners on the viewer's
  Discord id** (a stable face per player per surface). `/shop view` deliberately
  takes no seed — it previews rarities before any egg exists, so seeding it from
  the viewer would make the preview disagree with the egg they buy.
  This is the ONE deliberate exception to "randomness comes from `ctx.rng()`":
  variant choice is a pure function of ids already in scope, so it needs no clock,
  no rng and no `ctx` threaded into a dozen pure display builders.
```

- [ ] **Step 2: Note in `prompts.md` that variants are now live**

The "Art variants" section states variants are unreferenced from `src/` until the resolver ships. That is now false. Update it to say the resolver is live, name `assetImage`'s seed parameter, and keep the guard description — `tests/asset-variants.test.ts` still proves every variant has a base, and the resolver now *depends* on that plus the no-gaps rule, since a gap would make an index unreachable.

- [ ] **Step 3: Verify the docs guard**

Run: `npx vitest run tests/docs-assets.test.ts`
Expected: PASS. The banner count must still read 33 — a variant is another face of a banner, not a new banner.

- [ ] **Step 4: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add CLAUDE.md docs/assets/prompts.md
git commit -m "Document the variant resolver and its deliberate rng carve-out"
```

---

## Self-Review Notes

**Spec coverage.** §1's resolver is Tasks 1–2. §2's seeds are Tasks 3–6, one family each, including all three signature changes (`revealPayload` in Task 4, `fightFrames` and the three pure builders in Task 5, genelab's `claimPayload` in Task 3). §3's guards are verified in Task 7 Step 3 and by the full-suite run ending every task. §4's six test properties are all in Task 2 Step 1 except the `hashSeed` pin, which is Task 1 Step 2. Deliverables 1–6 map to Tasks 1, 2, 1, 3–6, 2–6, 7.

**Ordering constraints.** Task 1 before Task 2 (`images.ts` imports `hashSeed`). Task 2 before Tasks 3–6 (nothing can pass a seed until the parameter exists). Task 3 before Task 5 for genelab's `claimPayload`, which gains `eggId` then `userId` — two seeds keying different things in one builder.

**Every task ends green.** Unlike 6a's Task 8, no task here commits a deliberately failing assertion: each family's pin updates ship in the same commit as its wiring.
