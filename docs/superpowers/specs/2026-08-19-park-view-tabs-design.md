# /park view — tabbed navigation (spec 5b)

**Date:** 2026-08-19
**Amended:** 2026-08-21
**Status:** the tabs and the select-menu engine have shipped; the Lots tab menus are the
last PR of the series
**Depends on:** `main` at `8359f62`

> **Amendment note (2026-08-21).** Sections 3.4, 3.5, 3.6, 3.7, 6, 7, 9, 11 and the
> decisions table were
> rewritten after the shipped work moved past what they described. Two rulings drive most
> of it: the lot tables become null-prototype maps and `buildLot` owns its own kind check
> (§3.4), and `upgradeLot` takes the staleness anchor as a **required** parameter
> (§3.5). Both move enforcement out of the handlers and into the service and data layers,
> which is the reverse of what those sections originally specified. §11's two-PR split is
> superseded outright: the work is planned as three numbered PRs plus a standalone bug fix
> that was split out of the first, which reached GitHub as three merged PRs so far.

## Problem

`/park view` renders one card carrying up to eleven fields, a rendered park image, a
featured-dino thumbnail and a single button:

```
Cash · Food · Rating · Dinos(+escaped/at-risk/wrong-habitat) · Attendance · Lots(full width)
· Achievements · Legacy · Seasons · [Income capped] · Featured
```

Four distinct complaints, all confirmed as in scope:

1. **Too many numbers.** Eleven fields is a wall; no screen reads at a glance.
2. **Art gets buried.** `park.png` and the featured thumbnail compete with the field wall
   instead of headlining.
3. **Dead end.** The card reports numbers but offers only `Collect`. Every other action
   means retyping a slash command.
4. **Mobile scrolling.** The park image sits below a full screen of text.

The same builder (`dashboardPayload`, `src/modules/park/embeds.ts:22`) also serves the
*visited* park through `visitPayload` (`src/modules/park/visit.ts:66`), so every one of
those complaints lands on two surfaces.

## Solution overview

Four tabs on one message, swapped in place with `i.update`. Buttons only for navigation;
select menus for the two actions that need input. Existing payload builders are routed to
rather than duplicated.

## 1. Tab set and field placement

Default tab is always **Park**. No stored "last tab", no new column — `/park view` opens
the same way every time.

| Tab | Fields | Art | Actions |
|---|---|---|---|
| 🏞️ **Park** *(default)* | Cash · Rating · Dinos (count **plus a compact alert marker**, see below); world-event header + motto in the description; **⛔ Income capped** conditional, full width | `park.png` | `Collect <amount>` |
| 🦕 **Animals** | Dinos · Food · Featured; **⚠️ Needs attention** conditional (escaped / at risk / wrong habitat) | `banners/dino_roster.webp` + featured-dino thumbnail | `Feed all` · `Full roster` → existing `dinoListPayload` |
| 🏗️ **Lots** | Built list (id · name · level) · slots used/total · next slot unlock | `banners/lots.webp` **(new asset)** | `Build…` · `Upgrade…` select menus |
| 🏛️ **Prestige** | Attendance · Achievements · Legacy · Seasons · Landmark tier | `banners/landmark.webp` | `Landmark` → `landmarkPayload` · `Guests` → guests view |

**Rating lives on Park only**, not duplicated onto Prestige. It is the park's headline
number; Prestige leads with Attendance and Legacy.

### Escaped dinos must stay visible on the default tab

Today the escaped / at-risk / wrong-habitat counts render inline on the one card, so a
player sees them without doing anything. Moving the full breakdown to the Animals tab would
hide an escaped dino behind a click — a visibility regression on the most time-sensitive
state in the game.

The Park tab's Dinos field therefore keeps a **compact marker** whenever anything needs
attention (`14 · ⚠️ 4 need attention`), and the Animals tab carries the itemised breakdown.
The marker is the summary, never the detail; it exists so the default tab can never look
calm while a dino is escaping.

### Routed surfaces open as ephemeral replies

`Full roster`, `Landmark` and `Guests` route to existing payload builders. Each opens as a
**new ephemeral reply**, leaving the tab card intact and on screen. They must not `i.update`
the tab card — that would destroy the navigation the player is standing in, and the routed
payloads mint their own components (`park:dinos:<uid>:<page>` paging,
`park:landmark:buy:<uid>:<tier>`) which then have to keep working on their own message.

`Feed all` is the exception: it acts on the card's own subject, so it performs the feed and
then re-renders the **Animals tab** in place with the result line as the message `content`.
The card stays alive rather than collapsing to a bare confirmation the way `alert:feedall`
does — that handler collapses because an alert DM has nothing to return to.

**Every tab carries a banner.** This was a deliberate choice over a text-only treatment for
the three detail tabs: a card with no image reads as a data panel rather than a screen of
the game. `dino_roster`, `landmark` and `guests` already exist under `assets/images/banners/`;
only Lots needs new art.

### Action-row budget

Discord allows five action rows per message, and a select menu occupies a whole row.

- Park — 2 rows (Collect, tab bar)
- Animals — 2 rows (Feed all + Full roster, tab bar)
- Lots — 3 rows (Build select, Upgrade select, tab bar)
- Prestige — 2 rows (Landmark + Guests, tab bar)

