# The /park surface

Fires on: the park module's command and view code — `src/modules/park/index.ts`,
`embeds.ts`, `visit.ts`, `showcase.ts` and `dinos.ts` — plus `src/core/text.ts`, and the
suites that cover them (`tests/park.test.ts`, `tests/park-tabs.test.ts`,
`tests/visit.test.ts`, `tests/showcase.test.ts`, `tests/lot-menus.test.ts`).

## Headlines

- Every `/park` subcommand MUST be added as its own `case`: before the switch existed a brand-new subcommand fell through unguarded to the dashboard and reported success for a command that did nothing. §park-subcommand-switch-with-default
- `/park`'s `autocomplete()` serves `feature`'s `dino` option, so `'park feature': ['dino']` has to stay in `tests/contract.test.ts`'s `AUTOCOMPLETE_OPTIONS` manifest — that file enforces the mapping bidirectionally. §park-feature-autocomplete-manifest
- `park:tab:<uid>:<tab>` is owner-checked and `park:vtab:<targetId>:<tab>` carries a TARGET and deliberately is not; never merge them into one shape with a flag. §park-tabs-two-customid-families
- Every tab switch sends an explicit `attachments: []` — the Park tab carries no `files` key at all when `renderPark` fails, and without it the PREVIOUS tab's uploads survive as orphan attachment cards under the failed render's embed. §tab-switch-explicit-attachments
- The Park tab `deferUpdate()`s BEFORE rendering and then `editReply`s: `RENDER_TIMEOUT_MS` is 3000, Discord's whole initial-response window, and renders serialize process-wide, so rendering first can lose the interaction to 10062. §park-tab-defers-before-render
- `settleEscapes` runs ONCE per interaction in `renderTab`, never per builder — it is write-bearing and `buildParkSnapshot` settles again internally. §settle-escapes-once-per-interaction
- `bumpLegacyBest` fires once per `/park view` COMMAND invocation and never from a tab click; every tab builder and the whole visit path read the pure `legacyRank` instead, so a navigation click never mutates a row. §bump-legacy-best-once-per-command
- Collect must stay the first button of the first row — `tests/park.test.ts:208-218` indexes `components[0].toJSON().components[0]` positionally. §collect-first-button-first-row
- `park:goto:landmark` and `park:goto:guests` reply EPHEMERALLY and never `i.update`: those handlers re-render their own message with no tab row, so updating in place strands the player one click from losing navigation. §goto-surfaces-reply-ephemerally
- Tabs are a UI win, not a performance win: a tab switch re-pays the whole render's `SELECT`s, and about half of them are exact duplicates from `toClockDinos` running four times — any dedup must preserve the settle-escapes-once ordering. §park-view-select-cost-and-dupes
- `withParkImage` APPENDS to `files` rather than assigning: it is the one sanctioned hand-touch of that key in `src/`, so `park.png` stacks onto whatever a payload already carries without clobbering it. §withparkimage-appends
- `dashboardPayload` calls no `attach()` of its own at any of its three call sites; giving it art would break the tab switch's attachment accounting. §dashboardpayload-ships-no-art-of-its-own
- `animalsPayload` seeds its art on `user.discordId`, the park OWNER, not the viewer — `park:vtab:<targetId>:animals` puts a visitor on someone else's tab, and seeding on the clicker would give one park two faces. §animals-tab-seeds-on-owner
- `visitPayload` takes `dashboardPayload`'s own `components`, never a hand-built `components: []` — hand-building silently deletes the tab row. §visitpayload-reuses-dashboard-components
- `visit: true` suppresses `park:collect` at the source and must keep doing so: that button carries no user id, so a viewer clicking it on someone else's park card would collect the CLICKER's own income. §visit-suppresses-park-collect
- `/dino list`'s `Math.min(1, d.comfort)` is a legitimate DISPLAY-only clamp precisely because it bounds nothing computed or stored — it is not the clamp `park-progression` rejects, and the two must not be conflated. §display-only-comfort-clamp-is-legitimate
- A menu option's `value` is an IDENTITY plus a STALENESS ANCHOR and never a price: a stale Upgrade option charges the NEXT rung's price, measured at 90x its own label on `hatchery_lab`. §menu-value-is-identity-plus-anchor
- The caller must pass the CLIENT-SUPPLIED anchor to `upgradeLot`; passing a level the caller just read makes the comparison a tautology that can never fire, and it compiles, typechecks and passes every test. §caller-passes-client-supplied-anchor
- `confirmPayload` ships `content: ''`, `attachments: []` and RETAINS the tab row — the `attachments: []` is load-bearing, because `lotsPayload` attaches its banner on every call and an `i.update` carrying neither key strands that banner as an orphan attachment card. §confirm-payload-shape
- Map service errors PER MENU: `UnknownKindError` and `LotLimitError` each mean two different things across `buildLot` and `upgradeLot`, so a shared mapping tells a player "All lots full" when they meant "already max level". §per-menu-error-mapping
- Both spends confirm via `i.update` onto the card, never an ephemeral follow-up — the Lots tab must not be left displaying a state it is about to change. §confirm-rendered-onto-the-card
- The confirm CLICK is a second layer only, never the guard, and neither is the handler's own fresh read: another open message may still hold a stale button. §confirm-click-is-not-the-guard
- `park:buildyes:<uid>:<kind>:<lotCount>` carries the owner's lot count and the handler's check of it is the whole lock — two clicks landing before the first repaint both pass the owner check and the allowlist, and for a paddock the second one burns a slot permanently. §buildyes-lotcount-anchor
- No `await` may sit between reading `lots.length` for that check and calling `buildLot`: the absence of a suspension point is what closes the race, and introducing one reopens it silently. §no-await-between-check-and-write
- Player-typed free text reaching a public embed DESCRIPTION or a bot-authored non-ephemeral message's CONTENT is defanged, never rejected outright — both render `[text](url)` as a masked link with arbitrary visible text. §defang-user-text-on-public-surfaces
- Defang BEFORE storing, and make every confirmation echo agree with what was stored: a half-closed vector (store defanged, echo raw) is worse than a documented open one. §defang-before-store-echo-must-agree
- Defang AFTER the trim and BEFORE the length check — defanging only ever lengthens a string, so a guard that ran first would no longer govern what is actually stored. §defang-after-trim-before-length-check

