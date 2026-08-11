# Spec 3a — The Social Surface

Part 3 of the three-part roadmap ("The Server Is A Park"), first of two
sub-specs. Written 2026-08-10, immediately after Part 2 shipped (`8b1946e`,
PR #28).

## 1. Context and scope

Part 3 was always scheduled last because its value is a function of
population, and the live database currently holds one player. That has not
changed. The owner's decision is to build it anyway: the roadmap is finished
when Part 3 ships, and the social layer should exist before players arrive
rather than after.

Part 3 covers three pillars — exhibition duels, rich park visits, wider
leaderboards. It splits in two, for the same reason Part 2 did:

| Sub-spec | Contents | Status |
| --- | --- | --- |
| **3a — The Social Surface** | batched-aggregate leaderboards, two new `/top` metrics, park showcase, park discovery | this document |
| **3b — Exhibition Duels** | `resolveDuel` core, async ghost duels, live challenge duels, duel record and rating | later |

3a runs first on purpose. It builds the surface a duel result has to be
reported on, so 3b slots one more metric into infrastructure that is already
green instead of shipping a combat engine and a leaderboard rewrite together.

### Decisions locked before design

Four decisions were settled during brainstorming and are recorded here so 3b
does not reopen them:

- **Duels are free and pay nothing but a record.** No energy cost, no cash,
  no shards, no XP. This keeps duels out of the faucet question entirely —
  two colluding accounts have nothing to farm — and leaves battle energy as
  the sole pacing gate on PvE. It is why 3a needs no anti-farm rules and why
  3b will need none either.
- **Duels support both formats**: an async ghost duel against a snapshot of
  the opponent's squad, and a live challenge with an Accept button. 3b builds
  one `resolveDuel` core with two entry paths, never two engines.
- **Leaderboards are widened by batched aggregates, not denormalization.**
  See §2.
- **Discovery ships as buttons, not select menus.** See §5.

## 2. Leaderboards: `scored()` becomes a fixed number of queries

### The problem

`src/modules/leaderboards/service.ts` loads every candidate user and then
calls `collectionScore` once per user, which itself issues a query. The file
documents this as acceptable at v1 scale and suggests denormalizing a
`collectionScore` column if the player base grows.

Spec 2b hit the same wall from the other side and declined to put legacy rank
on `/top` at all, on the grounds that it would cost 2N more queries.

### Why not a denormalized score table

A stored score column is the obvious fix and it is the wrong one here.

`legacyPoints` (`src/modules/park/ranks.ts`) reads three sources: species
discovered, achievement tiers claimed, and battle stars. Those move at points
that never call `recomputeRating` — claiming an achievement, clearing a
battle stage. A stored column would therefore need refresh hooks at roughly
twenty sites spanning five modules, and a missed one produces silent drift
with no error and no failing test.

It would also be the first stored-derived value in the codebase. Escrow locks,
quest progress, world events, park ratings' inputs, and legacy rank itself are
all derived at read time, each with a comment in the repo `CLAUDE.md`
explaining why. A score table cuts directly against that design language.

### The design

Replace the per-user loop with a fixed set of **batched reads** — one query per
source table, grouped into a `Map<userId, number>` in JS — then assemble rows
from those maps.

| Metric | Source | Reads |
| --- | --- | --- |
| `rating` | `users.park_rating` | 0 — already in the candidate scan |
| `cash` | `users.cash` | 0 — already in the candidate scan |
| `collection` | `dinos` | 1 |
| `legacy` *(new)* | `species_seen`, `achievement_claims`, `battle_progress` | 3 |
| `stars` *(new)* | `battle_progress` | 1 |

Worst case is four queries plus the candidate scan, regardless of how many
players exist. Nothing is stored, nothing needs refreshing, and nothing can go
stale. The `legacy` metric on `/top` is exactly as derived as `legacyPoints` is
today, which answers 2b's objection rather than overriding it.

**Not `GROUP BY`, and that is a deliberate reversal of this spec's first
draft.** Recon over the whole tree found that `src/` has never used `groupBy`,
`count()`, `sum()`, `countDistinct`, `selectDistinct`, `.having()`, `.limit()`,
or a partial `.select({ … })` projection — not once. Every read in the codebase
is `.select().from(t).where(…).all()` followed by JS aggregation, and the four
files that import `sql` use it only for CHECK bodies and `UPDATE … SET` column
arithmetic, never in a SELECT. Introducing an aggregate here would be a new
idiom, and it buys nothing the batched read does not already deliver: the
guarantee that matters is a **fixed query count**, which both satisfy. Two
concrete hazards also argue against it — `SUM(stars)` over an empty row set
returns SQL `NULL` where `.reduce(…, 0)` returns `0` (a fresh account's legacy
points would become `NaN`, and `NaN >= threshold` is `false`, so `legacyRank`
would silently return null rather than crash), and drizzle's aggregate builders
have no in-repo precedent for how the result is unwrapped on better-SQLite3.

Server scope keeps its existing `inArray` predicate — the one helper on this
list the codebase already uses — so a server board reads only its candidates'
rows rather than the whole table.

New exported functions in `leaderboards/service.ts`:

```ts
export function collectionScores(ctx: Ctx): Map<string, number>
export function legacyScores(ctx: Ctx): Map<string, number>
export function starScores(ctx: Ctx): Map<string, number>
```

`scored()` composes them. `topPlayers` and `playerRank` keep their current
signatures and return shapes; only the interior changes.

### Two parity details that are easy to get wrong

- **`dexProgress` filters by the live roster.** It computes
  `roster.filter((s) => seen.has(s.id)).length`, not a raw row count, so a
  `species_seen` row naming a retired species contributes nothing. The
  batched species term must apply the same roster filter, or a retired
  species would make the board and the park card disagree.
- **`earnedTierCount` does not filter.** It is a plain row count over
  `achievement_claims` with no check against the `ACHIEVEMENTS` table, so the
  batched form is a plain `COUNT(*) GROUP BY user_id`. Adding a filter here
  would introduce the disagreement rather than prevent it.

Scope filtering is unchanged: `server` scope still resolves its candidate set
through `user_guilds` first, and the maps are consulted only for those
candidates.

### Command surface

`/top`'s `metric` option grows from three choices to five (`rating`, `cash`,
`collection`, `legacy`, `stars`). `metricLabel` and `formatValue` gain the two
new cases; both new metrics format as plain integers, unlike `rating`, which
divides by 100.

