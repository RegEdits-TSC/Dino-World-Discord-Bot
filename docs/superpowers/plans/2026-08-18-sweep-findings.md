# Hardening sweep findings

## Method

Seventeen modules under `src/modules/**` (plus the `src/core` surfaces they call) were swept against eight defect classes:

1. **Custom-id integrity** — component ids that omit the state they act on, or carry state that goes stale on a durable message.
2. **Cross-user authorization** — id segments a handler trusts for identity before writing another player's row.
3. **Interaction lifecycle** — acknowledgement ordering, reply-once, and the user-row bootstrap a handler assumes but never performs.
4. **Payload and attachment contracts** — `files` / `attachments` on `i.update`, `editReply` and `deliverNotification`, including orphaned uploads and shared payload objects.
5. **Derived-state invariants** — values re-derived at read time (escrow locks, quest progress, world events, attendance, alert records) and the conditions that make re-derivation safe.
6. **Admin reset / fast-forward coverage** — every table and column a feature reads, against the two tools that must move or clear all of them.
7. **Transaction atomicity and commit ordering** — writes escaping the transaction that measures them, and presentation racing a commit.
8. **Event-scaled price and cost routing** — quote, autocomplete label and actual charge each reaching the same helper rather than re-multiplying a table value inline.

Each candidate defect was put to three independent skeptics, who were asked to refute it against the tree rather than rate it. A candidate died on a majority of kills. Six candidates survived; two of those are the same defect reached independently by the custom-id lens and the lifecycle lens, and are reported once (S2) rather than twice. Five of the six drew no dissent at all; S1 drew one kill vote and survived 2–1.

An empty class is a real result, not a gap in the sweep: it is evidence that the convention that class enforces is currently holding across all seventeen modules, and it is recorded as such below.

## Confirmed defects

### S1 — Duel Accept trusts the challenger id from the customId and mutates that player's rating

**File:** `src/modules/duels/index.ts:178` (customId minted at `src/modules/duels/embeds.ts:82`)

**Scenario:** `duel:accept:<challengerId>:<defenderId>:<expiresAtMs>` is split into five client-supplied segments at `src/modules/duels/index.ts:160`. The handler validates exactly two of them: `defenderId` must equal the clicker (`:163`) and `expiresAtMs` must be finite and in the future (`:168`). `challengerId` is never validated — not against a stored challenge (a live challenge stores nothing by design), not against the message that carries the button, not against any consent record — and is passed straight to `resolveDuel(ctx, challengerId, defenderId, 'live', expiresAtMs)` at `:178`.

Attacker `B` emits a component interaction with `custom_id = "duel:accept:A:B:<now+1>"`, where `A` is any player holding a `users` row and one non-escaped dino — a player who has never interacted with `B` and has posted no challenge. Every gate passes: `i.user.id === 'B' === defenderId`; the expiry is in the future; `resolveDuel` requires only that both `users` rows exist and both squads are non-empty (`src/modules/duels/service.ts:196-206`), and nothing asks whether a challenge for this pair was ever posted. Repeating with `expiresAtMs = now + DUEL_CHALLENGE_TTL_MS + k` for k = 1, 2, 3… defeats the replay guard: `challengeAlreadyResolved` (`src/modules/duels/service.ts:169-173`) scans only `[expiresAtMs - TTL, expiresAtMs]`, so each incrementing anchor opens a window containing none of the prior duels. `cooldownUntil` is consulted only on the `mode === 'ghost'` branch (`src/modules/duels/service.ts:207-212`), so the six-hour pair cooldown does not apply on this path at all.

**Wrong outcome:** `resolveDuel` writes `users.duelRating` for `challengerId` and inserts a `duels` row in one transaction (`src/modules/duels/service.ts:243-252`), so `A`'s zero-sum Elo moves on a duel they never agreed to, never initiated, and are never told about — `notifyDefender` returns early for anything that is not `mode === 'ghost'` (`src/modules/duels/service.ts:274`), and `A` is seated as the challenger here regardless, so no notification path exists. Repeated with incrementing anchors, `B` farms rating off a weak `A` without limit, or grinds a strong `A` down; `A`'s `/duel record` and their standing on `/top metric:duels` are both corrupted by fights they never fought. There is no second layer: `resolveDuel` is the only writer and it takes `challengerId` on faith. Every other cross-user surface has one — trades require `toUser === userId`, and `alert:*`, `season:claim`, `daily:claim`, `guests:claim`, `ach:*`, `park:assignyes` and `park:landmark:buy` all owner-check before any read.