## park-subcommand-switch-with-default

`/park`'s dispatch used to be a trap for the next subcommand: before `/park landmark`
shipped, there was no subcommand switch, only a chain of explicit `=== 'rename'` /
`=== 'alerts'` checks with the view path as the fallthrough, so a brand-new
subcommand nobody had written a branch for fell through unguarded and rendered the
dashboard — reporting success for a command that did nothing. `execute`
(`src/modules/park/index.ts`) now dispatches on a real `switch (i.options.getSubcommand())`
with a `case` for `rename`, `alerts` and `landmark`, `case 'view': break;` to reach the
dashboard path below the switch, and a `default` arm that replies
`'Unknown /park subcommand.'` ephemerally and returns — so an unrecognised subcommand
now errors visibly instead of silently doing nothing. The switch's own comment records
why it exists. Any future `/park` subcommand MUST be added as its own `case`; there is
no longer a fallthrough to lean on, and none should be reintroduced.

The park COMPONENT handler carries the identical rule for the identical reason, stated
at `§component-default-arm-must-acknowledge` in
`docs/conventions/command-and-handler-surface.md`.

## park-feature-autocomplete-manifest

`/park` has an `autocomplete()` now — its first — serving `feature`'s `dino` option,
so `'park feature': ['dino']` lives in `tests/contract.test.ts`'s
`AUTOCOMPLETE_OPTIONS` manifest.

## park-tabs-two-customid-families

`/park view` renders one of four tabs — `park | animals | lots | prestige`
(`ParkTab`, `src/modules/park/embeds.ts`) — swapped in place. `dashboardPayload` keeps
its name and IS the Park tab; `animalsPayload`, `lotsPayload` and `prestigePayload` are
the others. Two customId families: `park:tab:<uid>:<tab>` is owner-checked, and
`park:vtab:<targetId>:<tab>` carries a TARGET and deliberately is not — the `park:tour`
precedent. Never merge them into one shape with a flag.

