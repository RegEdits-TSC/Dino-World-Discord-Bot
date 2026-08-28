# Admin service

Fires on: `src/modules/admin/service.ts` and `src/modules/admin/guard.ts`, their suite
`tests/admin.test.ts`, and the schema and migrations the reset and fast-forward paths have
to keep up with — `src/core/db/schema.ts` and everything under `drizzle/`.

## Headlines

- `adminReset` must delete from EVERY table the feature reads and zero every column it stamps — a table it misses leaves state the player can neither see nor clear. §admin-covers-daily-tables
- `adminFastForward` shifts `lastQuestClaimAt` only where it is `> 0` (0 is the never-claimed sentinel and an unguarded shift invents a claim history) and deliberately leaves `daily_quests.dayKey` alone, since fast-forward cannot move the UTC calendar. §fastforward-column-guards
- Keep the redundant `user` option on `/admin reverse` and name the row, the amount and the resulting balance in the reply: a transposed digit landing on a different row of the RIGHT player passes every guard, and "Reversed for @player" is indistinguishable from success in that case. §reverse-confirmation-names-row-amount-balance
- Read `moved` back off the COMMITTED compensating row rather than re-deriving it from the target's deltas, and render it with `movementOf` — the same helper the ledger uses. §moved-read-off-committed-row-shared-renderer
- `movementOf` names food by display name (`Ferns`, not `ferns`) and renders a zero-delta row as "no movement" rather than `0`, because reversing such a row is inert yet permanently consumes that row's single reversal. §movement-rendering-food-names-and-no-movement
- Never implement the reset boundary from the spec's `users.createdAt` comparison — `adminReset` only ever UPDATEs the users row, nothing in `src/` deletes one, and that comparison shipped as unreachable dead code. The spec still says otherwise. §spec-createdAt-boundary-is-false
- `adminReset` writes the zero-delta `RESET_MARKER_REASON` row as the FIRST insert inside its existing transaction, and both surfaces read the boundary through the one shared `resetBoundaryOf`, never a hand-rolled copy. §reset-marker-row-and-shared-boundary
- Cut the boundary on the marker's AUTOINCREMENT row id, never on `created_at_ms`: a millisecond holds more than one row, so a timestamp comparison leaves a charge stamped at the reset's own instant on the reversible side of a boundary it predates. §boundary-cut-on-row-id-not-timestamp
- On the live database the boundary is blind to every reset performed before this feature shipped, so `resetBoundaryOf` returns 0 and the ledger flags nothing — do NOT read an unflagged old charge as safe to reverse on a pre-deploy account. §boundary-blind-to-pre-deploy-resets
- The reversal note is QUEUED, never sent, and it is a DM: `adminReverse` passes `originGuildId: null`, so the reply must say "Note queued to the player" and must never be described as inheriting the player's routing. §reversal-note-is-a-queued-dm
- Do not describe that note as mute-aware — nothing on the notify path reads `users.alertsEnabled`, which gates the park alert sweep alone, so a player who ran `/park alerts off` still gets it. §reversal-note-is-not-mute-aware
- Send the note AFTER the transaction commits and do not await it, so an unreachable player cannot roll back a completed reversal; log its rejection rather than discarding it. §notify-fires-after-commit-unawaited
- Pin that ordering with the overdraw case — the only refusal that comes from BELOW the guards, and therefore the only test that can see a notify hoisted above the `reverse` call rather than above the guards. §notify-ordering-test-must-see-below-guards
- Collapse the note's interior whitespace BEFORE the cap, not merely trim the ends: a newline injects a line of the operator's own text into the middle of the embed, indistinguishable from a real ledger row. §collapse-whitespace-before-capping
- `movedNothing` is the one predicate, lives beside `movementOf` and is called BY it — never re-derive it in `ledger.ts` and never obtain it by comparing against the rendered string. §moved-nothing-single-predicate
- `sideEffectNoteFor` is the single place the suppression rule lives; both surfaces call it and neither re-derives it, because they did disagree once. §suppression-lives-in-one-helper
- Hold the full-row-set derivation with two non-redundant tests: one splitting a charge and its reversal across a page boundary at exactly `PAGE_SIZE + 1` rows, and one hand-inserting a zero-delta reversal whose target moved something. §page-boundary-pairing-tests

## admin-covers-daily-tables

**`adminReset` must cover every table the feature reads.** When the daily loop shipped,
`adminReset` and `adminFastForward` (`src/modules/admin/service.ts`) both had to grow to
cover the new tables: reset deletes `user_stats`, `daily_quests` and `achievement_claims`
rows and zeroes `questStreak`, `questStreakBest` and `lastQuestClaimAt`. That is the same
lesson the Gene Lab's `breedings` fix taught, and it applies to every feature that ships a
table afterwards — a table a feature reads but reset never clears leaves state behind that
the player can neither see nor get rid of, and that the operator cannot clear either.

