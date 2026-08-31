# Follow-through — design

**Date:** 2026-08-31
**Status:** design agreed, not implemented
**Parent:** sub-project 1 of 3 in the gameplay smoothness pass (see §1).

A dated record of the decision as it was made. If a mechanism here is proven wrong after
implementation, the correction belongs in `docs/conventions/`, naming the dead mechanism —
not in this file. See `§specs-are-dated-records` in `docs/conventions/prose-and-specs.md`.

---

## 1. Context — why this exists, and what it is one third of

A read of the live bot found the gameplay legible but not smooth. The findings, in the
order they hurt:

- **No onboarding.** `getOrCreateUser` mints a row silently mid-command. Nothing greets a
  new player and nothing points at `/help`. The first-ten-minutes walkthrough exists at
  `src/modules/help/index.ts` but is only reachable by already knowing to run `/help`.
- **Nothing answers "what do I do now."** The closest surface is `/daily`, which is a quest
  board, not guidance.
- **Pending timers are invisible in aggregate.** Incubating eggs, the active expedition,
  breeding pairs and battle energy each live behind their own command, and none appear on
  the park card. Verify with
  `grep -ni 'expedition\|breeding\|incubat\|energy' src/modules/park/embeds.ts`.
- **Loop closure is thin.** Most flows end in a text instruction to type the next command.
  Derive the current button inventory with
  `grep -rhoP "setLabel\('\K[^']+" src/modules/*/*.ts | sort | uniq -c | sort -rn`.
- **Gates are invisible until you hit them.** `LOT_SLOT_THRESHOLDS`, `SHOP_CEILING`,
  `MYTHIC_UNLOCK_RATING` and the site unlock ratings all key off `ratingHighWater`, and
  nothing renders how far away the next one is.
- **Progression is scattered** across `/daily`, `/achievements`, `/season`, `/guests view`
  and `/park landmark`, each with its own claim button and no shared signal.

That is too much for one spec, so it was cut into three sub-projects, to ship in order:

1. **Follow-through** — this document. Every terminal action offers the next one as a
   control, and every insufficiency error quotes the number it currently withholds. No new
   state, no migration.
2. **The hub** — one screen answering "what do I do now": what is ready, what needs
   attention, what is claimable, and the next rating unlock. Likely a fifth tab on
   `/park view`.
3. **Onboarding** — a guided first session that graduates into the hub from (2).

(2) and (3) are out of scope here, named only so this document's boundaries are legible.

## 2. Decisions locked before design

| Question | Decision |
| --- | --- |
| May a follow-through button spend cash? | Yes, behind a two-step confirm. Never one click. |
| How does Assign choose a paddock? | One eligible → assign directly. Several → select menu. None → offer Build instead. |
| How wide is the error sweep? | Gates and prices only. Messages already correct and actionable are left alone. |
| How is the graph built? | Per-module minting on existing prefixes, with one contract test owning the whole graph. |

The rejected alternative for the last row was a central `core/follow-through.ts` registry
declaring every step as data behind a single `next:` prefix. It was rejected because one
prefix means one handler switching over every module's actions — the shape
`§one-entry-per-prefix-branch-internally` exists to prevent — and because it would have to
import from every module, inverting the dependency direction the repo has today.

## 3. The follow-through graph

| Surface | New control(s) | Kind |
| --- | --- | --- |
| `/expedition claim` reply, and the `exp:claim` button's `i.update` | **🥚 Incubate #id** · **🧭 Dig again** | free · spend |
| `/shop egg` reply | **🥚 Incubate #id** · **🥚 Buy another** | free · spend |
| `/breed claim` reply, and the `breed:claim` button's `i.update` | **🥚 Incubate #id** | free |
| `mythic:confirm`'s `i.update` | **🥚 Incubate #id** | free |
| `hatch:crack` reveal | **🦕 Assign to #N** / **🦕 Assign… ▼** / **🏗️ Build a paddock** | free |
| `/build` reply, when the built lot is a paddock | **🦕 Assign a dino** | free |
| `/rescue` reply | **🍖 Feed it** | consumes food, one click |

### 3.1 Why Feed is one click and Dig again is not

Food is a spend, but `/park view`'s **🍖 Feed all** button has consumed food on one click
since it shipped (the `park:feedall:<uid>` button in `src/modules/park/embeds.ts`). Putting
a confirm on `/rescue`'s Feed alone would make the two disagree for no reason a player could
infer. **The confirm rule is scoped to cash**, deliberately.

### 3.2 Public replies need an explicit owner check

`/expedition claim`, `/shop egg`, `/build` and the `hatch:crack` reveal are public messages.
Anyone in the channel can click a button on them. Every customId in §4 therefore carries the
owner uid and the handler rejects a mismatch before the service call — the same explicit
check `exp:claim` already performs, and for the same reason: `incubateEgg` and `assignDino`
resolve against the **caller**, so a bystander's click would silently act on their own eggs
rather than being refused.

