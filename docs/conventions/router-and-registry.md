# Router and registry

Fires on: `src/core/router.ts`, `src/core/components.ts`, `src/core/modules.ts`,
`src/core/module-list.ts`, `src/core/config.ts`, `src/core/logger.ts`,
`src/deploy-commands.ts`, `modules.json`, and the router / components / modules /
registry-load / config test files.

## Headlines

- A component interaction can be emitted straight at the gateway with any `custom_id`, anchored on any message the attacker can address, so a handler that merely parses its own segments is trusting the attacker's arithmetic: `clickedIdIsOnMessage` walking `Message#components` is the check, and without it any player could force a duel on any other and move their Elo. §clicked-id-on-message
- Never accept `Message#interactionMetadata.user.id` as authority — that was the first duel fix and the original exploit reproduced unchanged against it; the button set is the check. §authorship-not-authority
- Four placement details of the router's guard are each load-bearing, and moving any one of them breaks something different — from acknowledging every unclaimed customId prefix in existence to burning a one-shot quest stamp on a forged click. §router-guard-placement
- A module-level `clickedIdIsOnMessage` call is defence in depth now, not the enforcement; the duel one stays because direct-execute callers bypass the router entirely and would pass vacuously without it. §module-guard-defence-in-depth
- Do not assume a rejected click was a harmless repeat: on `alertPayload`'s one-row Feed all / Collect / Mute it can be a different real action the user wanted. §alert-row-rejection-exception
- The router guard closes CROSS-MESSAGE anchoring only and misreading that is the most likely way it causes harm — it does nothing about stale same-message replay, the class that already charged 32x on `park:landmark:buy`. §guard-scope-cross-message-only
- §router-guard-test-evidence
- Route selects through their own `selects?: SelectDef[]` and `findSelect` on `ModuleManifest`, never by widening `ComponentDef.execute` — that parameter is bivariant, so widening it typechecks almost everywhere while letting a select reach any of the seventeen button handlers, none of which reads `i.values`. §selects-have-their-own-namespace
- A select and a button may share a prefix; two selects may not. §select-and-button-may-share-prefix
- Selects are routed, and the id guard was extended to them in the same change — it proves the bot minted THIS MENU on THIS MESSAGE and nothing at all about `i.values`. §selects-own-namespace
- The router enforces BOTH select guards centrally, in a fixed order, with the same rejection shape and a distinct `logger.warn` each — never leave either to individual select handlers as its only proof. §router-enforces-two-select-guards
- `submittedValuesAreOnMessage` is what proves every submitted value was one the bot actually offered; the router calls it centrally because this repo already forgot a per-handler check once. §submitted-values-guard
- A handler MAY keep its own copy of a guard as defence in depth — direct-execute callers are off the router path — but shipping a select that relies on its own check instead of the router's is forbidden. §handler-guard-copies-are-defence-in-depth
- Reject a partly valid submission whole, never filter it: a shortened values array is a selection the player never made. §select-submission-all-or-nothing
- Build the offered-values lookup as a `Set`, never a plain object keyed by value — `__proto__` and `constructor` read back truthy from one. §offered-values-must-be-a-set
- Modals are not routed; if they ever are, extend `clickedIdIsOnMessage`'s walk to `SectionComponent.accessory` and `LabelComponent.component` in the same change, since both sit outside `.components`. §modals-and-other-selects-unrouted
- The four non-string select kinds (types 5-8) are not routed either — `isStringSelectMenu()` is false for all of them, so they fall through to the same silent no-op modals get and need their own predicate, namespace and pair of guards. §modals-and-nonstring-selects-unrouted
- If a button or select is ever minted onto a message the bot does not own, add an explicit greppable flag on `ComponentDef`/`SelectDef` — never a prefix exception list inside the router. §foreign-message-needs-flag

## clicked-id-on-message

