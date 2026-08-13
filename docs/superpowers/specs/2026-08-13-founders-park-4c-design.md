# Spec 4c — Founder's Park: the campaign finale

Adds battle chapter 7 and expedition site 7, both keyed `founders_park`. Closes the
campaign at seven chapters, introduces the first star-gated chapter and the first mythic
boss egg, and tightens the two balance guards 4b shipped.

No schema change, no migration, no new species, no new command.

---

## 1. What this ships

| | |
|---|---|
| Battle chapter 7 | `founders_park`, "Founder's Park", 5 stages, boss **The Last Asset** (Ultimasaurus) |
| Expedition site 7 | `founders_park`, `unlockRating` 1000, 48 h, 300,000 |
| New gate kind | `ChapterDef.starGate` — chapter 7 opens on **75 campaign stars**, not park rating |
| First mythic boss egg | `eggRarity: 'mythic'`, `eggSpeciesId: 'ultimasaurus'` |
| Balance guards | ladder tolerance 0.03 → 0.01; finale pin becomes a two-sided change detector; chapter 6 gets its own pin |
| Derived, free | campaign stars 90 → 105, legacy ceiling 190 → 205, campaign shards 177 → 222 |

Theme: chapter 6 was the lab's hybrids loose inside the lab. Chapter 7 is the **original
park** — the one everything escaped *from* — with its own headline attractions gone feral
and the lab's last asset at the centre. The chapter escalates on theme and reward, not on
difficulty; the wall is the gate, not the fight.

---

## 2. Gating

`ChapterDef` gains one optional field:

```ts
export interface ChapterDef {
  id: string; name: string; tagline: string; stages: StageDef[];
  starGate?: number;   // absolute campaign-star total; replaces the rating co-gate
}
```

`chapterUnlocked` keeps its `(chapterId, progress, ratingHighWater)` signature — `progress`
already carries every stage's stars, so the sum is derivable in place:

```ts
export function chapterUnlocked(chapterId: string, progress: ProgressMap, ratingHighWater: number): boolean {
  const idx = CAMPAIGN.findIndex((c) => c.id === chapterId);
  if (idx < 0) return false;
  if (idx === 0) return true;
  const chapter = CAMPAIGN[idx];
  const prior = CAMPAIGN[idx - 1];
  const priorBoss = prior.stages[prior.stages.length - 1];
  if ((progress.get(priorBoss.id)?.firstClearedAt ?? null) === null) return false;
  if (chapter.starGate != null) {
    const stars = [...progress.values()].reduce((s, p) => s + p.stars, 0);
    return stars >= chapter.starGate;
  }
  return siteUnlocked(EXPEDITION_SITES[chapterId].unlockRating, ratingHighWater);
}
```

`founders_park` sets `starGate: 75`. No other chapter sets it, so all six shipped chapters
are byte-identical in behaviour. The prior-boss-first-clear requirement is unchanged and
still ANDed in: Founder's Park needs Asset 47 cleared **and** 75 stars.

**Why 75 and not 90 — or 80.** The campaign's 90 stars are not all achievable. `starsFor`
(`src/data/battle/resolve.ts:110-114`) awards the third star only for `squadKos === 0`, and
three bosses — Volcano Core, Abyssal Trench, Containment Site — never produce a flawless win
in 3,000 seeds against a level-capped legendary squad. Measured best-achievable, best of the
four combat traits:

```
Coastal Dig  15 | Amber Ridge 15 | Frozen Cliffs 15 | Volcano Core 14
Abyssal Trench 14 | Containment Site 14        MAX ACHIEVABLE = 87 / 90
```

Three further stages 3-star only at sub-1% rates (`abyssal_trench_3` and `_4` at ~0.17%,
`containment_site_3` at ~36%), so the **no-grind floor is 81**. The 4b session's provisional
80 clears that by exactly one star: any future retune costing a single currently-deterministic
3-star would drop the margin to zero, and two would make the finale reachable only by grinding
a 0.17% stage — with no test failing. 75 leaves six stars of margin instead of one.

> **Correction (post-implementation):** 87/90 above is this design phase's own 3,000-seed
> figure. The shipped reachability test (`tests/battle-balance.test.ts`) simulates at 400
> seeds instead and computes achievable as **85**, not 87 — deliberately: two of the stages
> this section calls sub-1% (`abyssal_trench_3`/`_4`) actually measure at 0.058% each, close
> enough to a coin flip across the smaller sample (400 seeds x 4 traits) that it misses both.
> 75 still clears comfortably either way. See that file's own comment for the exact figures;
> treat 87 throughout this document as superseded by the shipped 85.

75 also defuses a soft paywall. A mythic squad reaches 90/90 trivially (3,000/3,000 on every
stage), so a gate pressed against the legendary ceiling is one that a 500-shard purchase
quietly trivialises — the exact "*a boss that only a triple-mythic roster can beat is a
paywall, not a fight*" concern `tests/battle-balance.test.ts:10-12` opens with, and it would
be attached here to a chapter whose own reward is a mythic egg.

**Why the star sum is over the whole map, not chapters 1–6.** `progress` holds only rows
the player actually has, and chapter 7's own stages are unreachable until it unlocks, so
the two scopes are identical at the moment the gate is evaluated. Summing the whole map is
the simpler expression and stays correct when chapter 8 ships.