**Collect stays the first button of the first row.** `tests/park.test.ts:209-211` indexes
`components[0].toJSON().components[0]` positionally. That layout is required, not incidental
— record it here so a later reshuffle does not silently break the pin.

## 2. customId shapes

Two deliberately distinct actions, never one shape with a flag:

- `park:tab:<uid>:<tab>` — own card, **owner-locked**
- `park:vtab:<targetId>:<tab>` — visited card, **not** owner-locked; the id segment is a
  target, not an owner

Separate actions so a forged owner-locked id cannot masquerade as a public visit id. The
un-owner-locked visit shape has precedent: `park:tour:<targetUserId>`
(`src/modules/park/index.ts:440-448`) and `top:visit:<targetUserId>` both carry a target and
both deliberately have no ownership check, because visiting is public and read-only.

The visited card drops `Collect`, `Feed all`, `Build…` and `Upgrade…` entirely and keeps
`Next park ▶`.

### 2.1 The park handler has no default arm — add one in the same change

`src/modules/park/index.ts:401-465` is an if-chain over `action` with **no final `else`**.
An unrecognised `park:*` action returns without acknowledging, and Discord paints "This
interaction failed" after three seconds. A stale `park:tab:…` id from a renamed tab after a
later deploy lands exactly there.

Convert the chain to a `switch` with a `default` arm that `deferUpdate()`s, in the same
change that adds the tab row — the same fix `/park`'s subcommand dispatch already received,
and the same shape `dex`, `guests` and `leaderboards` already use.

### 2.2 The Park tab must defer before rendering

`renderPark`'s own `RENDER_TIMEOUT_MS` is 3000 — Discord's entire initial-response window —
and renders serialize process-wide, so queue wait stacks on top of it.

The Park tab handler does `await i.deferUpdate()` then `i.editReply(...)`. **Never a bare
`i.update`.** `deferUpdate`, not `deferReply`, because a tab advances one message rather
than accumulating one per click — the `park:tour` reasoning exactly. The other three tabs
are synchronous and may `i.update` directly.

### 2.3 Every tab switch carries an explicit `attachments: []`

A tab switch is a *different-banner* render. Without `attachments: []` the outgoing tab's
uploads (worst case `park.png` plus the featured-dino thumbnail) survive alongside the
incoming banner as orphan attachment cards.

This is the opposite of the omit-idiom `landmarkPayload` and the guests view use, and
CLAUDE.md documents that idiom without this exception — so it must be spelled out. Each tab
also builds a **fresh payload object**, never a memoised or module-level one: a single
payload reaching two send sites accumulates duplicate attachment ids (the
`fightFrames`/`finalPayload` rule).

### 2.4 A persistent header strip is free

Five of the card's fields are columns of the `users` row `getOrCreateUser` already returned
(`index.ts:107`) and cost **zero** marginal reads: park name, motto, cash, rating, landmark
tier. Food, Achievements and Seasons are one indexed read each.

So carrying **park name + Cash + Rating** across all four tabs costs essentially nothing, and
is the right home for what a player wants regardless of which tab they are on. Section 1's
table lists Cash and Rating under Park; they render on every tab.

## 3. Select menus — the real risk in this change

### 3.1 Router: add a branch, do not widen the existing one

`routeInteraction` currently hard-drops anything that is neither a command nor a button:

```ts
// src/core/router.ts:42-44
const isCommand = interaction.isChatInputCommand();
const isButton = interaction.isButton();
if (!isCommand && !isButton) return;
```

A `StringSelectMenuInteraction` is silently dropped today — no ack, no log — and the user
sees "This interaction failed" after three seconds.

`ComponentDef.execute` is declared with **method syntax** (`src/core/modules.ts:12-15`), so
its parameter is **bivariant**. Widening it compiles across all seventeen modules while
allowing a select menu to reach handlers written for buttons only.

**This was measured, not reasoned about.** Widening the parameter — to
`MessageComponentInteraction`, then to `ButtonInteraction | StringSelectMenuInteraction` —
and running `npx tsc --noEmit -p tsconfig.test.json` each time breaks **exactly one call
site**, an unrelated helper at `src/modules/battles/index.ts:85`. Everything else goes green.
Every one of the seventeen handlers opens with `i.customId.split(':')` and none reads
`i.values`, so a select dispatched into a button handler would silently run the button path
against the wrong payload shape.

The near-silence is the hazard, not the good news: the compiler will not force a review of
those handlers.

**Design:** a separate `selects: SelectDef[]` array on `ModuleManifest`, its own
`findSelect` on `ModuleRegistry` with its own duplicate-prefix check, and an
`interaction.isStringSelectMenu()` branch in `routeInteraction`. `ComponentDef` typing is
left untouched.

Prefixes live in **one flat namespace validated at boot** — a duplicate throws in
`ModuleRegistry`'s constructor and the bot never starts. `selects` gets its own map and its
own duplicate check, so a select and a button may both use the `park` prefix without
colliding.

### 3.2 The guard needs wiring, not changing