### 3.3 A bare-return defect this change inherits

The `hatch` and `mythic` component handlers in `src/modules/hatchery/index.ts` both bail with
a bare `return` on an unrecognised action. Per `§component-default-arm-must-acknowledge`, that
paints "This interaction failed" after three seconds, and a stale id from an older deploy
lands exactly there. Both become `deferUpdate()`. In scope because this work edits both
switches.

## 4. customIds and validation

### 4.1 Incubate — one handler, several minters

`hatch:inc:<uid>:<eggId>`, minted by expeditions, shop, genelab and hatchery, handled once in
hatchery. The router dispatches on the prefix alone, so a button minted in
`src/modules/expeditions/index.ts` reaches hatchery's handler with no import between the two
modules and no second copy of "is this egg owned, locked in a trade, or already incubating,
and is an incubator slot free" — that validation already exists exactly once, inside
`incubateEgg`.

### 4.2 Assign — three shapes, chosen at mint time

Eligibility is: a lot of type `paddock`, whose `diet` matches the dino's species diet, with
occupancy below `paddockCapacity(level)` (`2 * level`, max level 4).

- **Exactly one eligible** — `park:assign:<uid>:<dinoId>:<lotId>`. The lot id rides in the id
  so the handler re-checks that exact lot still exists, still matches diet, and still has
  room. On any failure it replies with the existing `That lot changed — open /park view`.
- **Several eligible** — `park:assignpick:<uid>:<dinoId>` opens an ephemeral select. That
  select is `park:assignsel:<uid>:<dinoId>` on the **selects** namespace, which
  `src/core/modules.ts` resolves through a different map from components, so it shares the
  `park` prefix with the button handler exactly as the Lots tab's Build/Upgrade menu already
  does — and inherits `clickedIdIsOnMessage` and `submittedValuesAreOnMessage` from the
  router for free.
- **None eligible** — no assign control is minted at all. **🏗️ Build a paddock** takes its
  place.

Off-diet paddocks are never offered. The existing "Assign anyway" wrong-habitat confirm stays
reachable only from `/dino assign`, so a follow-through click can never make the half-comfort
mistake in one press.

`/build` runs the same machinery backwards: `park:builddino:<uid>:<lotId>` opens a select of
the player's unassigned, diet-matching dinos.

### 4.3 Feed after rescue

`care:feed:<uid>:<dinoId>`. **The care module registers no component prefix today** —
`grep -n 'prefix:' src/modules/care/index.ts` returns nothing — so this is its first, and it
needs a `components` entry on its manifest plus its own routed test.

### 4.4 Spend confirms — the price is checked twice

**Dig again.** `exp:again:<uid>:<siteId>` opens an ephemeral confirm card quoting the price
*now*, via `expeditionFeeFor` under live `eventMods`. Its confirm button is
`exp:againyes:<uid>:<siteId>:<price>`; the handler recomputes the price and **refuses if it
moved**, telling the player to reopen the card.

**Buy another.** `shop:again:<uid>:<rarity>` → `shop:againyes:<uid>:<rarity>:<price>`. The
handler recomputes `eggPriceAt` the same way, and additionally re-checks that
`dailyEggOffers` still contains that rarity.

Baking the price into the id is `§money-button-carries-its-rung` applied to a number that
genuinely moves: expedition fees shift with world events and egg prices roll at UTC midnight.
A confirm card left open across a rollover would otherwise charge today's price under
yesterday's label. **Refusing on mismatch is the purpose of the segment, not a nicety** — and
re-rendering the message on success is a second layer only, never the guard, because any
other open message still holds a stale button (`§repaint-is-second-layer-not-guard`).

Shop gains a second component prefix, `shop`, beside its existing `sell`.

## 5. The error sweep

### 5.1 Root change — `InsufficientFundsError` carries the numbers

The class in `src/core/economy.ts` carries `wallet` and an optional `foodId` today, never the
amount. That is precisely why every catch site can only say "Not enough cash."

It gains **required** `needed` and `held`. Every throw site inside `apply` already holds both
figures in scope at the throw — enumerate them with
`grep -n "throw new InsufficientFundsError" src/core/economy.ts`. The params are required
rather than optional
deliberately: an optional param lets a call site keep throwing the numberless error, and
nothing anywhere would fail — the bug being fixed, reintroduced by its own default.

Enumerate the catch sites to rewrite with:

```
grep -rn "InsufficientFundsError" src/modules/*/*.ts
```

A shared `shortfallLine(e)` beside the class renders the tail; each module keeps its own
leading clause naming *what*:

```
Not enough cash — the Gene Lab costs 12,000, you have 8,410 (3,590 short).
Not enough shards — a Mythic egg costs 500, you have 340 (160 short).
Not enough Ferns — need 3, you have 1 (2 short). Buy more with /shop food.
```

`shortfallOf` in `src/modules/admin/service.ts` is **untouched**. It derives its numbers from
the `tx_log` row rather than the error, and deliberately reads balances after the reversal
transaction has rolled back. It keeps its own wording.

### 5.2 Lot slots

A new `nextLotSlot(highWater)` beside `lotSlots()` in `src/data/progression.ts`, returning the
next slot number and the threshold that unlocks it, or `null` once every threshold in
`LOT_SLOT_THRESHOLDS` is passed. Every `LotLimitError` site in `src/modules/park/index.ts`
that means *slot cap* rather than *already max level* — find them with
`grep -n "LotLimitError" src/modules/park/index.ts` — renders:

```
All lots full (7/7). Slot 8 unlocks at ★8.0 — you're at ★6.2 (best ★6.4).
All lots full (10/10) — every slot is unlocked.
```

Both ratings appear on purpose. The gate reads `ratingHighWater`, not `parkRating`, so a
player whose live rating has dipped below their best would otherwise read the message as the
gate having moved under them.

### 5.3 Max level

`Already max level.` becomes `Already max level (4) — that paddock holds 8.`, with the cap and
capacity read off the def rather than written into the string, since facilities and paddocks
do not share a max level.

### 5.4 The model to match

`src/modules/battles/service.ts` already does this correctly:
`Not enough energy — need ⚡3, have ⚡1. Next ⚡ <t:…:R>.` That is the house shape. Nothing in
battles changes.

### 5.5 Explicitly out of scope

Messages already correct and actionable — `That dino has escaped — rescue it first.` and its
neighbours — are left alone. So is the locked-expedition-site path, whose autocomplete already
labels the row `LOCKED, needs ★4.0`.

## 6. Testing

1. **One contract test owns the graph.** A table of (surface → expected customId) pairs. For
   each pair: assert the minted payload actually carries that id, then dispatch that id
   through `routeInteraction` and assert the effect. `§routed-test-per-component` exists
   because the `/admin ledger` pager would have shipped dead without one, and a test that
   calls `comp.execute` directly proves nothing about routing. Derive how much of the suite
   currently routes with `§router-guard-test-evidence` in
   `docs/conventions/router-and-registry.md`.

2. **Every guard is watched failing before it is trusted.** Break the thing each guard
   protects, watch that specific check fire, restore. The guards: a bystander clicking someone
   else's Incubate; the target lot filling up between mint and click; an egg that is already
   incubating; the price moving between confirm and click.

   The price test **must move the clock across a UTC rollover, or flip the world event, so
   that `eventMods` genuinely returns a different fee**. Passing a hand-written wrong price
   into the customId would prove the equality operator works and nothing whatsoever about
   staleness.

3. **Error tests assert the whole rendered line**, never a substring containing the number. A
   substring assertion on `8,410` passes against a sentence that quotes the wrong figure
   somewhere else in it — a trap this repo has already paid for more than once.

4. **`nextLotSlot` unit tests** covering the exhausted case (`null`) and both sides of a
   threshold boundary.

5. **`needed` and `held` are gated by the type system, not by a test.** That is the reason they
   are required rather than optional. `npm run typecheck` is the gate, and it must run before
   any commit touching `tests/` or `scripts/`, since `npm run build` typechecks neither.

## 7. Operator steps, and one honest limit

No migration. No new emoji. No new art. **No `npm run deploy-commands`** — components and
selects are not builder changes and no command gains an option.

In order: `npm run typecheck` → `npm test` → `npm run build` → restart the bot →
`npm run test:live`.

**`test:live` is REST-only and will not click any of these buttons.** Nothing automated will
have exercised this feature against real Discord. The manual checks the operator owes after
restart:

- `hatch` → **Assign**, in both shapes: with exactly one eligible paddock, and with several.
- `/expedition claim` → **Incubate**, and confirm the egg starts its timer.
- **Dig again** → confirm → verify the charge lands exactly once, and that a second click of
  the same confirm is refused.
- `/build` a paddock → **Assign a dino** with no dinos free, to see the empty-menu path.

## 8. Risks accepted

- **Stale same-message replay is not solved here.** The router proves the bot minted a control
  on a message; nothing proves the state behind it still holds. Every guard in §4 is a
  per-button convention, which is exactly the class the queued stale-replay hardening work
  exists to close systemically. This spec adds cash-spending surface before that lands, and
  narrows the window with a two-step confirm and a price recheck rather than closing it.
- **The graph is convention, not structure.** Nothing stops a future module minting an egg and
  forgetting to offer Incubate. The contract test in §6.1 is the only thing that would catch
  it, and only if whoever adds the surface also adds its row.