**Why the gate is absolute and must stay absolute.** 75 of the 90 stars nominally available
in chapters 1–6. Chapter 7 adds 15 more, taking the campaign to 105. The gate must never be
re-expressed as a fraction of the total — that would silently re-tighten on existing players
every time a chapter ships, the same failure mode `COLLECTION_TARGET` is frozen to avoid.

**Why the chapter is not gated on rating.** Rating's comfort term averages over *assigned*
dinos only (`recomputeRating`, `src/modules/park/rating.ts`), so unassigning all but one
well-kept dino sets that term to 1.0. A rating gate on the campaign finale is therefore
bypassable by inventory shuffling. Stars are not: they are earned per stage and monotone.

**Why the site keeps a rating gate anyway.** The split is deliberate. A player who never
battles still gets the expedition; a player who battles hard with a modest park still gets
the chapter. See §4 for what the site's gate actually costs.

### Rendering a locked star-gated chapter

`chaptersPayload` (`src/modules/battles/embeds.ts:169-170`) currently emits one hardcoded
sentence for every locked chapter, with no number:

> 🔒 Locked — beat the previous chapter's boss and raise your park rating.

Both halves of that sentence are actively wrong for a star-gated chapter. The player has
already beaten the previous boss — that is a precondition of even reaching this state — and
raising park rating does nothing at all. The one surface that explains the lock currently
tells the reader to do the only thing that cannot unlock it.

It becomes gate-kind aware. For a star-gated chapter it must render the player's own
progress against the gate — `58/75 campaign stars` — sourced from
`[...view.progress.values()].reduce((s, p) => s + p.stars, 0)`. `ChaptersView.progress` is
already in scope at `:161`; nothing needs threading.

Both the gate check and the rendered copy must read the **same** `starGate` field. They must
not each carry their own copy of `75`.

---

## 3. Chapter content

New file `src/data/battle/chapters/founders_park.ts`, imported and appended to `CAMPAIGN`
in `src/data/battle/chapters/index.ts`. `STAGES` rebuilds itself.

Tagline: *"The first park. Everything that ever got out has come home."*

| # | stage id | name | npcLvl | enemies (weakest-first) | energy | cash | food | xp | shards |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `founders_park_1` | The Turnstiles | 11 | therizinosaurus, pachyrhinosaurus, spinosaurus | 1 | 1,000 | — | 300 | 7 |
| 2 | `founders_park_2` | Collapsed Aviary | 11 | pachyrhinosaurus, spinosaurus, **quetzalcoatlus** | 1 | 1,150 | — | 325 | 7 |
| 3 | `founders_park_3` | The Lagoon Walk | 12 | therizinosaurus, deinosuchus, spinosaurus | 1 | 1,300 | prime_steak ×4 | 350 | 7 |
| 4 | `founders_park_4` | Founder's Statue | 12 | giganotosaurus, spinosaurus, **tyrannosaurus** | 2 | 1,500 | — | 385 | 8 |
| 5 | `founders_park_boss` | **The Last Asset** | 11 | spinosaurus, giganotosaurus, **ultimasaurus** | 3 | 1,750 | prime_steak ×6 | 430 | 16 |

Every cash and xp figure is ≥ Containment Site at the same stage position; shards tie it
exactly, which the `>=` monotone guard accepts. Chapter shards **45**, campaign **177 → 222**,
still 278 under the 500-shard mythic price.

```ts
boss: {
  bossId: 'boss-founders_park', title: 'The Last Asset', speciesId: 'ultimasaurus',
  levelBonus: 1, hpMult: 0.75, atkMult: 1.10,
  eggRarity: 'mythic', eggSpeciesId: 'ultimasaurus',
}
```

`npcLevel 11 + levelBonus 1 = 12` — exactly at the frozen `NPC_LEVEL_SANITY_CAP`, zero
headroom. That cap must not be raised to accommodate this or any future boss.

**The trophy is pinned, matching chapters 4/5/6.** The egg is granted on first clear only
(`src/modules/battles/service.ts:174`, `if (stage.boss && firstClear)`), so it is a one-shot:
an unpinned roll would mean beating Ultimasaurus and hatching an Indominus, with no repeat
attempt to justify the spread. `battle-content.test.ts:58` requires
`getSpecies(eggSpeciesId).rarity === boss.eggRarity`, which `ultimasaurus` (mythic) satisfies.

**Two consequences of the mythic egg, both stated rather than discovered later.**

*It is safe.* `MYTHIC_UNLOCK_RATING` (800) is satisfied transitively — chapter 7 requires
chapter 6's boss cleared, which required `ratingHighWater >= 950`, and that column is
monotone. `hatchEgg` never re-checks the gate, and does not need to.

*It is the campaign's first untradeable boss trophy.* `src/modules/trading/service.ts:60`
rejects mythic eggs and `src/modules/trading/index.ts:50` filters them out of the offer
autocomplete. Every prior boss egg was tradeable. Not a defect — mythics have always been
untradeable — but it is a real change in what a boss reward is, and it must be said in
`docs/gameplay.md` rather than left for a player to find.

