# Command and handler surface

Fires on: every `src/modules/*/index.ts`, plus `src/core/autocomplete.ts` and the
contract, autocomplete and settings test files that gate them.

## Headlines

- Slash commands live in `ModuleManifest`s (`src/core/modules.ts`), not in loose builder files. §commands-live-in-manifests
- An autocomplete provider only ever `i.respond(...)` — never `reply`/`defer`, which answers the wrong interaction type and kills the suggestion list. §autocomplete-respond-only
- Never call `getOrCreateUser` from an autocomplete provider: it would mint a user row on a keystroke. §autocomplete-no-user-creation
- Autocomplete providers are read-only; the one permitted write is `settleEscapes`, and only after guarding that the user row exists, because it crashes for unknown users. §autocomplete-read-only-except-settle-escapes
- Never sweep escrow in an autocomplete provider — `locksFor` is a pure read and a stale lock is no longer representable. §autocomplete-no-escrow-sweep
- A router-level error in an autocomplete provider degrades to an empty suggestion list, never a visible failure. §autocomplete-errors-degrade-empty
- Registering a new module touches five sites, and missing any one of them fails a specific test rather than the build. §module-registration-sites
- Any option flagged `.setAutocomplete(true)` needs a matching entry in `tests/contract.test.ts`'s `AUTOCOMPLETE_OPTIONS` — the manifest is bidirectional and fails either way round. §autocomplete-options-manifest
- An autocomplete handler is dead until the BUILDER advertises the option as autocompleting, and nothing fails while it sits dead — that is how `/sell`'s `dino` handler shipped unreachable. §setautocomplete-must-be-advertised
- Adding a plain boolean option is still a builder change and still needs `npm run deploy-commands`; it needs no `AUTOCOMPLETE_OPTIONS` entry and moves no command count. §boolean-option-is-a-builder-change
- Never call `emojiTag` in a module-level constant: the map loads after client ready, so module init freezes the unicode fallback permanently, and no test catches it because tests load no map. §never-emojitag-in-module-constant
- Never put a custom emoji tag in an autocomplete label — Discord renders it as literal text there, and no test catches that either. §never-emoji-tag-in-autocomplete-label
- A component's `prefix` must be the FIRST customId segment and nothing more: `prefix: 'admin:ledger'` matches nothing, the interaction is never acknowledged, and Discord paints "This interaction failed" after three seconds. §component-prefix-is-first-segment-only
- Every new component needs its own ROUTED test dispatching its real minted customId through `routeInteraction`; the generic gates will not cover you, and the ledger pager would have shipped dead without one. §routed-test-per-component
- Only one registry entry per prefix exists, so a handler takes the whole prefix and branches on the action segment internally — acknowledging an unrecognised action with `deferUpdate`, never a bare `return`. §one-entry-per-prefix-branch-internally
- A component handler's `switch` needs a `default` arm that `deferUpdate()`s: an unrecognised action that returns without acknowledging paints "This interaction failed" after 3 seconds, and a stale id from an older deploy lands there. §component-default-arm-must-acknowledge
- A button that spends money carries the rung, page or amount it was minted for in its customId, and the handler validates it — `park:landmark:buy:<uid>` omitted the tier and charged 32x its own label across four clicks of one button. §money-button-carries-its-rung
- Re-rendering the message on success is a second layer only, never the guard: any OTHER open message still holds a stale button. §repaint-is-second-layer-not-guard
- `park:tour:<targetUserId>` and `top:visit:<targetUserId>` carry a TARGET rather than an owner and must never grow an ownership check — that would make Visit work only for the player already on screen. §target-segment-customids-no-owner-check
- Acknowledge before rendering a park: `renderPark`'s own timeout is Discord's ENTIRE initial-response window and renders serialize process-wide, so rendering first cost the interaction to 10062 and showed "This interaction failed" with no park. §acknowledge-before-slow-render
- Keep the existence check AHEAD of the acknowledgement at all three visiting surfaces — "That player has no park yet" is an EPHEMERAL answer and either defer would have committed it to a public message. §existence-check-before-acknowledgement
- Every surface that hands a player a new object offers the next step as a control on that same message, and every such control is a row in the table in `tests/follow-through.test.ts` — the graph is convention, nothing structural, so that table is the only thing that catches a new surface minting an egg and forgetting to offer Incubate. §follow-through-graph-has-a-row-per-surface
- A follow-through control on a PUBLIC reply carries the owner's id and its handler rejects a mismatch BEFORE the service call — but only for `claimExpedition` and `startExpedition` is that check the write barrier, because both resolve the CALLER's own dig and take no id. For `incubateEgg`, `assignDino` and `feedDino` the service already filters on the caller, so the check buys the right SENTENCE on a public card and nothing more; never describe it as the protection. §follow-through-control-carries-the-owner-uid
- `hubView` (`src/modules/hub/service.ts`) reads across the game's subsystems onto one card and must never roll a quest board, roll a season, stamp a season hint or badge, recompute rating, bump the legacy high-water, expire a trade, record an alert, or claim anything — each is a write the rest of the codebase only ever reaches from a real command, and `tests/hub-nowrite.test.ts` is the gate that proves `hubView`/`hubCardPayload` touch none of them. §hub-is-a-read
- `hub:open` is minted as a raw string by the park dashboard and by the park alert DM, never imported from the hub module, so the hub stays a leaf and park never grows the other half of an import cycle; the mint is gated on `ctx.config.modules.hub`, and a renamed hub prefix or action breaks both entry points with no compiler or typecheck signal at all. §hub-open-is-minted-by-other-modules
- No control the hub renders may spend cash. Its reused controls split three ways on click — one self-heals its own card (`hatch:inc`), several replace the hub card outright with their owning module's own card (`hatch:crack`, `exp:claim`, `breed:claim`, `guests:claim`), and the rest leave the hub card standing with a now-stale label (`daily:claim`, `ach:claimall`, `season:claim`, `park:collect`) — `hub:refresh` exists for that last group alone, and the trade holds only as long as nothing behind any of them charges. §hub-controls-never-spend
- `hatch:crack` and `breed:claim` carry no owner segment; they are safe to mint on the hub only because ephemerality — established once, at `/hub`'s own reply and at `hub:open` — is inherited by every later `hub:*` update, making the surface visible to nobody but its owner. A property of the SURFACE those two ids happen to sit on, not of the ids themselves. §ephemeral-is-what-makes-the-reuse-safe