## tab-switch-explicit-attachments

**Every tab switch sends an explicit `attachments: []`.** `landmarkPayload` and the
guests view get away with the omit-idiom because they always `attach()` on every call,
so their `files` key alone already replaces the message's whole attachment set
(discord.js `MessagePayload` — the same mechanic `fightFrames`' F1/F4 sends rest on,
stated in full at `§f1-f4-unconditional-empty-attachments` in
`docs/conventions/fights-and-duels.md`); an explicit
`attachments: []` there would be redundant, not wrong. A tab switch can't rely on that
shortcut: the Park tab's own payload carries no `files` key at all when `renderPark`
fails (its `RENDER_TIMEOUT_MS` is 3000, Discord's whole initial-response window, so a
slow render is a real case, not a theoretical one), and without `attachments: []` the
PREVIOUS tab's uploads — worst case the Animals tab's roster banner plus a
featured-dino thumbnail, two files — would survive as orphan attachment cards under the
failed render's embed.

## park-tab-defers-before-render

The Park tab `deferUpdate()`s BEFORE rendering and then `editReply`s, for that same
timeout reason — renders serialize process-wide, so rendering before acknowledging can
lose the interaction to 10062. The other three tabs are synchronous and `i.update`
directly.

## settle-escapes-once-per-interaction

`settleEscapes` runs ONCE per interaction in `renderTab`, never per builder: it is
write-bearing and `buildParkSnapshot` settles again internally.

## bump-legacy-best-once-per-command

`bumpLegacyBest` fires once per `/park view` COMMAND invocation — coupled to the fact
that the Park tab is always the first screen a fresh `/park view` renders, not to the
Park tab itself. `renderTab`'s `park` branch (a `park:tab`/`park:vtab` click navigating
to or back to that tab) never calls it; every tab builder and the whole visit path read
the pure `legacyRank` instead, so a navigation click never mutates a row.

## collect-first-button-first-row

**Collect must stay the first button of the first row** — `tests/park.test.ts:208-218`
indexes `components[0].toJSON().components[0]` positionally.

## goto-surfaces-reply-ephemerally

Routed surfaces (`park:goto:landmark`, `park:goto:guests`) reply EPHEMERALLY and never
`i.update`: a routed payload mints components under a foreign prefix, and those handlers
re-render their own message with no tab row, so updating in place would strand the
player one click from losing navigation.

## park-view-select-cost-and-dupes

Tabs are a UI win, not a performance win: measured at the migration 0018 index work,
`/park view` cost 23 `SELECT`s per render, and a tab switch re-pays them. That migration
indexed the tables behind the path — `lots_user`, `dinos_user_lot`, `attractions_user`
among them — so those reads are index searches rather than full scans. But the count is
unchanged, and **12 of the 23 are exact duplicates**, because `toClockDinos` runs four
times per render with no memoization between calls. Deduplicating them is the larger
remaining win and is still open; it is not a free change, since it has to preserve the
"settle escapes once per interaction" ordering `renderTab` depends on
(`§settle-escapes-once-per-interaction`). Re-measure those figures before quoting them:
they are a dated measurement, not an invariant, and the next builder to gain a read
moves them silently.

## withparkimage-appends

`withParkImage` (`src/modules/park/embeds.ts`) still **appends** to `files` rather than
assigning, so `park.png` can stack onto whatever a payload already carries without
clobbering it. It is the sanctioned exception to
`§no-hand-assigned-payload-files` in `docs/conventions/embed-payload-builders.md`: that
guard bans the `payload.files = [...]` idiom, not appending to the key.

## dashboardpayload-ships-no-art-of-its-own