**This reverses a recorded economy decision, deliberately.**
`src/data/battle/chapters/volcano_core.ts:4-5` currently reads "*never mythic, which would
undercut the 500-shard mythic purchase*", and `tests/battle-content.test.ts:105` is literally
named "*… no mythic*". Both must be updated in this change — the comment replaced, not left
asserting the opposite of what ships. The reasoning that supersedes it: the egg is a
one-shot behind a 75-star gate and a cleared chapter 6, which is a far higher bar than 500
shards, and it is the only reward class left that reads as an escalation over chapter 6's
pinned legendary.

### Measured balance

All figures from a probe copying `tests/battle-balance.test.ts`'s `squadOf`/`npcsOf`/`winRate`
verbatim (same rounding order, same `mulberry32` sequence, squad = 3× level-capped
tyrannosaurus). Harness fidelity confirmed against both shipped baselines: Abyssal Trench
0.9127 and Containment Site 0.8750, reproduced to four decimals.

| stage | untraited @3,000 | savage @400 | Blood Moon savage @400 |
|---|---|---|---|
| 1 The Turnstiles | 1.0000 | 1.0000 | 1.0000 |
| 2 Collapsed Aviary | 1.0000 | 1.0000 | 1.0000 |
| 3 The Lagoon Walk | 1.0000 | 1.0000 | 1.0000 |
| 4 Founder's Statue | 0.9983 | 1.0000 | 1.0000 |
| 5 **The Last Asset** | **0.8330** | **1.0000** | **0.9250** |

Boss cell supporting numbers: fleet 0.8725, ironhide 0.9200, glass_cannon 0.9975,
strongest-of-four **1.0000** (savage). Boss HP 731 against escort HP 329. Headroom **0.0520**
under the 0.8850 the ladder allows against chapter 6's 0.8750. Blood Moon traited clears the
0.85 floor by 0.0700 — a full 0.06 better than chapter 6's 0.8650, which is the tightest
existing constraint in the file.

Seven-boss ladder, untraited at 3,000 seeds:

| chapter | rate | delta |
|---|---|---|
| Coastal Dig | 1.0000 | — |
| Amber Ridge | 1.0000 | +0.0000 |
| Frozen Cliffs | 1.0000 | +0.0000 |
| Volcano Core | 0.9173 | −0.0827 |
| Abyssal Trench | 0.9127 | −0.0047 |
| Containment Site | 0.8750 | −0.0377 |
| **Founder's Park** | **0.8330** | **−0.0420** |

No positive delta anywhere. Appending chapter 7 disturbs none of the existing six.

### Three findings that must reach the boss file's comment

**1. Legendary escorts are unshippable on a boss stage.** The first draft of this chapter
used `tyrannosaurus + spinoraptor` as escorts. All 209 cells of `hpMult 0.30..1.20 ×
atkMult 0.80..1.30` fail all three floors simultaneously — the best measures 0.0257
untraited against a 0.40 floor. Both are legendary bruisers resolving to 477/121/42/82 at
L11, **strictly stronger than a level-capped player dino** (455/116/40/79) on every stat,
in front of a 974 HP / 107 DEF mythic tank. The only cells that satisfy the constraints sit
at `hpMult 0.09–0.13`, i.e. a 107 HP finale boss — an `hpMult` chosen to defeat a test.
Mythic escorts (`indominus + indoraptor`) measure **0.0000** on every metric at every grid
point, reproducing the documented Indominus draft.

**2. `hpMult` is not monotone in difficulty below the focus-fire crossover.** `resolveBattle`
focus-fires the lowest-HP live enemy. Boss HP is `round(974 · hpMult)`; escort HP is 329;
the crossover is at **hpMult 0.33727**. Below it the boss is the lowest-HP enemy, gets
focused from round 1, and win rate *rises* as `hpMult` falls — measured at `atkMult 3.0` to
make it observable: 0.3113 at 0.3372, 0.5710 at 0.30, 0.8470 at 0.20. The shipped cell sits
2.22× above the crossover, and the fine sweep 0.70–0.80 is strictly monotone at ≈ −0.017 per
+0.01. **A future author cutting this boss's HP to compensate for a world event — following
4b's "HP is the exposure knob" rule — could walk it under 0.34 and produce a boss that gets
easier as they make it tankier.** Every assertion in the file reads 1.0000 in that region,
so nothing would catch it.

**3. Escort species affects combat only through `(rarity, archetype)`.** `spinoraptor +
spinoraptor` measured identical to four decimals against `tyrannosaurus + spinoraptor`.
Swapping escort species changes embed text and enemy art and nothing else — the combat twin
of the repo's "art is keyed on archetype×diet, never species" rule. Escort choice is a theme
lever, not a balance lever.

### Deliberate content choices

- **No mythic on any non-boss stage.** Stages 1–4 have zero balance test pressure anywhere
  in the suite (`battle-balance.test.ts` reaches only `stages[4]`; `battle-content.test.ts`
  is purely structural). That is a hazard, not a licence.
- **One legendary each on stages 2 and 4, kept on purpose.** T. rex on stage 4 measures
  0.9983 — the only non-boss stage in either chapter 6 or 7 that measurably threatens a
  capped squad. Every substitution flattens it to a dead 1.0000. Swapping it out would
  remove signal, not add safety.