## commands-live-in-manifests

Slash commands live in `ModuleManifest`s (`src/core/modules.ts`). Commands
may define `autocomplete?(ctx, i)`. Components and select menus hang off the same
manifest; the router resolves both, and selects get a namespace of their own on it —
§selects-have-their-own-namespace in `docs/conventions/router-and-registry.md`.

## autocomplete-respond-only

Autocomplete providers only ever `i.respond(...)` (never `reply`/`defer`).

## autocomplete-no-user-creation

They never call `getOrCreateUser` — no row creation on
keystrokes.

## autocomplete-read-only-except-settle-escapes

They are read-only — the only permitted write is `settleEscapes`
(guard on the user row existing first: it crashes for unknown users).

## autocomplete-no-escrow-sweep

Escrow
no longer needs a sweep here: `locksFor` (`src/core/locks.ts`) is a pure read.

## autocomplete-errors-degrade-empty

Router-level errors degrade to an empty suggestion list.

## module-registration-sites

Registering a new module touches 5 sites: modules.json, `src/core/module-list.ts`
(the `ALL_MODULES` array), tests/registry-load.test.ts (command count),
tests/config.test.ts (expected modules), and `tests/contract.test.ts:49`
(the top-level command count in "every builder serializes"). `src/index.ts` and
`src/deploy-commands.ts` both import
`ALL_MODULES` from that one list rather than declaring their own, so they no
longer need a manual edit. A new module is also a builder change, so it needs
`npm run deploy-commands` too.