`clickedIdIsOnMessage` (`src/core/components.ts:47`) already accepts a
`MessageComponentInteraction` and matches on `c.customId`, recursing into nesting
components. A select menu's `customId` sits in the same place a button's does, so the guard
works unchanged — the select branch simply has to call it, with the same
`deferUpdate` + `logger.warn` rejection and the same `return` **before** `postDispatch`.

**What it proves:** the bot minted that menu, on that message.
**What it does not prove:** anything whatsoever about `i.values`. Submitted values are
client-supplied and must be validated server-side regardless of what Discord does or does
not check — the same discipline `parseDexFilters` (`src/modules/dex/service.ts`) applies to
client-supplied filter slugs.

### 3.3 A second guard for values, not a wider one

`clickedIdIsOnMessage` must stay exactly as it is. The **values** problem gets its own
sibling helper in `src/core/components.ts`:

```ts
submittedValuesAreOnMessage(i: StringSelectMenuInteraction): boolean
```

It walks to the clicked select on `Message#components` — the same unforgeable record the
existing guard reads — and checks `i.values ⊆ options.map(o => o.value)` plus the
`min_values` / `max_values` bounds, failing closed on the same terms.

**Kept as a separate exported function, never folded into `clickedIdIsOnMessage`**, which the
router calls for every component including buttons, where there are no values to check.

Recon could not confirm from `discord.js` 14.27.0 or `discord-api-types` that Discord's
gateway rejects a `values` entry absent from the option list, a selection count outside the
bounds, a duplicate value, or a click on a `disabled` component. **Design as if none of it is
enforced.** One consequence: **do not close a select flow by disabling the menu** — the guard
does not read `disabled`, so a disabled select is not a lock. Close a flow by removing the
component.

### 3.4 Build was NOT already safe — `buildLot` had a prototype-key hole

> **Amended.** An earlier version of this section put the fix in the Build *handler* and said
> it must "never rely on `buildLot`'s own check". That is now backwards. The fix lands in the
> data layer and in `buildLot` itself; the handler's allowlist is defence in depth. The
> history below is kept because it is the reason the design has this shape.

An earlier draft of this spec claimed a forged Build value fails closed on `buildLot`'s own
checks. That was wrong.

```ts
// src/modules/park/service.ts:85-86, as it stood
const paddock = PADDOCKS[kind]; const facility = FACILITIES[kind];
if (!paddock && !facility) throw new UnknownKindError(kind);
```

`PADDOCKS['constructor']` was **truthy** — it resolved up the prototype chain to `Object`,
with `.buildCost` `undefined` and `.name === 'Object'`. The guard did not fire. The write
survived only by schema accident: `cost` became `NaN`, better-sqlite3 bound `NaN` as `NULL`,
and the `users.cash` `NOT NULL` constraint rolled the transaction back.

`/build` cannot reach this — its `kind` comes from `addChoices`. **A select menu value can.**
Nine raw index sites exist across `src/`, and `upgradeCostFor` does `PADDOCKS[kind].buildCost`
with no guard at all.

**Fix, two layers, both kept.**

*Layer 1 — the tables themselves.* `PADDOCKS` and `FACILITIES` become null-prototype maps:

```ts
export const PADDOCKS: Record<string, PaddockDef> = Object.assign(
  Object.create(null) as Record<string, PaddockDef>,
  { herbivore_paddock: { /* … */ }, carnivore_paddock: { /* … */ } } satisfies Record<string, PaddockDef>,
);
```

The `as` and the `satisfies` are both load-bearing. `Object.create(null)` is `any`, so a bare
`Object.assign(Object.create(null), {…})` returns `any` and the literal silently loses its
`PaddockDef` check — a typo in a `buildCost` would stop being a type error.

This kills the whole class at all nine index sites at once, and turns `upgradeCostFor`'s
silent `NaN` into a loud `TypeError` at the read. It is safe to apply: nothing in `src/`,
`tests/` or `scripts/` uses `for…in` over either table, spreads one, or compares a whole
table with `toEqual`/`toStrictEqual`. Every access is dot-access or
`Object.keys`/`values`/`entries`, all of which ignore the prototype.

*Layer 2 — `buildLot` owns an explicit check.*

```ts
if (!Object.hasOwn(PADDOCKS, kind) && !Object.hasOwn(FACILITIES, kind)) throw new UnknownKindError(kind);
```

CLAUDE.md's own rule is that boundaries get validation, and a reader arriving at `buildLot`
should be able to see why it is safe without first knowing how the table was constructed.

The Build **handler** keeps the identical allowlist as defence in depth — never as the guard.
It earns its place for a concrete reason: 90 of 101 `fakeButton` sites, and every case in
`scripts/test-live.ts`, call `execute` directly rather than through `routeInteraction`, so
handler-level checks are what those paths actually exercise.

The *rest* of what `buildLot` re-derives at execution is correct and must not be duplicated
into the menu value: a stale "Build Gene Lab" option is already rejected by
`DuplicateFacilityError`, and a stale option on a now-full park by `LotLimitError`. Build's
cost is a flat per-kind constant — no level term, no world-event multiplier — so **Build
needs no staleness anchor**, only the allowlist.

### 3.5 Upgrade's stale-label overcharge reaches 90x

