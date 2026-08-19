## Is the hole real

**Yes, and it is worse than the review described in scope while being narrower than it implied in impact.**

Confirmed at source: `src/core/router.ts:56-57` resolves a handler from `customId.split(':')[0]` and calls `comp.execute` with nothing binding `i.message` to the module, the id, or the clicker. `clickedIdIsOnMessage` (`src/core/components.ts:44-50`) exists and is called from exactly one place, `src/modules/duels/index.ts:186`.

**Reachable surface.** 17 component prefixes across the 17 enabled modules. 13 have at least one branch that edits the *source* message via `i.update` or `deferUpdate`+`editReply`; counted by branch, **24 distinct source-editing branches** are reachable with a forged id naming the attacker's own user id, because every owner segment is checked against `i.user.id` — naming yourself passes.

**The review's list is 11/13 right, with two false positives and roughly twelve omissions.** `daily:claim` and `season:claim` are *not* exploitable — every terminal is an ephemeral `i.reply`, a new interaction response. Missed entirely: `alert:collect`, `alert:feedall`, `park:assignyes`, `park:assignno`, `park:landmark:buy`, `battle:skip`, `battle:again`, `battle:chapter`, `hatch:crack`, `mythic:confirm`, `sell:confirm`, `exp:claim`, `breed:confirm`.

**The impact ceiling is message vandalism, and that is the honest ceiling.** I traced the write in all 24 branches: each is either scoped directly to `i.user.id` (`claimQuests`, `claimAchievements`, `claimSeason`, `claimExpedition`, `claimMilestone`, `collectIncome`, `feedAll`, `buyLandmark`, `buyMythicEgg`, `runFight`, `expireStale`, the `alertsEnabled` UPDATE) or re-filtered server-side on `(id, userId)` (`hatchEgg`, `sellDino`, `claimBreeding`, `startBreeding`, `spliceDino`, `assignDino`). Exactly two cross-user writes exist in component handlers:

1. `resolveDuel` — the original defect, already closed by the guard at `duels/index.ts:186`, which sits above both the accept and decline branches.
2. `settleEscapes(ctx, targetUserId)` via `park:tour` / `top:visit` — a genuine write to another player's rows, but not an escalation: it stamps `escapeMoment(...)` rather than `ctx.now()`, only fires for dinos already past `escapeAt`, cannot suppress an alert (`escapeAlertsFor` skips `esc <= now`), and is equally reachable from the public `/park view user:<id>` command anyone may run.

So: no money moves, no state is stolen, nothing is disclosed that is not already public. What an attacker gets is the ability to overwrite **any bot message they can address** with their own content — and, because most of those updates send `components: []`, to silently disarm live buttons other players are relying on (a park card's Collect, an alert DM's Feed All, a season or guests claim, a duel challenge card). The victim loses a pending action, never state, and can re-run the command.

The severity driver is the **free, unlimited, side-effect-free subset**, which is larger than the review implied: nine branches need no resource and no prior state beyond at most one setup command — `park:tour` (no owner check at all by design; any target with rating > 0), `park:assignno`, `park:dinos`, `ach:page`, `dex:page`, `hatch:eggs`, `trade:list`, `battle:chapter`, and all three `alert:*` actions. `alert:mute` / `alert:collect` / `alert:feedall` are the worst cosmetically — they send `embeds: [], components: [], attachments: []`, leaving the victim's message as one line of unrelated text with its art and buttons gone. `park:tour` is the worst functionally: full replacement with a rendered park PNG of the attacker's choosing.

Verdict on the reviewer: right about the mechanism, wrong about the inventory in both directions, and it did not overstate the ceiling — it never claimed state theft, and there isn't any.

## Is the guard safe

**Yes — conditional on one design detail the review omitted: rejection must be `await i.deferUpdate()`, never a bare `return`.** With a silent return, Discord paints "This interaction failed" after 3s on every rejected click, and several of the flows below turn from invisible into ugly. With `deferUpdate`, every one of them is a no-op that is already the correct outcome.

Flow by flow:

**`battle:skip` arriving at or after F4 — SAFE.** This was the safety analysis's decisive blocker and its framing ("by design rather than by race") is wrong; all three skeptics independently corrected it and I confirmed the code. `fightFrames` dresses the Skip row onto frames 0-2 only; F4 is built with `components: []` (`battles/embeds.ts:141`) and `presentFight` pushes `againRow` onto it (`battles/index.ts:95`). The cinematic runs 7.5s and the Skip button is live for all of it — a click at t=7.4s finds `battle:skip:<uid>:<pid>` still on the message and **passes the guard**. The only rejected case is a click whose gateway latency straddles F4's PATCH, and in that case F4 is already on screen and `entry.skipped = true` has nothing left to skip. What is lost is the handler's deliberately always-true acknowledgement at `battles/index.ts:233` — and the router's own `deferUpdate` supplies exactly that. Net functional loss: zero. The two absorb-the-late-Skip paths become unreachable, which is why they need a comment rather than a deletion.

