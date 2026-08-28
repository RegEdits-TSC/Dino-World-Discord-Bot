# Economy core

Fires on: `src/core/economy.ts` and `src/data/tx-reasons.ts`, plus the two suites that
cover them, `tests/economy.test.ts` and `tests/tx-reasons.test.ts`.

## Headlines

- A reversal moves money and nothing else — the landmark tier stays raised, the sold dino stays sold — so never widen one into an undo. §reversal-moves-money-only
- Correct a `tx_log` row with a compensating ROW, never an edit: nothing in `src/` UPDATEs or DELETEs a ledger row. §reversal-is-a-compensating-row
- "Has this been reversed?" is DERIVED at read time from a row whose `reverses_id` points at the target — never stamp a flag on the target, and never sweep. §reversed-flag-is-derived
- `EconomyService.reverse` keeps the read, its guards and its writes in ONE synchronous transaction, which is what makes a double reversal structurally impossible rather than checked by convention. §reverse-in-one-sync-transaction
- Never reverse a reversal: the original target stays pointed at while the player is on net charged, so every reader of the derived flag reports "reversed" and is wrong — silently, with no test able to notice. §reversals-are-terminal
- Core's guards are exactly three — not found, is itself a reversal, already reversed — and core must learn nothing else about what a row MEANS. §core-guards-know-only-the-row
- The reset-marker refusal lives in the ADMIN layer, never in `EconomyService.reverse`: core would accept a marker and mint a nonsense "reverses #<marker>" row into the very ledger this feature exists to make readable. §marker-refusal-lives-in-admin-layer
- There is no re-charge path anywhere in `src/`, so a reversal that PAID CASH OUT is final while one that CLAWED CASH BACK is walked back with `/admin give` — do not state that rule symmetrically, an earlier revision did and had it backwards. §no-recharge-path-refund-is-final
- Reversal is SYMMETRIC and can therefore overdraw; `post`'s balance guards throw from INSIDE the transaction so the whole reversal rolls back, and `shortfallOf` names the gap because "insufficient cash" alone cannot tell 5 short from 5,000,000 short. §reversal-is-symmetric-and-can-overdraw
- One helper, two surfaces: every value the ledger and a reversal confirmation both show has exactly one definition, because they DID disagree once. Never derive a predicate from rendered display text — that half breaks silently on a wording edit. §one-helper-two-surfaces
- `sideEffectFor` fails CLOSED on a reason prefix it does not know — a blank note and "this charge left nothing behind" are indistinguishable to an operator, and a new spend path can ship without a `SIDE_EFFECTS` entry. §side-effect-fails-closed
- `SIDE_EFFECTS` is a null-prototype map; a plain object reads back a truthy `constructor`/`__proto__` and claims a side effect that is not there. §side-effects-null-prototype-map
- A payout suppresses ONLY the unrecognised fallback, never a genuine entry — gating the whole note on "is this row a charge" silently killed the table's most consequential line while its own test went on passing. §payout-suppresses-only-the-fallback
- `SIDE_EFFECTS` must answer EVERY reason `src/` emits, and `tests/tx-reasons.test.ts` scrapes the literals out of the `economy.apply` call sites to prove it — fix a missing note in the TABLE, never by loosening the suppression rule. §side-effects-answers-every-reason
- The lookup keys on the reason PREFIX, so `admin` covers `admin:give` and the reset marker `admin:reset` alike. §side-effects-keys-on-the-prefix
- Write each entry against what the call site does in its own transaction, not against what the reason sounds like: the machine gate proves an entry EXISTS, and only reading the call site proves it is true. §write-entries-against-the-call-site
- Tell "has an entry" from "fell back" with `knownSideEffectFor`'s `string | null`, never a string comparison against the fallback text — that works today and breaks silently the next time the wording is edited. §known-side-effect-returns-nullable

## reversal-moves-money-only

Operator refunds (`/admin ledger`, `/admin reverse`) are the first readers `tx_log` has
ever had. It was written at every economy call site and read by nothing, so after a wrong
charge — the landmark stale button (`§money-button-carries-its-rung` in
`docs/conventions/command-and-handler-surface.md`) is the worked example — the operator
could hand cash back with `/admin give` but could not see what had actually been charged,
could not tell whether they had already made the player whole, and left no record that the
grant was remediation rather than a gift. Reversing that landmark charge is now possible,
and the tier still stays raised: **money is all a reversal moves.** Every side effect of
the reversed action survives it, which is exactly what the `SIDE_EFFECTS` table further
down exists to spell out, row kind by row kind.

## reversal-is-a-compensating-row