Putting state in the customId (`park:landmark:buy:<uid>:<tier>`,
`dex:page:<uid>:<page>:<slugs>`) only helps if the handler also proves the bot MINTED
that id. A component interaction can be emitted straight at the gateway with any
`custom_id`, anchored on any message the attacker can address, and `routeInteraction`
(`src/core/router.ts`) dispatches on the customId PREFIX alone — it never checks that
the message belongs to the module handling it. So a handler that merely *parses* its
own segments is trusting the attacker's arithmetic. **A component handler must verify
the clicked customId is actually present on the message that carries it**:
`clickedIdIsOnMessage(i)` (`src/core/components.ts`) walks `Message#components` —
Discord's own record of the buttons the bot put there, unforgeable by the client —
and matches the whole id by exact equality, never a prefix. It fails CLOSED (no
components, no authority) and recurses into v2 containers, because failing to look
inside a nesting component would break a legitimate click rather than admit a forged
one. `duel:accept|decline` is the first caller and the reason the rule exists: without
it, any player could force a duel on any other and move their Elo, and a forged
`duel:decline` could blank an unrelated bot message via `i.update`.

## authorship-not-authority

**Message authorship is NOT a substitute** — the first fix bound the challenger
segment to `Message#interactionMetadata.user.id`, which proves only that the anchoring
message came from SOME interaction of that player's; a public `/park view`, a
`/duel record`, or their genuine challenge card addressed to a THIRD player all
satisfy it, and the original exploit reproduced unchanged against it. The button set
is the check; `interactionMetadata` is not read anywhere in `src/` any more.

## router-guard-placement

**That check is now enforced once, for every component, by the router itself.**
`routeInteraction` gates `comp.execute` on `clickedIdIsOnMessage(interaction)`, so a
forged customId anchored on a message that does not carry that button is rejected
before any handler runs. Four placement details are each load-bearing: it sits AFTER
`findComponent`, inside `if (comp)` (hoisting it would make the router acknowledge
every unclaimed customId prefix in existence, replacing the fully-silent no-op pinned
since the router was written); it rejects with `await i.deferUpdate()` and a
`logger.warn`, never a bare `return` (which paints "This interaction failed" after 3s
on every rejected click, an innocent pager double-click included) and never a distinct
text reply (an oracle telling an attacker the GUARD, not the handler, stopped him);
it `return`s BEFORE `postDispatch`, because `deferUpdate()` sets `i.deferred = true`
and `dailyRouterHooks.postDispatch` gates only on `!i.deferred && !i.replied`, so
falling through would emit a real quest/season followUp for a forged click and burn
the one-shot `notifiedAt` / `hintedRung` stamps; and it lives inside the existing
`try`, so a `deferUpdate()` that throws on an expired interaction is caught rather
than becoming an unhandled rejection.

## module-guard-defence-in-depth

Module-level `clickedIdIsOnMessage` calls are
DEFENCE IN DEPTH from here on — the duel one stays because callers that invoke
`comp.execute` directly bypass the router entirely: `scripts/test-live.ts`, and four
S1 regression fixtures in `tests/duels.test.ts` that dispatch the same way (via
`duelsModule.components[0].execute`, not through the router) and therefore FAIL
LOUDLY — not pass vacuously — if the duel handler's own call is deleted.

## alert-row-rejection-exception

Nearly every rejected click is a harmless repeat of the action that just ran — a
repaint race bounded to milliseconds — with one exception worth knowing: `alertPayload`
(`src/modules/park/alert-embeds.ts`) puts Feed all / Collect / Mute on ONE row and any
one of them wipes all three, so a click rejected there can be a DIFFERENT real action
the user wanted, not merely a repeat of the one that just ran.

## guard-scope-cross-message-only

**This closes CROSS-MESSAGE anchoring only, and misreading that is the most likely way
the guard causes harm.** It does NOT protect against stale-same-message replay — the
class that already cost real money on `park:landmark:buy`, whose stale buttons sat on
their own messages and would pass this guard cleanly. Every future button that spends
money, turns a page or names a rung still needs that state in its customId and
validated in its handler; the router guard relaxes none of that.

