# Timers and alerts

Fires on: the park alert sweep and its parts — `src/modules/park/alert-detect.ts`,
`alert-embeds.ts`, `alert-record.ts` and `alert-sweep.ts` — plus `src/core/scheduler.ts`
and `src/modules/world/broadcast.ts`, and the suites over them (`tests/alert-*.test.ts`,
`tests/scheduler.test.ts`, `tests/world-broadcast.test.ts`).

## Headlines

- Proactive park alerts run on their own 15-minute `alert_sweep` timer, separate from the 30-second scheduler tick behind the passive notifications — do not fold one into the other. §alert-sweep-own-timer-cadence
- A background timer enqueues with the sentinel `userId: '0'`, never a real snowflake: `adminReset` deletes timers BY `userId` and `adminFastForward` shifts them BY `userId`, so a colliding id would let one player's reset silently kill or shift a world-wide timer. §broadcast-timer-sentinel-userid
- The alert sweep uses that same sentinel for that same reason. §alert-sweep-sentinel-userid
- `alerts_sent` is a record of a SIDE EFFECT already performed, not derived state — the underlying condition is non-monotone, so "has this instant been warned about" has no read-time answer. §alerts-sent-is-a-side-effect-record
- `alreadySent` compares `firedForMs` against the stored value, never mere row existence: existence alone would suppress the legitimate case where an escape instant leaves the warning window and later genuinely re-enters it. §already-sent-compares-instant-not-existence
- That comparison carries `ALERT_INSTANT_EPSILON_MS` (2 hours) of tolerance, because a decor purchase moves `escapeAt` by only 34-65 minutes and a bare equality check would re-fire a fresh DM on every single purchase. §alert-instant-epsilon
- Keep `ESCAPE_TIERS` ordered MOST URGENT FIRST and collapse only LESS urgent tiers behind whichever fired — reverse the order and last call never fires at all; reverse the collapse and the real last-call DM is silently suppressed. §escape-tiers-order-and-collapse-direction
- The sweep must never call `settleEscapes`: settling first makes `escapeAlertsFor` filter away the very warning the sweep exists to send, and turns a stated user-facing contract into a lie. §sweep-never-settles-escapes
- §notify-payload-omits-attachments
- Anchor the season-ending nudge's `firedForMs` to the season's true END instant, never `now + daysLeft * DAY` — the naive version drifts past the sweep's own epsilon and DMs roughly every 2 hours for the last 3 days of a season. §season-nudge-anchored-to-true-end
- The season nudge inherits the sweep's `lots.length === 0` guard, so a player with season points and no lots is never nudged — reachable, and accepted rather than special-cased. §season-nudge-inherits-lots-guard

## alert-sweep-own-timer-cadence

Proactive park alerts (escape warning + income cap) run on their own 15-minute sweep
timer, `alert_sweep` (`SWEEP_MS`, `src/modules/park/alert-sweep.ts`) — separate from the
30-second scheduler tick that drives the passive notifications
(`§notify-payload-shape` in `docs/conventions/notify-and-runtime.md`).

## broadcast-timer-sentinel-userid

The world broadcast timer (`src/modules/world/broadcast.ts`) enqueues with
a sentinel `userId: '0'`, never a real Discord snowflake, purely because
`Scheduler.enqueue` requires a `userId` even though the broadcast isn't
per-player. That sentinel is necessary, not incidental: `adminReset`
deletes timers BY `userId` and `adminFastForward` shifts them BY `userId`
(`src/modules/admin/service.ts`), so if the sentinel could ever collide
with a real player's id, resetting or fast-forwarding that one player
would silently delete or shift the world broadcast timer for every server.
`'0'` can never collide with a real snowflake — Discord IDs start far
above that range.

This is the statement of the rule for every timer in the repo that is not per-player, not
just for the broadcast one.

## alert-sweep-sentinel-userid

The sweep enqueues with the same sentinel `userId: '0'`, because `Scheduler.enqueue`
requires one even though the sweep isn't per-player, and it must never collide with a real
snowflake for the same reason the world broadcast timer's must not — `adminReset` deletes
timers BY `userId` and `adminFastForward` shifts them BY `userId`. What is specific to this
one is the blast radius: a collision here would let one player's reset or fast-forward
silently kill or shift alerts for every server, rather than one broadcast.

## alerts-sent-is-a-side-effect-record

`alerts_sent` (`schema.alertsSent`, read/written via `src/modules/park/alert-record.ts`)
is deliberately NOT the same kind of thing as derived quest progress, or the
derived escrow locks (`§escrow-derived-never-stored` in
`docs/conventions/escrow-and-item-moves.md`) — it's a record of a SIDE EFFECT
(a DM already sent for a
specific instant), not a value re-derived at read time, because the underlying
conditions aren't monotone: `incomeCapAlertFor`'s `pending` can drop to 0 and jump back
up to a fresh capped payout the moment its owner feeds, so "has this exact instant
already been warned about" has no answer without a row that says so.

It is the one documented exception to that principle, and it is an exception because of
the non-monotonicity, not because storing was convenient.

## already-sent-compares-instant-not-existence

