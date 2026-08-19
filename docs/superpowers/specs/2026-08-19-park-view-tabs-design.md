# /park view — tabbed navigation (spec 5b)

**Date:** 2026-08-19
**Status:** design approved, not implemented
**Depends on:** `main` at `d6a88a6`

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

### 3.4 Build is NOT already safe — `buildLot` has a prototype-key hole

An earlier draft of this spec claimed a forged Build value fails closed on `buildLot`'s own
checks. That is wrong.

```ts
// src/modules/park/service.ts:85-86
const paddock = PADDOCKS[kind]; const facility = FACILITIES[kind];
if (!paddock && !facility) throw new UnknownKindError(kind);
```

`PADDOCKS['constructor']` is **truthy** — it resolves up the prototype chain to
`Object`, with `.buildCost` `undefined` and `.name === 'Object'`. The guard does not fire.
The write survives today only by schema accident: `cost` becomes `NaN`, better-sqlite3 binds
`NaN` as `NULL`, and the `users.cash` `NOT NULL` constraint rolls the transaction back.

`/build` cannot reach this because its `kind` comes from `addChoices` — a **select menu
value can**. So the Build handler validates with an explicit
`Object.hasOwn(PADDOCKS, kind) || Object.hasOwn(FACILITIES, kind)` before calling
`buildLot`, and never relies on `buildLot`'s own check.

The *rest* of what `buildLot` re-derives at execution is correct and must not be duplicated
into the menu value: a stale "Build Gene Lab" option is already rejected by
`DuplicateFacilityError`, and a stale option on a now-full park by `LotLimitError`. **No
extra state in the customId is required for Build** — only the allowlist check.

### 3.5 Upgrade's stale-label overcharge reaches 90x

`upgradeLot` (`src/modules/park/service.ts:127-134`) scopes its lookup by `userId`
(`and(eq(id), eq(userId))`), so a forged foreign lot id is rejected — but it re-derives cost
from `lot.level` **at execution time** while the menu label was frozen at render time. For a
paddock that cost is geometric:

```ts
// src/modules/park/service.ts:124
return Math.round(PADDOCKS[kind].buildCost * 2.5 ** level);
```

This is the `park:landmark:buy` incident in a new place: frozen label, re-derived price, no
refund path. **It is worse than the original.** The measured worst case is `hatchery_lab` —
a label reading 25,000 against a charge of 2,250,000, a **90x** overcharge, versus the
landmark defect's 32x.

A menu option's `value` therefore carries **identity plus a staleness anchor, never a
price**. The handler passes the id to the existing service function and lets it charge; any
price in the label is a display copy the handler never reads back.

**Fix, same shape as the landmark one:** the Upgrade option's **value carries
`<lotId>:<expectedLevel>`**, and the handler rejects when `lot.level !== expectedLevel`,
after the owner check and before any read or write.

### 3.6 The two menus cannot share one error mapping

The service layer overloads two error classes:

- `UnknownKindError` means *unknown kind* in `buildLot` **and** *unknown lot* in
  `upgradeLot` (`service.ts:86`, `service.ts:130`)
- `LotLimitError` means *slot cap reached* in `buildLot` **and** *already max level* in
  `upgradeLot` (`service.ts:96`, `service.ts:133`)

A single handler serving both menus that reuses `/upgrade`'s mapping verbatim tells a player
"All lots full" when they meant "already max level". **Branch on which menu submitted before
mapping errors.** Keep `/upgrade`'s hoisted-read-for-the-price-quote pattern
(`index.ts:248-250`) for `InsufficientFundsError` — it is the only way to name the amount
without deriving it in a second place.

### 3.7 Confirm step

Both Build and Upgrade require a confirm click before spending. The confirm happens **in
place on the same message**, not as an ephemeral follow-up: the select `i.update`s the card
into a confirm state (tab bar retained, action row replaced with Yes / No), and Yes returns
to a freshly rendered Lots tab. The card is therefore never left displaying a level it has
just changed, and no ephemeral messages accumulate.

- `park:buildyes:<uid>:<kind>` / `park:buildno:<uid>`
- `park:upgyes:<uid>:<lotId>:<expectedLevel>` / `park:upgno:<uid>`

The confirm buttons re-validate everything the select validated. The confirm click is a
second layer, never the guard — another open message may still hold a stale menu.

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
| `tests/park-view-image.test.ts:31` | `files.map(f => f.name)` equals `['tank-herbivore.webp','park.png']` | Featured moves to the Animals tab; Park ships `park.png` alone |
| `tests/park-view-image.test.ts:17` | `files` has length 1 | same |
| `tests/park.test.ts:955` / `:964` | `files` length 1 / `undefined` | `dashboardPayload`'s output shape becomes per-tab |

## 7. Test work

- **`fakeSelect` in `tests/harness.ts`**, alongside `fakeButton`: carries `values`, enforces
  the same reply-once / defer-before-editReply lifecycle, and defaults `componentIds` to
  `[customId]` so the router guard is *exercised* rather than bypassed.
- Regression tests pinning each of:
  - a stale `expectedLevel` on `park:upgyes` is rejected and charges nothing
  - a forged foreign `lotId` is rejected
  - a select menu whose customId is not on the message is rejected by the router guard
  - a forged `park:tab` anchored on a foreign message is rejected
  - a `park:vtab` click writes nothing for the target
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

## 10. Operator steps

`npm run build` → restart the bot → `npm run test:live` for the gallery. Nothing
irreversible; no command deploy, no emoji deploy, no migration.

## 11. Sequencing

Two PRs, not one. The halves have very different risk profiles and the first is useful on
its own.

**PR 1 — tabs.** The four tabs, both customId shapes, the visited-park treatment, the
compact alert marker, the routed surfaces, the `lots.webp` asset, and the three broken art
pins. Touches the park module only. The Lots tab ships in this PR with its fields and its
banner but **no** Build / Upgrade menus — a line pointing at `/build` and `/upgrade` stands
in.

**PR 2 — select menus.** The `SelectDef` type, the registry's `findSelect`, the router's
`isStringSelectMenu` branch, the guard wiring, `fakeSelect`, the Build and Upgrade menus,
both confirm steps, and the `<lotId>:<expectedLevel>` contract. Touches `src/core/`, so it
is the half that can break all seventeen modules.

Splitting this way means a router change lands on its own, reviewable against a `main` that
already has the tabs working — rather than arriving mixed into a large cosmetic diff where a
bivariance mistake is easy to miss.

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
| Two PRs | One | The `src/core/` half can break all seventeen modules; it deserves review against a `main` where the tabs already work |
| `submittedValuesAreOnMessage` as a sibling helper | Fold value-checking into `clickedIdIsOnMessage` | The router calls that guard for every component including buttons, which have no values to check |
| Explicit `Object.hasOwn` allowlist on Build | Rely on `buildLot`'s own kind check | `PADDOCKS['constructor']` is truthy; the write survives only by a `NOT NULL` accident |
| `bumpLegacyBest` on the Park tab only | Everywhere, or nowhere | Keeps the high-water armed on every `/park view` without a navigation click mutating a row |
| `user_id` indexes left out of scope | Add them alongside the tabs | Higher-leverage change on its own merits; should not ride in as a side effect of a UI change |