## autocomplete-options-manifest

`tests/contract.test.ts` also enforces a bidirectional autocomplete manifest, so any
option flagged `.setAutocomplete(true)` needs a matching entry in `AUTOCOMPLETE_OPTIONS`
there too — and an entry with no flagged option fails the same test from the other side.

## setautocomplete-must-be-advertised

A builder change is easy to miss, and an autocomplete handler that Discord was never
told about is dead code that fails nothing. Example: `/sell`'s `dino` option now sets
`.setAutocomplete(true)` — its autocomplete handler already existed but was
dead because the builder never advertised the option as autocompleting to
Discord — and that builder change needed its own one-time `npm run deploy-commands`
before the handler could ever be reached.

## boolean-option-is-a-builder-change

Adding an option like `/admin ledger`'s `show-all` is a builder
change, so it needs `npm run deploy-commands`; it is a boolean, so it needs no
`AUTOCOMPLETE_OPTIONS` entry in `tests/contract.test.ts` and moves no command count.

## never-emojitag-in-module-constant

**Never call `emojiTag` in a module-level
constant** (the map loads after client ready, so module init would freeze
the fallback permanently). The mistake fails no test, because tests load no map.
`HELP_TOPICS` storing a LAZY art descriptor rather than a built `ImageRef` is the same
class of mistake avoided.

## never-emoji-tag-in-autocomplete-label

**Never put a custom emoji tag in an
autocomplete label** (Discord renders it as literal text there). This mistake fails no
test either, for the same reason — stated in full as §emoji-mistakes-invisible-to-tests
in `docs/conventions/emoji-pipeline.md`. Food autocomplete labels use `FoodDef.fallback`
unicode rather than `emojiTag`/`foodEmoji` for exactly this.

## component-prefix-is-first-segment-only

One general rule worth stating on its own: **a
component's `prefix` must be the FIRST customId segment and nothing more.**
`ModuleRegistry.findComponent` (`src/core/modules.ts`) resolves a handler by
`customId.split(':')[0]`, so registering `prefix: 'admin:ledger'` matches nothing at all —
`routeInteraction`'s `if (comp)` falls straight through, the interaction is never
acknowledged, and Discord paints "This interaction failed" after three seconds. The ledger
pager was written that way and would have shipped dead.

## routed-test-per-component

Nothing STRUCTURAL catches an unreachable prefix: the
registry's boot-time duplicate check only rejects a REPEATED prefix, never an unreachable
one, and the router's real-payload sweep builds a synthetic registry from a hardcoded prefix
list rather than resolving any real manifest's. What catches it is a per-component ROUTED
test — one that dispatches the real minted customId through `routeInteraction` against a
registry built from the real `ALL_MODULES` and asserts a reply lands — and the ledger pager
has one (`tests/admin.test.ts`, "routes the real Next button through the registry"). Every
new component needs its own; the generic gates will not cover you.

## one-entry-per-prefix-branch-internally

Only one entry per prefix may exist, so a handler takes the
whole prefix and branches on the id's own action segment internally — `park` dispatching
`park:tab`, `park:vtab` and `park:tour` from one entry is the pattern — acknowledging an
unrecognised action with `deferUpdate`, never a bare `return`, for exactly the reason
§component-default-arm-must-acknowledge documents.

## component-default-arm-must-acknowledge

The park COMPONENT handler is the worked example: its `action` chain is
a `switch` with a `default` arm that `deferUpdate()`s, because an unrecognised
`park:*` action previously returned without acknowledging and Discord painted "This
interaction failed" after 3 seconds. A stale id from an older deploy lands there. Any
future park component action MUST be added as its own `case`.

## money-button-carries-its-rung

