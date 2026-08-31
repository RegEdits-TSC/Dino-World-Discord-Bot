# Season track

Fires on: `src/modules/daily/season.ts` and its embeds, `src/modules/daily/hooks.ts`
(where the capstone is stamped and the rung hint fires), the ladder content in
`src/data/seasons.ts`, `tests/season*.test.ts`, and `src/core/world.ts` — which holds
`SEASON_EPOCH` and the 30-day cycle the track rides.

## Headlines

- A season carries NO modifiers of any kind, even now that the reward track rides the cycle — a reward rung is not a multiplier. §season-carries-no-modifiers
- `SEASON_EPOCH` (690) is a WRITTEN LITERAL, never derived at runtime: the display number is `seasonIndex - SEASON_EPOCH + 1`, so moving it retroactively renumbers every badge a player has already earned. §season-epoch-written-literal
- `season_progress` rows are RETAINED per season rather than swept, and points must NEVER be derived for a past season's row — `user_stats` keeps growing, so a delta against an old frozen baseline climbs forever. §season-rows-retained-never-derive-past
- Stamp the capstone badge only from a write context, never a read path: `visitPayload`, `topPlayers`/`seasonScores` and `/park view user:<other>` all stay pure reads of `badgeAt`. §badge-stamped-only-in-write-context
- Guard `stampSeasonBadge` on `badgeAt IS NULL`, and run it BEFORE `postDispatch`'s hint-exemption returns — a player who crosses the capstone while running an exempt command like `/season` itself must still have it recorded. §stamp-season-badge-guard-and-order
- The five ungated day-1 sources sum to 430 of the 800 capstone (0.5375) against a pinned `< 0.55` ceiling: 0.0125 of headroom, so a cap increase on ANY of those five breaches it. §season-day1-bankable-pool-ratio
- Seven of the nine source caps never bind for the moderate profile inside a 30-day season, BY DESIGN — caps contain the grinder, not the baseline player — so do not "fix" a cap that merely looks slack. §season-caps-need-not-bind
- Tune against the MEASURED season economy — day 21 moderate, day 28 Gene-Lab-less, 418 points for a 10-day player — never the design spec's hand-computed figures. §season-measured-economy
- Hint a newly-unlocked rung ONCE via `season_progress.hinted_rung`, a HIGH-WATER MARK compared with `>`, stamped only after the combined followUp actually succeeds and never before. §hinted-rung-high-water-stamp-after-send
- `season:claim:<uid>:<seasonIndex>` carries the season index and validates it after the owner check and before any read or write, or a `/season` card left open across a rollover pays this season's rungs against last season's ladder. §season-claim-customid-carries-index

## season-carries-no-modifiers

The season track (`/season`, `src/modules/daily/season.ts` + `src/data/seasons.ts`)
rides the SAME 30-day cycle `seasonFor`/`seasonDay` already drove — `seasonFor`'s own
comment in `src/core/world.ts` now says it plainly: the cycle is no longer purely
cosmetic. But **a season still carries NO modifiers of any kind** — a reward rung is not
a multiplier — so the guarantee that cycle shipped with is untouched, and the reason it
matters is stated at `§seasons-carry-no-modifiers` in
`docs/conventions/world-events.md`.

## season-epoch-written-literal

`SEASON_EPOCH` (`src/core/world.ts`, **690**) is a WRITTEN
LITERAL, never derived at runtime: `seasonNumberFor`/`seasonNumberOf` compute the
DISPLAY number as `seasonIndex - SEASON_EPOCH + 1`, so moving this constant
retroactively renumbers every badge a player has already earned. 690 is a deliberate
release decision, not the index in flight at ship time (689): it's the index of the
season beginning 2026-09-04, one boundary AFTER ship day, so the season already
running at ship time numbers as **Season 0** — a short launch season — and Season 1
is a full 30 days for every player. The alternative (epoching at 689) was rejected for
two reasons: Season 1 would then be a stub of at most 21 days against a measured
28-day Gene-Lab-less clear time, so some players could provably never earn the first
badge; and 689 goes stale the moment the calendar crosses 2026-09-04 with nothing able
to detect it, silently renumbering every badge already earned. 690 needs no recompute
regardless of actual ship date.

This constant is frozen for a reason of its own and is deliberately not folded into the
frozen-denominator table at `§park-target-frozen` in
`docs/conventions/park-progression.md`: those are denominators over content that
keeps growing, while this one is the origin of a display number that has already been
printed on badges people hold.

## season-rows-retained-never-derive-past