## fastforward-column-guards

`adminFastForward` shifts `lastQuestClaimAt` with the other time columns, but guarded to
rows where it is `> 0`: 0 is that column's "never claimed" sentinel, and an unguarded
shift would invent a claim history for a player who has never claimed. It deliberately
leaves `daily_quests.dayKey` alone — fast-forward cannot move the UTC calendar, so today's
board stays today's, and shifting only the claim anchor is precisely what lets a streak
gap or a streak continuation be simulated. The asymmetry is the feature, not an omission.

## reverse-confirmation-names-row-amount-balance

**The confirmation names the row, the amount and the resulting balance**, and all three
are load-bearing rather than decoration. The redundant `user` option catches a transaction
id belonging to somebody else and nothing more: a transposed digit that still lands on a
row of the RIGHT player passes every guard, and if that row is a payout the reversal claws
cash OUT of them. A reply reading only "Reversed for @player" is indistinguishable from
success in that case, and two reversals in a row produce identical text. `adminReverse`
therefore returns `txId`, `moved` and `balance`.

## moved-read-off-committed-row-shared-renderer

`moved` is read back off the COMMITTED compensating row rather than re-derived from the
target's deltas, and it is rendered by `movementOf`, the same helper the ledger renders
every row with — the rule and the reason are `§one-helper-two-surfaces` in
`docs/conventions/economy-core.md`. `balance` costs one `SELECT` on `users`, plus a second
on the food inventory when the reversed row moved food, on a command run a few times a
month.

## movement-rendering-food-names-and-no-movement

`movementOf` also names food (`Ferns`, not `ferns` — a code identifier is not something to
put in front of a human) and renders a zero-delta row as "no movement" rather than `0`:
every `feed` and every cash-neutral `trade` writes one, reversing it is inert, and it
permanently consumes that row's single reversal, so it must never read like an amount that
can be handed back.

## spec-createdAt-boundary-is-false

**The reset boundary is a MARKER ROW, and the spec is wrong about it.**
`docs/superpowers/specs/2026-08-27-operator-refunds-design.md` §3 case 6 states that
`adminReset` "deletes the `users` row, which `getOrCreateUser` recreates with
`createdAt: ctx.now()`", making a pre-reset charge detectable as
`tx_log.created_at_ms < users.created_at_ms`. **That is false.** `adminReset` only ever
UPDATEs the users row and never re-stamps `createdAt` — that column means account
CREATION, and stamping it on a reset would corrupt what it means — and nothing in `src/`
deletes a users row at all. The comparison was unreachable and shipped as dead code until
a reviewer caught it.

That spec has deliberately not been corrected in place, because a spec in this repo is a
dated record of a decision as it was made. So the false mechanism is still there today,
one file away and dated, which is exactly why this correction is not "correction history
nobody could re-derive" and must never be cut: a reader who starts from the spec needs a
refutation to land on. This is the only place that refutation lives, and a reader who
finds the spec's mechanism should implement from here instead.

## reset-marker-row-and-shared-boundary

`adminReset` writes a zero-delta row with reason `RESET_MARKER_REASON` (`admin:reset`)
INSIDE its existing transaction, so a rolled-back reset leaves no marker. Both surfaces
then derive the boundary from the newest such row through the one shared `resetBoundaryOf`
rather than two hand-rolled copies — the general rule is `§one-helper-two-surfaces` in
`docs/conventions/economy-core.md`, and the specific cost of drift here is that copies
which disagreed would show the operator a row as reversible and then refuse it, or worse,
quietly pay one the ledger had flagged.

## boundary-cut-on-row-id-not-timestamp

The boundary is cut on the marker's **row id**, never its timestamp, at both surfaces. A
millisecond holds more than one row, so a strict `created_at_ms <` comparison leaves a
charge stamped at the reset's own instant on the reversible side of a boundary it actually
predates. The marker is the FIRST insert in `adminReset`'s transaction and `tx_log.id` is
AUTOINCREMENT — never reused, strictly increasing — so its id is above every pre-reset row
and below every post-reset one: an exact cut with no tie possible, at identical cost.

## boundary-blind-to-pre-deploy-resets

**The boundary is blind to every reset performed before this feature shipped, and that is
disclosed rather than hidden.** It derives entirely from marker rows and no marker exists
for any historical reset, so on the live database `resetBoundaryOf` returns 0 for every
account that was reset before the deploy: every pre-existing charge reads as reversible
and the ledger flags none of it. Nothing can back-derive one — the spec's `users.createdAt`
route is the false premise corrected above, and `tx_log` carries no other record of a
reset — so there is no fix to write, only a fact to state. Scrolling back through old
history is the first thing an operator does with a new ledger, which is exactly where the
silence would mislead. **Do not read an unflagged old charge as "safe to reverse" on a
pre-deploy account.**