**A reversal is a compensating ROW, never an edit.** `tx_log` is append-only — nothing in
`src/` UPDATEs or DELETEs a ledger row. `reverses_id` leans on that: it is deliberately
not a DB-level foreign key — `§reverses-id-not-a-foreign-key` in
`docs/conventions/schema-and-migrations.md`.

## reversed-flag-is-derived

"Has this been reversed?" is DERIVED at read time from the existence of a row whose
`reverses_id` points at the target: nothing is stamped on the target and nothing sweeps.
That is the same derived-never-stored philosophy the repo applies to escrow locks, quest
progress and world events, and it is what makes the terminal-reversal rule below
load-bearing rather than fastidious — the flag has no independent storage anywhere that
could correct it after the fact.

## reverse-in-one-sync-transaction

`EconomyService.reverse` (`src/core/economy.ts`) takes the read, its guards and its writes
in ONE transaction, and better-sqlite3 is synchronous with no suspension point inside it,
so a double reversal is structurally impossible rather than checked by convention — the
same no-suspension-point argument `park:buildyes`' `lotCount` anchor rests on
(`§no-await-between-check-and-write` in `docs/conventions/park-surface.md`), except here
the transaction callback is synchronous by construction, so the window cannot be reopened
by dropping an `await` into it the way that one can.

## reversals-are-terminal

**Reversals are terminal**, and the reason is the derived flag rather than squeamishness
about double-entry: reversing a reversal is perfectly coherent bookkeeping, but it leaves
the ORIGINAL target still pointed at by a row while the player is, on net, charged — so
every reader of that derivation reports "reversed" and is wrong. Relax this and the flag
starts lying, silently, with no test able to notice.

## core-guards-know-only-the-row

Core's guards are only these — not found, is itself a reversal, already reversed — and
know nothing else about the row. What a reason string MEANS is the admin module's
business, never core's; the marker refusal below is the same layering rule seen from the
other side.

## marker-refusal-lives-in-admin-layer

`adminReverse` refuses the marker row itself, and the refusal lives in the ADMIN layer
rather than in `EconomyService.reverse` because a reset marker is an admin concept and
core has no business knowing the reason string this module stamps. Core would accept one —
its guards have no notion of markers, as the section above says — and what that buys is a
nonsense "reverses #<marker>" row minted into the very ledger this feature exists to make
readable.

## no-recharge-path-refund-is-final

**There is no re-charge path at all**, which strengthens the terminal rule rather than
weakening it: `/admin give`'s `cash` and `shards` options are both `.setMinValue(0)`, so
Discord rejects a negative before the handler is even reached, and nothing else in `src/`
lets an operator debit a player. That cuts ONE WAY, and an earlier revision of this
passage got it backwards by saying a reversal cannot be walked back short of
`/admin reset`. A reversal that CLAWED CASH BACK — the symmetric case below — is walked
back with `/admin give`, which is exactly what that command is for. What has no path back
is a reversal that PAID CASH OUT: taking it away again needs a debit, and no debit exists.
So treat a refund as final when it is made; a clawback is recoverable. The spec offers
`/admin give` as the escape hatch for both, and it covers only the second.

## reversal-is-symmetric-and-can-overdraw

**Reversal is SYMMETRIC**, deliberately and not by oversight: reversing a CREDIT takes the
cash back, so a mis-grant can be clawed back without wiping the account. Short of
`/admin reset` it is the only path that moves a balance downward without the player having
spent anything, and it can therefore overdraw. `post`'s balance guards throw
`InsufficientFundsError` from INSIDE the transaction, which rolls the whole reversal back,
and `shortfallOf` (`src/modules/admin/service.ts`) then reads the untouched balances to
name the gap — "insufficient cash" alone leaves the operator unable to tell 5 short from
5,000,000 short.

## one-helper-two-surfaces

**One helper, two surfaces — they drifted once, so neither surface re-derives.**
`/admin ledger` and `/admin reverse`'s confirmation render the same rows, and a
confirmation that disagreed with the ledger the operator opens next is worse than one that
says nothing. They DID disagree once, the ledger suppressing a side-effect note while the
reply kept printing it. So every value both surfaces show has exactly one definition, and
neither surface re-derives it:

- `movementOf` renders a row's movement, and `movedNothing` — the predicate the ledger
  filters on — lives beside it and is called BY it, so the filter and the words "no
  movement" can never disagree.
- `sideEffectNoteFor` owns the payout-suppression rule, and `knownSideEffectFor` is the
  `string | null` accessor that lets a caller tell "has an entry" from "fell back".
- `resetBoundaryOf` derives the reset boundary for both surfaces. Two hand-rolled copies
  that drifted would show the operator a row as reversible and then refuse it, or worse,
  quietly pay one the ledger had flagged.