A monotone ladder with only one buyable rung at any moment looks as though it has nothing
to mis-buy. That argument holds for the FUNCTION and not for the SURFACE, and the difference
cost real money before it was fixed. `park:landmark:buy:<uid>` carried no tier and
its handler answered with `i.reply`, so an old `/park landmark` message kept its
original label and a live button forever while `buyLandmark` re-derived `current + 1`
on every click: four clicks of one button labelled "Build Stone Marker" charged
5,000,000, then 10,000,000, then 20,000,000, then 40,000,000 — 32x its own label,
against a feature that ships no refund path precisely because a monotone ladder was
believed to have nothing to mis-buy. The customId is now
`park:landmark:buy:<uid>:<tier>` (the `hatch:crack:<eggId>` /
`dex:page:<uid>:<page>:<slugs>` precedent — 40 of Discord's 100 characters at a
20-digit snowflake), and the handler validates the parsed tier as an integer rung and
rejects anything that is no longer `current + 1`, in that order, after the owner check
and before any read or write.

Any future button that spends money needs the same treatment: the rung, page
or amount it was minted for belongs in the customId, because a Discord message is
durable and its label is not re-derived. The full set of anchors shipped today is
tabulated under §guard-scope-cross-message-only in
`docs/conventions/router-and-registry.md`.

## repaint-is-second-layer-not-guard

The success path additionally answers with `i.update` of
a freshly built `landmarkPayload`, so the message just used advances to the next rung —
but that is a second layer only, never the guard: any OTHER open message still holds a
stale button, which is why the tier check is what actually protects the purchase.

## target-segment-customids-no-owner-check

`park:tour:<targetUserId>`
(`src/modules/park/index.ts`) and `top:visit:<targetUserId>`
(`src/modules/leaderboards/index.ts`) are the repo's first customIds whose id
segment is a TARGET rather than an owner — visiting is public and read-only, so
neither carries an ownership check and neither should ever grow one; turning either
into an ownership check would make Next park / Visit work only for the player whose
park happens to already be on screen.

## acknowledge-before-slow-render

Both of those visiting surfaces render somebody else's park behind an interaction, and
BOTH acknowledge before they render — `park:tour` with `deferUpdate` + `editReply`
(a tour advances ONE message rather than accumulating one per hop; `deferReply` would
post a new one), `top:visit` with `deferReply` + `editReply` (the board it sits on must
survive the click). That ordering is not stylistic: `visitPayload` awaits `renderPark`,
whose own `RENDER_TIMEOUT_MS` (`src/core/render/client.ts`) is 3000 — Discord's ENTIRE
initial-response window — and renders serialize process-wide through one chain, so queue
wait stacks on top of the timeout. Rendering first cost the interaction to 10062 and
showed "This interaction failed" with no park, which is also the one case `visitPayload`'s
own `catch { png = undefined }` text-only degrade can never be delivered for.

## existence-check-before-acknowledgement

The
existence check stays AHEAD of the acknowledgement at all three surfaces (`park:tour`,
`top:visit`, `/park view user:`), because "That player has no park yet" is an EPHEMERAL
answer and either defer would have committed it to a public message.

## follow-through-graph-has-a-row-per-surface

Every surface that hands the player a new object offers the next step on it as a control on the
same message: an egg gets Incubate, a newly hatched dino gets Assign, a claimed expedition gets
Dig again. Those controls are minted per module, on each module's own existing prefix, rather
than through a central registry. A central one was considered and rejected twice over: a single
`next:` prefix means one handler switching over every module's actions, which is the shape
§one-entry-per-prefix-branch-internally exists to prevent, and such a registry would have to
import from every module, inverting the dependency direction the repo has today.