`metricLabel` must keep computing its emoji per call. It is already correct on
this point and the reason is in the file: the app-emoji map loads after client
ready, so a module-level constant would freeze the unicode fallback forever.

This is a builder change and therefore requires `npm run deploy-commands`.

## 3. Showcase: park motto and featured dino

Migration `0012` adds two columns to `users`:

- `motto TEXT NOT NULL DEFAULT ''`
- `featured_dino_id INTEGER` — nullable, **no foreign key**

### Motto

Set through a new `/park motto` subcommand. The builder caps input with
`.setMaxLength(80)`; the service trims and re-checks the length, mirroring
`renameDino`, which carries both a builder cap and a service guard. Submitting
blank or whitespace clears it.

Free text reaches a public embed, so mention injection is the obvious concern.
It is already handled: `src/index.ts` sets `allowedMentions: { parse: [] }`
client-wide, which is the same shield `/park rename` and `/dino rename` rely
on. No new sanitisation is required, and none should be added — a second
mechanism would be a second thing to keep in sync.

> **Superseded before merge.** That paragraph is right about mentions and wrong
> about markdown: an embed *description* renders `[text](url)` as a masked link
> with arbitrary visible text, which `allowedMentions` does nothing about, and 80
> characters is ample for `[Free Nitro](https://evil.tld)`. The shipped code
> defangs rather than rejects — `defangLinks` (`src/core/text.ts`) splits the
> `](` sequence, leaving every character the player typed visible — and closes
> the same pre-existing vector in `renameDino` at the same time, since nicknames
> reach public battle embeds. One helper, two call sites, so it stays one
> mechanism rather than two.