> **Amended.** An earlier version enforced the anchor in the *handler* only. `upgradeLot` now
> takes it as a **required** parameter and throws `StaleLevelError`; the handler check remains
> for its message, not as the lock.

`upgradeLot` scopes its lookup by `userId` (`and(eq(id), eq(userId))`), so a forged foreign lot
id is rejected — but it re-derived cost from `lot.level` **at execution time** while the menu
label was frozen at render time. For a paddock that cost is geometric:

```ts
// src/modules/park/service.ts:124
return Math.round(PADDOCKS[kind].buildCost * 2.5 ** level);
```

This is the `park:landmark:buy` incident in a new place: frozen label, re-derived price, no
refund path. **It is worse than the original.** The measured worst case is `hatchery_lab` — a
label reading 25,000 against a charge of 2,250,000, a **90x** overcharge, versus the landmark
defect's 32x.

A menu option's `value` therefore carries **identity plus a staleness anchor, never a price**.
The Upgrade option's value is `<lotId>:<expectedLevel>`; any price in the label is a display
copy no handler reads back.

**The lock lives in the service, not the handler.**

```ts
export class StaleLevelError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`expected level ${expected}, found ${actual}`);
  }
}

export function upgradeLot(ctx: Ctx, userId: string, lotId: number, expectedLevel: number): Lot
```

`expectedLevel` is **required, never optional** — the same rule that makes
`hungerAt(…, drainMs)`, `feedCostFor(now)` and `energyCostFor(now)` required. A default would
let a call site silently charge whatever the current level costs against a price the player
read at an older one. Required means a future caller cannot forget it: omitting it is a
typecheck failure rather than a 90x charge.

Two properties must survive future work.

1. **Guard order is not-found → stale → maxLevel.** At a stale level the max verdict is
   computed against a level the caller did not expect either, so "already max level" would name
   the wrong problem. The ordering is also what lets `/upgrade` pass a `-1` sentinel for an id
   it could not read and still get "No such lot." rather than a stale-level message.
2. **The argument must be the CLIENT-SUPPLIED anchor, never a level the caller just read.** At
   `park:upgyes` that is `Number(parts[4])`, parsed out of the customId. Passing the in-scope
   freshly-read `lot.level` instead compiles, typechecks, passes every test written for this
   feature, and makes the comparison `lot.level !== lot.level` — a guard that can never fire,
   silently voiding the entire mechanism. `/upgrade` is the one legitimate exception and needs
   a comment saying so: it carries no frozen label — the player names the lot and the charge
   happens on the same read — so there is no anchor to carry, and `lotRow?.level ?? -1` is the
   honest argument rather than a tautology waiting to be "fixed".

The confirm handler still performs its own fresh read, because it needs `lot.kind` and
`lot.level` to quote the price in the `InsufficientFundsError` branch — the hoist `/upgrade`
already does (`index.ts:257-260`). That read stays. It simply stops being the only thing
standing between a stale button and the money.

### 3.6 The two menus cannot share one error mapping

The service layer overloads two error classes:

- `UnknownKindError` means *unknown kind* in `buildLot` **and** *unknown lot* in
  `upgradeLot` (`service.ts:86`, `service.ts:130`)
- `LotLimitError` means *slot cap reached* in `buildLot` **and** *already max level* in
  `upgradeLot` (`service.ts:96`, `service.ts:133`)

A single handler serving both menus that reuses `/upgrade`'s mapping verbatim tells a player
"All lots full" when they meant "already max level". **Branch on which menu submitted before
mapping errors.** Keep `/upgrade`'s hoisted-read-for-the-price-quote pattern
(`index.ts:257-260`) for `InsufficientFundsError` — it is the only way to name the amount
without deriving it in a second place.

`StaleLevelError` (§3.5) is the one class that is **not** overloaded across the two menus: it
can only come from `upgradeLot`, and it means exactly one thing. It still needs an arm in
every catch chain that calls `upgradeLot`, `/upgrade`'s included — where it is unreachable
today, since the hoisted read and the service's own read happen in the same tick with no
write between them, but where `else throw e` on a spend path is not where anyone wants to
discover otherwise.

### 3.7 Confirm step

Both Build and Upgrade require a confirm click before spending. The confirm happens **in
place on the same message**, not as an ephemeral follow-up: the select `i.update`s the card
into a confirm state (tab bar retained, action row replaced with Yes / No), and Yes returns
to a freshly rendered Lots tab. The card is therefore never left displaying a level it has
just changed, and no ephemeral messages accumulate.

- `park:buildyes:<uid>:<kind>:<lotCount>` / `park:buildno:<uid>`
- `park:upgyes:<uid>:<lotId>:<expectedLevel>` / `park:upgno:<uid>`

The confirm buttons re-validate everything the select validated. The confirm click is a
second layer, never the guard — another open message may still hold a stale menu.

