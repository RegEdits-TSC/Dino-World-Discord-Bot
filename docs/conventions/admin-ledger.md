# Admin ledger

Fires on: `src/modules/admin/ledger.ts` and `src/modules/admin/index.ts` — the
`/admin ledger` view, its zero-movement filter, its own pager customId, and the command
dispatch that replies with them.

## Headlines

- `/admin ledger` must reply with `MessageFlags.Ephemeral`; dropping it posts a player's complete financial history publicly, nothing structural protects it, and the whole suite once stayed green with the command branch never dispatched at all. §ledger-must-be-ephemeral
- The ledger hides rows that moved nothing, which makes it a FILTERED list — most rows on the live table are zero-movement because every feed writes one, and hiding them costs nothing since reversing one moves no money. §ledger-hides-zero-movement-rows
- The reset marker takes its own branch AHEAD of the movement test in both the filter and the renderer: it is zero-delta by construction and it is the one boundary the operator cannot do without. §reset-marker-exempt-from-filter
- Mint the pager as `admin:ledger:<targetId>:<page>:<all|->` and never route a filtered list through the shared `pageRow`, whose customId has nowhere to put filter state and silently returns the UNFILTERED page — wrong rows, wrong count, no error. Do not widen `pageRow`. §ledger-pager-carries-filter-state
- `parseShowAll` recognises exactly one literal and degrades everything else to the HIDING default, because the footer then says rows are missing whereas degrading toward showing silently widens a view nobody asked to widen. §parse-show-all-degrades-to-hide
- Build `reversedBy` and `resetBoundaryOf` from the FULL row set, never from the filtered `shown` or the paginated `items`: a charge whose compensating row is hidden, or merely on another page, reads as un-reversed and the operator's next move is to reverse it. §derive-over-full-row-set
- Hiding is a DISPLAY choice and never a permission — `/admin reverse` still accepts a hidden row's id, so a later "#N was already reversed by #M" can name a row the default view will not show. §hiding-is-display-not-permission
- The footer must name the hidden count whenever there is one and confirm the wider view under show-all, and a player whose every row was filtered away reads "No rows moved anything.", never "No transactions." §footer-and-empty-state-wording
- Never add a footer caveat that prints on the majority of renders about a condition most of them do not have — a line an operator sees every time is a line they stop seeing. §no-caveat-printed-on-every-render
- Cap the operator note with `NOTE_MAX` because it renders into this embed's DESCRIPTION, and carry the same cap on the command option so the operator is stopped while typing rather than silently truncated afterwards. §note-max-cap-at-both-ends

## ledger-must-be-ephemeral

**`/admin ledger` replies with `MessageFlags.Ephemeral` and that flag is the whole reason
it is safe to run in a live channel** — dropping it posts a player's complete financial
history publicly. Nothing structural protects it, and the whole suite once stayed green
with the command branch never dispatched at all (every test reached `ledgerPayload`
directly or via the pager), so the flag now has its own `fakeCommand({ sub: 'ledger' })`
test. The ephemerality is also what lets the pager's ownership check be described as
defence in depth rather than the only lock; weaken one and the other stops being enough.

## ledger-hides-zero-movement-rows

**The ledger hides rows that moved nothing, which makes it a FILTERED list — so its page
buttons carry the flag and must never go back through the shared `pageRow`.** When this
was measured on the live table, 112 of 173 rows were zero-movement, and that proportion is
structural rather than incidental: every feed writes a zero-delta base row alongside the
food row that actually moved something, so page one was almost entirely "no movement" and
the charges an operator opens this view to find sat pages back. Hiding them costs nothing:
reversing one moves no money AND permanently consumes that row's single reversal, so there
was never anything to reach for. The predicate is `movedNothing`, which has exactly one
definition and is shared with the renderer — see `§moved-nothing-single-predicate` in
`docs/conventions/admin-service.md`, and never re-derive it here.

## reset-marker-exempt-from-filter