- The same rule predates this feature on the pricing side: `eggPriceAt`, `foodPriceAt`,
  `roundCharge`, `sellCashAt`, `roundPayout`, `feedCostFor` and `energyCostFor` are each
  the single quote-and-charge path for a value a world event can scale, so a display
  quote, an autocomplete label and the actual charge or payout cannot drift apart. Route
  any future price or cost surface through the matching helper rather than re-deriving it.

Two corollaries carry this further than "share a function":

- **Read a displayed value back off the COMMITTED row**, never re-derive it from what you
  believe you just wrote. `adminReverse` reads `moved` off the compensating row it
  inserted, not off the target's deltas.
- **Never derive a predicate from rendered display text.** Comparing a value against the
  string a renderer produced works today and breaks silently the next time the wording is
  edited, which is why `knownSideEffectFor` returns `string | null` and why `movedNothing`
  is a predicate rather than a string comparison. This is the half that fails with nothing
  going red, so it is the half to hold.

## side-effect-fails-closed

**`sideEffectFor` (`src/data/tx-reasons.ts`) fails CLOSED** on a reason prefix it does not
know — "unrecognised — check manually", never a blank — because a blank note and "this
charge left nothing behind" are indistinguishable to an operator, and a new spend path can
ship without a `SIDE_EFFECTS` entry.

## side-effects-null-prototype-map

`SIDE_EFFECTS` is null-prototype for the same reason `PADDOCKS` and `FACILITIES` are
(`§null-prototype-catalog-maps` in `docs/conventions/park-progression.md`) — a plain
object reads back a truthy `constructor`/`__proto__` and claims a side effect that is not
there.

## payout-suppresses-only-the-fallback

What a payout suppresses is **only that fallback, never a genuine entry**, and the
difference is not a nicety — the first version of this rule gated the WHOLE note on "is
this row a charge", which reads correctly for every reason the table has never heard of
and silently killed the one payout that IS in it. `sell` posts positive cash
(`src/modules/shop/shards.ts`), so "the dino was destroyed; the cash returning does not
bring it back" — the most consequential line in the table — became unreachable from both
surfaces while `tests/tx-reasons.test.ts` went on asserting it directly and passing. A
suite green on a path no surface can reach is the exact failure this feature exists to
spare the operator, arrived at from the other side. So: a reason WITH an entry always
shows it, payout or charge; a reason with NO entry shows the fallback only when the row
actually took money. The second half is what keeps the column readable — without it every
ordinary income row would read "unrecognised — check manually" and train the operator to
skip the column on the one kind of row where it matters.

## side-effects-answers-every-reason

**That second half is a BACKSTOP, and treating it as the whole answer left live payout
reasons rendering BLANK.** `sell` was never the only non-charge with an entry —
`shop-food`'s food row and `feed`'s zero-delta base row are both non-charges that carry
one — and the reasons that had none rendered nothing at all: `trade` (whose counterparty
row is still unreversed, so the two sides of one trade read differently), `admin:give`
(one command can grant an egg and a dino alongside the cash), `milestone`,
`expedition-loot`, `quest`, `season` and `battle`. `SIDE_EFFECTS` now answers **every**
reason `src/` emits, and `tests/tx-reasons.test.ts` scrapes the reason literals out of the
`economy.apply` call sites and fails until each one is answered — so the suppression only
ever fires for a reason nobody has taught the table yet, which is what it was for. Fix a
missing note in the TABLE, never by loosening that rule.

## side-effects-keys-on-the-prefix

One coupling to know: the lookup keys on the PREFIX, so `admin` covers `admin:give` AND
the reset marker `admin:reset` — the marker never reaches it, because both surfaces branch
on that reason first.

## write-entries-against-the-call-site

**Write each entry against what the call site does in its own transaction, not against
what the reason sounds like.** `collect` was first given "nothing to undo" on the
reasoning that income is only money — and that is wrong: `collectIncome`
(`src/modules/park/service.ts`) stamps the collection anchor in the same transaction as
the cash, so reversing it hands the money back and leaves the window spent, on the single
highest-volume payout row in the ledger. Two neighbours had the same shape of gap:
`expedition-loot` named the claim and the food row but not the EGG `claimExpedition`
inserts beside them, and `admin` named an egg or a dino but not granted FOOD, which lands
as its own ledger row needing its own reversal. The machine gate proves an entry EXISTS;
only reading the call site proves it is true.

## known-side-effect-returns-nullable

Telling "has an entry" from "fell back" needs `knownSideEffectFor`'s `string | null`,
never a string comparison against the fallback text — that would work today and break
silently the next time the wording is edited. Fail closed for money actually taken, never
for money paid out.
