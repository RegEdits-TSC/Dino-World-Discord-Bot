# Embed payload builders

Fires on: every `src/modules/*/embeds.ts` and `*-embeds.ts`, plus the payload builders
not named one — `src/modules/admin/ledger.ts`, `src/core/paginate.ts`, `src/core/notify.ts`
and the module `index.ts` files that build a payload inline (care, expeditions, hatchery,
help, leaderboards, park, shop, trading).

## Headlines

- Wire art with `attach(embed, payload, slot, assetImage(...))`, never by setting the embed slot and the file separately — that drift shipped three attachment defects in round 2. §always-use-attach
- A null ref makes `attach` a total no-op: `payload.files` is not even created, and two tests assert `files` is `undefined`, not `[]`. §attach-null-ref-is-noop
- `attach` APPENDS, so call order IS upload order — several tests pin `files.map(f => f.name)` with `toEqual` and three mock `assetImage` as a call-order queue, so never reorder, never hoist a lookup, never collect refs into an array first. §attach-order-is-upload-order
- A ternary guarding on DOMAIN data stays outside `attach` — an absent featured dino is not an asset miss. §domain-ternary-stays-outside-attach
- Hand-assigning `payload.files = [...]` is banned outright by `tests/images.test.ts`'s "no source file hand-assigns an embed payload files array" guard. §no-hand-assigned-payload-files
- For two assets on one payload, call `attach()` twice: appending is what it does, so the second can never clobber the first. §attach-appends-never-assign-files
- What `attach` cannot do is DEDUPE: attachment names are basenames with no `kind` prefix, so two refs on one payload must resolve to distinct names or one embed slot renders the wrong picture — check the names, not the count. §attachment-name-dedupe
- §payload-never-shared-across-two-sends
- Never pass `rarityEmoji(...)` to `ButtonBuilder.setEmoji` — unlike every other emoji call site it THROWS rather than degrading, and the six rarity gems legitimately return `''` when no map is loaded. §never-rarity-emoji-to-seticon
- Never mint a select with `min_values: 0`: the router enforces `submittedValuesAreOnMessage` for every select with no opt-out, and a legitimately empty submission fails it closed. §no-min-values-zero
- Give an optional selection an explicit "none" option rather than relying on an empty submission. §never-mint-min-values-zero
- Never close a select flow by disabling the menu — neither guard reads `disabled`, so a disabled select is not a lock. Remove the component instead. §disabled-is-not-a-lock
- `tests/lib/discord-limits.ts` is what knows the select rules; `tests/contract.test.ts` structurally CANNOT catch a select-menu mistake, since it walks command options only. §select-limits-live-in-discord-limits
- A FILTERED list needs its own page row: `pageRow`'s customId has nowhere to put filter state, so paging through it silently returns the unfiltered page — wrong rows, wrong count, no error. Do not widen `pageRow`. §filtered-lists-need-their-own-page-row
- On an `assetImage('banners', …)` line, never hoist the NAME into a `const` and never pass a quoted string literal as the seed — `scrapeBannerNames` reads one source line at a time and takes every quoted string after the match. §banner-call-site-shape
- Seed `eggs`/`hatch` on the egg's own row id and `banners`/site banners on the viewer's Discord id; the two departures from that are deliberate and documented where they live. §seeds-by-family
- Five bases are HALF-SEEDED — seeded at `/help` and unseeded at their own surface, or the mirror image — so a face shipped for one would vary on one surface and never on the other. §half-seeded-bases
- A seeded call site needs a test that can DETECT the seed: four shipped where deleting the seed argument left the whole suite green, because those fixtures' ids hashed to index 0, which IS the base file. §seeded-site-needs-a-test-that-can-fail

## always-use-attach

**Always wire art with `attach(embed, payload, slot, assetImage(...))`** — it
sets the embed slot and appends the file together, so the two can never drift
apart (that drift shipped three attachment defects in round 2).

## attach-null-ref-is-noop

A null ref is
a total no-op: `payload.files` is not even created, so an art-free payload
never ships an empty attachment array — `tests/hatchery.test.ts` and
`tests/notify-handlers.test.ts` both assert `files` is `undefined`, not `[]`.