**Why tests miss it:** `tests/duels.test.ts` covers the defender check from both wrong directions — a bystander `c` clicking (`:642`) and the challenger `a` clicking their own Accept (`:650`) — which gives the impression the id segments are validated. But every accept test builds the customId as `duel:accept:a:b:<TTL>` after actually running `challenge('a','b')`, so `challengerId` is always genuine and the unvalidated segment is never exercised with a third-party value. The double-accept test (`:632`) uses an identical `expiresAtMs` on both clicks, pinning `challengeAlreadyResolved` in the one configuration where it fires and never varying the anchor. Nothing asserts that a duel requires a prior `/duel challenge` to have been posted — and it does not, which is the defect. `fakeButton` takes the customId as a literal string, so a forged-segment case would have been trivial to write.

**Class:** Cross-user authorization.

**Gate:** `no` — closable in code by binding the challenger segment to the message that carries the button (reject any `challengerId` that is not the originating interaction's user), plus anchoring the replay scan to the pair rather than the client-supplied window. A stored-challenge redesign would need a migration but is not required to close it.

**Correction to that gate:** the first half of it, as written, does not close the defect and was implemented and reverted. "The originating interaction's user" (`Message#interactionMetadata.user.id`) proves only that the anchoring message came from SOME interaction of the named challenger's — not that they ever challenged this defender. `routeInteraction` dispatches on the customId prefix alone and never checks the message belongs to the module handling it, so the forged id can be anchored on any interaction-authored bot message of theirs: a public `/park view`, a `/duel record`, or their genuine challenge card addressed to a THIRD player. The check that does close it is the message's own BUTTON SET (`Message#components`): only a real `A → B` card carries a button whose custom_id is exactly `duel:accept:A:B:<exp>`. The second half also needs care — narrowing the replay window's upper bound to `ctx.now()` makes it `[expiresAtMs - TTL, ctx.now()]`, empty for any anchor past `now + TTL`, so the guard returns false unconditionally and one fixed customId replays forever. Clamping `expiresAtMs` from ABOVE and keeping the original `expiresAtMs` upper bound is what actually closes the replay half.

**Status:** fixed — round 1 (`450dfa7`) did not close it; round 2 (this commit) does.

### S2 — `park:collect` is the only customId with no id segment, and its handler creates no user row

**File:** `src/modules/park/index.ts:405` (button minted at `src/modules/park/embeds.ts:93`; crash at `src/modules/park/service.ts:150` / `:172`)

**Scenario:** Player A runs `/park view` in a guild channel. That path replies publicly (`await i.deferReply()` at `src/modules/park/index.ts:182`, no ephemeral flag) and `dashboardPayload` appends the Collect button unconditionally, minted as the bare literal `park:collect` — the only customId in all of `src/modules/**` with no id segment. The message is durable and sits in channel history. Channel member B, who has never run a bot command and therefore holds no `users` row, clicks the green `Collect 12,345`.

Nothing upstream mints a row for B: `touchPresence` (`src/core/router.ts:10`) issues an UPDATE that matches zero rows, and its `user_guilds` INSERT carries no foreign key to `users` (`src/core/db/schema.ts:190-194`) so it succeeds silently; `dailyRouterHooks.preDispatch` (`src/modules/daily/hooks.ts:21`) calls `rollDailyQuests`/`rollSeason`, both of which no-op on a missing user row. Dispatch reaches `src/modules/park/index.ts:403-407`. `settleEscapes` at `:404` survives — it destructures only `clockDinos` and `dinos`, never `user`. Then `collectIncome(ctx, i.user.id)` at `:405` → `pendingIncome` (`src/modules/park/service.ts:171`) → `toClockDinos`, whose `.get()!` at `:150` is a false non-null assertion yielding `undefined`, and `:172` evaluates `user.lastCollectAt`. Verified end-to-end through the real `routeInteraction`: `TypeError: Cannot read properties of undefined (reading 'lastCollectAt')` at `service.ts:172:81` → `service.ts:176:18` → `park/index.ts:405:30`.

Because the customId carries no owner id, the handler has no uid to check — and unlike every other component handler it also never calls `getOrCreateUser`. Compare `mythic:confirm` (`src/modules/hatchery/index.ts:111`), which does; every other handler owner-checks the id segment, which implicitly guarantees the row exists because the button was minted for a user who has one. `battle:chapter` has an explicit `if (!cv)` arm replying "Run /battle chapters first."; `hatch:crack` and `breed:claim` get clean domain errors from their `(id, userId)` filters. This is also the only unguarded entry into `collectIncome`: the sibling `alert:collect` path (`src/modules/park/index.ts:525-545`) rejects any clicker who is not the alerted user.

**Wrong outcome:** The handler sends zero replies. The router's catch (`src/core/router.ts:69-76`) answers B with the generic ephemeral "Something went wrong — nothing was charged. Try again." and logs at level `error`. The message is doubly misleading — nothing was attempted rather than failed — and it repeats on every click forever, with no hint that the fix is to run a command of their own first. Since the public card never expires, the button is a standing error-response and log-noise generator for any non-player in the channel. Either behaviour would be correct: create B's park (the `mythic:confirm` behaviour), or tell B plainly the button is not theirs.

**Why tests miss it:** Every test that clicks this button drives it as an already-seeded user — `tests/dinos.test.ts:281` and `:288` use `fakeButton({ customId: 'park:collect', user: 'u1' })` after `seedUser`, and `tests/journeys.test.ts:94`, `:143`, `:192` click as `p1` after the journey created that park. No test in the suite drives any component interaction from a user with no `users` row, so the `!` at `service.ts:150` is never falsified. The three tests that reason about the missing id segment — `tests/visit.test.ts:72`, `tests/park-view-image.test.ts:54`, `tests/dinos.test.ts:205` — all assert only that `park:collect` is *absent* from another player's card; none exercises the case where it is present, which is the owner's own public dashboard. The harness fakes cannot see it either: they enforce reply-once and defer-before-`editReply`, and a handler that throws before replying at all violates neither rule. `npm run typecheck` cannot see it: the `!` suppresses exactly this check, and `tsconfig` sets `strict` without any option that questions a hand-written non-null assertion.

**Class:** Custom-id integrity **and** interaction lifecycle — reached independently by both lenses, reported once.

**Gate:** `no`.

**Status:** fixed by this commit

### S3 — `adminFastForward` shifts `dinos.lastFedAt` but not `dinos.escapedAt`, so an escaped dino resumes earning

**File:** `src/modules/admin/service.ts:169-170`

**Scenario:** The dinos update at `:169-170` shifts only `lastFedAt`. `escapedAt` is never shifted, and the trailing `settleEscapes` (`:214`) skips any row where `escapedAt !== null`, so nothing re-stamps it. `accruedIncome` (`src/core/clock.ts:119-134`) reads `escapedAt` twice as an income boundary: it skips a dino only when `escapedAt <= from` (`:126`), and otherwise clamps `dinoEnd = min(end, max(from, escapeAt(d)))` (`:131`), where `escapeAt` returns the stored `escapedAt` verbatim (`src/core/clock.ts:106-107`). Shifting `lastFedAt` back moves `from` (`users.lastCollectAt`, also shifted) and `hungerZero` back with it while `escapedAt` stays put — putting the stamped escape instant back inside the window.

Verified against the real `accruedIncome`, `getSpecies` and `PADDOCKS`: a triceratops fed at t=0, hunger 100, in a herbivore paddock with no decor → `paddockFit` 0.75, hunger threshold 33.3, comfort crossing 32h, `escapeAt` 40h, `hungerZero` 48h. At t=41h the player runs `/park view`: `settleEscapes` stamps `escapedAt = 40h`, Collect pays to 40h and sets `lastCollectAt = 41h`; a second Collect correctly pays 0. The owner then runs `/admin fast-forward user:<p> hours:24` — `lastCollectAt` 41h→17h, `lastFedAt` 0h→−24h, `escapedAt` unchanged at 40h. The next Collect computes `from = 17h`, `hungerZero = 24h`, `dinoEnd = min(41h, 40h, 24h) = 24h`, and pays for [17h, 24h].

**Wrong outcome:** `/park view` renders the dino with the ESCAPED badge (`src/modules/park/index.ts:65`) while the Collect button on that same embed pays cash attributable to it, breaking the invariant that an escaped dino earns nothing until rescued. Measured payouts for the scenario above: 22 cash for a common triceratops, 1,148 for a legendary tyrannosaurus. Off-diet (`paddockFit` 0.5, reachable through `assignDino`'s `allowMismatch` confirm path) the wrong window widens from 8h to 16h: 70 cash common, 3,515 legendary, 31,640 for a park of nine escaped legendaries. The overpay is also a double-pay — [17h, 24h] overlaps hours the pre-fast-forward Collect already paid. With `escapedAt` shifted by the same `shift` as `lastFedAt`, every one of those cases returns exactly 0.

**Why tests miss it:** `tests/admin.test.ts:160` ("advances income and starves an assigned dino into escaping") is the only fast-forward-plus-escape test, and it inserts a dino whose `escapedAt` is still NULL — the escape is *caused* by the fast-forward and stamped by the trailing `settleEscapes`, so `escapedAt` is always written after the shift, never before it. `escapedAt` appears exactly once in that file (`:168`) and only as a not-null assertion. No test fast-forwards a player who already holds a stamped `escapedAt`, the only state that reaches the bug. Sibling coverage does not help: "fast-forward does not shift alert records" (`:462`) pins `alerts_sent`, not `dinos`, and the breedings tests pin a claimed-vs-pending scope on another table. `accruedIncome`'s own unit tests in `tests/clock.test.ts` always construct `escapedAt` and `lastFedAt` as a mutually consistent pair, so the inconsistent pair this tool creates is never built anywhere.

**Class:** Admin reset / fast-forward coverage.

**Gate:** `no`.

**Status:** fixed by this commit

### S4 — `pruneAlertRecords` re-arms the income-cap DM every 30 days for an idle park

**File:** `src/modules/park/alert-record.ts:87` (justifying comment at `:85-86`)

**Scenario:** The prune deletes every `alerts_sent` row older than `ALERT_RECORD_TTL_MS` (30 days), justified by the comment that "a pruned row can only re-fire for an instant TTL-old, which the `escapeAt > now` and `pending > 0` conjuncts in alert-detect already exclude." That holds for the escape kind — `esc <= now` is rejected at `src/modules/park/alert-detect.ts:32` — but not for `income_cap`.

`incomeCapAlertFor` (`src/modules/park/alert-detect.ts:66-75`) computes `capAt = lastCollectAt + capHours * 3_600_000` and `pending = accruedIncome(clockDinos, …, lastCollectAt, now)`. Once `now >= capAt`, `accruedIncome`'s `end = Math.min(to, from + capHours * h)` (`src/core/clock.ts:121`) is pinned at `capAt`, and every per-dino clamp (`escapeAt(d)`, `hungerZero`) is a function of `lastFedAt`, hunger and fit alone. `pending` is therefore **frozen** the moment the cap is reached — it does not decay with elapsed time, so the `pending > 0` conjunct can never age out.

A player with `alertsEnabled` true and a Visitor Center L1 park (`capHours` 8) collects at T, feeds, then stops playing. At T+8h the sweep fires the income-cap DM and `recordSent` writes `firedForMs = capAt`. Nothing settles their escapes — the sweep deliberately never calls `settleEscapes` — and nothing moves `lastCollectAt`. At T+8h+30d the prune deletes that row; on the next 15-minute sweep `alreadySent(ctx, uid, 'income_cap', 0, '', capAt)` finds no row and returns false, `incomeCapAlertFor` still returns the identical `{ capAt, pending }`, and the identical DM goes out again. Then again 30 days later, indefinitely.

**Wrong outcome:** A lapsed player receives the same "your park has hit its income cap" DM every 30 days forever, violating the module's stated one-DM-per-instant guarantee. The 2-hour `ALERT_INSTANT_EPSILON_MS` tolerance is irrelevant here: it is the row's *absence*, not a moved instant, that defeats the check.

**Why tests miss it:** `tests/alert-record.test.ts` exercises `pruneAlertRecords` against `sentAt` only — old rows deleted, recent rows kept — and `tests/alert-sweep.test.ts` drives at most a couple of sweeps within one fixture clock, never a prune followed by another sweep on an unchanged park. Nothing composes prune + re-detect for the `income_cap` kind, the only combination that exposes the frozen-`pending` property.

**Class:** Derived-state invariants.

**Gate:** `no` — `alerts_sent` already stores both `sentAt` and `firedForMs`, so the fix is a retention rule change (exempt `income_cap`, or retain by `firedForMs` rather than `sentAt`) with no schema change.

**Status:** fixed by this commit

### S5 — Declining a duel challenge leaves the duel banner attached as an orphan image

**File:** `src/modules/duels/index.ts:173`

**Scenario:** Player A runs `/duel challenge opponent:B`. The reply is `challengePayload`, which since commit `49965a9` calls `attach(embed, payload, 'image', assetImage('banners', 'duel'))` (`src/modules/duels/embeds.ts:88`) — the message ships one uploaded file `duel.webp` and an embed pointing at `attachment://duel.webp`. B clicks **Decline**. The handler sends `i.update({ content: '⚔️ Challenge declined by B.', embeds: [], components: [] })` — no `files`, and no `attachments` key. In `MessagePayload.resolveBody` (`node_modules/discord.js/src/structures/MessagePayload.js:215-225`) `this.options.files` is undefined, so `attachments` resolves to `undefined`, `JSON.stringify` drops the key from the PATCH body, and Discord retains the message's existing attachment set when `attachments` is omitted.

**Wrong outcome:** The declined card renders as one line of text followed by the full 1536×1024 `duel.webp` banner still hanging on the message as a bare attachment card that no embed references — the state `fightFrames`' own comment forbids ("Never add a file here that no frame references — it renders as a bare attachment card under the message") and the state the sibling accept path at `src/modules/duels/index.ts:181` spends an explicit `attachments: []` to avoid. The fix is `attachments: []` on the decline update. This is the shed-a-previous-set case, not the omit-the-key case — that rule applies only on the `deliverNotification` path, where one payload object reaches two sends.

**Why tests miss it:** The decline test in `tests/duels.test.ts` ("declines without resolving anything", `:663`) asserts only `expect(JSON.stringify(b.replies[0])).toMatch(/declined/i)` and that no duel row was written; it never inspects `files` or `attachments`. The two tests that do inspect the attachment set ("replaces the card in place, shedding its buttons and attachments", `:602`, and "accepting uploads the result art while still shedding the challenge card attachment set", `:616`) both drive `duel:accept` only, and both were written in this branch alongside the banner. The defect is new: before `49965a9`, `challengePayload` returned `{ embeds, components }` with no files at all, so the decline update had nothing to shed and was correct as written.

**Class:** Payload and attachment contracts.

**Gate:** `no`.

**Status:** fixed by this commit

## Classes that produced nothing

Two of the eight classes finished the sweep with zero surviving findings. Both are recorded here as results, not omissions:

- **Transaction atomicity and commit ordering.** Every `track` call sits inside the write it measures; `runFight` still commits energy, rewards, progress, XP and the boss egg in one transaction before the first Discord edit; `collectIncome`'s credit and its `lastCollectAt` update remain in one transaction (`src/modules/park/service.ts:175-180`); `resolveDuel`'s rating writes and its `duels` insert are one transaction (`src/modules/duels/service.ts:243-252`). No candidate in this class survived refutation — several were killed on the grounds that the write in question was already inside the enclosing transaction.
- **Event-scaled price and cost routing.** Every quote, autocomplete label and charge still reaches one helper — `eggPriceAt`, `foodPriceAt`, `roundCharge`, `sellCashAt`, `roundPayout`, `feedCostFor`, `energyCostFor` — with no re-multiplied table value at any call site, and the required-`now` parameters that prevent a call site silently keeping an unmodified rate are all still required. Nothing in this class reached a skeptic.

Note that S1 was the only finding to draw a dissenting skeptic (it survived 2–1); the other four were unanimous.