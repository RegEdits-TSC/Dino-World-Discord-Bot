# Spec 4b — Campaign hardening

Three engine deliverables. No new content, no art, no emoji, no builder change.

1. **The balance harness becomes event-aware**, so a world event can no longer
   make a boss unwinnable without a test noticing.
2. **Chapters 5 and 6 are re-tuned** against the worst case that harness now
   models.
3. **`users.legacyRankBest`** — a monotone high-water column, so a Legacy rank
   once earned is never lost.

This is the first half of a two-part push. 4c is chapter/site 7, and it is
deliberately *not* here — see §6 for why this ordering is not arbitrary.

---

## 1. Why these three, and why in this order

4c's boss must be tuned against the balance harness. This spec **changes that
harness**. Tuning chapter 7 first means tuning it twice: once against neutral
mods, then again once the worst case lands. That sequencing is the whole reason
these were split from the chapter rather than bundled with it.

`legacyRankBest` has the same shape of argument. Chapter 7 raises the legacy
ceiling from 190 to 205, which devalues every rank threshold for the third
consecutive release. Shipping rank persistence *before* the ceiling moves means
the move can never harm anyone; shipping it after leaves a window in which a
player can see a rank they had earned disappear.

Neither deliverable needs chapter 7 to exist, and both fix something players can
feel today.

## 2. The Blood Moon hole

`enemyHp` is the only `EventMods` field that touches combat, it appears on
exactly one event, and it is applied to **every** enemy in the fight — escorts
included — at `src/modules/battles/service.ts:109`:

```ts
const hp = Math.round(s.hp * (boss?.hpMult ?? 1) * mods.enemyHp);
```

`battle-balance.test.ts` builds its NPCs itself and never applies `eventMods`,
so nothing in the suite has ever measured a boss under an event. Measured, 400
seeds, 3× level-10 `tyrannosaurus`:

| chapter | neutral `savage` | neutral none | **Blood Moon `savage`** | **Blood Moon none** |
| --- | --- | --- | --- | --- |
| Volcano Core | 0.9950 | 0.9300 | 0.9200 | 0.4950 |
| Abyssal Trench | 0.9525 | 0.4900 | **0.5000** | 0.0250 |
| Containment Site | 0.8825 | 0.4225 | **0.4025** | 0.0125 |

Blood Moon runs roughly one day in eight. On those days the last two bosses sit
far below the 0.85 traited floor the suite asserts on every other day, and an
untraited squad wins 1–2 times in a hundred. Volcano Core is already fine and
needs no change.

## 3. The harness change

`npcsOf(stage)` becomes `npcsOf(stage, mods)`, applying `enemyHp` exactly the way
`service.ts:109` does — same multiplication order, same rounding — so the test
models the real pipeline rather than an approximation of it.

**Under neutral mods, every assertion that exists today stays exactly as it is:**
traited ≥ 0.85, untraited ≥ 0.40, finale ≤ 0.99, and untraited non-increasing
across `CAMPAIGN` order.

**Under Blood Moon, one new assertion: traited ≥ 0.85 for every boss.**

### Why only the traited floor under the event

Requiring ≥ 0.40 untraited under Blood Moon as well is not satisfiable without
flattening the late campaign. Sweeping boss HP shows why: Containment Site can
reach an untraited Blood Moon rate of 0.4600 only at scale 0.75, which lifts its
*neutral* untraited rate to 0.9325 — above Abyssal Trench's, breaking the
monotonicity assertion. Every configuration that satisfies both floors under the
event makes chapters 4–6 markedly easier on the seven ordinary days out of eight,
to fix the eighth.

The traited floor is the right guarantee: a prepared squad can always win.
Blood Moon stays a real difficulty spike, which is its design intent — it also
pays +50% battle XP and −1 energy per fight.

## 4. Re-tuning chapters 5 and 6

**They must move together.** This is the finding that matters most in this
section, because it is invisible to inspection: fixing either boss alone breaks
the monotonicity assertion on the *other* one, which nobody touched.

Abyssal Trench needs boss HP at scale ≤ 0.65 to clear the Blood Moon traited
floor. At 0.65 its neutral untraited rate lands at 0.8550, **below** Containment
Site's re-tuned 0.8800 — and untraited rates must be non-increasing down the
campaign. Scale 0.60 resolves it, landing at 0.9225, which sits cleanly between
Volcano Core's 0.9300 and Containment's 0.8800.

Target ladder, neutral untraited: **0.9300 → 0.9225 → 0.8800**, monotone, with
every traited floor clear under both neutral and Blood Moon conditions.

The measured configuration that produces it, as a starting point for tuning
rather than a final answer:

| chapter | boss HP scale | Blood Moon `savage` | neutral `savage` | neutral none |
| --- | --- | --- | --- | --- |
| Volcano Core | 1.00 (unchanged) | 0.9200 | 0.9950 | 0.9300 |
| Abyssal Trench | **0.60** | 0.9225 | 1.0000 | 0.9225 |
| Containment Site | **0.80** | 0.8650 | 0.9725 | 0.8800 |

Containment Site is the finale, so its neutral traited rate is the one bound by
the ≤ 0.99 ceiling — 0.9725 leaves real margin. Abyssal Trench is not the finale
and has no upper bound today, which is why its neutral traited rate reaching
1.0000 is legal; if 4c makes chapter 7 the finale, that bound moves with it
automatically, since the test derives the finale from `CAMPAIGN`'s last entry
rather than by id.

Current values: Abyssal Trench boss `hpMult` 1.3 / `atkMult` 1.25; Containment
Site boss `hpMult` 2.15 / `atkMult` 1.2. Both at `npcLevel` 11 with `levelBonus`
1, i.e. effective level 12 — the sanity cap, which does not move.

### The `hpMult ≥ 1.0` convention is retired, and `atkMult` is the wrong lever

Both chapter files state in prose that *"boss multipliers never fall below 1.0"*.
It is **not machine-checked** — nothing in `battle-content.test.ts` asserts it.
Applying scale 0.60 to Abyssal Trench's 1.3 gives 0.78, which breaks it.

**Decision: retire the convention for `hpMult`, and keep `atkMult` where it is.**
`atkMult` was the obvious way to preserve the convention, and it was measured
before being rejected:

| boss | `atkMult` | Blood Moon `savage` | neutral `savage` | neutral none |
| --- | --- | --- | --- | --- |
| Abyssal Trench | 1.05 | 0.8675 ✓ | **1.0000** | 0.8650 |
| Containment Site | 1.05 | 0.8675 ✓ | **1.0000** | 0.8775 |

It clears the Blood Moon floor and fails everything else. Containment Site is the
finale, so its neutral traited rate of 1.0000 breaches the ≤ 0.99 ceiling; and the
resulting untraited ladder — 0.9300 → 0.8650 → 0.8775 — is not monotone.

The mechanical reason is worth writing down, because it is counter-intuitive and
it will come up again in 4c. Blood Moon adds enemy HP, which lengthens fights, so
the natural instinct is that cutting enemy *attack* is the matched fix. It is not:
cutting attack removes the threat outright, and the squad simply stops dying —
hence 1.0000. Cutting HP keeps the boss hitting exactly as hard while shortening
how long the squad is exposed to it, which is why it lands inside the band
instead of above it. **HP is the exposure knob; attack is the threat knob. Only
the exposure knob has a usable range here.**

Both chapter files' convention text must therefore be updated in the same change,
recording that `hpMult` may fall below 1.0 when compensating for an event
multiplier, and that `atkMult` was measured and rejected. Leaving prose that
contradicts the data beside it is the failure this spec is otherwise trying to
end.

### The tuning protocol

This exists because both existing chapters shipped with comments citing figures
they were not measured at. Containment Site's comment claims a *"3,000-seed
check: traited 0.90, untraited 0.44"*; the true 3,000-seed untraited figure is
0.4310, and 0.44 is the 10,000-seed value. **Correct that comment as part of this
change.**

1. Tune at **400 seeds** — that is what the test uses, and it is the number that
   decides pass or fail.
2. Confirm stability at 3,000 and 10,000.
3. Record the seed count honestly in the chapter comment. If three counts are
   quoted, quote all three.
4. Measure `fleet`, not only `savage`. `fleet` is the stronger trait against this
   content — 0.9800 vs 0.8825 on Containment Site — so `savage` is not the
   ceiling case the ≤ 0.99 finale bound assumes.

## 5. `users.legacyRankBest`

### The problem

Nothing persists an earned rank. `legacyRank` recomputes from three live tables
on every call, and `docs/gameplay.md` promises players in as many words that
*"nothing can ever be lost — it's simply recalculated from what you've already
done."* That promise is currently true only by accident: no threshold has moved
yet. It is what blocks any future retune, and Director has devalued three
releases running — 94.4% → 89.5% → 82.9% once chapter 7 ships.

### The design

Migration **0014** adds `legacy_rank_best`, a monotone integer on `users`,
default 0, following `ratingHighWater` exactly.

**`legacyRank` returns the tier for `max(stored, computed)`.** This is the whole
design and it is what makes the feature safe:

- The stored column is a **safety net, not a source of truth**. Whenever the
  computed value is higher — the normal case — it wins, so the rank is always at
  least what the player has actually earned.
- A missed write site is therefore **harmless**. The stored value only ever
  matters when the computed value *drops*, which is exactly the case it exists
  to cover.
