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