The price of that choice is that NOTHING structural holds the graph together. Nothing stops a
future surface minting an egg and never offering Incubate; the code compiles, `npm run typecheck`
is clean, and every other test passes. The only symptom is a player typing a command they should
not have had to. `tests/follow-through.test.ts` is the whole defence: one table of (surface,
expected customId) pairs, each row driving the real surface, asserting the minted payload actually
carries the id, then dispatching that id back through `routeInteraction` and asserting the
database effect. A new surface that hands out an object adds its row there in the same change —
and the table only catches the omission if whoever adds the surface also adds the row.

That table also owns the ONE whole-list assertion. Two of those payloads are built by two
different modules pushing onto the same array (`/expedition claim` carries Dig again and Incubate;
`/shop egg` carries Buy another and Incubate), so a components array is always built as a named
local and PUSHED onto, never assigned wholesale — an assignment deletes the other module's control
with no error anywhere. Per-surface tests therefore assert only the id they own, with `toContain`,
and the full ordered list is pinned in the contract table alone, so a deleted control and an
undeclared new one are each a single findable failure rather than several contradictory ones.

A CROSS-MODULE mint is gated on the handler's module being enabled — `ctx.config.modules.<name>`,
read off `Ctx.config` (`src/core/context.ts`, `src/core/config.ts`). `ModuleRegistry` filters to
enabled modules before it resolves anything (`src/core/modules.ts`), so a `hatch:inc` button minted
by the shop while the hatchery module is off is a control nothing answers at all, sitting on a
durable message that outlives the deploy that disabled it. A mint by the module that also handles
the id needs no gate: it is a condition that cannot be false.

A follow-through control REPLIES or UPDATES; it never defers. Every action behind one is
synchronous DB work with nothing to wait on, so the contract test treats a `deferUpdate` as a
router rejection rather than a dispatch — which is also what makes it able to tell "the handler
answered" apart from "no handler resolved for this prefix at all", the silent shape
`routeInteraction` takes when `findComponent` misses.

Two shapes are settled and should not be re-litigated per surface. A control that spends CASH goes
behind a two-step confirm whose second button carries the price it quoted, and the handler refuses
when the price has moved: §money-button-carries-its-rung applied to a number that genuinely moves,
since expedition fees shift with the day's world event and egg prices roll at UTC midnight. A
control that spends FOOD does not: `park:feedall:<uid>` has consumed food on one click since it
shipped, and putting a confirm on one food button but not the other would make the two disagree
for no reason a player could infer.

A follow-through control that NAVIGATES rather than acts replies EPHEMERALLY under the
`park:goto:<target>:<uid>` shape — `park:goto:lots:<uid>` is the hatch reveal's "Build a paddock" —
and never reuses `park:tab:<uid>:<tab>`. `park:tab` ends in `renderTab`, which `i.update`s the
message it was clicked from; the hatch reveal is public, so that would destroy the reveal and leave
the owner's private Lots card sitting in the channel. Note the owner id sits at index 3 in a `goto`
id, not index 2, which is why that arm re-destructures its parts. That ephemeral also strips the
tab row `lotsPayload` appends unconditionally, unlike its landmark/guests/roster neighbours: left
in, one tab click would advance THIS message and hand the player a second, parallel park card
beside the one they opened it from.

## follow-through-control-carries-the-owner-uid

`/expedition claim`, `/shop egg`, `/build` and the hatch reveal are PUBLIC messages, so anyone in
the channel can click a button sitting on one. Every follow-through customId therefore carries the
owner's id, and its handler rejects a mismatch before the service call — the same explicit check
`exp:claim` already performed before this work.

What that check actually buys differs by service, and the difference is worth stating precisely
because getting it backwards produces a comment that lies. `claimExpedition` takes no id at all and
`startExpedition` dispatches the clicker's own crew: both always resolve the CALLER, so without the
owner check a bystander's click on somebody else's card does not fail — it silently succeeds
against their OWN expedition. There the check IS the barrier. `incubateEgg`, `assignDino` and
`feedDino` each filter their own read on `userId` already, so a bystander is refused with or
without it; there the check buys a legible sentence ("That is not your egg.") on a public card
instead of a confusing one about something the clicker never named. Do not write a comment calling
either kind "the protection" without checking which one you are holding.