The anchors shipped today, and what each one is anchored against. A handler validates
its own segment strictly after the owner check (where there is one) and before any read
or write; the repaint that follows is a second layer, never the guard, because another
open message still holds a stale control.

| customId | Anchor segment | What a missing anchor costs |
| --- | --- | --- |
| `park:landmark:buy:<uid>:<tier>` | the tier being bought | the shipped defect: four clicks of one button labelled "Build Stone Marker" charged 32x its own label |
| `park:buildyes:<uid>:<kind>:<lotCount>` | the owner's lot count | a second paddock, permanently burning one of ten lot slots with no demolish path |
| `park:upgrade` menu value `<lotId>:<expectedLevel>` | the level the label was quoted for | up to 90x the quoted price (`hatchery_lab`: a 25,000 label against a 2,250,000 charge) |
| `season:claim:<uid>:<seasonIndex>` | the season the ladder belongs to | a card left open across a rollover paying this season's rungs against last season's ladder |
| `dex:page:<uid>:<page>:<rarity\|->:<diet\|->:<archetype\|->` | the active filters | the unfiltered page: wrong rows, wrong title suffix, wrong page count, no error |
| `admin:ledger:<targetId>:<page>:<all\|->` | the show-all flag | the same silent unfiltered page, on a financial history |
| `hatch:crack:<eggId>` | the egg | the wrong egg |

`pageRow` (`src/core/paginate.ts`) carries `<prefix>:<action>:<userId>:<page>` and
nothing else, which is why the two filtered lists above mint their own row instead —
see §filtered-lists-need-their-own-page-row in `embed-payload-builders`. Do not widen
`pageRow` to hold one caller's state.

## router-guard-test-evidence

The guard's tests are its only evidence, and that is not a figure of speech: the
overwhelming majority of `fakeButton` sites never reach `routeInteraction` at all —
only three test files dispatch through it — and `npm run test:live` bypasses the router
by its own design, so both existing gates are blind to this seam and a simulated version
of the guard ran the whole suite green. The nine cases live in `tests/router.test.ts`
("router component guard", plus the real-payload sweep that reads every minted id out
of the builder JSON rather than hand-typing it) and `tests/harness.test.ts` (the
`fakeButton` default `componentIds: [customId]`, load-bearing for every direct-execute
site). Do NOT add `componentIds` to the direct-execute sites: they test handler logic
and the default already models the truth.

**This passage deliberately carries no counts, and none should be added back.** Earlier
revisions pinned exact figures ("90 of 101", then "132 of 143") and both went stale — the
second time because the very commit correcting the number added five `fakeButton` sites of
its own, so it was wrong on arrival. A count written into prose is wrong the moment the
next test lands, and it is wrong silently. Derive the figures when you actually need them:
`grep -rc 'fakeButton(' tests/` summed, minus the one declaration site in
`tests/harness.ts`, gives the total; `grep -rl 'routeInteraction(' tests/` cross-referenced
against each of those files' own `fakeButton(` count gives the router-dispatching share.

## selects-have-their-own-namespace

Select menus route through their own `selects?: SelectDef[]` on `ModuleManifest`
(`src/core/modules.ts`) with their own `findSelect` and their own boot-time duplicate
check — NEVER by widening `ComponentDef.execute`. That declaration uses method syntax,
so its parameter is bivariant: widening it was measured to break exactly ONE call site
under `npm run typecheck` and go green everywhere else, while letting a select reach any
of the seventeen button handlers minted across this codebase's modules, every one of
which opens with `i.customId.split(':')` and none of which reads `i.values`.

## select-and-button-may-share-prefix

A select and a button MAY share a prefix — separate namespaces — but two selects may not.

## selects-own-namespace

Select menus are routed now, and the id guard was extended in the same change, exactly as
the router-guard passage called for while selects were still unrouted: they dispatch
through their own `selects` array and `findSelect` on `ModuleRegistry` (never by widening
`ComponentDef.execute` — see that type's own doc comment, and §selects-have-their-own-namespace
here, for why), and
`routeInteraction` gates the select branch on `clickedIdIsOnMessage` too, with the same
fail-closed `deferUpdate` + `logger.warn` rejection the button branch uses. That guard
proves the bot minted THIS MENU on THIS MESSAGE and **nothing about `i.values`**, which
ride outside the `custom_id` on a separate client-supplied channel.