**Double-click on any handler that clears its own components (`hatch:crack`, `sell:confirm`, `mythic:confirm`, `alert:*`, `park:assign*`) — SAFE, and an improvement.** Today the second click reaches the service and is rejected there (`HatcheryError` "egg not found", "Nothing to collect yet", or the router's generic catch). Under the guard it never reaches the service at all. The first click already succeeded and repainted; nothing is owed. `hatch:crack` is the most double-clicked button in the game and this is strictly better for it.

**Pagination and state-in-customId races (`pageRow`, `dexPageRow`, `battle:chapter`, `park:tour`, `guests:claim`, `park:landmark:buy`) — SAFE.** Each `i.update` re-mints both ids, so a click in flight across the edit is rejected. Clicking the repainted button works. The one sharp-sounding case, `park:tour` behind a 3s render, is actually the *safest*: during the pending render the old id is still on the message, so the guard passes for the whole window. The failing window is the same sub-second repaint lag as everywhere else.

**Multi-button alert rows — SAFE, worth naming.** `alertPayload` puts Feed all / Collect / Mute on one row and any one of them wipes all three, so the rejected click can be a *different* real action rather than a repeat. But the message re-renders without the siblings on the same PATCH, so this is still a repaint race, bounded to the same milliseconds.

**Ephemeral and DM-minted buttons — NOT a risk; the safety analysis's "medium" here collapses to zero.** discord.js builds `MessageComponentInteraction#message` from the interaction payload's `data.message`, not from cache, and the library's own public `get component()` performs precisely this `findComponentByCustomId(this.message.components, this.customId)` lookup for every component type. If ephemerals arrived without `components`, that getter would return null for every ephemeral button in every discord.js bot. No live dev-guild probe is needed before shipping.

**Select menus, modals, link buttons, v2 containers — empty risk.** `router.ts:44` returns for anything that is neither a chat-input command nor a button, `ComponentDef.execute` is typed `ButtonInteraction`, and nothing in `src/` mints a select, modal, or link button. The helper already recurses into nested `components` and rejects an empty clicked id.

**Buttons minted onto messages the bot does not own — none exist.** Every button in the repo ships on the payload it is clicked from, including the DM-delivered ones (`core/notify.ts`, `park/alert-embeds.ts`) and the world broadcast (which mints no components at all). The guard's premise is literally true.

**Did any skeptic find a real counterexample? No — 0 of 3 dissented, and the one who simulated the change ran the entire suite under a router-level gate with every test passing.** The safety analysis's own blockers survive only as cosmetics under a `deferUpdate` rejection, which it acknowledged: "that single detail is the difference between cosmetically annoying and unshippable."

**The one honest limitation:** this guard closes cross-message anchoring, not stale-same-message replay. The landmark 32x overcharge came from stale buttons on *other open messages*, and those buttons are on their own messages, so the guard passes them. Per-rung, per-page, per-season state in customIds remains mandatory and this change does not relax it.

## Recommendation

**GO.** The hole is real, cheap to exploit, and unbounded in repetition for nine branches; the fix is one guard on the single dispatch path, and after correcting the rejection behaviour no legitimate flow loses anything but a redundant service call. Ship it exactly as designed below.

**Insertion point.** `src/core/router.ts:57`, inside the existing `else` and inside `if (comp)`, as the first statement before `comp.execute`, returning from the enclosing `try`:

- **After `findComponent`, not before** — `tests/router.test.ts:138-144` pins an unrouted prefix as a fully silent no-op with no ack at all. Hoisting the guard would make the router acknowledge every unclaimed prefix in existence. Separate change; do not ride it along.
- **Inside the `try` opened at line 45** — a `deferUpdate()` that throws on an expired interaction is absorbed by the catch at line 68 instead of becoming an unhandled rejection at `src/index.ts`.
- **After `touchPresence` (46) and `preDispatch` (48)** — both write only about the clicker, and the "presence writes even on a dead dispatch" invariant is pinned at `tests/router.test.ts:121-129`.
- **Before `postDispatch`, via an early `return` — the non-obvious one.** `deferUpdate()` sets `i.deferred = true`, and `daily/hooks.ts:41` gates only on `!i.deferred && !i.replied`. Falling through would let a forged click produce a real "Quest complete" / "Season reward ready" followUp and, worse, consume the one-shot `hintedRung` / `notifiedAt` stamps for a message nobody asked for.

Import `clickedIdIsOnMessage` from `./components.js`; no cycle, and `ButtonInteraction` already satisfies its parameter type — do not widen the function.

**Rejection behaviour.** `await i.deferUpdate()` plus `logger.warn({ customId, userId, messageId })`. This is already the house idiom for the same situation, with the reasoning written down at `battles/index.ts:254-256` and repeated in seven other unknown-action arms; `park/index.ts:535-538` records the same ruling for stale shapes. Do **not** send a distinct text reply — it is an oracle that tells an attacker the guard, rather than the handler, stopped him, and it would badly confuse a user who merely double-clicked a pager. Expect two benign shapes in the warn log before assuming an attack: pager double-clicks and late `battle:skip`.

**Tests — the only evidence this change will ever have.** The premise that the suite protects this is false in a way worth stating plainly: 92 `fakeButton` sites exist and only **five** dispatch through `routeInteraction` (`tests/router.test.ts:34`, `:142`, `tests/daily-hooks.test.ts:199`, `:215`, `tests/season-hooks.test.ts:131`); the other 87 call `execute` directly. A simulated gate ran the whole suite green. `npm run test:live` also bypasses the router by its own design (`scripts/test-live.ts:273-274`). **Both existing gates are blind.** So expected breakage is zero, and so is expected coverage — the new tests are not a formality:

1. Positive with `componentIds: ['m:go']` stated, not defaulted — pins exact equality, not prefix matching.
2. Negative, `componentIds: []` — no execute, no replies, exactly one `deferOpts` entry.
3. Negative, `componentIds: ['m:other']` — the actual attack shape; the case a prefix-match regression would let through.
4. Guard precedes every write — stub `execute` inserts a row; assert the table is empty after rejection.
5. Guard precedes `postDispatch` — rejected click routed *with* `dailyRouterHooks` for a user holding a complete-but-unnotified quest; assert zero replies **and** `notifiedAt` still null and `hintedRung` unmoved. Nothing else in the suite can see this.
6. Unrouted prefix unchanged — `nowhere:at:all` with `componentIds: []` yields no reply *and* no `deferOpts` entry. This is what pins the guard inside `if (comp)` against a later tidy-up that hoists it.
7. Presence still writes on a rejected click.
8. Legitimate flows with teeth — build each real payload and read its minted ids out of the builder JSON (`payload.components[0].toJSON().components.map(c => c.custom_id)`, the idiom already at `tests/dex.test.ts:272`), feed exactly those as `componentIds`, and route each. Cover `dashboardPayload`, `dexPageRow`, `chaptersPayload`, `eggListPayload`, the `/season` hub, `/guests`, `/daily`, the alert payload, and the `/top` board. Hand-typed ids would prove only that the guard compares two strings someone wrote.
9. Harness pin in `tests/harness.test.ts` — default `componentIds` is `[customId]`, and `[]` yields a message with no ids. That default is now load-bearing for 87 direct-execute sites.

Do not add `componentIds` to the 87 direct-execute sites; they test handler logic and the default already models the truth.

**Keep the duel handler's own call.** Deleting it makes four regression fixtures (`tests/duels.test.ts:678, 695, 711, 753`) vacuous while green — they dispatch via `execute` at line 587, not the router. It is also the one handler where the check is not purely structural (`resolveDuel` mutates the *challenger's* rating off a segment nothing else validates), and `comp.execute` has a sanctioned second caller in `scripts/test-live.ts:319`. Cost: one production-unreachable reply string. Annotate both sites — a line in `router.ts` saying module-level checks are now defence in depth, and a line at `duels/index.ts:186` saying the router preempts this in production and the branch survives for direct-execute callers and its own fixtures.