- **Chapter 7's stage 3 is genuinely easier than chapter 6's stage 3** for an underlevelled
  squad (chapter 6 fields a legendary bruiser at L12; chapter 7 fields three epics). Invisible
  to the shipped harness, which saturates both at 1.0000. Accepted: the chapter's ramp is
  correct where it matters, and forcing position-3 parity would mean adding a second legendary
  to a stage that already reads as the chapter's breather.

---

## 4. Expedition site 7

`src/data/sites.ts` gains one entry. `SiteDef` is unchanged.

```ts
founders_park: { id: 'founders_park', name: "Founder's Park", unlockRating: 1000,
  durationMs: 48 * H, cost: 300_000,
  eggOdds: [{ rarity: 'epic', weight: 4 }, { rarity: 'legendary', weight: 90 }, { rarity: 'mythic', weight: 6 }],
  bonusCash: [50_000, 140_000], bonusFood: [200, 400] },
```

Mythic rate goes 2%/day → 3%/day. 48 h keeps a clean two-day cadence that never drifts
against a player's routine, unlike 36 h. Epic stays present at 4% so Containment Site
remains a meaningfully different shorter-cycle run rather than dead content.

`bonusCash[1]` 140,000 < `cost` 300,000, preserving the inequality `docs/gameplay.md:532-534`
asserts in prose. Nothing tests it; it must be preserved by hand.

**What `unlockRating: 1000` actually gates — stated precisely, because the obvious reading
is wrong.** Rating is `round(1000 · (0.40·collection + 0.35·park + 0.25·comfort))`, and
1000 is the scale ceiling. But the comfort term averages over **assigned** dinos only, so
unassigning all but one well-kept dino sets it to 1.0 at will. The real gate is therefore
`collection weight ≥ 190` **and** `parkRaw ≥ 40` — both saturable, both genuinely hard
endgame bars, neither shortcut by any loop. The comfort quarter is **not load-bearing here**.

This is recorded rather than fixed. The unassign loop is pre-existing behaviour affecting
every rating gate in the game, and closing it (dividing by total owned rather than assigned)
would silently cut the live rating of every player holding unassigned stock, permanently and
unevenly, since `ratingHighWater` is monotone. Out of scope for a battle chapter. Documented
so nobody later rediscovers it as a defect in this spec.

Played straight rather than looped, the gate is genuinely reachable and the arithmetic is
worth recording: `0.40C + 0.35P + 0.25M >= 0.9995` forces `C = P = 1` and `M >= 0.998`. The
roster's rarity-weight sum is 337 against a `COLLECTION_TARGET` of 190 — saturable without
owning a single mythic — and `parkRaw` 41 clears `PARK_TARGET` 40 on lot levels alone.
`feedAll` (`src/modules/care/service.ts:71-96`) fills every dino to `fillTo` and calls
`recomputeRating` once at the same `ctx.now()`, so `M = 1` is a normal outcome of one
command rather than a race. It is nonetheless the **first gate in the game requiring all
three terms saturated simultaneously**: with 20 assigned dinos, one sitting at fit 0.75
gives `M = 0.9875` and a rating of 997. `docs/gameplay.md` renders it as **10.0★** — the
literal ceiling of the scale — which is worth saying out loud rather than leaving a player
to infer.

---

## 5. Progression and legacy

Nothing in `src/data/progression.ts` changes.

- `LOT_SLOT_THRESHOLDS` stays at `[100, 200, 400, 600, 800, 880, 950]`. `tests/rating.test.ts:52-62`
  asserts "a gate this deep carries a park-side reward too" against the two newest sites, and
  a site at 1000 has no park-side reward behind it. **The test's claim is rewritten, not the
  constant.** Adding 1000 would grant an 11th lot slot — +8 dino capacity and more income at
  exactly the tier where income is already largest — which is a real, unsimulated balance
  change smuggled in as a test fix. `parkRaw` already saturates at 41 with 10 slots, so the
  rating term would gain nothing either. The pairing deliberately stops at 950 because 1000
  is a battle/expedition gate, not a build gate.
- `PARK_TARGET` (40) and `COLLECTION_TARGET` (190) stay frozen for the reasons already in that
  file. Note that `COLLECTION_TARGET`'s 190 and the legacy ceiling's 190 are unrelated numbers
  that happen to coincide; only the latter moves.
- `MYTHIC_UNLOCK_RATING` (800) and `SHOP_CEILING` unchanged.

**Legacy rank.** `legacyMaxPoints()` derives from the three content tables, so 190 → 205 with
no code change (52 species + 48 achievement tiers + 105 battle stars).

`LEGACY_TIERS` is deliberately **not** retuned. The tempting argument — that 4b's
`legacyRankBest` made thresholds safe to raise — is wrong: that column stores *points*, and
`legacyRank` resolves `tierForPoints(max(stored, computed))`, so raising Director from 170 to
185 demotes every live Director on their next `/park view`. The column protects against the
computed total dropping, not against the ladder moving underneath it. Director slides from
89.5% to 82.9% of the ceiling; tier fractions become 7.3 / 17.1 / 31.7 / 48.8 / 68.3 / 82.9%.
That slide is the correct outcome, and `ranks.ts`'s own doc comment records it as a third
deliberate drop rather than a regression.