### Featured dino

Set through a new `/park feature` subcommand carrying one **optional integer**
`dino` option with `.setAutocomplete(true)`, matching the option type `/sell`
and `/dino rename` already use for dino references. Omitting the option clears
the feature, the same way omitting `nickname` clears a dino's nickname.

The column carries **no foreign key on purpose**. A featured dino can be sold,
traded away, or released, and a dangling reference must never be an error. The
value is resolved on read and a reference that no longer names a live dino
owned by that user reads back as "no feature" — the same tolerance a retired
decor `kind` gets from `matchedKindCount`, and the same reasoning that keeps
`breedings.parentA`/`parentB` free of foreign keys.

Ownership is checked twice, deliberately:

- at **set** time, so `/park feature` on someone else's dino is a visible
  error rather than a silent no-op;
- at **read** time, so a dino that changed hands after being featured stops
  displaying without needing a sweep anywhere.

### Rendering

Both render through `dashboardPayload` (`src/modules/park/embeds.ts`):

- motto as a description line under the park name;
- featured dino as the embed **thumbnail**, using its `archetype`×`diet` art
  via `attach(embed, payload, 'thumbnail', assetImage('dinos', ...))`.

`dashboardPayload`'s `opts` object gains `motto?: string` and
`featured?: { name: string; archetype: string; diet: string } | null`. Both
optional, so the hand-built fixtures in `tests/park.test.ts` and
`tests/park-view-image.test.ts` keep compiling — the same convention `now` and
`legacyRank` already follow in that signature.

Art is keyed on archetype×diet, so no new images ship. A missing file degrades
to no thumbnail, which `assetImage`'s null return already guarantees.

## 4. This feature trips a trap the repo predicted

The repo `CLAUDE.md` records that `withParkImage` (`src/modules/park/embeds.ts`)
*assigns* `files` rather than appending, so it drops anything `attach` added to
the payload it wraps — and that this is harmless today "because
`dashboardPayload` never calls `attach()` at all, so there is nothing to drop".

Featuring a dino makes `dashboardPayload` call `attach()`. The thumbnail would
therefore vanish at **both** `/park view` branches, which are exactly the two
call sites that wrap the payload in `withParkImage`. There would be no error
and no failing test.

The fix is to append:

```ts
export function withParkImage<T extends { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] }>(
  payload: T, png: Buffer,
): T & { files: AttachmentBuilder[] } {
  payload.embeds[0].setImage('attachment://park.png');
  return { ...payload, files: [...(payload.files ?? []), new AttachmentBuilder(png, { name: 'park.png' })] };
}
```

Attachment names must stay distinct for both slots to resolve, and they are:
`park.png` against `<archetype>-<diet>.webp`. The park PNG goes last, so call
order stays upload order and the existing pinned name assertions keep their
meaning.

The third caller, `/help topic:park`, is unaffected: it wraps the shared
help-topic payload, which calls `attach()` only when the topic declares `art`,
and `HELP_TOPICS.park` declares none. After this change that would no longer
break even if it did.

### A second drop on the same path, which the fix above does not cover

The other-player `/park view` branch does not forward the payload it built. It
rebuilds one:

```ts
const base = { embeds: payload.embeds };
```

That single line is the entire mechanism keeping the Collect button off someone
else's park — `park:collect` carries no user id, so a viewer clicking it would
collect **their own** income from a message about another player. It must keep
dropping `components`. But it drops `files` with them, so the featured dino's
upload would vanish on exactly the surface visits exist for, leaving a dangling
`attachment://<archetype>-<diet>.webp` in the embed.

Both drops are load-bearing in opposite directions, which is why §5's shared
visit builder constructs its components from scratch — forwarding `embeds` and
`files`, never `components` — instead of filtering a dashboard payload.