**Build carries a staleness anchor too, and it is `<lotCount>`.** §3.5's lock lives in the
service because an upgrade has a level to compare; a build has none and its price never
moves, so the anchor is the owner's lot count at mint time and the handler's own check of it
is the whole lock. Without it the id changes nothing when the purchase succeeds, so two
clicks landing before the first repaint both pass the owner check and both pass the
allowlist. `DuplicateFacilityError` stops the second for a facility. Paddocks are duplicable
by design, so it builds a second one — and since `lotSlots` caps at 10 with no demolish path
outside `adminReset`, the loss is a permanent slot rather than the cash. The count is a sound
anchor precisely because `buildLot` only ever increases it. It is validated in the same order
`park:upgyes` validates its level — integer parse, then a fresh read, both before any write —
and **no `await` may sit between that read and `buildLot`**: better-sqlite3 is synchronous and
Node is single-threaded, so a check-then-write with no suspension point between them cannot
interleave with a second interaction, which is what closes the race.

**`confirmPayload` returns four keys, and three of them are load-bearing in ways "renders in
place" does not imply.** None is derivable from the description above, so each is specified
here:

```ts
return {
  content: '',                 // an OMITTED key leaves the message's existing content pinned
  embeds: [embed],
  components: [yesNoRow, tabRow(user.discordId, 'lots')],
  attachments: [],             // lotsPayload attaches banners/lots.webp on every call
};
```

- **`content: ''`** — discord.js drops an omitted `content` key from the request body, and
  Discord then leaves the existing content unchanged. Concrete failure without it: confirm a
  build, so `renderTab` writes "Built **Gene Lab** (lot #4).", then pick an Upgrade option on
  that same card — the confirm renders with a success line pinned above a spend that has not
  happened.
- **`attachments: []`** — `lotsPayload` calls
  `attach(embed, payload, 'image', assetImage('banners', 'lots'))` unconditionally and
  `confirmPayload` ships no `files` of its own, so without this the banner strands as an orphan
  attachment card under the confirm embed. Same rule as §2.3, for the same reason.
- **The tab row is retained**, so a player mid-confirm is never one click away from losing
  navigation — the reason routed surfaces reply ephemerally rather than `i.update`-ing the card
  away.

**`renderTab`'s `lots` branch is an ADDITIVE edit, never a block replacement.** The two new
locals thread into the existing `lotsPayload` call; `if (tourRow) built.components.push(tourRow)`
and `content: content ?? ''` both stay exactly where they are. Dropping the first dead-ends a
park tour on the Lots tab with no way to advance short of re-running a command; dropping the
second discards every build and upgrade success line and leaves a stale one pinned. Neither is
caught by any existing test — the only `tourRow` regression test exercises the *Animals* tab.

## 4. Router hooks

`dailyRouterHooks.postDispatch` (`src/modules/daily/hooks.ts`) gates its hint on
`!i.deferred && !i.replied`. `i.update()` sets `replied = true`, so that gate **passes** for
a tab hop and a quest-complete or season-rung hint can fire on a navigation click.

This is accepted rather than fixed. It is bounded: `notifiedAt` and `hintedRung` are stamped
after the first successful send, so the hint fires once, not on every hop, and its text is
correct whenever it appears. Exempting the `park` prefix outright is **not** an acceptable
alternative — it would also kill the hint after `Collect` and `Feed all`, which are real
actions worth hinting.

`preDispatch` (`rollDailyQuests` + `rollSeason`) writes rows for the **clicker**, including
on a `park:vtab` click against someone else's park. That is already true of `park:tour`
today and is correct: the clicker took an action.

## 5. Read paths must not write

`attendanceOf` (`src/modules/park/attendance.ts`) is pure and must stay pure — it is read for
other players' parks. The Prestige tab on a **visited** card must not call `recomputeRating`,
which writes three columns including the live `parkRating`, a value `liveRating`
(`src/modules/trading/service.ts`) checks against `TRADE_MIN_RATING` at both `createTrade`
and `acceptTrade`. This is the same hazard `/guests view` already had to avoid by keeping
`recomputeRating` below its subcommand switch.

**No tab can be read-only in the absolute sense, and the spec should not pretend otherwise.**
`routeInteraction` writes on every component click before any handler runs — `touchPresence`
(`router.ts:47-52`), then `preDispatch`'s `rollDailyQuests` + `rollSeason`. The repo's
"a read path must never write" rule is about *feature* state, never the router's presence and
season bookkeeping. The achievable bar is: **a tab adds no new writes of its own beyond what
any button click already costs.**

Two feature-state writes need a deliberate decision:

- **`settleEscapes` is write-bearing and already runs twice per `/park view`** — once at
  `index.ts:183` and again inside `buildParkSnapshot` (`snapshot.ts:40-41`). Any tab showing
  the park image, the Dinos count or income drags it. **Settle once, at the top of the tab
  handler**, and let both consumers see the settled state. Do not add a no-settle mode to
  `buildParkSnapshot` — `docs/gameplay.md` states escapes settle when a command touches your
  park, and a no-settle path would make that untrue.
- **`bumpLegacyBest` writes; `legacyRank` is a pure twin at the same read cost.** The
  Prestige tab uses `bumpLegacyBest` on the **owner's Park tab only** — the first render of
  the card — and `legacyRank` everywhere else, including every Prestige render and the whole
  visit path. Latching the high-water on the default tab keeps the safety net armed on every
  `/park view` without making a navigation click mutate a row.

### 5.1 Tabs are a UI win, not a performance win — say so plainly

