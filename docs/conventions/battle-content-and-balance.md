# Battle content and balance

Fires on: the campaign data under `src/data/battle/` — chapters, stages, enemy rosters
and boss definitions — plus `src/data/sites.ts`, whose `EXPEDITION_SITES` keys those
chapter ids must equal, and the suites over them (`tests/battle-*.test.ts` and
`tests/elo.test.ts`).

## Headlines

- A chapter id MUST equal its `EXPEDITION_SITES` key: that one invariant derives the chapter banner asset, the theme, and the `unlockRating` co-gate, so a drifted id silently breaks all three at once. §chapter-id-equals-site-id
- `tests/battle-content.test.ts` is the machine gate for all campaign data, which is what lets a chapter reusing the existing rating gate ship as a data-only PR — new chapter file, index import, WebPs, prompt rows, zero engine changes. §chapter-ships-data-only
- That data-only promise covers the EXISTING gate kind only: chapter 7 needed `ChapterDef.starGate` and a branch in `chapterUnlocked`, so plan any genuinely new gate kind as an engine change or discover it mid-implementation. §new-gate-kind-costs-engine-change
- `rosterFor(stage, squadSize)` is the single source of truth for which enemies are fielded and which entry is the boss — re-derive the boss by matching `speciesId` anywhere and the fight and its embed can disagree about who fought. §rosterfor-single-source
- `tests/battle-balance.test.ts` asserts boss win rates under BOTH neutral mods and Blood Moon, and under an event only the TRAITED floor — tightening it to demand the untraited floor too is unsatisfiable without flattening the late campaign. §balance-asserts-both-mod-sets
- Compensate a boss for an event multiplier on `hpMult`, NEVER `atkMult`: measured, `atkMult` 1.05 breaches the finale ceiling on one boss and inverts the monotone ladder on another. §hpmult-not-atkmult
- Re-tune chapters 5, 6 and 7's bosses TOGETHER — the monotonicity assertion couples them, so fixing one alone breaks another. §retune-late-bosses-together
- Boss multipliers may fall below 1.0; the old "never below 1.0" convention is retired, and Abyssal Trench's `hpMult` of 0.82 is deliberate, not a value to "fix" upward. §boss-multipliers-may-be-below-one
- `NPC_LEVEL_SANITY_CAP` (12) must never be raised to accommodate a new boss — a boss past it was measured unwinnable, and the finale already sits exactly on it with zero headroom. §npc-level-sanity-cap-frozen
- Tune and check the ladder at 3,000 seeds with a 0.01 tolerance, never the 400 seeds the rest of the balance file uses: at 400 the gaps between adjacent bosses are smaller than the sampling noise, so a real inversion reads as a clean pass. §tune-at-3000-seeds

## chapter-id-equals-site-id

Chapter ids in
`src/data/battle/chapters/` MUST equal `EXPEDITION_SITES` keys (`src/data/sites.ts`):
that single
invariant derives the chapter banner asset (`sites/<chapterId>-banner`) and the
theme unconditionally, and — for every chapter that does NOT set `starGate` —
the `unlockRating` co-gate too.

Each of the three is a separate breakage if the ids drift, and the banner is the quietest
of them: a name with no committed file is never an error, it simply renders without art
(`§art-missing-file-degrades` in `docs/conventions/art-resolver.md`). A drifted id
therefore loses the banner with no signal at all, while the theme and the gate go wrong
somewhere else entirely.

## chapter-ships-data-only

`tests/battle-content.test.ts` is the
machine gate for all campaign data — including that every `bossId` appears in
`docs/assets/prompts.md` — so a chapter reusing the existing rating-gate kind
still ships as a data-only PR (new chapter file + index import + WebPs +
prompt rows) with zero engine changes.

Those four items are the checkable part of the promise: if a change needs a fifth, it is
not a data-only PR.

## new-gate-kind-costs-engine-change

