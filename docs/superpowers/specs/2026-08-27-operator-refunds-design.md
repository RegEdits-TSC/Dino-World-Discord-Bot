# Spec — Operator Refunds

**Date:** 2026-08-27
**Status:** design approved, ready for planning
**Follows:** the index work merged as `ca87684` (PR #51)

## Why this exists

There is no way to reverse a cash charge. Every spend guard in the codebase is
the only line of defence behind it, and that has already cost real money once:
`park:landmark:buy` carried no tier in its customId, so an old `/park landmark`
message kept a live button forever while `buyLandmark` re-derived `current + 1`
on every click. Four clicks of one button labelled "Build Stone Marker" charged
5,000,000, then 10,000,000, then 20,000,000, then 40,000,000 — **32× its own
label**, against a feature that shipped no refund path precisely because a
monotone ladder was believed to have nothing to mis-buy.

The customId defect is fixed. The absence it exposed is not.

But "no refund path" turns out to be the symptom rather than the gap. The real
gap is that **the ledger is write-only.** `tx_log` is written on every
`EconomyService.apply` call site — every spend and every payout in the game —
and read by nothing, anywhere in `src/`.
`/admin inspect` dumps current state — cash, rating, dinos, eggs, lots, trades,
expeditions — and not one ledger row. So after an incident the operator can
grant cash back with `/admin give`, but cannot see what was charged, cannot tell
whether they already made the player whole, and leaves no record that a grant
was remediation rather than a gift.

This spec makes the ledger readable and adds a precise, idempotent reversal on
top of it.

## Scope

Changes `src/core/db/schema.ts`, `src/core/economy.ts`, and the admin module.
Adds migration 0019. Two new `/admin` subcommands.

### Non-goals

- **No player-facing surface.** Refunds are operator-initiated remediation, not
  an undo window. Nothing a player can trigger.
- **No side-effect reversal.** A reversal moves money and nothing else. See §2.
- **No automatic compensation.** The bot never decides on its own that a charge
  was wrong; that judgement is the operator's.
- **No free-form clawback.** `/admin give` stays positive-only. But reversal is
  **symmetric and deliberately so**: any ledger row can be undone, credits
  included, so reversing an `admin:give`, a `collect` or a quest payout does take
  cash back. That is the only way money leaves a player, it is always tied to a
  specific row, and §3 case 4 covers what happens when they have already spent it.
- **No batch reversal.** An operator tool that undoes ten charges in one
  keystroke is a worse tool.

## §1 The data model and the reversal primitive

### Migration 0019

Two nullable columns on `tx_log`:

- `reverses_id INTEGER`, referencing `tx_log.id`. Nothing is backfilled — every
  existing row keeps `NULL`, meaning "an original charge, not a reversal."
- `note TEXT`, the operator's free-text reason for a reversal (§2). `NULL` on
  every charge and on any reversal made without one.

The note lives on the row rather than in `reason` because `reason` is structured
(`build:<kind>`, `landmark:<tier>`) and is what the side-effect table keys on.
Mixing free text into it would make that lookup ambiguous. A reversal row's
`reason` is the fixed string `reverse`.

### Reversal is a compensating entry, never an edit

A reversal is a **new ledger row** carrying the exact opposite deltas of its
target, with `reverses_id` set to the target's id. `tx_log` stays append-only,
which is what an audit ledger is for: a posted entry is never mutated.

"Has this been reversed?" is therefore **derived**, not stored — a row exists
whose `reverses_id` is the target. Same philosophy as escrow locks
(`src/core/locks.ts`), quest progress, world events and attendance, all of which
this codebase computes at read time rather than keeping a flag in sync.

### `EconomyService.reverse(txId, now)`

Lives in `src/core/economy.ts`, beside `apply`, because reversal is a wallet
operation: it needs the same transaction, the same balance guards, and it writes
to `tx_log`, which `EconomyService` owns exclusively.

In one transaction it reads the target row, refuses if it does not exist, refuses
if a row already reverses it, applies the negated deltas through the same guards
`apply` uses, and posts the compensating row. Because the read, the guard and
both writes share that transaction and better-sqlite3 is synchronous with no
suspension point between them, **a double reversal is structurally impossible
rather than checked by convention.**

This placement was chosen over two alternatives. A service in the admin module
would put the idempotency check and the `reverses_id` write outside the class
that owns the ledger, splitting one invariant across two files. Extending
`apply()` with an optional `reversesId` would fold two different contracts
together — `apply` takes a delta, `reverse` derives one from a row — and a
caller that negates wrong posts a second charge rather than a refund.

### Reversing a credit can fail, correctly

Undoing an `admin:give` or a `collect` removes cash, and `EconomyService` refuses
to drive a balance below zero. That is an `InsufficientFundsError` and a real
outcome, not an edge case to suppress: the player has already spent it.

### Food reverses per row

`apply` writes one `tx_log` row for cash and shards and a **separate row per food
item**, so a food purchase is several rows. Reversing the cash row does not
return the food. Each row reverses independently — simpler to reason about, and
it matches how the rows were written. The ledger view must make the relationship
visible; it is not the primitive's job to bundle them.

### Indexing

The guard introduces `tx_log`'s first filtered read. `CLAUDE.md` currently states
that `tx_log` must stay unindexed *because* it has no filtered read anywhere, and
that sentence must be amended in the same change rather than left to go stale.

Add a **partial** index on `reverses_id WHERE reverses_id IS NOT NULL`, the same
shape as `timers_due` from migration 0018. Only reversal rows enter it, so an
ordinary charge — on what will become the largest table in the schema — pays
essentially nothing, while the double-reversal guard stays logarithmic. The
per-user ledger read stays unindexed: it is operator-only and rare, and an index
on `user_id` would pay write cost on every economy transaction in the game to
serve a command run a few times a month.

## §2 The two surfaces

### `/admin ledger user:<@x>`

That player's transactions, newest first, ephemeral, paged at `PAGE_SIZE` through
the existing `paginate` / `pageRow` helpers. Each line carries the id to pass to
`reverse`, a relative timestamp, the reason, the deltas, and a side-effect note.

**Every `tx_log` row for that player is listed, including the separate food rows
`apply` writes** — the view is the ledger, not a curated summary. A food purchase
therefore appears as a cash row and one row per food item, each individually
reversible, which is what makes the "shop-food" side-effect note necessary.

**Three row states must be visually distinct**, because confusing them is how an
operator pays someone twice:

1. an ordinary charge;
2. a charge that **has already been reversed**;
3. a **reversal row itself**, shown as `↩ reverses #123`.

The first two matter most: a row already made good must not look like one that
has not been.

**A customId inversion to get right.** `pageRow` builds
`<prefix>:<action>:<userId>:<page>`, and its comment says the embedded id "locks
paging to the list owner." Here that slot holds the **target** player, not the
clicker — the `park:tour:<targetUserId>` / `top:visit:<targetUserId>` precedent.
The handler's ownership check is therefore `i.user.id === ctx.config.ownerId`,
**not** a comparison against the segment. Getting this backwards would let the
target page their own audit log. The message is ephemeral, so this is defence in
depth rather than the only lock, but it must be explicit rather than inherited by
accident from the helper's usual meaning.

### Side-effect notes

A reversal moves money and nothing else, so the view says what each charge left
behind. A small table keyed on the reason prefix:

| prefix | what the reversal does not undo |
|---|---|
| `build` | the lot still stands |
| `upgrade` | the lot keeps its level |
| `landmark` | `users.landmarkTier` stays raised |
| `attraction` | the attraction row remains |
| `decorate` | the decor stays on the lot |
| `shop-egg`, `mythic` | the egg remains |
| `breed` | the breeding row remains |
| `splice` | traits were re-rolled — **irreversible** |
| `sell` | the dino was **destroyed**; the cash coming back does not return it |
| `rescue` | the dino is already un-escaped |
| `expedition` | the expedition row remains |
| `shop-food` | the food is a separate ledger row needing its own reversal |

**An unrecognised prefix reads "unrecognised — check manually", never blank.**
This is the one place the design fails closed. A blank note and "no side effect"
are indistinguishable to a tired operator; new spend paths will ship and someone
will forget this table; the tool should say it does not know rather than imply a
safety it has not verified.

### `/admin reverse user:<@x> tx:<id> [note:<text>]`

Requires both `user` and `tx`, and refuses if the row does not belong to the
named player. The `user` option is **deliberately redundant** — it is the
confirmation step, in the spirit of `/admin reset` making the operator type the
target's id, and it turns a mistyped transaction id into a refusal rather than a
refund to the wrong person.

The ephemeral reply states what moved, the resulting balance, and repeats the
side-effect note, so the last thing the operator reads is "the lot is still
standing."

**`note` is optional and does two things.** It is stored on the reversal row, so
the audit record says *why* the money moved and not merely that it did; and it
is sent to the player through the existing notification path, so a balance change
does not arrive unexplained. Omitting it reverses silently — the default, since
remediation usually happens in a conversation already underway.

Three constraints on the note:

- **Delivery is not guaranteed.** It routes through `ctx.notify`, so it inherits
  the player's existing routing and mute settings. A muted player gets nothing.
  The operator's reply must say the note was *queued*, never that it was
  delivered, or the tool will imply a confirmation it does not have.
- **Notify after the transaction commits, never inside it.** A failed DM must not
  roll back a completed reversal. The money moving is the operation; telling the
  player about it is a side effect of lower importance, and coupling them would
  make an unreachable player block a legitimate refund.
- **Cap the length** at what the ledger view can render on one line, and store
  what was sent. No link-defanging: unlike `/park motto` or `/dino rename`, this
  text is authored by the bot owner rather than by a player, so it is not the
  untrusted-input case `defangLinks` exists for.

`/admin`'s subcommand dispatch already ends in
`else { throw new AdminError('Unknown subcommand.') }`, so it does **not** carry
the silent-fallthrough trap `/park` had. No hardening needed; do not introduce a
fallthrough when adding these two.

## §3 Error handling

Every failure is an ephemeral message naming the row and saying what to do next.

1. **Unknown id** — "No transaction #N."
2. **Belongs to another player** — the redundant `user` option catching a typo.
3. **Already reversed** — names the reversal row, so the operator can go read it.
4. **Would overdraw** — reports the shortfall: "player holds 400; reversing this
   needs 5,000."
5. **Target is itself a reversal — refused.** Subtler than it looks. Reversing
   #101, which reversed #100, is coherent double-entry — it re-applies the
   original charge — but it breaks the derived flag: #100 still has a row
   pointing at it, so the ledger would report "reversed" while the player is, on
   net, charged. Rather than make the derivation walk a chain and the view
   unreadable, **reversals are terminal.** An operator who wants to re-charge
   uses `/admin give`, deliberately and visibly.
6. **Charge predates a reset — refused.** `adminReset` clears every per-player
   table but **not `tx_log`**, and it deletes the `users` row, which `getOrCreateUser`
   recreates with `createdAt: ctx.now()`. A pre-reset charge is therefore
   detectable as `tx_log.created_at_ms < users.created_at_ms`, and reversing one
   would credit a fresh account for money it never lost. The ledger view marks
   these "pre-reset"; `reverse` refuses them.
7. **No user row** — unreachable through the command, since the `user` option
   resolves one, but `EconomyService` guards it regardless.

## §4 Testing

**`EconomyService.reverse`:** the happy path (balances move, the compensating row
carries negated deltas and the correct `reverses_id`), each of cases 1–6, and
**atomicity** — a refused reversal must leave no partial row, which is what makes
the double-reversal guard trustworthy rather than merely usually-right.

**Command layer:** the wrong-player refusal, the three row states rendering
distinctly, paging, the unrecognised-prefix note, and the optional note — that
supplying one stores it on the reversal row and enqueues a notification, that
omitting one reverses silently, and that **a notification failure leaves the
reversal committed**. That last case is the one worth writing deliberately: it
fails only if the notify call sits inside the transaction, which is exactly the
mistake the ordering constraint exists to prevent.

**Migration:** the same production-path treatment as 0018 — apply 0000–0018 to a
**populated** database, run the real `migrateDb`, then assert the column exists,
that existing rows read `NULL`, and that the partial index is present and used by
the guard's query. Include a **before-assertion** so the case cannot pass
vacuously, the way `tests/migration.test.ts`'s 0018 case does.

## Deliverables

1. `src/core/db/schema.ts` — `tx_log.reverses_id` and `tx_log.note`, plus the
   partial index.
2. `drizzle/0019_operator_refunds.sql` — pure additive DDL. drizzle-kit generates
   a random name; rename it and update the journal tag to match, as 0018 did.
3. `src/core/economy.ts` — `reverse(txId, now)`.
4. `src/modules/admin/` — the ledger view, the reverse subcommand, and the
   reason-prefix side-effect table.
5. Tests per §4.
6. `CLAUDE.md` — the reversal invariant, why reversals are terminal, the pre-reset
   refusal, and an amendment to the `tx_log`-must-stay-unindexed line, which this
   change makes false as written.

## Risks

- **A reversal is real money moving.** The mitigations are the redundant `user`
  option, the ephemeral confirmation naming the amount, and an idempotency guard
  that lives in the same transaction as the write.
- **The derived "reversed?" flag depends on reversals being terminal.** If a
  future change permits reversing a reversal, the flag silently starts lying. §3
  case 5 is load-bearing, not a convenience.
- **The side-effect table will go stale.** New spend paths will ship without an
  entry. Failing closed on unknown prefixes bounds the damage to a note that says
  "check manually" rather than one that wrongly implies safety.
- **`tx_log` is unbounded and nothing prunes it.** The ledger view pages, so this
  is not a correctness problem, but the per-user read is a full scan on the
  largest table in the schema. Deliberate: indexing `user_id` would tax every
  economy transaction to serve a rare operator command.
- **A queued note is not a delivered one.** The player may be muted, may have
  DMs closed, or may simply not read it. The operator's confirmation says queued
  rather than sent for that reason, but an operator who treats the note as proof
  the player was informed will occasionally be wrong.
- **Reversal can take money back.** This is intended (see Non-goals) and is the
  only path by which a balance decreases outside normal play, but it means a
  mistyped `tx` id against the right player can reduce a balance rather than
  raise one. The redundant `user` option does not catch that case — only reading
  the ledger row first does.