`/park view` costs **31 `SELECT`s** today, five of which repeat the same three-table read.
That redundancy is concentrated in field groups that land on different tabs, which is the
strongest argument *for* this design.

But the schema carries **exactly one index** (`drizzle/0006_daily_loop.sql:23`) — `dinos`,
`lots` and `attractions` are full table scans on every read, so per-tab cost scales with
*global* row count, not with the size of one park. A tab switch needing dinos + lots +
attendance is already ~8 reads. **Tabs save far less per switch than 31 suggests.**

Adding `user_id` indexes on `lots`, `dinos` and `attractions` is the higher-leverage change
and is deliberately **out of scope here** — recorded so it is chosen later on its merits
rather than smuggled in as a side effect of a UI change.

## 6. Blast radius

**Not triggered:**
- No new command, subcommand or option → **no `npm run deploy-commands`**
- No new module → the five-site registration checklist does not apply
- `tests/contract.test.ts:52` (29 top-level commands) — unaffected
- `tests/help.test.ts:84-89` (the `/park` subcommand scrape) — unaffected
- No migration, no new emoji → no `deploy-emojis`

**Pins that break, all in the Park tab's art:**

| Pin | Asserts | Cause |
|---|---|---|
| `tests/park.test.ts:947-956` | Featured field named, thumbnail is `attachment://tank-herbivore.webp`, `files` length 1 | Featured moves to the Animals tab, so this must target the Animals builder |
| `tests/park.test.ts:959-966` | no Featured field, `files` is `undefined` (not `[]`) | same |

**Two pins an earlier draft listed here do NOT break**, and the difference is worth
recording so nobody "fixes" them: `tests/park-view-image.test.ts:17` and `:31` exercise
`withParkImage` against **hand-built** payloads — `:17` calls
`dashboardPayload(u, [], 0, 0, 0)` with no featured dino, which produces no `files` at all,
and `:31` supplies its own `files: [existing]`. `withParkImage` itself is unchanged, so both
keep passing exactly as they are.

`tests/park.test.ts:205-216` (the Collect button label) reads
`components[0].toJSON().components[0]` and **keeps passing** provided Collect stays the first
button of the first row — see the action-row budget above.

**Added by the §3.5 amendment — pins that break on the `upgradeLot` signature change:**

| Pin | Cause |
|---|---|
| `tests/park.test.ts` — six `upgradeLot(ctx, 'u1', …)` call sites | Each gains a fourth argument. Every one must pass the level the lot is actually at, or it starts testing `StaleLevelError` instead of what it was written for — `:669`'s `toThrow(LotLimitError)` is the one that silently becomes a wrong-error test |
| `tests/stats-sites.test.ts:121` | Same, one site |

The `/upgrade` command itself (`src/modules/park/index.ts:262`) is the only production call
site. It already hoists `lotRow` for its price quote, so it passes `lotRow?.level ?? -1` for
free — see §3.5 for why the sentinel is correct there and why that site is exempt from the
"never pass a level you just read" rule.

The **§3.4 null-prototype change breaks no pin at all.** Nothing in `src/`, `tests/` or
`scripts/` uses `for…in` over either table, spreads one, or compares a whole table with
`toEqual`/`toStrictEqual`; `tests/data.test.ts`'s existing assertions are all dot-access.

## 7. Test work

- **`fakeSelect` in `tests/harness.ts`**, alongside `fakeButton`: carries `values`, enforces
  the same reply-once / defer-before-editReply lifecycle, and defaults `componentIds` to
  `[customId]` so the router guard is *exercised* rather than bypassed.
- Regression tests pinning each of:
  - a stale `expectedLevel` on `park:upgyes` is rejected and charges nothing
  - a stale `lotCount` on `park:buildyes` is rejected and builds no second lot
  - the Cancel half of each confirm (`park:buildno`, `park:upgno`) re-renders the Lots tab
    rather than acknowledging silently — asserting only that the confirm MINTS those ids
    leaves the handler deletable with the suite still green
  - a forged foreign `lotId` is rejected
  - a select menu whose customId is not on the message is rejected by the router guard
  - a forged `park:tab` anchored on a foreign message is rejected
  - a `park:vtab` click writes nothing for the target