## router-enforces-two-select-guards

`routeInteraction` gates the select branch on TWO guards, both enforced centrally by the
router — never left to individual select handlers as their only proof — in a fixed order:
`clickedIdIsOnMessage` first (exactly as it gates buttons), then
`submittedValuesAreOnMessage` (`src/core/components.ts`), only once the first guard has
already passed, since it reads the menu's own options off the message and is meaningless
before the menu itself is known to be the bot's. Each has the same `deferUpdate` +
`logger.warn` rejection shape as the button branch, and each guard's `logger.warn` carries
its own distinct message, so the two rejections read apart in logs even though the client
cannot tell them apart either way.

## submitted-values-guard

**The router calls a second guard centrally for the same reason it hoisted the first
one** — this repo's own history is the argument, since the id guard exists because a
per-handler check was forgotten once already. `submittedValuesAreOnMessage`
(`src/core/components.ts`) is what proves every submitted value was one the bot actually
offered on this menu; `clickedIdIsOnMessage` proves nothing about `i.values`, which arrive
on a separate client-supplied channel. No select handler validates its own values as a way
of satisfying this, and no handler NEEDS to re-prove "these values were on this menu",
because the router already has. A select handler still owns any DOMAIN validation beyond
that — e.g. that an offered option is still legal for the CURRENT state of a multi-step
flow.

One binding consequence lives in `embed-payload-builders`: never mint a select with
`min_values: 0`, since a legitimately empty submission from one fails this guard closed.

## handler-guard-copies-are-defence-in-depth

A handler MAY keep its own copy of a guard as defence
in depth, and the Lots tab's Build and Upgrade menus do exactly that: the router
is not on the path when `execute` is invoked directly, which is how
`scripts/test-live.ts` and all but a handful of this suite's dispatch sites reach a
handler. They re-implement `submittedValuesAreOnMessage` for that reason — the same
direct-execute-bypass reason the `buildLot` kind allowlist is duplicated in the menu
handler — but never `clickedIdIsOnMessage`, which the router alone proves. What is
forbidden is treating a handler-level copy as the PRIMARY enforcement —
the router's is primary, and a new select must not ship relying on its own check instead.

## select-submission-all-or-nothing

It is ALL-OR-NOTHING: a partly
valid submission is rejected rather than filtered, since a shortened values array is a
selection the player never made.

## offered-values-must-be-a-set

Only `submittedValuesAreOnMessage` needs a `Set` for
this — `offered = new Set(menu.options.map(o => o.value))`, never an object keyed by
value, since `__proto__` and `constructor` read back truthy from a plain object.
`clickedIdIsOnMessage` carries no equivalent risk to guard against: it never indexes into
anything by an attacker-supplied key, only walks `Message#components` and compares each
candidate to `i.customId` with `===`.

## modals-and-other-selects-unrouted

Modals remain UNROUTED: they fall through the router's top-level predicate check to a
silent no-op. If modals are ever routed, extend `clickedIdIsOnMessage`'s walk to follow
`SectionComponent.accessory` and `LabelComponent.component`, both of which sit outside
`.components`, in the same change.

## modals-and-nonstring-selects-unrouted

Neither are the non-string select kinds — user, role,
mentionable and channel selects, Discord component types 5-8. Routing STRING selects
did not cover them: `isStringSelectMenu()` reads false for all four, so they fall through
the router's top-level predicate check to the same silent no-op modals get. A future
implementer wiring one of those kinds up needs its own predicate, its own registry
namespace and its own pair of guards — not the assumption that "selects are routed now"
already covers it.

## foreign-message-needs-flag

And if a button or select is ever minted onto a
message the bot does not own, add an explicit greppable flag on `ComponentDef`/
`SelectDef` — never a prefix exception list inside the router.