`season_progress` rows are RETAINED per season rather than swept on rollover, unlike
`rollDailyQuests`'s delete-every-other-key sweep — because `badgeAt` on a PAST row is
the permanent record of that season's capstone, and a sweep would destroy the
collection it exists to record. The flip side is a real trap: points must NEVER be
derived for a past season's row. `user_stats` keeps growing after a season ends, so a
delta computed against an old frozen baseline climbs forever — `currentRow`/
`seasonView`/`seasonPoints` all read ONLY the row matching `seasonIndexFor(ctx.now())`,
never an arbitrary past one, and that restriction is the whole reason it's safe to
retain the rows at all.

## badge-stamped-only-in-write-context

The capstone badge is stamped from `dailyRouterHooks.postDispatch` — a WRITE
context — and NEVER from a read path: `visitPayload`, `topPlayers`/`seasonScores` and
`/park view user:<other>` must all stay pure reads of `badgeAt`. That split — a pure read
never writes, and the monotone value is stamped separately in a write context — is stated
in full at `§legacy-high-water-write-split` in `docs/conventions/park-progression.md`.

## stamp-season-badge-guard-and-order

`stampSeasonBadge` is guarded on `badgeAt IS NULL` (idempotent, stamped instant never
moves) and runs BEFORE the hint-exemption `return`s in `postDispatch` — a player who
crosses the capstone while running an exempt command like `/season` itself must still
have it recorded, only the hint TEXT is suppressed for exempt commands/prefixes.

## season-day1-bankable-pool-ratio

The day-1 bankable pool — the five sources with no facility or cooldown gate at all
(care 120 + sales 100 + splicing 90 + commerce 60 + collections 60 = **430**) — is the
real guard against maxing the ladder in a single sitting: 430/800 = 0.5375, just over
half the 800 capstone, with `tests/season-balance.test.ts` pinning both the exact sum
and the `< 0.55` ratio ceiling. That ratio is the tightest static margin in the whole
balance suite (0.0125 of headroom) — a future cap increase on ANY of those five
sources, even by 10 points, breaches it.

## season-caps-need-not-bind

**Genuine finding, not a defect: 7 of the 9 source caps never bind for the moderate
profile inside a 30-day season — only `splicing` and `collections` do.**
`genelab`'s 180-point cap, for example, is unreachable by the moderate profile inside
the season window at all: its raw score tops out at 150 (`floor(30 days) * 5`), and
the cap only becomes binding at day 36, six days past the season's own horizon. That
matches the file's own stated design — caps exist to contain the GRINDER, not the
baseline player — so don't "fix" a cap that looks slack without checking whether it
was ever meant to bind for anyone but a player deliberately maxing that one source.

## season-measured-economy

**Measured economy, superseding the design spec's hand-computed hypotheses** (every
figure re-derived independently from live `seasons.ts` content, no tuning): the
moderate profile clears the 800 capstone on day **21** (808 points, not the spec's
hypothesised day 21.4); a Gene-Lab-less profile clears on day **28** (821 points, not
day 27.3) — real slack before the 30-day boundary is **2 days**, not 2.7, making it the
tightest of the four balance gates; a player who only logs in for 10 days reaches
**418** points, landing between rung 4 (350) and rung 5 (475).

## hinted-rung-high-water-stamp-after-send

The rung-unlocked hint fires ONCE per newly-unlocked rung via `season_progress.hinted_rung`
(migration 0016, default -1, a HIGH-WATER MARK compared with `>`, not an
unlocked-and-unclaimed existence check). Persisting nothing, or testing merely for a rung
that is unlocked and unclaimed, re-fires the hint on every non-exempt dispatch for up to
30 days. It mirrors the quest side's
notifiedAt-after-send discipline exactly: stamped only after the combined followUp in
`postDispatch` actually succeeds, never before, so an errored send leaves the hint
owed rather than silently consuming it. Claiming a rung never lowers `hinted_rung`
(`claimSeason` doesn't touch the column), so a claim quietly retires that rung's hint
without re-arming it; only a FURTHER rung unlocking (`topReady` climbing past the
stored value) fires again, and a new season's fresh row resets to -1 on its own.

## season-claim-customid-carries-index

`season:claim:<uid>:<seasonIndex>` carries the season index in the customId, because a
`/season` card left open across a rollover would otherwise pay this season's rungs
against last season's ladder. Validated strictly after the owner check and before any
read or write; `!Number.isInteger(offered)` is provably redundant (`seasonIndexFor`
always returns an integer, so the bare `!==` alone rejects every non-integer target)
but is kept deliberately as explicit boundary validation on client-supplied input.

The general rule this follows, and the table of every anchor shipped today, are at
`§guard-scope-cross-message-only` in `docs/conventions/router-and-registry.md`.