`dashboardPayload`
(the Park tab, `src/modules/park/embeds.ts`) calls no `attach()` of its
own — it ships no art beyond whatever `withParkImage` adds, at all
three call sites that wrap it: `/park view` on your own park and
`renderTab`'s `park` branch (both `src/modules/park/index.ts`), plus
`visitPayload` (`src/modules/park/visit.ts`). The featured dino's
thumbnail lives on the ANIMALS tab instead (`animalsPayload`), attached
alongside the roster banner via two `attach()` calls of its own — a
different builder for a different tab, never wrapped by `withParkImage`.
Adding art here would break the attachment accounting
`§tab-switch-explicit-attachments` rests on.

## animals-tab-seeds-on-owner

A deliberate departure from the default of seeding a banner on the viewer's Discord id
(`§seeds-by-family` in `docs/conventions/embed-payload-builders.md`):
`animalsPayload` (`src/modules/park/embeds.ts`) seeds on `user.discordId`,
the park OWNER, because `park:vtab:<targetId>:animals` puts a visitor on someone else's
tab and seeding on the clicker would give one park two faces.

## visitpayload-reuses-dashboard-components

`visitPayload` no longer hand-builds `components: []` the way an earlier
version did: it calls `dashboardPayload(user, 0, { …, visit: true })`
directly and takes ITS `components` (and, defensively, its `files`, though
`dashboardPayload` never sets that key today).

## visit-suppresses-park-collect