`alreadySent`
compares `firedForMs` to the stored value, not mere row existence, so a moved instant
(the player fed, reassigned, or spliced) earns exactly one fresh warning rather than
being silently suppressed by an old record.

Row EXISTENCE alone is not an alternative fix: it would also
suppress the legitimate case where a fed dino's escape instant leaves the window and
later genuinely re-enters it, which is exactly what comparing `firedForMs` (with
tolerance, not just presence) exists to allow.

## alert-instant-epsilon

Alert tolerance had to widen for enrichment: `ALERT_INSTANT_EPSILON_MS`
(`src/modules/park/alert-record.ts`, 2 hours) exists because a decor purchase moves a
dino's `escapeAt` by only 34–65 minutes (one or two rungs) — comfortably inside the 12h
heads-up window — so a bare `firedForMs` equality check would re-fire a fresh DM on every
single decor purchase. The tolerance is the second half of the comparison rule above:
compare the instant, and compare it loosely enough that a legitimate small move is not a
new instant.

## escape-tiers-order-and-collapse-direction

Escape alerts have two tiers — heads-up at 12h out (`ESCAPE_WARN_MS`), last call at 1h
out (`ESCAPE_LAST_CALL_MS`) — and `ESCAPE_TIERS` is ordered MOST URGENT FIRST on purpose:
`recordEscapeSent` collapses every LESS urgent tier behind whichever one just fired,
never a more urgent one. Firing last call also marks heads-up sent for that same instant
(it logically already happened), but firing heads-up must leave last call free, since
that's a genuinely later beat still to come. Reversing `ESCAPE_TIERS`' order breaks tier
*selection* — every dino matches heads-up first and last call never fires at all — and
reversing the collapse *direction* breaks it a second way: heads-up firing would
pre-mark last call as sent (same `firedForMs`, since the dino hasn't been fed), so the
real last-call DM at the 1-hour mark would find `alreadySent` already true and silently
never go out.

Both failure directions are silent, and neither is recoverable by reading the code that
fires: the ordering of the array and the direction of the collapse are the whole
mechanism.

## sweep-never-settles-escapes

The sweep must never call `settleEscapes`: it reads `escapedAt` straight off the row via
`toClockDinos`, never a settling call, so a dino crossing the escape threshold mid-sweep
still gets its last-call DM before anything stamps it escaped. Calling `settleEscapes`
here would race the alert against itself — `escapeAlertsFor` filters out any row with
`escapedAt !== null`, so a sweep that settled first would silently swallow the very
warning it exists to send — and it would also turn "escapes are only settled when a
command touches your park" (the Escapes section of `docs/gameplay.md`) into a lie, since
a background timer isn't a command anyone touched.

Reading a row without settling it is safe here for the same shape of reason it is safe on
the guests surfaces, where the predicate is time-aware rather than column-driven:
`§attendance-predicate-is-time-aware` in `docs/conventions/park-progression.md`.

## notify-payload-omits-attachments

**A payload reaching `deliverNotification` (`src/core/notify.ts`) must never carry an
`attachments` key at all.** `alertPayload` (`src/modules/park/alert-embeds.ts`) is one
payload object handed to two send sites — `deliverNotification` tries `channelSend` and
falls back to `dmSend` on failure — and discord.js's `MessagePayload.create()` pushes
resolved files into that array IN PLACE and only shallow-copies it, so a pre-set key on
the shared object would carry a mutation from the first send attempt into the second.
Omitting the key is the fix: there is nothing to reset because there is nothing there.

**The inverse rule exists, prescribes the opposite fix, and is right about the sites it
governs** — `§payload-never-shared-across-two-sends` in
`docs/conventions/embed-payload-builders.md`, where `fightFrames`'s F1 and F4 must each
send an explicit `attachments: []` on every call because two send sites reuse one
`MessagePayload` object and each must shed the other's stale set. The discriminator is
which mechanism the send needs: an explicit `attachments: []` when the send must REPLACE
the message's existing attachment set (an `i.update` or `editReply` on a message that
already carries files), and no key at all when the payload is merely being handed to a
send helper that may retry it elsewhere. `src/modules/park/alert-embeds.ts` matches the
trigger globs of both docs, so a reader editing that file gets both passages at once; its
payloads go to `deliverNotification`, so only this one is right for it.

## season-nudge-anchored-to-true-end

The season-ending nudge rides the EXISTING 15-minute `alert_sweep` timer as a new
alert kind, firing only to players holding unclaimed unlocked rungs. `firedForMs` is
anchored to the season's true END instant (`(index + 1) * SEASON_DAYS * DAY_MS`), not
`now + daysLeft * DAY` — the pre-flight scan on this plan caught that the naive
version drifts with time-of-day past the sweep's own epsilon and would have DM'd
roughly every 2 hours for the last 3 days of a season instead of once.

## season-nudge-inherits-lots-guard

It inherits the
sweep's existing `lots.length === 0` guard, so a player with season points but zero
lots is never nudged — reachable in principle (60 shop purchases alone clears rung 1)
but accepted rather than special-cased, since that player still sees the rung on
`/season` itself.