This is also the mirror image of §target-segment-customids-no-owner-check, where the id segment
names a TARGET and an ownership check would break the feature outright. Check which kind of segment
you are holding before copying either pattern.

## hub-is-a-read

`hubView` (`src/modules/hub/service.ts`) reads across the game's subsystems onto one card — eggs,
expeditions, breedings, park clock state (`toClockDinos`, called once and threaded through every
later section rather than re-read), trades, daily quests, achievements, season, guests and battle
energy — and every one of those subsystems normally sits behind its own write the moment a player
looks at it through its OWN command: `/daily` calls `rollDailyQuests`, `/season` calls `rollSeason` and, once a hint has
gone out, `stampSeasonHint`; `/park view` and its siblings call `recomputeRating`; `/dex` and
`/park` call `bumpLegacyBest`; `/trade` calls `expireStale`; the alert sweep inserts into
`alertsSent` (`src/modules/park/alert-record.ts`). `hubView` must never call any of them, and the
list is worth stating by name because "a read must not write" is too generic to catch a specific
reuse — each renders EVERY subsystem in one pass, so a mistake here fires on every hub open rather
than once per subsystem's own screen, and each is a distinct, unrecoverable loss:

- `rollDailyQuests`/`rollSeason` each guard on a row existing for today's key and short-circuit
  once it does. Calling either from a read consumes the "first touch of the day" the real command
  owns, and there is no way to tell that write apart from the player's own later, deliberate one.
- `stampSeasonHint` moves `hintedRung` forward permanently (`src/modules/daily/season.ts`); a hub
  render that stamped it would forfeit the notification `dailyRouterHooks.postDispatch` was
  supposed to send.
- `recomputeRating` (`src/modules/park/rating.ts`) writes the LIVE, non-monotone `parkRating`
  column (`ratingHighWater` is the separate monotone one) — `trading/service.ts`'s `liveRating`
  reads that same column, and both `createTrade` and `acceptTrade` refuse below
  `TRADE_MIN_RATING`. A hub-triggered recompute that lands a lower live rating than the one on
  file — a dino escaped, comfort dropped — can turn an otherwise-acceptable pending trade into a
  rejected one the moment its recipient tries to accept, decided as a side effect of the SENDER
  opening their own hub.
- `bumpLegacyBest` latches a monotone high-water (`src/modules/park/ranks.ts`); calling it from a
  read banks a legacy rank the player never asked to lock in.
- `expireStale` closes a trade the instant its clock runs out, rather than leaving that judgment to
  the same createdAt-based filter `hubView`'s own trade-incoming row already uses to decide
  whether to SHOW it. The comment beside that row states the rule directly: "a render must never
  close another player's offer as a side effect of being looked at."
- Recording an alert (the `alertsSent` insert) marks a warning as sent; a read that recorded one
  would silently suppress the real alert sweep's own DM later.
- Claiming anything — the service calls behind `daily:claim`, `ach:claimall`, `season:claim`,
  `guests:claim` — hands out cash, shards, food or an egg. The CLAIM section renders these as
  buttons precisely so `hubView` itself never touches a reward path; the button's own handler, not
  `hubView`, is what may claim.

`tests/hub-nowrite.test.ts` is the gate. It seeds one park live across every branch `hubView` and
`hubCardPayload` can take — an egg in every incubation state, a returned dig, a finished and a
still-cooking pairing, an at-risk, an escaped, an unassigned and an off-diet dino, a claimable
achievement tier and attendance milestone, income both pending and capped, a live incoming trade
offer and an already-expired one nothing has closed — then asserts every table in that forbidden
list (`dailyQuests`, `seasonProgress`, `achievementClaims`, `alertsSent`, `trades`, `eggs`,
`expeditions`, `breedings`, `dinos`, `lots`) and the `users` row itself read back byte-identical
before and after calling `hubView` then `hubCardPayload`.