`visit: true` already
suppresses `park:collect` at the source (that button carries no user id,
so a viewer clicking it on someone else's park card would collect the
CLICKER's own income) while still minting the tab row, so there is neither
a components array to hand-build nor a featured-dino upload to forward: a
visited Park tab never carries one.

## display-only-comfort-clamp-is-legitimate

`/dino list`'s own `Math.min(1, d.comfort)`
clamp (`dinoListPayload`, `src/modules/park/index.ts`) is a different, legitimate use of
the shape `§base-vs-enriched-fit-is-a-real-split`
(`docs/conventions/park-progression.md`) rejects for the rating — it only bounds what's
DISPLAYED, never what's computed or stored, and
the rung is broken out as its own `enriched +N%` mark rather than folded into the percentage.

## menu-value-is-identity-plus-anchor

The Lots tab's Build and Upgrade select menus follow the `park:landmark:buy` lesson,
which they would otherwise repeat in a worse form. A menu option's `value` is an
IDENTITY plus a STALENESS ANCHOR and never a price: `park:build` carries `<kind>`,
`park:upgrade` carries `<lotId>:<expectedLevel>`. Prices are re-derived by `buildLot` /
`upgradeLot` at execution, and the label is a display copy no handler reads back.
The level anchor is load-bearing: `upgradeCostFor` is a pure function of `(kind, level)`
and paddock cost is `buildCost * 2.5 ** level`, so a stale option charges the NEXT rung's
price. Measured worst case is `hatchery_lab` — a label reading 25,000 against a charge of
2,250,000, **90x**, against the landmark defect's 32x: that ratio is what "worse form"
means here, and it is why these menus were anchored before anyone had to be charged.
The general rule, and the table of every customId that carries an
anchor, is `§guard-scope-cross-message-only` in
`docs/conventions/router-and-registry.md`.

## caller-passes-client-supplied-anchor

**The caller must pass the CLIENT-SUPPLIED
anchor** to `upgradeLot`: passing a level the caller just read makes the comparison a
tautology that can never fire, which compiles, typechecks and passes every test.
`/upgrade` is the one
exception and says so at the call site — it quotes no frozen label, so it has no anchor to
carry.

## confirm-payload-shape

`confirmPayload` (`src/modules/park/embeds.ts`) ships `content: ''`, `attachments: []` and
RETAINS the tab row. The `attachments: []` is load-bearing rather than redundant:
`lotsPayload` attaches `banners/lots.webp` on every call, and an `i.update` carrying
neither `files` nor an explicit `attachments` strands that banner as an orphan attachment
card.

## per-menu-error-mapping

Error mapping is PER MENU. The service layer overloads two classes: `UnknownKindError`
means unknown *kind* in `buildLot` and unknown *lot* in `upgradeLot`; `LotLimitError`
means *slot cap* in one and *already max level* in the other. A shared mapping tells a
player "All lots full" when they meant "already max level".

## confirm-rendered-onto-the-card

Both spends sit behind a confirm rendered ONTO the card via `i.update`, never an
ephemeral follow-up — the Lots tab must not be left displaying a state it is about to
change.

## confirm-click-is-not-the-guard

The confirm CLICK is a second layer only, never the guard — another open message
may still hold a stale button. What actually locks the upgrade is the REQUIRED
`expectedLevel` on `upgradeLot`: the handler's own fresh read stays because it needs
`lot.kind`/`lot.level` to quote the price in the `InsufficientFundsError` arm and to name
the two levels in the stale rejection, NOT because it is the thing standing between a
stale button and the money.

## buildyes-lotcount-anchor

Build has no service-level twin, because a build has no
level to anchor on and its price never moves — so `park:buildyes:<uid>:<kind>:<lotCount>`
carries the owner's LOT COUNT and the handler's own check of it is the whole lock. That
anchor is not decoration: two `park:buildyes` clicks landing before the first repaint
both pass the owner check and both pass the allowlist, and for a PADDOCK — duplicable by
design, unlike a facility, which `DuplicateFacilityError` already stops
(`§one-facility-per-kind` in `docs/conventions/park-progression.md`) — the second
click builds a second one. The cost is not the cash but the SLOT: `lotSlots` caps at 10
and a duplicate lot is permanent (`§duplicate-lots-are-permanent` in
`docs/conventions/park-progression.md`), which is
what stops this being triaged as minor. `lotCount` is a sound anchor precisely
because it is monotone under those same rules — `buildLot` only ever increases it.

## no-await-between-check-and-write

**No `await` may sit between reading `lots.length` for that check and calling
`buildLot`**: better-sqlite3 is synchronous and Node is single-threaded, so a
check-then-write with no suspension point between them cannot interleave with a second
interaction, and that — not the read itself — is what closes the race. Introducing an
await there reopens it silently.

## defang-user-text-on-public-surfaces

Player-typed free text that reaches a public embed DESCRIPTION or a bot-authored,
non-ephemeral message's CONTENT is defanged, never rejected outright: `defangLinks`
(`src/core/text.ts`) splits the `](` sequence, because both surfaces render
`[text](url)` as a masked link with arbitrary visible text — 80 characters of motto is
ample for `[Free Nitro](https://evil.tld)`. A TITLE does not render it — `dashboardPayload`'s
`.setTitle(user.parkName)` (`src/modules/park/embeds.ts`) was never exposed. The
client-wide `allowedMentions: { parse: [] }` kills mention injection and does nothing
about markdown.

## defang-before-store-echo-must-agree

Three call sites now defang BEFORE storing, and every confirmation
echo agrees with what was stored — a half-closed vector (store defanged, echo raw) is
worse than a documented open one: `setMotto` (`src/modules/park/showcase.ts`) returns
what it wrote, so `/park motto`'s echo just reads that back; `renameDino`
(`src/modules/park/dinos.ts`, whose nicknames reach public battle embeds) defangs what
it stores but returns `void`, so `/dino rename`'s echo (`src/modules/park/index.ts`)
re-defangs the trimmed input itself rather than trusting the raw option — the fourth
`defangLinks` call, and the only one that isn't at a store site; `/park rename`
(`src/modules/park/index.ts`, pre-existing code that writes `parkName` directly rather
than through a service — left that way on purpose, not restructured into one) now
defangs once and reuses that single value for both the write and the reply. That last
one closes a real vector, not a theoretical one: `parkName` reaches `landmarkPayload`'s
public embed DESCRIPTION on `/park landmark` (`src/modules/park/embeds.ts`), which
replies non-ephemerally, so an un-defanged park name was a live masked link there.

## defang-after-trim-before-length-check

Defanging runs AFTER the trim and BEFORE the length check at every store site —
defanging only
ever lengthens a string, so a guard that ran first would no longer govern what is
actually stored, and a motto or nickname landing exactly at its cap after `](` is
rejected rather than stored one character over. The design spec explicitly said no
sanitisation should be added; that line is superseded (see its own note).