`tests/park-view-image.test.ts` currently pins that branch with
`expect(reply.components).toBeUndefined()`. Discovery puts a **Next park**
button there, so that assertion must change — to "carries no `park:collect`",
which is the property it was actually protecting. Widening it is not weakening
it: the current form would equally pass if the embed lost its image.

## 5. Discovery: buttons only

`src/core/router.ts:44` reads `if (!isCommand && !isButton) return;`. A select
menu interaction is silently dropped. Supporting one would mean widening the
router, the `ModuleManifest.components` type, and the interaction fakes in
`tests/harness.ts` — cross-cutting core work inside a social-features spec.
Discovery therefore ships as buttons.

### Visit buttons on `/top`

The leaderboard embed gains one action row of up to five buttons labelled
**Visit #1** through **Visit #5**, mapping to the first five ranked players.
The handler renders that player's park, reusing the existing read-only
other-player branch of `/park view`, and answers with **`i.reply`** rather than
`i.update` so the leaderboard the buttons sit on survives the click.

customId: `top:visit:<targetUserId>` — 30 characters against a 20-digit
snowflake, well inside Discord's 100.

### Next park

A visited park gains a **Next park ▶** button that steps to the next park in
the tour ring, answering with **`i.update`** so a tour advances one message
rather than accumulating one per hop.

It is rendered on the **other-player** view branch only — the branch a Visit
button and a `/park view user:` both land on. Your own `/park view` does not
carry it: that surface already owns the Collect button and the dashboard
controls, and turning the player's own park into the head of a tour ring makes
the ordering question ("next after me" when your own rating changes mid-tour)
load-bearing for no gain. Discovery starts from `/top`.

customId: `park:tour:<targetUserId>`.

The ring is every user with `parkRating > 0`, ordered by rating descending
with `discordId` as tiebreak, wrapping at the end. The rating filter is what
stops the tour landing on an empty lot belonging to someone who ran one
command and left. If exactly one park qualifies, Next resolves to that same
park; if none qualifies, the button is not rendered at all.

### No viewer id in either customId

`pageRow`'s customId embeds a `userId` because paging a list belongs to the
list's owner. Visiting does not: these messages are public and the paths are
read-only, so there is no owner to lock to and no state to protect. In both
customIds the id segment is the **target park**, never an owner — a fact worth
a comment at the handler, because turning it into an ownership check would make
**Next park** work only for the player whose park is on screen.