That promise is no longer
unconditional, though: chapter 7 (Founder's Park) needed a real engine change
— `ChapterDef.starGate` plus a branch in `chapterUnlocked`
(`src/data/battle/chapters/index.ts`) — because its own unlock condition is a
campaign-wide star total, not a rating threshold, and the id-derived
`unlockRating` co-gate had no way to express that. A future chapter that
needs a genuinely new gate kind will cost an engine change again.

The correction matters more than the example: a reader who saw only the data-only promise
would scope a new gate kind as a data PR and find the engine change halfway through it.

## rosterfor-single-source

`rosterFor(stage, squadSize)` (`src/data/battle/chapters/index.ts`) is the
single source of truth for which enemies are fielded and which entry is the
boss — `runFight` and `fightFrames` both call it rather than re-deriving the
boss by matching `speciesId`, so the fight and its embed always agree on who
actually fought; the content test pins the boss as the third authored enemy,
which the small-squad slicing branch relies on.

## balance-asserts-both-mod-sets

`tests/battle-balance.test.ts` asserts boss win rates under BOTH neutral mods and
Blood Moon (`enemyHp` 1.15, the only event that touches combat). Under an event only
the TRAITED floor (>=0.85) is asserted — requiring the untraited floor there too is
unsatisfiable without flattening the late campaign.

## hpmult-not-atkmult

Compensating a boss for an event
multiplier goes on `hpMult`, NEVER `atkMult`: on Containment Site (the chapter-6 boss),
`atkMult` 1.05 lands neutral traited at 1.0000, breaching the finale ceiling,
and on Abyssal Trench, `atkMult` 1.05 lands neutral untraited at 0.8650 — below
Containment Site's 0.8800 — inverting the monotone ladder. Cutting attack removes the
threat, while cutting HP keeps the boss hitting as hard and shortens exposure. HP is
the exposure knob, attack is the threat knob.

## retune-late-bosses-together

Chapters 5, 6 and 7's bosses must be
re-tuned TOGETHER — the monotonicity assertion couples them, so fixing one alone breaks
another. The Abyssal Trench counterexample above is an instance of exactly this coupling:
the number that moved was one boss's, and what it broke was its neighbour's ordering.

## boss-multipliers-may-be-below-one

This retired the old "boss multipliers never fall below 1.0" convention;
Abyssal Trench's `hpMult` is 0.82 deliberately. The retirement has to be recorded, not
just applied: a reader who still believed the old convention would see 0.82 as a typo,
"fix" it upward, and break the ladder.

## npc-level-sanity-cap-frozen

`NPC_LEVEL_SANITY_CAP` (`src/data/progression.ts`, 12, enforced in
`tests/battle-content.test.ts`) is frozen by a deliberate design decision, not a value
to keep in sync as content ships — do not "fix" it to track the roster. It must never
be raised to
accommodate a new boss: simulation during the Abyssal Trench / Containment
Site work showed a boss whose effective level (`npcLevel + levelBonus`)
exceeded it was unwinnable, which is why both new bosses were tuned down on
`hpMult` instead of pushed up on level — see those chapter files' own
comments in `src/data/battle/chapters/` for the numbers and the reasoning.
Founder's Park's boss lands exactly on that cap too (`npcLevel` 11 +
`levelBonus` 1 = 12, zero headroom) — the same tuning tradeoff, one more
data point against ever raising it, and the evidence that the cap is already touched, so
the next chapter cannot quietly assume headroom under it.

The repo's other frozen constants are denominators, and their shared argument is tabulated
at `§park-target-frozen` in `docs/conventions/park-progression.md`. This one is
deliberately not in that table: its reasoning is a measured unwinnability result about one
boss's effective level, which a denominator table has no column for.

## tune-at-3000-seeds

The monotone ladder itself is
checked at 3,000 seeds with a 0.01 tolerance, never the 400 seeds every other
assertion in this file uses — at 400 seeds the ladder's own gaps between adjacent
bosses are smaller than its sampling noise, so a real inversion can read as a clean
pass. Tune a boss by measuring at 3,000 seeds, not 400.