## hub-open-is-minted-by-other-modules

`hub:open:<userId>` is minted in two places that are not the hub module at all: the park
dashboard (`src/modules/park/embeds.ts`, behind `opts.hub`) and the park alert DM
(`src/modules/park/alert-embeds.ts`, behind its own `hub` parameter). Both mint it as a RAW
STRING template rather than importing anything from `src/modules/hub/`. That is deliberate: the
hub is written as a leaf that imports park, daily, guests, expeditions, genelab and battles to
build its own rows, and the moment park imported the hub back, the pair would be a cycle — the
whole "hub reads everything, nothing reads the hub" shape the module depends on would be gone.

Both mints are gated on `ctx.config.modules.hub` (`src/modules/park/index.ts` passes it through
as `hub: ctx.config.modules.hub`; `src/modules/park/alert-sweep.ts` passes the same flag into
`alertPayload`), for the reason §follow-through-graph-has-a-row-per-surface already states for
every cross-module mint: `ModuleRegistry` filters to enabled modules before resolving anything, so
an ungated `hub:open` button minted while the hub module is disabled is a control sitting on a
durable message that answers nothing at all.

Because neither mint imports the hub module, nothing at COMPILE time ties the string `'hub:open'`
to `hub/index.ts`'s own `prefix: 'hub'`. Renaming that prefix — or renaming the `open` action
inside it — breaks both entry points silently: `npm run typecheck` stays clean, every hub-only
test stays green, and the only symptom is a button on a park card or an alert DM that Discord
acknowledges with nothing happening. The whole-game router sweep in `tests/router.test.ts` is
what actually catches this, but only because `hub` was added to that test's own hardcoded
`PREFIXES` array — that array builds a SYNTHETIC registry from a fixed prefix list, not a
resolution of the real `ALL_MODULES`, so a component whose prefix is absent from `PREFIXES` is
invisible to the sweep rather than failing it. Adding a new cross-module mint means adding its
prefix there too, or the sweep silently tolerates exactly the defect it exists to catch.

## hub-controls-never-spend

The hub renders its READY and CLAIM rows by minting other modules' own customIds verbatim —
`hatch:crack`, `hatch:inc`, `exp:claim`, `breed:claim`, `daily:claim`, `ach:claimall`,
`season:claim`, `guests:claim`, `park:collect` — rather than growing proxy handlers of its own.
What each of those does to the HUB CARD once clicked is not one shape but three, and only one of
the three is what `hub:refresh` actually answers:

- **Self-heals.** `hatch:inc` (`src/modules/hatchery/index.ts`) answers with `i.update`, but it
  rebuilds `components` from `i.message.components`, filtering out only the row entry matching its
  own `custom_id`, and replaces `content`. The hub card's own embed and its other buttons —
  Refresh included — survive untouched; only the incubate button itself disappears, correctly,
  since that egg is no longer idle.
- **Replaces the card outright.** `hatch:crack`, `exp:claim`, `breed:claim` and `guests:claim` each
  answer with `i.update` too, but of their OWNING module's own reveal/claim card — a hatch reveal,
  an expedition claim card, a breeding claim card, the guests view — new embed, new components, no
  reference back to the hub at all. The hub card is gone, not stale; there is nothing left standing
  to refresh.
- **Leaves the hub card standing, now stale.** `daily:claim`, `ach:claimall` and `season:claim`
  (`src/modules/daily/index.ts`) and `park:collect` (`src/modules/park/index.ts`) each answer with
  a brand-new EPHEMERAL `i.reply` of their own — a separate message — rather than touching the
  message the button was clicked from. The hub card the player opened `/hub` on is left exactly as
  it rendered, still naming a quest, an achievement tier, a season rung or pending income as ready,
  even though it no longer is.