Neither handler may touch the clicker: no `getOrCreateUser`, nothing that mints
a row or mutates state for a passer-by who clicked a button. It does still
settle the **target's** escapes — that is the existing other-player view
behaviour, and it is what makes the displayed park accurate. (The router's own
`touchPresence` writes on every interaction regardless, so "writes nothing at
all" was never the achievable property; "creates nothing for the clicker" is.)

### No privacy opt-out

Parks are already fully viewable today by anyone who types a `@handle`, and
`/top` already publishes display names and figures. Discovery removes the need
to know the handle; it does not remove a gate that existed. A toggle would add
a column plus a filter on every tour and board path to protect a property the
feature never had. Reversible later if a real server ever asks for it.

## 6. Testing

### The O(1) claim has to be able to fail

A correctness-only test passes with the N+1 fully intact, so correctness tests
alone would not verify the thing this section of the spec is for.

Wrap `ctx.db` in a counting proxy, build a three-user fixture and a
thirty-user fixture, and assert the query count is **identical** across the
two — and pin the exact number per metric, so a rewrite that reads everything
twice cannot pass by being equally wasteful at both sizes. That test fails the
moment a per-user read reappears inside `scored()`.

Drive it through `topPlayers` directly, **not** through `/top`. The command's
footer branch calls `playerRank`, which runs `scored()` a second time, and that
branch flips between the two fixtures (the caller is inside the top 10 at three
players and outside it at thirty) — so a command-level count would differ for a
reason that has nothing to do with the N+1.

### Agreement

`legacyScores(ctx).get(uid)` must equal `legacyPoints(ctx, uid)` for the same
user, and `collectionScores(ctx).get(uid)` must equal `collectionScore(ctx, uid)`.
These are what stop the board and the park card disagreeing. Include a fixture
carrying a `species_seen` row for a species not in the live roster, so the
roster-filter parity detail in §2 is covered rather than assumed.

### Showcase

- motto: trims; over-length rejected; blank clears; a motto containing a role
  mention renders inert.
- feature: set and clear; setting a dino owned by someone else is rejected;
- a featured dino that was **sold** afterwards reads back as no feature;
- a featured dino **traded away** afterwards reads back as no feature.

### `withParkImage` regression

A payload entering with files keeps them, with `files.map((f) => f.name)`
pinned by `toEqual` — call order is upload order, and several existing tests
already depend on that convention.

### Discovery

- tour ring: ordering, wrap at end, `parkRating = 0` skipped;
- single-eligible ring: Next resolves to the same park;
- zero-eligible ring: no button rendered;
- own `/park view` carries no Next park button, the other-player branch does;
- the other-player branch carries no `park:collect`, and **does** carry the
  featured dino's file — the two opposite drops of §4;
- Visit buttons: at most five, and each targets the right player;
- neither handler creates a row for the clicker: click as a user with no
  `users` row and assert none exists afterwards.

### Contract and migration

- top-level command count stays **26**; `/park` subcommands do not move it, so
  `tests/contract.test.ts`'s "every builder serializes" assertion is unchanged.
- `/park feature`'s `dino` option sets `.setAutocomplete(true)` and therefore
  needs a matching entry in that file's `AUTOCOMPLETE_OPTIONS`, which is
  enforced bidirectionally.
- migration `0012` runs through the populated-database path in
  `tests/migration.test.ts`. It is a plain two-column `ALTER TABLE`, so it must
  **not** be a table recreate; read the emitted SQL by eye to confirm
  drizzle-kit did not choose one.

### Autocomplete provider contract

`/park feature`'s provider is read-only, responds only through `i.respond`,
and never calls `getOrCreateUser`. It needs no escrow sweep: `locksFor` is a
pure read, and featuring a dino neither consumes nor transfers it, so an
escrowed dino is a legal feature target.

## 7. Operator steps

In this order, which is the order 2b established and verified:

1. `npm run build` — the bot runs compiled output (`node dist/index.js`), so
   pulling source alone deploys nothing.
2. Restart the bot, exactly one process per token. This applies migration
   `0012`.
3. `npm run deploy-commands` — `/top` gains two metric choices, `/park` gains
   two subcommands.
4. `npm run test:live` — cosmetic review of the showcase card, the widened
   board, and the Visit and Next park buttons.

Steps 2 and 3 must not be swapped. Deploying the builders against the old
process would have Discord offering `/park motto` to a build whose switch has
no `motto` case; it would hit the `default` arm and answer "Unknown /park
subcommand." Take a database copy before step 2.

No `deploy-emojis` — this spec ships no new emoji.

No module registration either: `leaderboards` and `park` both already exist in
`ALL_MODULES`, so the five-site registration checklist does not apply.

## 8. Out of scope

Deferred to 3b:

- duels of any kind, the duel record, and the duel rating metric on `/top`.

Deferred indefinitely, with reasons:

- **Guestbook or park likes** — a new table plus free-text moderation, and the
  emptiest possible feature at a player base of one.
- **Side-by-side park comparison** — largely duplicates what the widened
  `/top` already shows, and it is a stats screen rather than a visit.
- **Select-menu discovery** — needs router, manifest and harness changes; see
  §5.
- **A privacy opt-out** — see §5.
- **Any new currency, faucet or sink** — 3a adds none, and 3b adds none by
  the free-and-record-only decision in §1.
- **A `/help` topic for showcase or discovery** — adding a `HELP_TOPICS` key
  changes deployed builder choices; `docs/gameplay.md` covers the prose.
  Worth noting that `HELP_TOPICS.park` still declares no `art`, which is what
  keeps `withParkImage` harmless on that path either way.