**Every rejection pin above needs a POSITIVE assertion on the reply, not only on the state.**
This is the amendment's sharpest test finding and it applies to the whole list. A rejection
test that asserts only "cash unchanged, level unchanged" is satisfied twice over without any
implementation at all: the park component handler's pre-existing `default: await
i.deferUpdate()` arm writes nothing, and `upgradeLot` is already scoped by `userId`, so the
forged-foreign-lot case **cannot fail under any implementation**. Assert the specific message
or the specific `deferOpts` shape as well as the state.

The same trap sets the shape of the red gate: when a suite is run before the implementation
exists, name **which** cases are expected to go red. Two of the five upgrade cases pass on an
untouched `main`, so a bare "expected: FAIL" is satisfied by the other three and nobody learns
the two are inert.

**Three surfaces that ship with no coverage unless it is written deliberately:**

- **`confirmPayload` needs its own direct test** — tab row present, `attachments` is `[]`,
  `content` is `''`. Assertions that only `toContain` the yes/no customIds are satisfied by a
  builder that has none of the three (§3.7).
- **A visited Lots tab must pin that `park:tour:` survives.** The only existing `tourRow`
  regression test clicks the *Animals* tab, and the `park:vtab:<uid>:lots` case asserts on the
  embed title and the absence of owner-only buttons — so the loss described in §3.7 is
  currently invisible.
- **§3.4 and §3.5's own guards.** For §3.4: `constructor` / `__proto__` / `toString` /
  `valueOf` / `hasOwnProperty` all read back `undefined` on both tables. For §3.5: a mismatched
  `expectedLevel` throws `StaleLevelError` with the lot's level **and the user's cash** both
  unchanged — the level assertion alone still passes if the charge went through and the update
  failed.
- Router-level dispatch tests for the new select branch. The existing suite is structurally
  blind here: only 11 of 101 `fakeButton` sites route through `routeInteraction` at all, so
  a select-menu guard that is never wired would otherwise pass the whole suite green.

Three pieces of test *infrastructure* need changing, and none of them fails loudly if
skipped:

- **`tests/lib/discord-limits.ts` under-validates select payloads.** `rowSchema` applies the
  five-**buttons**-per-row cap (`:26-28`) and knows nothing about select menus — not the
  25-option limit, not label or value lengths. It needs a type-3 branch in the same change as
  the first select, or the harness's strongest existing net silently stops covering the new
  component and an illegal payload first fails at `test:live` against real Discord instead of
  in `npm test`.
- **`tests/router.test.ts`'s real-payload sweep harvests a select's `custom_id` but replays
  it through `fakeButton`** (`:384-386`, `:441`). Left alone it yields a green sweep proving
  only that the guard compares two strings — the exact vacuous pass the sweep's own header
  comment says it exists to prevent. Replay type-3 components through `fakeSelect`, add the
  select-bearing builder to `surfaces`, add its prefix to `PREFIXES`.

  **The select-bearing surface must REPLACE the existing Lots-tab entry in `surfaces`, not sit
  beside it as a standalone local.** The live entry passes no `buildable`, so under the menu's
  own `buildable.length > 0` guard it mints no select at all; the replay loop iterates
  `surfaces` only, so every component stays type 2, neither select guard is ever reached, and
  an anti-vacuity assertion written against a local variable passes while the sweep it guards
  stays vacuous. Convert every entry from ids to full components, keep the existing
  "acknowledged instead of dispatched" `deferOpts` assertion — it is the only thing separating a
  real dispatch from a guard acknowledgement — and include `park:upgrade:<uid>`, the one id in
  this work carrying a colon-separated payload past the owner segment.
- **`fakeSelect` must copy `fakeButton`'s lifecycle block wholesale**, including the
  `deferOpts` `kind` discriminator (`tests/harness.ts:261-274`). A thinner fake that only
  records replies cannot tell a correct `deferUpdate` rejection from a UX-breaking
  `deferReply` one — the subtlest property the router guard has. Pin the new
  `componentIds` default in `tests/harness.test.ts` beside the existing `fakeButton` case at
  `:70-79`; that test is the only thing keeping the default honest.

`tests/contract.test.ts` needs **nothing** — and that is the finding, not a reassurance. It
walks command options only, so it structurally cannot catch a select-menu mistake.

`scripts/test-live.ts` renders a select with no change to `toPost`, but its `button()` driver
cannot produce one; add a `select(m, customId, user, values)` helper mirroring `:317-321`. A
green `test:live` is **not** evidence the router routes selects — that script never calls
`routeInteraction`.

## 8. Assets

One new file: `assets/images/banners/lots.webp`, 1536×1024, produced with
`node scripts/fit-art.mjs banner <src> <dest>`. Prompt row added to `docs/assets/prompts.md`
alongside the existing banner family.

## 9. Documentation

Updated in the same change, not as follow-up:

- `docs/commands.md` — `/park view` gains tabs
- `docs/gameplay.md` — the park view section
- repo `CLAUDE.md` — the `SelectDef` pattern; the bivariance reason for *not* widening
  `ComponentDef`; the geometric-upgrade-cost lesson and the `<lotId>:<expectedLevel>` value
  contract; the Collect-must-stay-row-0 layout pin

  Three corrections belong in the same edit, because `CLAUDE.md` is the file every future
  implementer is told is authoritative and each of these would otherwise be written into it as
  a live fact:

  - The prototype-hole story must be recorded in the **past tense**, with the null-prototype
    maps and `buildLot`'s own `Object.hasOwn` named as the fix. The `NaN`-binds-as-`NULL`
    detail stays as history — it explains why the hole was survivable — but must not read as
    the current safety mechanism, and "never rely on `buildLot`'s own check" inverts the
    shipped design and must go.
  - `upgradeLot`'s required fourth parameter joins the `hungerAt(drainMs)` /
    `feedCostFor(now)` / `energyCostFor(now)` family, with the tautology warning from §3.5:
    the caller must pass the client-supplied anchor, never a level it just read.
  - The existing select-menu bullet says the guards are "never left to individual select
    handlers, **none of which exist yet**". One exists after this work; that clause is stale.

## 10. Operator steps

`npm run build` → restart the bot → `npm run test:live` for the gallery. Nothing
irreversible; no command deploy, no emoji deploy, no migration.

## 11. Sequencing

> **Superseded 2026-08-21.** This section described a two-PR split. The work is planned as
> three numbered PRs plus a standalone bug fix that was split out of the first, and §6's
> blast radius and §7's test-work list should be read against that boundary rather than
> this one.

**Two numberings are in play and they do not line up.** The plan documents number themselves
1–3; GitHub has merged three PRs so far. Plan PR 1's scope was split in two on the way out,
which is where the numbers diverge.

| Plan PR | GitHub | Landed | Contents |
|---|---|---|---|
| — (split out of plan PR 1) | **#41** | `0a6a7a2` | The park component handler's missing default arm, plus the spec and plan docs. A standalone bug fix that should not have had to wait on a feature |
| **1** — tabs | **#43** | `f8e02f4` | The four tabs, swapped in place, read-only on a visited park. Player-visible |
| **2** — select routing | **#44** | `8359f62` | `SelectDef`, `findSelect`, the router's select branch, both guards, `fakeSelect`. Engine only; no select minted |
| **3** — lot menus | next | not started | The Lots tab Build and Upgrade menus, both confirm steps, and the §3.4 / §3.5 hardening the menus make reachable |

`docs/superpowers/plans/2026-08-19-park-view-tabs-3-lot-menus.md` is titled "PR 3 of 4" and
that is correct on the plan axis — the fourth document is the unnumbered default-arm plan.
Nothing should be renumbered to make the two axes agree; they are counting different things.

The original reasoning survives the resplit and is why it is worth keeping: the `src/core/`
half can break all seventeen modules, so a router change deserves review against a `main`
where the tabs already work, rather than arriving mixed into a large cosmetic diff where a
bivariance mistake is easy to miss. Splitting the default-arm fix out was the same instinct
applied once more.

Plan PR 3 is the one that spends money, which is why the two hardening rulings ride with it
rather than shipping separately: they have no player-visible effect and are unreachable
through today's commands, so a standalone PR for them would be justified only by "a future PR
needs this".

## Decisions made and rejected alternatives

| Decision | Rejected alternative | Why |
|---|---|---|
| Four tabs | Three (Lots stays on Park) or two | Lots is the single biggest block on the card; leaving it on the default tab preserves the scroll the change exists to remove |
| Swap in place, owner-locked | Ephemeral side panels; unlocked kiosk | Panels do not read as tabs; unlocked lets one clicker change what everyone else is reading |
| Visited card gets read-only tabs | Leave the visit card dense | The density complaint applies equally there, and `park:tour` is precedent for a public, un-owner-locked target segment |
| Select menus for Build / Upgrade | Buttons only, slash commands retained | Buttons cannot take input; without them the Lots tab cannot close the dead-end complaint |
| Separate `selects` array | Widen `ComponentDef.execute` | Method-syntax bivariance makes the widening compile silently while letting select menus reach button-only handlers |
| Confirm on both spends | Validation only; confirm on Upgrade only | Chosen deliberately over the shipped landmark pattern; spends from a public card get an explicit yes |
| Every tab carries a banner | Art on Park only | A text-only card reads as a data panel rather than a screen of the game |
| Always open on Park | Remember last tab | Requires a new column for UI state; no other surface stores one |
| Compact alert marker on Park | Full breakdown on Animals only | Hiding an escaped dino behind a click is a visibility regression on the most time-sensitive state in the game |
| Routed surfaces open ephemeral | `i.update` the tab card | Would destroy the navigation the player is standing in, and the routed payloads mint their own components |
| Three numbered PRs plus a split-out bug fix | One, or the two-PR split this spec originally proposed | The `src/core/` half can break all seventeen modules and deserves review against a `main` where the tabs already work; the default-arm fix is a standalone bug fix that should not wait on a feature; and the money-spending menus are worth isolating from the cosmetic diff. See the superseded §11 |
| `submittedValuesAreOnMessage` as a sibling helper | Fold value-checking into `clickedIdIsOnMessage` | The router calls that guard for every component including buttons, which have no values to check |
| Null-prototype `PADDOCKS`/`FACILITIES`, **plus** an `Object.hasOwn` check inside `buildLot` | An allowlist in the Build handler only | The handler check leaves eight other raw index sites exposed, and `upgradeCostFor` has no guard at all — its silent `NaN` becomes a loud `TypeError` only once the table itself is fixed |
| `upgradeLot`'s `expectedLevel` is a **required** parameter | A level check in the confirm handler | Required makes omitting it a typecheck failure rather than a 90x charge; a handler check is one forgotten line away from the `park:landmark:buy` incident |
| `StaleLevelError` as its own class | Reuse `UnknownKindError` or `LotLimitError` | Both are already overloaded across `buildLot` and `upgradeLot` (§3.6); a third meaning on either would make the per-menu error mapping unwritable |
| `bumpLegacyBest` on the Park tab only | Everywhere, or nowhere | Keeps the high-water armed on every `/park view` without a navigation click mutating a row |
| `user_id` indexes left out of scope | Add them alongside the tabs | Higher-leverage change on its own merits; should not ride in as a side effect of a UI change |