The **reset marker is exempt** and takes its own branch ahead of the movement test in both
the filter and the renderer — it is zero-delta by construction and it is the one boundary
the operator cannot do without, since `adminReverse` refuses everything below it.

## ledger-pager-carries-filter-state

The customId is `admin:ledger:<targetId>:<page>:<all|->` — the `dexPageRow` precedent
(`src/modules/dex/embeds.ts`) followed rather than rediscovered. `pageRow`'s
`<prefix>:<action>:<userId>:<page>` has nowhere to put filter state, and paging a filtered
list through it silently returns the UNFILTERED page: wrong rows, wrong count, no error.
**Do not widen `pageRow`** for this any more than the dex did — its four other callers
(`ach`, `hatch`, `park:dinos`, `trade:list`) have no business knowing about a ledger flag.

## parse-show-all-degrades-to-hide

`parseShowAll` recognises exactly one literal and degrades everything else — the `-`
placeholder, a stale id from an older deploy, a forged value, a missing segment — to the
DEFAULT, which hides: that is the safe direction, because the footer then says rows are
missing, whereas degrading toward showing would silently widen a view the operator did not
ask to widen.

## derive-over-full-row-set

**Both derivations stay over the FULL row set, whatever the filter or the page renders.**
`reversedBy` and `resetBoundaryOf` are built from `rows`, never from the filtered `shown`
nor the paginated `items`. Narrow either and a charge whose compensating row is hidden — or
merely on another page — reads as un-reversed, and the operator's next move on a charge
that reads that way is to reverse it: `EconomyService` refuses the second one, but only
after they have already decided the player is owed money. That is what makes this more
than a display bug. Two non-redundant tests hold it, and what each of them has to contain
is `§page-boundary-pairing-tests` in `docs/conventions/admin-service.md`.

## hiding-is-display-not-permission

**Hiding is a DISPLAY choice and never a permission**: `/admin reverse` still accepts a
hidden row's id, and a test pins that. Doing so writes a reversal that is itself hidden, so
`EconomyService`'s later refusal, "#N was already reversed by #M", names a row the default
view will not show. No money is involved and `show-all` reveals both, so nothing is at
risk; it is worth knowing only because it is the one place the filter hides an operator's
OWN recorded action, and an operator who goes looking for #M and cannot find it will
conclude the message is wrong rather than that the row is filtered.

## footer-and-empty-state-wording

The footer names the hidden count whenever there is one, and confirms the wider view when
show-all is set — an operator who cannot tell a filtered list from a complete one
eventually concludes a charge does not exist. For the same reason a player whose every row
was filtered away reads "No rows moved anything.", never "No transactions.": one of those
players has a history and the other does not.

## no-caveat-printed-on-every-render

A runtime caveat in the ledger footer — one saying that the reset boundary is blind to any
reset performed before this feature shipped — was written and then removed on purpose: a
boundary of 0 means "never reset" for nearly every player and "reset before this shipped"
for a handful, and nothing can tell those apart, so the note would have printed on the
majority of ledgers, forever, about a condition most of them do not have. That is the same
mistake as the unrecognised-side-effect fallback filling every payout row
(`§payout-suppresses-only-the-fallback` in `docs/conventions/economy-core.md`): a line an
operator sees on every render is a line they stop seeing. Say it once, where it is read —
`§boundary-blind-to-pre-deploy-resets` in `docs/conventions/admin-service.md` is that one
place. The rule generalises to any
future footer note: if it would fire on most renders about a condition most of them do not
have, state it in the docs instead.

## note-max-cap-at-both-ends

`NOTE_MAX` caps the operator note that `/admin reverse` carries, because it renders into
the ledger's embed DESCRIPTION, which Discord caps at 4096 characters; the command option
carries the same cap, so the operator is stopped while typing rather than silently
truncated afterwards. The note's interior whitespace is collapsed before that cap is
applied and never after — `§collapse-whitespace-before-capping` in
`docs/conventions/admin-service.md`.