A runtime caveat in the ledger footer was written for this and then deliberately removed;
the reasoning is `§no-caveat-printed-on-every-render` in
`docs/conventions/admin-ledger.md`. That is why the fact is stated once here, in prose an
implementer reads, and nowhere in the running bot.

## reversal-note-is-a-queued-dm

**The note is QUEUED, never sent, and it is a DM.** `adminReverse` passes
`originGuildId: null` to `ctx.notify`, and `deliverNotification` (`src/core/notify.ts`)
only consults the guild's notify channel when it is handed a guild id — so the channel
branch is never taken here and this note has exactly one route. A DM to a player who has
closed them fails silently and the bot never gets a delivery confirmation, so the reply
says "Note queued to the player" and must never be reworded into a claim of delivery. Do
not describe it as inheriting the player's routing: that is true of the notify path in
general and false of this call site, which never hands it a guild.

## reversal-note-is-not-mute-aware

It does NOT inherit a mute either: nothing on the notify path reads `users.alertsEnabled`,
which gates the park alert sweep alone, so a player who ran `/park alerts off` still gets
the reversal note. Do not describe this path as mute-aware — an earlier revision of this
rule and of the comment at the call site both did, and it is the kind of claim an operator
would act on.

## notify-fires-after-commit-unawaited

The send fires AFTER the transaction commits and is not awaited, so an unreachable player
cannot roll back a completed reversal; its rejection is logged rather than discarded,
since the operator has already been told the note went out and a failure leaving no trace
is a claim nobody can go back and check.

## notify-ordering-test-must-see-below-guards

That ordering is pinned by a test that passes a note down a refusal path and asserts
nothing was queued — the overdraw case in `tests/admin.test.ts`, the only one whose
refusal comes from BELOW the guards and can therefore see a notify hoisted above the
`reverse` call rather than above the guards. A cheaper refusal case proves nothing here.

## collapse-whitespace-before-capping

The operator note's interior whitespace is COLLAPSED before the `NOTE_MAX` cap is applied
(`§note-max-cap-at-both-ends` in `docs/conventions/admin-ledger.md`), not merely trimmed
at the ends: the ledger renders one row per line, so a note carrying a newline injects a
line of the operator's own text into the middle of the embed, indistinguishable from a
real ledger row. Collapse first, cap second — the same ordering rule the park motto's
defang follows, so that what is stored is what the cap governs.

## moved-nothing-single-predicate

`movedNothing` (`src/modules/admin/service.ts`) is the predicate behind the ledger's
zero-movement filter, and it lives beside `movementOf` and is called BY it — one
definition, so the filter and the words "no movement" cannot disagree. Never re-derive it
in `ledger.ts`, and never get it by comparing against the rendered string; the general
rule, and why that second mistake fails with nothing going red, are
`§one-helper-two-surfaces` in `docs/conventions/economy-core.md`.

## suppression-lives-in-one-helper

The suppression rule itself lives in ONE place, `sideEffectNoteFor`
(`src/modules/admin/service.ts`), which both the ledger renderer and `adminReverse`'s
reply call and neither re-derives. This pair is where the shared-helper rule in
`docs/conventions/economy-core.md` came from: these two DID disagree once, the ledger
suppressing the note while the reply kept printing it.

## page-boundary-pairing-tests

Two tests hold the full-row-set derivation (`§derive-over-full-row-set` in
`docs/conventions/admin-ledger.md`), and they are not redundant. The reachable one splits
the pair across a page boundary: it takes exactly `PAGE_SIZE + 1` rows to land the
reversal at the end of page 1 and the charge alone on page 2, and one row either side puts
both on the same page — which is how that test passed for free until a mutation run caught
it. The other hand-inserts a zero-delta reversal row whose TARGET moved something; that
PAIRING is what `EconomyService.reverse` cannot produce, because a moving charge always
gets a moving reversal — cash and shards negate to non-zero, a food row reverses to
another food row, and a food row with `foodDelta === 0` throws rather than writing.

A zero-delta reversal ROW on its own is perfectly reachable — reversing a zero-movement
row takes the non-food branch, so `post` writes one with `skipBaseRow` false — and an
earlier revision of this passage claimed otherwise, which is a plausible thing for the
next implementer to build on and false. What makes that reachable one useless for this
test is that its target is a zero-movement row too, so the target is hidden as well and
there is no visible charge left to check the mark on.