## attach-order-is-upload-order

`attach` APPENDS, so two calls on one payload both survive and **call order is
upload order**: several tests pin `files.map((f) => f.name)` with `toEqual`,
and three mock `assetImage` as a `mockImplementationOnce` queue keyed on
1st-call/2nd-call identity, so never reorder the calls, never hoist the
lookups above them, and never collect refs into an array first.

## domain-ternary-stays-outside-attach

A ternary that
guards on *domain data* (`best ? assetImage(...) : null` in shop,
`featured ? … : null` in hatchery) stays outside `attach` — it is not an
asset miss.

## no-hand-assigned-payload-files

`tests/images.test.ts`'s "no source file hand-assigns an embed
payload files array" guard bans the old `payload.files = [...]` idiom outright.

## attach-appends-never-assign-files

Two assets in one payload: call `attach()` for both and the second can never
clobber the first — appending is exactly what `attach` does, and hand-assigning
`payload.files` (the idiom that shipped those defects) is banned outright by
`tests/images.test.ts`.

## attachment-name-dedupe

What `attach` cannot do for you is DEDUPE, and that
hazard is still live: attachment names are basenames only — `assetImage`
(`src/core/images.ts`) names the file after the RESOLVED face — `${name}.webp`, or
`${name}-vN.webp` where a seed picked a variant — with no `kind` prefix either way, so
two refs on one payload must resolve to distinct names. Same-named uploads make
`attachment://<name>.webp` ambiguous and one of the two embed slots renders the
wrong picture. `<site>-banner.webp` vs `<site>-thumb.webp` is safe; naming the
hatch cracks `hatch/<rarity>.webp` would NOT have been, against
`eggs/<rarity>.webp` — hence `<rarity>-crack`. Two-asset payloads are routine
now (shop, expeditions, hatchery, battles), so check the names, not the count.

## payload-never-shared-across-two-sends

**A payload object reused across two send sites must hand each call its own fresh
`attachments: []`, never forward the same object twice.** discord.js's `MessagePayload`
pushes into `options.attachments` and `create()` only shallow-copies it, so one
payload object forwarded to both sends accumulates duplicate attachment ids
on whichever resolves second. The worked case is `fightFrames`'s F4, which reaches
`presentFight`'s closing `editReply` and, if a Skip races it, the button handler's
`i.update` (`src/modules/battles/index.ts`). It is invisible to
`tests/battles-embeds.test.ts`, which builds `FramePayload`s directly and never
constructs a `MessagePayload`. `finalPayload()` there is the fix and the pattern to copy
for any future payload reused across two send sites.

**The inverse case exists and prescribes the opposite fix, so check which one you are
in before applying either.** A payload reaching `deliverNotification` must never carry
an `attachments` key at all — `alertPayload` (`src/modules/park/alert-embeds.ts`) is the
same one-object-two-send-sites shape, but its two sites are `channelSend` and the
`dmSend` fallback, and the in-place push means a pre-set key would carry a mutation from
the first attempt into the second. That rule is stated in full as
§notify-payload-omits-attachments in `docs/conventions/timers-and-alerts.md`;
`src/modules/park/alert-embeds.ts` matches both docs, and only that one is right for
it. The discriminator is which
mechanism you need: an explicit `attachments: []` when the send must REPLACE the
message's existing attachment set (an `i.update` or `editReply` on a message that
already carries files), and no key at all when the payload is merely being handed to a
send helper that may retry it elsewhere.

## never-rarity-emoji-to-seticon

**Never pass a rarity tag
(`rarityEmoji(...)`) to `ButtonBuilder.setEmoji`** — unlike every other call
site, `setEmoji` throws rather than degrading: `resolvePartialEmoji('')`
returns `null` and the builder rejects it, and the six rarity gems
legitimately return `''` when no map is loaded. Today only `dw_cash` is
passed to `setEmoji`, so this is currently safe, but it's a live hazard for
future button work.

## no-min-values-zero

**Never mint a select with `min_values: 0`** — a legitimately empty submission from one
fails the router's `submittedValuesAreOnMessage` guard
closed, since the router enforces it for every select with no opt-out.