- No write is needed on any hot path, and none is needed for correctness.

### Where the write goes, and where it must not

`legacyRank` has three call sites:

| Site | Owner? | Write? |
| --- | --- | --- |
| `src/modules/park/index.ts:199` — `/park view`, own park | yes | **yes** |
| `src/modules/dex/embeds.ts:51` — `/dex list` footer | yes | **yes** |
| `src/modules/park/visit.ts:79` — another player's park | **no** | **never** |

`visit.ts` passes `targetUserId`, not the viewer. A write there would mean
viewing someone's park mutates their row — a write on a read path, for a user who
took no action. The bump must therefore be a **separate exported function** —
`bumpLegacyBest(ctx, userId)`, alongside `legacyRank` in
`src/modules/park/ranks.ts` — never folded into `legacyRank`, so the visiting
path cannot acquire it by accident. It writes `max(stored, computed)` and returns
nothing; callers that also need the tier call `legacyRank` as they do today.

Keeping `legacyRank` pure also keeps `visit.ts` correct for free: it still
displays `max(stored, computed)` for the target, which is the right number to
show, without writing anything.

### What this does not do

It does **not** retune `LEGACY_TIERS`. That stays a separate decision, now
unblocked rather than taken. Shipping the persistence is what makes a future
retune safe; performing one is not in this spec.

## 6. Out of scope

- **Chapter 7 and site 7** — spec 4c, which this spec exists to de-risk. Its gate
  is already decided: campaign stars ≥ 80, an absolute integer. A legendary squad
  tops out at 87 of 90 (the three late bosses cap at 2 stars without mythics), a
  pure clear-through banks about 60, and 90 is mythic-only — so 80 is above a
  clear-through and below the grind wall.

  **The star gate applies to the CHAPTER only.** `chapterUnlocked` and
  `siteUnlocked` are separate gates: the chapter gains the star condition, while
  site 7 keeps a rating gate like every other site. That split is deliberate and
  it is the tycoon-correct one — combat content sits behind combat achievement,
  park content behind park achievement. A player who builds and never fights
  still reaches the game's best expedition site; they are only kept out of the
  battle chapter, which is content they were not playing anyway. Collapsing the
  two gates into one would lock the endgame park economy behind a campaign grind,
  which is the wrong game.

- **Making chapter 7 meaningfully harder than chapter 6.** It cannot be, and 4c
  should not spend effort trying. `npcLevel` is at the sanity cap, and the entire
  legal band on `hpMult` is 9 fights out of 400 — the monotonicity assertion
  explicitly permits a tie. Chapter 7 escalates on **theme and reward**: the
  campaign's first mythic antagonist, the best shard payout, and site 7's economy
  tier. In a park tycoon the endgame difficulty curve lives in the park — the
  landmark cash sink, the rating ceiling — not in the battle ladder, and the
  battle ladder has been telling us that for two chapters.
- **Retuning `LEGACY_TIERS`** — §5.
- **Softening Blood Moon's `enemyHp`** — changes a shipped event's identity and
  its documented effect line. The traited floor is the guarantee; the spike is
  intended.
- **Squad sizes 1 and 2**, which are unwinnable from chapter 3 onward and
  unasserted at any size below 3. Real, pre-existing, and not what this spec is
  for.
- **Per-energy reward monotonicity** — no guard exists and none is added here.

## 7. Invariants for future work

- **Never assert the untraited floor under an event.** §3 records why it is
  unsatisfiable without flattening the late campaign.
- **Never re-tune one late boss alone.** The monotonicity assertion couples them;
  §4 is the worked example.
- **Never quote a seed count a figure was not measured at.** Two chapters already
  shipped comments that do.
- **Never re-tune a boss on `atkMult` to compensate for an event.** §4 has the
  measurement: it clears the event floor and lands the neutral traited rate at
  1.0000, breaching the finale ceiling and breaking the ladder. HP is the
  exposure knob, attack is the threat knob, and only exposure has range here.
- **Never fold the `legacyRankBest` write into `legacyRank`.** `visit.ts` calls
  it for another player's id.
- **Never let `legacyRank` return the stored value alone.** It must be
  `max(stored, computed)`, or a player who earns a rank between writes sees a
  stale one.

## 8. Shipping

Migration 0014 applies on boot, so this spec **does** need a DB backup — all
three files, `.db`, `-wal` and `-shm`. The WAL routinely dwarfs the `.db` here,
so a `.db`-only copy loses committed data.

No `deploy-commands` (no builder changes). No `deploy-emojis` (no new emoji).
No art. `npm run build` then restart the single bot instance, as always, because
the bot runs compiled `dist/`.

Order: `npm run typecheck` first (the only gate that sees test files), then
`npm test`, then `npm run build`, back up the DB, restart, then `npm run
test:live`.