**Explorer achievement.** `stages_first_cleared [5, 10, 20, 30]` stays at 30, which currently
equals `STAGES.size` exactly and becomes 86% of it at 35. Raising the platinum tier would take
a tier away from any player sitting between 30 and 34 cleared stages who has not yet claimed —
the same demotion pattern rejected for `LEGACY_TIERS`. Explorer is a breadth track, not a
completionist one. Documented as "30 of 35", not a full sweep.

---

## 6. Balance guards

`tests/battle-balance.test.ts`. Three guards need no edit at all: `BOSS_STAGES` maps over
`CAMPAIGN`, so the traited floor (≥0.85), the untraited floor (≥0.40) and the Blood Moon
traited floor (≥0.85) all pick up Founder's Park automatically. Those three are what stop a
mythic boss shipping unwinnable.

### The monotone ladder: tolerance 0.03 → 0.01, seeds stay at 3,000

0.03 would miss a revert of Abyssal Trench's `hpMult` 0.82 → 0.78, a **+0.0203** inversion.
0.01 catches it with 2× margin, and passes shipped content with the *full* tolerance as
headroom: the largest positive adjacent delta across all six pairs at 3,000 seeds is exactly
**0.0000**.

The seed count is pinned **down**, with the reason recorded in the test's own comment. At
10,000 seeds the Volcano Core → Abyssal Trench pair **inverts by +0.0100 on shipped content**:

```
              3,000 seeds        10,000 seeds
Volcano Core     0.9173             0.9064
Abyssal Trench   0.9127  (−0.0047)  0.9164  (+0.0100)  <-- inverted
```

4b's Abyssal fix holds at 3,000 and fails at 10,000. Raising the count is therefore a
**content decision**, not a rigour upgrade, and the next author must read that before
touching it.

### The finale pin: a two-sided change detector

The current assertion derives `FINALE` from `CAMPAIGN[length - 1]` and asserts the strongest
of four combat loadouts wins ≥0.995 — a lower bound doing a ceiling's job, which on a
seventh chapter reads as a demand that the finale be easy.

**An untraited ceiling was considered and rejected as vacuous.** With the ladder tightened to
0.01 and chapter 6 pinned absolutely, chapter 7's untraited rate is already forced
`<= 0.8850` — strictly tighter than any round-number ceiling like 0.90. An assertion implied
by one four lines above it is a test that cannot fail, which is the precise failure class
this project has already been bitten by.

What replaces it is a **two-sided change detector**, keeping the derivation so it follows
chapter 8 too:

```
expect(rate).toBeGreaterThanOrEqual(RECORDED - 0.01);
expect(rate).toBeLessThanOrEqual(RECORDED + 0.01);
```

It fails on any retune **in either direction** — exactly the property 4b wanted, a moved
number must be re-measured and re-approved rather than merged silently, made honest, because
a one-sided bound could only ever catch half of it. The failure message must say it is a
change detector, so a future implementer reads it as "re-measure and re-approve", not as a
defect report.

**It measures the untraited rate, not the strongest loadout — and that choice is forced.**
The obvious reading is to keep measuring the strongest-of-four-loadouts rate, since that is
the axis the ladder does not touch. It does not work here: Founder's Park measures **1.0000**
on that axis, the saturated maximum, so `RECORDED + 0.01` is unreachable by construction and
the detector silently degenerates to a one-sided lower bound — the very trap 4b recorded.
A band around the **untraited** rate (`0.8330 ± 0.01`) is non-degenerate in both directions
and is strictly tighter than the ladder's implied `<= 0.8850`, so it is not vacuous either.

The strongest-loadout figures are still worth having and are recorded in the test's comment
rather than asserted on: savage 1.0000, glass_cannon 0.9975, ironhide 0.9200, fleet 0.8725.

**Flipping it is an improvement, not a repair, and the comment must say so.** The 4b handoff
note predicted the old pin would false-alarm on a hard chapter 7. It would not: Founder's Park
measures 1.0000 on the strongest loadout, so the existing assertion passes untouched. The
reason to change it is that it is a weak instrument for this boss, not that it broke.

The strongest trait also **inverts between chapters 6 and 7**: on Containment Site `fleet` is
the ceiling (0.9987) and savage only 0.9827; on Founder's Park **savage is the ceiling
(1.0000) and fleet is the floor (0.8725)** — a 731 HP boss with `atkMult 1.10` rewards raw
damage where a 1.72× HP boss rewarded acting first. That inversion is precisely why a
strongest-loadout pin is the wrong instrument. `COMBAT_TRAITS` stops being asserted on, but
the knowledge above it survives into the new comment: `frail` is strictly worse than no combat
trait (0.5775), and which trait is strongest is chapter-dependent.

### Chapter 6 gets its own pin

Flipping the derived pin retargets it to chapter 7 and thereby leaves **chapter 6 measured by
nothing** — suite green, guard silently gone. A second, id-pinned assertion for
`containment_site` is added alongside the derived one, naming the stage explicitly rather than
deriving it, and using the same `± 0.01` change-detector shape. Its recorded value is the
measured **0.8750** untraited at 3,000 seeds.

