# World events

Fires on: `src/core/world.ts` (the derivation, the salt, the season cycle),
`src/data/world-events.ts` (the event table and its mods), the `/world` module
(`index.ts`, `embeds.ts`) and the four suites over them — `tests/world.test.ts`,
`tests/world-effects.test.ts`, `tests/world-income.test.ts`,
`tests/world-module.test.ts`.

## Headlines

- The day's event is a pure function of a UTC timestamp — `worldEventFor(now)` / `eventMods(now)` — DERIVED, never stored on a row. §world-event-derived-not-stored
- `WORLD_SALT` (`0x2c0`) exists so UTC days 0–4 all resolve to fully neutral Clear Skies: `makeCtx` defaults `nowMs` to 0, so essentially the whole offline suite runs on day 0 and an eventful epoch would silently multiply pinned fixtures across a dozen unrelated files. §world-salt-day-zero-epoch
- Never reorder `WORLD_EVENTS` or change the salt without re-running `tests/world.test.ts`. §world-events-order-frozen
- The 30-day/3-season cycle carries NO modifiers at all, deliberately — that is what removes every season×event stacking question before it can come up. §seasons-carry-no-modifiers
- `EventMods.hatchTraitOdds` is an array of FRACTIONS summing to 1, fed to `rollSlotCount`/`rollTraits` with no normalization: written on a 0–100 scale it rolls ZERO traits on every hatch, the exact opposite of the intended buff. §hatch-trait-odds-are-fractions

## world-event-derived-not-stored

`worldEventFor(now)` / `eventMods(now)` (`src/core/world.ts`)
are pure functions of a UTC timestamp — the day's event is DERIVED, never
stored. The principle, and the other features in this repo built the same way, are
at `§escrow-derived-never-stored` in `docs/conventions/escrow-and-item-moves.md`.

## world-salt-day-zero-epoch

`WORLD_SALT` (`0x2c0`) is XORed into the day index before seeding
`mulberry32` specifically so UTC days 0–4 all resolve to Clear Skies
(fully neutral mods): `makeCtx` defaults `nowMs` to 0 (`tests/harness.ts`),
so essentially the **whole offline test suite** runs on day 0 — an eventful
epoch would have silently multiplied pinned fixtures across a dozen
unrelated test files. `scripts/test-live.ts` is the one exception: it calls
`ctx.setNow(Date.now())` deliberately, so its gallery renders under
whatever event is live on the real calendar day, not day 0.

## world-events-order-frozen

Never reorder `WORLD_EVENTS` or change the salt without re-running
`tests/world.test.ts`.

## seasons-carry-no-modifiers

Seasons (`seasonFor`/`seasonDay`, same file) are a
separate 30-day/3-season cycle (`SEASON_DAYS`) with no
modifiers at all — deliberately, since that's what removes every
season×event stacking question before it can come up. The season TRACK now rides this
same cycle and still adds none of its own: `§season-carries-no-modifiers` in
`docs/conventions/season-track.md`.

## hatch-trait-odds-are-fractions

`EventMods.hatchTraitOdds` (`src/data/world-events.ts`) is a
`[0-trait, 1-trait, 2-trait]` array of FRACTIONS summing to 1 — the same
convention as `WILD_SLOT_ODDS`/`BRED_SLOT_ODDS` (`src/data/traits.ts`) —
fed straight into `rollSlotCount`/`rollTraits` with no normalization.
Writing it on a 0–100 scale (e.g. `[45, 40, 15]`) would put the entire
cumulative weight under the first step and roll **zero** traits on every
single Migration Season hatch — the opposite of the intended buff.