**One seam to record:** if select menus or modals are ever routed, the guard must be extended in the same change, and a component type whose state rides in its *value* rather than its `custom_id` needs the premise re-checked. If a button is ever minted onto a message the bot does not own, add an explicit greppable flag on `ComponentDef` — never a prefix exception list inside the router.

## Risks of shipping it

**A legitimate click is rejected in a shape not anticipated here.** Detection: `logger.warn` fires with `customId` and `messageId` on every rejection. Watch it for the first days. Expected benign traffic is pager double-clicks and late `battle:skip`; anything else — particularly a repeated prefix from a single user on their own messages — is a flow this analysis missed. Because the rejection is a `deferUpdate`, the user-visible failure mode is a button that appears to do nothing once, not an error toast, so the log is the primary signal rather than a bug report.

**The guard is placed correctly but the `return` is dropped in review or a later refactor.** Symptom: forged clicks produce phantom quest/season hints and silently burn one-shot stamps. Detection: test 5 is the only thing that catches it; it must not be weakened.

**Someone "simplifies" the guard above `findComponent`.** Symptom: the router starts acknowledging every unclaimed prefix, changing behaviour pinned since the router was written. Detection: test 6.

**The duel handler's call is deleted as redundant.** Symptom: four S1 regression fixtures keep passing while asserting nothing. Detection: none automated — this is what the comment at both sites is for.

**Coverage illusion.** The suite will be green the moment the guard lands, before any of the nine tests exist. Treat "1910 tests pass" as zero evidence for this change; the only evidence is the router tests listed above, each of which must be watched to fail first.

**What this does not protect.** Stale-same-message replay — the class that already cost real money on `park:landmark:buy`. Every future button that spends money, turns a page, or names a rung still needs that state in its customId and validated in its handler. The guard closes cross-message anchoring only, and a future reader who believes otherwise is the most likely way this fix causes harm.