---

## 7. Tests

### `tests/battle-content.test.ts`

| line | now | becomes |
|---|---|---|
| 16 | chapter-id array, 6 entries | append `'founders_park'` |
| 18–19 | `unlockRating` strictly increasing | passes unchanged (1000 > 950) |
| 35, 36 | `seen.size` / `STAGES.size` = 30 | 35 |
| 101 | `expect(total).toBe(177)` | 222 |
| 102 | `< 500`, comment "margin today: 323" | keep 500; margin 278 |
| 105 | test name "... no mythic" | drop that clause |
| 107 | egg-rarity array | append `'mythic'` |
| 108–110 | bossId array | append `'boss-founders_park'` |
| 111–114 | `eggSpeciesId` indices 3/4/5 | **add** index 6 is `'ultimasaurus'` — nothing auto-extends |
| 115 | `expect(b.eggRarity).not.toBe('mythic')` | re-scope to `bosses.slice(0, 6)` |

Line 115 is the one to get right. Deleting the guard would let chapter 8 quietly ship a second
mythic egg and turn the top reward into the default one. Re-scoping to every **non-final**
chapter keeps exactly the property that mattered.

Index 6's `eggSpeciesId` is asserted nowhere today, by construction: the test uses
`slice(0, 3)` plus hardcoded indices 3/4/5, so the newest boss is always the one whose trophy
species is untested. It must be added by hand.

Unchanged and must still pass: `:75-86` (`NPC_LEVEL_SANITY_CAP` 12 — do **not** raise),
`:88-97` (monotone rewards), `:118-135` (boss authored as `enemies[2]`), `:137-140` (bossId
present in `docs/assets/prompts.md`).

### New content assertions

`starGate` is a new class of authored data that can be wrong in ways nothing would catch:

- **A star gate must be reachable, measured rather than assumed.** A structural bound of
  `3 × 5 × (chapters before it)` = 90 is far too loose to be worth writing: the true maximum
  is 87, because three bosses never yield `squadKos === 0`. The test must **simulate** best
  achievable stars per stage from `CAMPAIGN` — best of the four combat traits, level-capped
  legendary squad — and assert `starGate <= maxAchievable - margin`. Without it the gate's
  reachability stays a hand-computed hypothesis, which is the exact error class this
  project's own lessons flag. The simulation belongs in `tests/battle-balance.test.ts`
  alongside the other seeded runs, not in the structural content test.
- **A chapter uses exactly one gate kind**, and chapter 1 remains ungated, so the two paths
  can neither both apply nor both vanish.

### Gating tests

Four cases for the new path, in `tests/battle-content.test.ts`'s gating block:

- 74 stars → locked
- 75 stars → unlocked
- 75 stars with `ratingHighWater: 0` → **unlocked** (the whole point of the split)
- prior boss uncleared, 75 stars → locked

### Everything else

| file:line | change |
|---|---|
| `ranks.test.ts:23` | `190` → `205`; comment `52 + 48 + 90` → `52 + 48 + 105` |
| `ranks.test.ts:74-76` | comment "all 190 possible points" → 205 |
| `emojis.test.ts:37` | title `52` → `53` |
| `emojis.test.ts:38-52` | insert `'dw_site_founders_park'` **before** `'dw_site_frozen_cliffs'` (`fo` < `fr`) |
| `emoji-assets.test.ts:101` | title `52` → `53` |
| `autocomplete-expeditions.test.ts:18-19` | append `'founders_park'` |
| `autocomplete-expeditions.test.ts:25` | **add** a `rows[6].name` assertion for the locked row |
| `autocomplete-expeditions.test.ts:34` | `toHaveLength(5)` → `6` |
| `expeditions.test.ts:26` | `listSites(950).length === 6` → `listSites(1000).length === 7` |
| `rating.test.ts:52-62` | rewrite the park-side-reward claim per §5 |
| `battles-autocomplete.test.ts:49` | comment "all 30 entries" → 35 |
| `battle-balance.test.ts:48-56, 66-70, 110-122, 149-152` | per §6 |

Two tests keep passing while silently covering less, and both are called out rather than
edited:

- `expeditions.test.ts:26` would still pass at `listSites(950).length === 6` and simply stop
  covering the new site. It is changed for that reason, not because it fails.
- `daily-content.test.ts:78-88` goes slack: Explorer platinum 30 was exactly `STAGES.size` and
  is now 86% of it. Left alone per §5, recorded here so it is a decision rather than an
  oversight.

---

## 8. Docs

