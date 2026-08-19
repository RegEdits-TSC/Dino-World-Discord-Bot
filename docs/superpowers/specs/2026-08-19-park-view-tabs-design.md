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
its parameter is **bivariant**. Widening it to
`ButtonInteraction | StringSelectMenuInteraction` therefore compiles clean across all
seventeen modules while allowing a select menu to reach handlers written for buttons only.
No existing test would catch that.

**Design:** a separate `selects: SelectDef[]` array on `ModuleManifest`, its own
`findSelect` on `ModuleRegistry` with its own duplicate-prefix check, and an
`interaction.isStringSelectMenu()` branch in `routeInteraction`. `ComponentDef` typing is
left untouched.

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

### 3.3 Build is already safe; Upgrade is not

`buildLot` (`src/modules/park/service.ts:84-97`) validates the kind against `PADDOCKS` /
`FACILITIES` (`UnknownKindError`), rejects a duplicate facility, enforces the slot cap
against `lotSlots(user.ratingHighWater)`, and takes cost from a **fixed** data-table value.
A stale or forged Build value fails closed on one of those three checks. **No extra state
in the customId is required.**

`upgradeLot` (`src/modules/park/service.ts:127-134`) scopes its lookup by `userId`
(`and(eq(id), eq(userId))`), so a forged foreign lot id is rejected — but it re-derives cost
from `lot.level` **at execution time** while the menu label was frozen at render time. For a
paddock that cost is geometric:

```ts
// src/modules/park/service.ts:124
return Math.round(PADDOCKS[kind].buildCost * 2.5 ** level);
```

So a menu reading "Upgrade #3 → lvl 4 · 250,000" charges 625,000 if anything bumped that lot
in between. This is the `park:landmark:buy` incident in a new place: frozen label,
re-derived price, no refund path.

**Fix, same shape as the landmark one:** the Upgrade option's **value carries
`<lotId>:<expectedLevel>`**, and the handler rejects when `lot.level !== expectedLevel`,
after the owner check and before any read or write.

### 3.4 Confirm step

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

`bumpLegacyBest` stays on the owner path only, never the visit path — the existing
`legacyRank` / `bumpLegacyBest` split.

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
