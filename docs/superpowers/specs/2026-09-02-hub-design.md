# The hub — design

**Date:** 2026-09-02
**Status:** design agreed, not implemented
**Parent:** sub-project 2 of 3 in the gameplay smoothness pass (see
`docs/superpowers/specs/2026-08-31-follow-through-design.md` §1).
**Depends on:** `main` at `3ba5b7e` (PR #57, sub-project 1).

A dated record of the decision as it was made. If a mechanism here is proven wrong after
implementation, the correction belongs in `docs/conventions/`, naming the dead mechanism —
not in this file. See `§specs-are-dated-records` in `docs/conventions/prose-and-specs.md`.

---

## 1. Context

The smoothness audit recorded in the follow-through spec found that **nothing answers "what
do I do now."** The closest surface is `/daily`, which is a quest board rather than
guidance, and pending timers are invisible in aggregate: incubating eggs, the active
expedition, breeding pairs and battle energy each live behind their own command, and none
appear on the park card.

Sub-project 1 (`3ba5b7e`) closed the loop-closure and error-message halves. This document is
sub-project 2. Sub-project 3, onboarding, graduates a new player into what this builds and
is out of scope here.

### 1.1 One departure from the parent spec, decided before design

The follow-through spec said the hub was "likely a fifth tab on `/park view`". **It is not a
tab.** A recon pass over every subsystem the hub aggregates found three reasons that shape
costs more than it pays, and one measurement that removes the reason it was originally
preferred:

- **A tab is public by construction.** `tabRow` maps over `PARK_TABS` with no per-tab filter
  (`src/modules/park/embeds.ts`) and the `vtab` arm deliberately has **no owner check**
  (`src/modules/park/index.ts`). Adding a `hub` member ships one player's unclaimed rewards,
  hungry dinos and pending trade offers onto every *visited* park card. Suppressing that
  needs two coordinated edits — `tabRow` must not mint it, and the `vtab` arm must reject it
  even though `isParkTab('hub')` is true — and half-doing it leaves either a dead button or
  a forgeable id.
- **A tab cannot reuse the controls the hub is made of.** Most existing claim handlers
  `i.update` **their own message**; clicked from a durable hub card they would delete it.
  The full inventory is §5.1.
- **A tab spends the last seat in the navigation row permanently.** `tabRow` puts every
  `PARK_TABS` entry in one row, and Discord caps a row at five buttons
  (`tests/lib/discord-limits.ts`).
- **Read cost, the original reason to prefer a tab, is not a constraint.** The prospective
  hub read block was measured against `makeCtx` with `ctx.db.$client.prepare` wrapped, 200
  warm reps: **21 statements, ~2.24 ms, unchanged between a 4-dino and a 40-dino park.**
  Against `RENDER_TIMEOUT_MS` of 3000 that is noise. Re-measure rather than quote — the
  script was a throwaway and is not in the repo.

There is one more trap the tab shape carries: `renderTab`'s dispatch ends at the last tab
with no `else` and no exhaustiveness check, so a `hub` member added to `ParkTab` and
`PARK_TABS` but missing a branch **compiles clean, typechecks clean, and renders the
previous tab's payload under a button labelled Hub**.

The rejected alternatives were an ephemeral card reached only from a park button (no
nameable destination for sub-project 3 to graduate into) and an enhanced `/daily`
(quest-shaped, and it would pull park reads into the daily module).

### 1.2 The `/park view` read dedup is NOT a prerequisite

`docs/conventions/park-surface.md` `§park-view-select-cost-and-dupes` records duplicated
reads on that path as the larger remaining win, and the sub-project-2 scoping note assumed
fixing it came first. **It does not, and the evidence argues against doing it first:**

- There is no latency to recover — see the measurement above.
- The obvious dedup is a **correctness** bug, demonstrated rather than argued: a memo seeded
  by `settleEscapes`' own read serves pre-settle rows downstream, and the attention marker
  renders 2 on a one-dino park instead of 1, because the escaped count comes from the fresh
  read while `needsAttentionCount`'s `escapedAt !== null` guard sees the stale copy. Silent,
  plausible, no failing test.
- `buildParkSnapshot`'s internal `settleEscapes` (`src/modules/park/snapshot.ts`) is not
  deletable: `/help topic:park` (`src/modules/help/index.ts`) calls it with no settle above
  it, so the dedup must make that settle conditional on the caller — a signature change
  whose default would preserve stale state.
- `renderTab`'s Park branch has an `await i.deferUpdate()` between its preamble reads and
  the tab's own reads, so any memo spanning `renderTab` spans a real suspension point.

Doing it first would also mean reshaping `toClockDinos` with no new caller to justify the
shape. The hub adds reads to a *different* module and does not make that finding worse in
any measurable way.

## 2. Decisions locked before design

| Question | Decision |
| --- | --- |
| What shape is the hub? | A standalone `/hub` command in its own module. Not a `/park view` tab. |
| Public or ephemeral? | **Ephemeral.** Owner-only by construction. |
| How dense? | Every live signal as text; up to five ranked buttons for the most urgent actionable rows. |
| How are the five chosen? | **Deadline first** — by what the player loses by waiting. |
| Empty state? | None. A "Working toward" section always renders, so the caught-up case is just the hub with its first sections absent. |
| Next unlock? | Two rows: nearest rating gate and nearest attendance gate. They key off different scalars. |
| Pending trade offers? | Shipped, as a **text row with no control**, plus a migration indexing the read. |
| Entry points? | `/hub`, a button on `/park view`'s Park tab, a button on the alert DM, and a mention in the `/help` walkthrough. |

### 2.1 Why a new module rather than growing `park`

`src/modules/hub/` imports services from park, hatchery, expeditions, genelab, daily,
guests, battles and trading. **Nothing imports it back**, so it is a leaf and creates no
cycle.

The follow-through spec rejected a central `core/follow-through.ts` registry partly because
it "would have to import from every module, inverting the dependency direction the repo has
today." That objection was about a **core** module every module depends on; a leaf inverts
nothing. The park module is also already the repo's largest aggregation surface — verify
with `wc -l src/modules/*/index.ts | sort -n` — and its Prestige branch already assembles
one payload out of several modules. Putting the hub there would make park the next such
aggregation; putting it in a leaf makes it the first thing in the repo that is allowed to
depend on everything, precisely because nothing depends on it.

## 3. What the hub reads, and what it must never call

`hubView(ctx, userId): HubView` in `src/modules/hub/service.ts` performs one gathering pass
and returns plain data. `embeds.ts` never touches the database.

### 3.1 The forbidden list

None of these may appear on any hub code path. Each is a write that would consume a
one-shot, forfeit a reward, or move a monotone high-water:

| Never call | Because |
| --- | --- |
| `rollDailyQuests`, `rollSeason` | Roll a new board / season row. Both already ran in `preDispatch` for the clicking user. |
| `stampSeasonHint` | Consumes the one-shot `hintedRung` follow-up that `dailyRouterHooks` owes. |
| `stampSeasonBadge` | A timestamped write; the hooks own it and run it ahead of their own exemptions. |
| `recomputeRating` | Can drop `parkRating` below `TRADE_MIN_RATING` and kill pending offers — a read must not have that power. |
| `bumpLegacyBest` | Latches a high-water. Use the pure `legacyRank` instead. |
| `expireStale` | A write. §6 gives the read-only alternative. |
| `recordSent`, `recordEscapeSent`, `pruneAlertRecords` | `alerts_sent` records that a **DM was sent**; a hub render that recorded would satisfy `alreadySent` and silently kill the next real DM. |
| any `claim*` | Claiming is a mint. It must be a click, never a render. |

### 3.2 The two sanctioned writes

Both run **once per interaction**:

- **`getOrCreateUser`** — unavoidable, and `park:collect` already sets the precedent for a
  first-time clicker who holds no users row.
- **`settleEscapes`** — deliberate, not incidental. Without it a dino whose escape instant
  has passed but is not yet stamped reads "at risk" on the hub and "escaped" on `/park view`
  seconds later. Two surfaces disagreeing about the same dino is exactly the defect
  `needsAttentionCount`'s doc comment (`src/modules/park/service.ts`) exists to prevent. It
  is also already the one write sanctioned on read paths —
  `§autocomplete-read-only-except-settle-escapes` permits it even in an autocomplete
  provider.

The `hub:refresh` and `hub:feedall` handlers settle once each too, on the same
once-per-interaction rule `renderTab` follows (`§settle-escapes-once-per-interaction`).

### 3.3 Reads

One shared `toClockDinos` pass and one `locksFor` map serve every dino- and lock-derived
row. Everything else is one read each: eggs, expeditions, breedings, incoming trades, and
the daily / season / achievement / attendance state.

`settleEnergy` (`src/data/battle/energy.ts`) is a **pure function** — it takes energy, a
timestamp and now, and returns the settled pair. The hub renders live energy with no write.
It must never print `users.energy` raw: that column is only accurate immediately after a
fight, because regeneration is never persisted.

## 4. The signal model, the sections, and the ranking

### 4.1 One shape per row

```ts
type HubSignal = {
  id: string;
  section: 'ready' | 'attention' | 'claim' | 'waiting' | 'goals';
  text: string;
  lossAtMs: number | null;   // when the player begins to lose something; null = waits forever
  control?: { customId: string; label: string; style: ButtonStyle };
};
```

### 4.2 Sections

| Section | Rows |
| --- | --- |
| **READY** | eggs ready to hatch · expedition returned · pairing ready · **eggs sitting un-incubated** |
| **NEEDS YOU** | escaped · at risk of escape, with its instant · wrong habitat · **dinos with no paddock** · no food in stock · income capped · **incoming trade offer expiring** |
| **CLAIM** | daily quests · achievements · season rungs, with a forfeit warning · guests milestones · pending income |
| **WAITING** | incubating, digging and breeding countdowns as one compact line |
| **WORKING TOWARD** | nearest rating gate · nearest attendance gate · battle energy |

**WORKING TOWARD always renders.** That is what removes the empty state: a caught-up park is
the hub with its first sections absent, not a second payload to build and keep in sync.

**WAITING earns its place** because "come back in twenty minutes" is a legitimate answer to
"what do I do now", and today it can only be assembled by running each subsystem's own
command in turn.

Two rows exist nowhere in the product today, and they are why a returning player currently
loses value silently: **un-incubated eggs** (owned, never started, earning nothing) and
**dinos with no paddock** (`lot_id IS NULL`, earning nothing). Confirm neither already has a
surface before implementing, with
`grep -rn "lotId === null\|incubationStartedAt === null" src/` — and note that the Gene Lab
breed picker labels an unassigned dino inline, so "no surface" means no *aggregate* surface.

The two unlock rows are separate because they key off **different scalars** —
`ratingHighWater` and `attendanceHighWater` — and a player can be one point from either. The
rating side reads a single shared pure helper over the rating ladders and returns the nearest
unpassed threshold; guests keeps its own. Battle chapters are excluded from that helper: a
chapter's blocker may be a star total or the previous boss rather than a rating, so it cannot
be expressed as one threshold.

### 4.3 Ranking

Sort actionable signals by `lossAtMs` ascending, `null` last, with a fixed tiebreak order
within the nulls. Take the first five.

Deadline-first is the only ordering that cannot mislead: a season rung forfeits at rollover,
a trade offer dies at its expiry, a dino escapes at a known instant, and capped income has
already stopped accruing — while a ready egg, an unclaimed achievement and a finished dig
wait forever. Every row the rule demotes is recoverable.

`null` is not "no urgency"; it is "no deadline". Rows whose `lossAtMs` is already in the past
— income already capped, a dino already escaped — sort first, which is correct.

## 5. Controls

Ephemeral is what makes control reuse cheap. The card is owner-only by construction, so a
foreign customId carrying no owner segment — `hatch:crack:<eggId>`,
`breed:claim:<breedingId>` — is safe on it in a way it would not be on a public card. **This
is a property of the surface, not of those ids**: neither becomes safe to mint on a public
message, and neither may be described as owner-checked.

### 5.1 Reuse inventory

| Control | Its handler does | On the hub |
| --- | --- | --- |
| `hatch:inc:<uid>:<eggId>` | Rebuilds `i.message.components` and drops only its own spent id | Hub survives, that one button vanishes. The best-behaved control in the repo. |
| `daily:claim:<uid>` · `ach:claimall:<uid>` · `season:claim:<uid>:<idx>` | Ephemeral `i.reply` | Hub survives |
| `park:assign` · `park:assignpick` · `park:assignsel` · `park:goto:lots` | Ephemeral `i.reply` throughout `assignFollowThrough` | Hub survives |
| `park:collect` | Ephemeral `i.reply` | Hub survives; its label goes stale. See §5.3. |
| `hatch:crack` · `exp:claim` · `breed:claim` · `guests:claim` | `i.update` their own message | Replace the hub with that module's card. Accepted: an ephemeral hub is cheap to reopen. |
| `park:feedall:<uid>` | `i.update`s **the Animals tab** into the clicked message | **Not reusable** — it would render a park tab, tab row and all, inside the hub. |

Verify this table rather than trusting it: it is a dated reading of handlers that may move.
`grep -n "i.update\|i.reply" ` over each handler is the check.

### 5.2 The `hub` prefix and its actions

One registry entry owns the whole prefix and branches on the action segment internally
(`§one-entry-per-prefix-branch-internally`):

- **`hub:open:<uid>`** — replies with the hub as a fresh ephemeral. The only action minted by
  *other* modules (§7); it never `i.update`s, because it is clicked on a park card or an
  alert DM that must survive.
- **`hub:feedall:<uid>`** — the single proxy. Feeds, then re-renders the hub with
  `feedSkipReport`'s line as the message `content`, the same result-line mechanism
  `renderTab` uses.
- **`hub:refresh:<uid>`** — re-renders in place.
- a **`default` arm that `deferUpdate()`s**, per `§component-default-arm-must-acknowledge`.

`hub:open` replies while `hub:feedall` and `hub:refresh` update, and that split is not
cosmetic: the first is clicked on someone else's card, the other two on the hub itself.

Every action carries the owner uid and rejects a mismatch before the service call. For
`hub:feedall` that check is a message-quality layer rather than the write barrier — `feedAll`
resolves against the caller — and it must not be described as the protection
(`§follow-through-control-carries-the-owner-uid`).

### 5.3 Why one Refresh instead of a proxy per subsystem

Every reused control that leaves the hub standing also leaves its label stale — the hub goes
on saying "2 dailies ready" after they are claimed. The alternative considered was minting a
`hub:*` proxy for each, so every action re-renders in place. **Rejected**: it is roughly one
handler per subsystem, and it duplicates claim-side validation that already lives in each
module's service. One Refresh control retires the whole class uniformly.

Staleness is therefore **mitigated, not eliminated**, and that is a deliberate trade. It is
sound only because no hub control spends cash: a stale label on a free claim is cosmetic,
while the same staleness on a spend is the `park:landmark:buy` defect again. **No hub control
may spend cash without revisiting this section.**

### 5.4 Layout

Up to five ranked buttons in row 0; Refresh alone in row 1. Two rows against a cap of five,
five buttons against a per-row cap of five (`tests/lib/discord-limits.ts`).

### 5.5 Two rows have no control, deliberately

- **Escaped dinos.** `rescueDino` is reachable only from `/rescue`; a button would be new
  spend surface in the care module, which this sub-project is not scoped to touch. The row
  names the command instead.
- **The trade offer.** The `trade` prefix handles exactly one action — verify with
  `grep -n "action !== " src/modules/trading/index.ts` — and accept/decline are slash-only.
  Adding them is real player value and belongs in its own change, where the offer
  notification, button-less since it shipped, can gain them too.

Both are recorded limitations, not oversights.

## 6. The trade row and migration 0020

Incoming offers are read by nothing today. `locksFor` filters `fromUser`
(`src/core/locks.ts`) — the **offer** side, because only the offerer's items are escrowed —
so a player has no way to see that an offer is waiting on them, and no way to learn that a
pending offer is why one of their dinos cannot be sold.

The hub issues its own read filtered `status = 'pending' AND toUser = ? AND createdAt >
cutoff`.

**Filtering on `createdAt` rather than calling `expireStale` is load-bearing.** A pending row
keeps `status = 'pending'` past its deadline until something closes it, and `expireStale` is
a write — and an unscoped scan. The hub derives expiry the way `locksFor` already does.

**Migration 0020** adds `trades_status_to` on `(status, to_user, created_at_ms)`, an exact
mirror of the existing `trades_status_from`, whose own comment already explains why `status`
leads. Without it the read is a full scan of every pending trade in the database with the
user filter applied in JavaScript — the only hub signal whose cost grows with the player base
rather than with the park. It was measured before the index at three seeded population sizes
and is linear in the global pending-trade count; re-measure rather than quoting figures.

## 7. Entry points

- **`/hub`** — no options. Ephemeral reply.
- **Park tab button.** `dashboardPayload` (`src/modules/park/embeds.ts`) gains a
  `hub?: boolean` opt and mints `hub:open:<uid>` as a **raw string**, importing nothing from
  the hub module — park must not import hub, or the leaf property in §2.1 is lost.
  - It goes **inside the existing `if (!opts.visit)` block, after Collect**. Collect must
    stay the first button of the first row (`§collect-first-button-first-row`), and the
    button must be suppressed on a visited card for the same reason `park:collect` is.
  - The `hub` opt is passed as `ctx.config.modules.hub` by the caller — the same gate
    `src/modules/shop/index.ts` applies before minting a cross-module control. Without it the
    button survives on a durable message past a deploy that disabled the module, as a control
    that silently does nothing.
- **Alert DM button.** The same `hub:open:<uid>`, inserted before Mute in
  `src/modules/park/alert-embeds.ts`, behind the same modules gate. That row's occupancy is
  conditional, so check the worst case against the `discord-limits` suite rather than by
  inspection.
- **`/help`.** `/hub` is named in the `getting-started` walkthrough body. A dedicated `hub`
  help topic is **out of scope**: the topic choice list is derived from `HELP_TOPICS`' keys,
  so a new topic is a `/help` builder change, and sub-project 3 rewrites that walkthrough
  anyway.

## 8. Testing

- **A routed test per component.** `hub:open`, `hub:feedall`, `hub:refresh` and the default
  arm, each dispatched through `routeInteraction` with its real minted customId, per
  `§routed-test-per-component`. The generic gates do not cover them; the ledger pager would
  have shipped dead without one.
- **The no-write gate.** Render the hub against a seeded park and assert `daily_quests`,
  `season_progress`, `alerts_sent`, `achievement_claims`, `trades`, `eggs`, `expeditions` and
  `breedings` are unchanged, and that `parkRating`, `attendanceHighWater` and the legacy
  high-water did not move. This is the test that makes §3.1 enforceable rather than
  aspirational.
- **Break-and-watch on the ranking.** Invert the `lossAtMs` comparator, watch the ordering
  test go red, restore. A guard nobody has watched fail is not yet a guard. Note that
  vitest's `expect()` is fail-fast, so an assertion sitting behind an earlier failing one is
  never observed — use `expect.soft`, reorder, or drop it, and say which.
- **The five registration sites**, each of which fails a specific test rather than the build:
  `modules.json`, `ALL_MODULES`, `tests/registry-load.test.ts`, `tests/config.test.ts`, and
  the pinned top-level command count in `tests/contract.test.ts` — that literal moves by one.
- **A disabled-module case**: with `hub` false in the config, neither entry-point button is
  minted.
- **Layout limits** through the existing `discord-limits` suite: five buttons per row, and the
  alert row in its fullest configuration.
- **The index exists** after migration 0020, following the pattern the 0018 read-index work
  established.
- **Both new rows covered** — un-incubated eggs and dinos with no paddock — including the
  boundary where the count is zero and the row must not render.

Any "expected failure" output quoted in a task brief is a **hypothesis**. Report what
actually happens when it differs.

## 9. Operator steps

1. `npm run deploy-commands` — **mandatory**. `/hub` is a new builder, and until it runs
   Discord does not advertise the command at all.
2. Migration 0020 applies on boot. The bot serves compiled `dist/`, so build before
   restarting.
3. RegEdits starts the bot; never start it for them.
4. No emoji work. Every glyph on this surface is unicode, per
   `§never-emojitag-in-module-constant` — the app-emoji map returns `''` when unloaded and
   `setEmoji` throws on that rather than degrading.
5. `npm run test:live` is REST-only and **cannot click any of these buttons**. Manual checks
   are the only evidence for §5.1's reuse table.

## 10. Risks accepted

- **The quest hint would stack on the hub.** `/hub` goes in `EXEMPT_COMMANDS` and `hub` in
  `EXEMPT_PREFIXES` (`src/modules/daily/hooks.ts`), or the hub renders "1 quest ready" and
  Discord immediately stacks "🎯 Quest complete — /daily to claim!" on top, burning the
  one-shot `notifiedAt`. Both sets are safe to extend here **because the new entries are ours
  alone** — the same edit made for a park *tab* would have killed the hint after every park
  button click, since `EXEMPT_PREFIXES` is prefix-wide. `stampSeasonBadge` runs ahead of both
  exemptions and is unaffected.
- **The hub and the DM sweep will report different at-risk sets, by construction rather than
  by drift.** `escapeAlertsFor` requires the escape instant to be in the future and within a
  fixed lead time; `needsAttentionCount` has no lower bound and folds in wrong-habitat. The
  hub renders the `needsAttentionCount` definition and **imports** it rather than inlining a
  copy — its doc comment forbids a second copy, and two copies drifting is a defect this repo
  has already paid a fix round for.
- **Stale labels between actions**, mitigated by Refresh only (§5.3). Sound only while no hub
  control spends cash.
- **Ephemeral cards are transient** — not shareable, not screenshot-able as a durable
  artefact, and gone on a client reload. Accepted as the price of owner-only, which is what
  makes §5.1 possible.
- **The sweep deliberately skips players the hub serves.** The alert sweep filters out players
  with alerts disabled and players with no lots — and the no-lots case is exactly the
  brand-new player the hub exists for. The hub is strictly broader than the sweep, and that
  divergence is intended.
- **`hub:open` is minted by modules that do not own it.** That is the price of not importing
  the hub from park; the modules gate in §7 is the whole mitigation, and a renamed hub prefix
  would break both entry points silently.