| file | change |
|---|---|
| `README.md:25` | "six chapters" → "seven chapters" |
| `docs/gameplay.md:508` | "six sites" → "seven sites" |
| `docs/gameplay.md:512-519` | add site row 7 |
| `docs/gameplay.md:546-553` | add egg-odds row 7 |
| `docs/gameplay.md:555-556` | **goes false** — "Volcano Core, Abyssal Trench, and Containment Site are the only sites that can ever drop a Legendary or Mythic egg" → four-site list |
| `docs/gameplay.md:565-566` | "six chapters" / "30 stages" → seven / 35 |
| `docs/gameplay.md:568-575` | add chapter row 7, including the star gate as a distinct gate kind |
| `docs/gameplay.md:579-582` | the gate ladder is no longer rating-only; describe both kinds |
| `docs/gameplay.md:640-642` | "all six chapters" → seven; `177` → `222` |
| `docs/gameplay.md:668-674` | "the two newest bosses were tuned separately" → three; add chapter 7's multipliers |
| `docs/gameplay.md:683-690` | add the boss trophy-egg row |
| `docs/gameplay.md:692` | **goes false** — "No boss ever drops a Mythic egg." |
| `docs/gameplay.md:913` | "up to 90" → 105; "190 points" → 205 |
| `docs/gameplay.md:1390-1391` | Blood Moon "can still clear any boss" — now measured for chapter 7 at 0.9250 |
| `docs/ops.md:64` | `52` → `53`, **two occurrences on one line**, machine-gated |
| `docs/assets/prompts.md` | see §9 |
| `CLAUDE.md:229-234` | the "unlockRating co-gate" and "data-only PRs" promise is now false — chapter 7 required an engine change |
| `CLAUDE.md:318-320` | "Containment Site (the finale)" → "the chapter-6 boss" |
| `CLAUDE.md:324-325` | "the two late bosses must be re-tuned TOGETHER" → three; the ladder now couples chapters 5, 6 and 7 |
| `CLAUDE.md:493-497` | record whether chapter 7 also hit `NPC_LEVEL_SANITY_CAP` (it does, exactly) |
| `CLAUDE.md:796, 807-808` | "max 90" → 105; "190 points total" → 205; "14.7% of the 190 ceiling" → "13.7% of the 205 ceiling" |
| `src/modules/park/ranks.ts:14, 26-28` | doc comment: 90 → 105, 190 → 205, new tier fractions, third deliberate Director drop |
| `src/modules/park/ranks.ts:31` | **goes false** — "Discharging this needs a monotone `users.legacyRankBest`, not a threshold edit." 4b **shipped** that column and it does **not** discharge the debt, for the reason in §5: it stores points, so `tierForPoints(max(stored, computed))` re-resolves against the new table and demotes anyway. Leaving this line in place invites the next author to "discharge" it and demote live Directors |
| `src/data/battle/chapters/volcano_core.ts:4-5` | **goes false** — "never mythic, which would undercut the 500-shard mythic purchase". Replace with the superseding reasoning, do not delete silently |
| `src/data/battle/chapters/abyssal_trench.ts:4-6` | "a mythic-base boss is unwinnable rather than hard" — true when written (the sub-1.0 `hpMult` convention did not exist yet), false as an absolute now. Re-anchor rather than leaving two chapter files contradicting each other |
| `src/modules/help/index.ts:47, 75, 80` | append the site to the expedition ladder; "6 chapters" → 7; :80's "its expedition site's rating gate applies too" is now false for chapter 7. **Body strings only — does not touch the builder.** |
| `src/modules/battles/index.ts:174-176` | comment "the campaign now has 30 stages" → 35, and record that **two** chapters now fall off an empty-query autocomplete rather than one |
| `src/data/battle/chapters/index.ts:34-35` | the comment claiming the site key derives the `unlockRating` co-gate is no longer universally true |
| `src/data/battle/chapters/containment_site.ts:47` | "the campaign's current finale" → "chapter 6" |
| `src/data/battle/chapters/abyssal_trench.ts:64` | "the two late bosses must be tuned together" → three |

**Do not change**: `docs/gameplay.md:846` and `CLAUDE.md:486-491` (`COLLECTION_TARGET`'s 190
is a different number that coincides); `docs/gameplay.md:902-909` (legacy tier thresholds stay
frozen); `docs/ops.md:354` (27 commands — unchanged); `docs/commands.md` (swept clean);
`docs/superpowers/**` and `.superpowers/sdd/**` (dated historical records).

**Accepted regression, recorded not fixed.** At 35 stages the `/battle stage` autocomplete's
25-result slice drops the two earliest chapters from a fully-unlocked player's empty query;
today it drops one. The emission order is newest-first because the frontier is what players
replay, and typing any part of a stage name still finds it. The comment records that the cost
is compounding, so chapter 8's author sees it coming.

---

## 9. Assets

**Three of these are hard test failures, not runtime degrades.** `assetImage` null-degrades
at runtime, so the bot would run without them — but `tests/images.test.ts:240-244` derives
`PORTRAIT_BOSS_IDS` from `CAMPAIGN` and asserts each portrait is a transparent 1024×1024
cutout with a 24px margin, and `:354-356` loops `CAMPAIGN` asserting **both** site images are
non-null. Adding the chapter without the art fails `npm test`. This spec is not "data-only"
in the sense earlier chapters were.