`hub:refresh:<userId>` (`hubCardPayload`, `ButtonStyle.Secondary`, alone on its own row) exists for
the last group alone: it is the only one where the card outlives an action that changed what the
card says. The self-healing group needs no help. The card-replacing group needs no refresh either,
for a different reason — the card is gone, and the only way back to a live one is reopening
`/hub`, an acceptable recovery only because the hub is cheap to reopen: one ephemeral command, no
state lost, nothing charged for looking.

None of that changes the rule that actually matters: no control the hub currently mints spends
cash — every one of the nine is a claim, an incubate, a feed, or a collect. A stale label on a free
action is cosmetic; the same staleness on a control that spends money is the exact defect this repo
already paid for once — §money-button-carries-its-rung's landmark incident is what a stale PRICE
looks like, not a stale count. A future hub row must not mint one of the two-step cash-confirm ids
(`park:landmark:buy:<userId>:<tier>`, `shop:againyes:<userId>:<rarity>:<price>`,
`exp:againyes:<userId>:<siteId>:<price>`-shaped controls) without re-litigating this trade first —
and if it lands in the stale-standing-card group, it inherits that group's staleness with none of
its "worst case is cosmetic" excuse.

## ephemeral-is-what-makes-the-reuse-safe

`hatch:crack:<eggId>` and `breed:claim:<pairingId>` are the two hub-minted ids that carry no owner
segment at all — contrast `hatch:inc:<userId>:<eggId>`, `exp:claim:<userId>`,
`daily:claim:<userId>` and the rest of the hub's controls, which all carry the clicking player's
own id somewhere in the customId. Both handlers (`hatchEgg` in `src/modules/hatchery/service.ts`,
`claimBreeding` in `src/modules/genelab/service.ts`) do filter their read on `userId` — a bystander
who somehow clicked either would get "You do not own that egg." / "No such breeding." back, the
same shape §follow-through-control-carries-the-owner-uid already documents for
`incubateEgg`/`assignDino`/`feedDino`. That filtering is real, but it is not why these two ids are
safe to hand out with no owner segment: it is incidental to their OWN surfaces (`/hatch`'s reveal,
`/breed claim`'s reply), which were already scoped to the caller before the hub ever reused them.

What actually makes them safe on the hub is narrower and does not depend on that filtering.
Ephemerality is established at exactly two entry points — the `/hub` command's own reply and the
`hub:open` action — both of which set `flags: MessageFlags.Ephemeral` explicitly
(`src/modules/hub/index.ts`) — and is INHERITED from there by everything downstream: `hub:refresh`
and `hub:feedall` both answer with `i.update` and set no `flags` of their own, because Discord
never lets an `i.update` change a message's ephemeral status — editing an already-ephemeral message
keeps it ephemeral with nothing further to set. So every `hub:*` card the player ever sees is
ephemeral, but the code establishes that fact once per open rather than fresh on every render, and
what `hatch:crack`/`breed:claim` actually ride on is that INHERITED ephemerality, not a flag either
of those two branches sets for itself. Either way, Discord shows the card — and therefore the
button — to nobody but the player who ran `/hub` or clicked `hub:open`. No other player's client
ever renders a `hatch:crack` or `breed:claim` button minted on someone else's hub, so there is no
bystander left to test the ownership filter against in the first place. That is a property of the
SURFACE — an ephemeral, owner-only delivery Discord itself guarantees once established — not of
the id.

Neither id becomes safe to mint on a PUBLIC message on the strength of that filtering. A public
surface exposes the button to everyone in the channel, and the two ids carry nothing to
distinguish "the owner clicked this" from "a bystander clicked this" for a reader of the customId
alone — only the service call downstream does that today, and reusing either id on a future public
surface without first confirming (or adding) that same filtering would reopen the exact class of
bug §follow-through-control-carries-the-owner-uid exists to close, this time with no id-level
signal for review to catch.