## never-mint-min-values-zero

Give an optional
selection an explicit "none" option instead of relying on an empty submission.

## disabled-is-not-a-lock

Nothing in the installed discord.js or discord-api-types claims Discord's gateway
validates submitted values, selection counts, or clicks on a `disabled` component, so
this repo assumes none of it is enforced. **Never close a select flow by disabling the
menu** — neither guard reads `disabled`, so a disabled select is not a lock. Remove the
component instead.

## select-limits-live-in-discord-limits

`tests/lib/discord-limits.ts` knows the select rules (25 options, 100-char label and
value, alone in its row — the alone-in-its-row rule is checked for every select type,
3 and 5-8, since it's identical for all of them; the option-count/label/value rules only
apply to type 3, since the other four don't carry an `options` array at all);
`tests/contract.test.ts` structurally CANNOT catch a select-menu mistake, since it walks
command options only.

## filtered-lists-need-their-own-page-row

`/dex list` is the one paginated surface that does NOT use the shared `pageRow`
(`src/core/paginate.ts`): its list is FILTERED, and `pageRow`'s
`<prefix>:<action>:<userId>:<page>` customId has nowhere to put that state, so paging
through it silently returned the unfiltered page — wrong rows, wrong title suffix, wrong
page count, no error. `dexPageRow` (`src/modules/dex/embeds.ts`) builds
`dex:page:<uid>:<page>:<rarity|->:<diet|->:<archetype|->` instead — 59 of Discord's 100
customId characters at worst — and `pageRow` stays untouched for its four other callers
(`ach`, `hatch`, `park:dinos`, `trade:list`). `/admin ledger` followed the same precedent
with `admin:ledger:<targetId>:<page>:<all|->`. Any future filtered list needs the same
treatment; do not widen `pageRow`.

## banner-call-site-shape

What must never happen on an
`assetImage('banners', …)` line is hoisting
the NAME into a `const`, or passing a **quoted string literal** as the seed:
`scrapeBannerNames` (`tests/images.test.ts`) reads one source line at a time and takes
every quoted string after the match, so the first loses the name entirely and the second
demands that `assets/images/banners/<seed>.webp` exist.

## seeds-by-family

Seeds by family, as shipped: **`eggs` and `hatch` on the egg's own row id**, so one egg
keeps one identity from purchase through to the reveal — the crack is the EGG's face,
not the hatched dino's — and **`banners` and site banners on the viewer's Discord id**,
a stable face per player per surface. There are two deliberate departures from seeding a
banner on the viewer: `animalsPayload` seeds on the park OWNER
(§animals-tab-seeds-on-owner in `docs/conventions/park-surface.md`), and `/shop view`'s
egg preview takes no seed at all (§shop-preview-takes-no-seed in
`docs/conventions/art-resolver.md`).

## half-seeded-bases

Five bases are **half-seeded**, which is subtler than a purely seeded or purely unseeded
one: `banners/trading`,
`leaderboards`, `guests` and `duel` are each unseeded at the surface they belong to
(`src/modules/trading/index.ts`, `leaderboards/index.ts`, `guests/embeds.ts`,
`duels/embeds.ts`) yet reach a SEEDED resolver through
`assetImage(t.art.kind, t.art.name, i.user.id)` (`src/modules/help/index.ts`), so a face
shipped for one of them would vary on `/help topic:trading` while `/trade` itself never
did; `banners/season` is the mirror image, seeded in `park/alert-embeds.ts` and unseeded
on `/season`. Seeding those five surfaces is real scope and was deliberately left undone
— do it in the change that ships the face, not before. `banners/help` was a sixth until
the `/help` overview was seeded too, so the two call sites that render it now agree.

## seeded-site-needs-a-test-that-can-fail

**A seeded call site needs a test that can detect the seed.** Four seeded sites shipped
where deleting the seed argument left the whole suite green, because the user ids in
those fixtures hashed to index 0 — which IS the base file — so the pin read identically
seeded or unseeded and proved nothing. Each has a guard now under an id that genuinely
moves the face; pick that id by resolving it against the real `assetImage`, never by
assuming one will differ.