| file | spec |
|---|---|
| `assets/images/sites/founders_park-banner.webp` | 1536×1024, WebP q95 — `node scripts/fit-art.mjs banner <src> <dest>` |
| `assets/images/sites/founders_park-thumb.webp` | 1024×1024, WebP q95 — **no `fit-art.mjs` mode produces this**; hand pass, centred square crop, `drawImage`-resized, not squashed |
| `assets/images/battles/boss-founders_park-portrait.webp` | 1024×1024 transparent, whole-bbox centred, **24px margin ±1**, single connected region, WebP q95. **Do not use `fit-art.mjs cutout`** — its 31px margin fails `images.test.ts:207-238` |
| `assets/emojis/svg/dw_site_founders_park.svg` | `viewBox="0 0 64 64"`, transparent corners, ≥1 fully opaque pixel in the centre half, **no pure `#000`** (`MAX_BLACK_SHARE` 0.02), **no `objectBoundingBox` ellipse gradients** (resvg renders them solid black — use `rect`/`polygon`/`circle` as the other site markers do) |
| `assets/emojis/png/dw_site_founders_park.png` | 128×128 transparent, generated by `npm run build-emojis`, **committed** |
| `assets/emojis/manifest.json` | one new `name → sha256` entry, written by `deploy-emojis`, **committed immediately** |
| `src/core/emojis.ts` | `dw_site_founders_park` unicode entry in `EMOJI_FALLBACK` |

`docs/assets/prompts.md` gains the banner/thumb section and the portrait row — the latter is
**machine-gated**: `battle-content.test.ts:137` fails until the literal `boss-founders_park`
appears in that file. Also update its `52 application emojis` → 53, its four "six boss
portraits" statements → seven, and its "the two endgame sites" → three. Several statements in
that file are already stale (the site-id list at :117 names four of six; :45-49 and :780-783
say "other three"); fix them in passing.

The park renderer needs nothing — `loadParkArt` never reads `dw_site_*`, and there is no new
lot kind or `ParkArt` key.

---

## 10. Explicitly not in scope

- **No new species.** Roster stays at 52. Ultimasaurus, Indominus and Indoraptor all already
  exist and all carry the `containment` biome tag.
- **No migration.** `battle_progress.stageId` and `expeditions.siteId` are free-form text.
- **No `deploy-commands`.** No new module, command, option or subcommand; `HELP_TOPICS` gains
  no key; both affected surfaces are `.setAutocomplete(true)` runtime providers, not
  `addChoices`. **The one way to force it accidentally** is editing a builder *string* — most
  plausibly `src/modules/expeditions/index.ts:68`'s description, where "star requirement"
  means ★rating and now reads ambiguously against the chapter's battle-star gate. Leave it
  alone; fix the wording in a later change if it grates.
- **The unassign loop stays open** (§4).
- **The 10,000-seed ladder inversion stays open** (§6). Fixing it means retuning Volcano Core
  and Abyssal Trench together, reopening content 4b just tuned.
- **`LOT_SLOT_THRESHOLDS` stays at 950** (§5).
- **Explorer platinum stays at 30** (§5).

---

## 11. Operator steps

```bash
# local, before committing — build does NOT typecheck tests
npm test
npm run typecheck

# art (repo root)
node scripts/fit-art.mjs banner <src> assets/images/sites/founders_park-banner.webp
#   thumb and portrait: hand pass — NOT fit-art.mjs cutout for the portrait

# emoji PNG — local, idempotent, no network
npm run build-emojis        # commit assets/emojis/png/dw_site_founders_park.png

# on the live host
#   1. back up the DB to backups/2026-08-13-pre-4c/
npm run build               # the bot runs compiled dist/ — build BEFORE restart
npm run deploy-emojis       # IRREVERSIBLE — commit manifest.json immediately after
#   2. restart the bot (exactly one process per token; the emoji map loads at ClientReady)
npm run test:live           # cosmetic gallery, REST-only, safe while live
```

`deploy-emojis` is the only irreversible live write. For this change it is a single additive
POST and nothing is deleted — the safe case. **The irreversibility that bites is the
manifest**: if `assets/emojis/manifest.json` is lost or left uncommitted, the next run sees
every hash as changed and DELETEs + re-POSTs all 53 emojis with new snowflake ids, permanently
breaking every `<:dw_cash:OLD_ID>` already sitting in chat history. Unrecoverable by rerunning.
Corollary: **do not touch any existing SVG in this change** unless that emoji's id changing is
intended.

---

## 12. Hazards for whoever ships chapter 8

1. **The `hpMult` crossover.** Chapter 7's boss is monotone only above `hpMult` 0.33727. Every
   prior boss tuned far from its crossover, so this failure mode has no precedent in the repo's
   experience and reads as 1.0000 everywhere it bites.
2. **The finale change detector retargets again.** It will follow chapter 8 automatically, and
   will fail the moment chapter 8 ships — by design. Re-measure and re-record; do not widen it.
   Chapter 6 now has its own id-pinned guard; chapter 7 will need the same treatment at that
   point, or it becomes unmeasured exactly as chapter 6 nearly did here.
3. **The star gate ladder.** 75 is absolute against an 87-star achievable maximum, not the
   nominal 90. Chapter 8's gate must be chosen against what is actually achievable before it —
   the simulating machine gate from §7 computes it — and must never be re-expressed as a
   fraction.
4. **The rating ladder is exhausted.** 1000 is the scale ceiling; no future site can out-gate
   Founder's Park on rating. Chapter 8's site needs a different axis entirely.
5. **Autocomplete truncation is compounding.** Two chapters fall off today; chapter 8 makes it
   three.
