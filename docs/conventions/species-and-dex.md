# Species and dex

Fires on: `src/data/species/` and the type, rarity, progression and attendance tables
beside it (`src/data/types.ts`, `rarity.ts`, `progression.ts`, `attendance.ts`), the
`/dex` module, and the three suites that gate the roster (`tests/roster.test.ts`,
`tests/data.test.ts`, `tests/dex.test.ts`).

## Headlines

- `COLLECTION_TARGET` (190) is frozen at the rarity-weight sum of the roster the collection term shipped against and must never become a live sum over `allSpecies()` — a live denominator cuts the rating of every existing player each time a new species ships. §collection-target-frozen
- `ATTENDANCE_SPECIES_TARGET` (40) and `ATTRACTION_DRAW_TARGET` (210) are the same rule applied twice over and must never become live counts over `allSpecies()`/`ATTRACTIONS`. §attendance-targets-frozen
- Never ship a species whose `biomeTags` are not covered by at least `ENRICHMENT_CAP_KINDS` distinct decor kinds — `tests/roster.test.ts`'s "every species can reach the enrichment cap" is the machine gate, and the decor catalog is a precondition for the cap rather than incidental content. §decor-catalog-covers-every-biome
- Loose art fidelity is the accepted price of fixed art cost: `archetype` is a combat concept, not a body plan, so outliers share art. A per-species `silhouette` field was considered and declined — do not reopen it. §archetype-art-fidelity-accepted
- Validate every post-prefix customId segment against the real union in `parseDexFilters` and degrade an unrecognised slug to "no filter": a raw slug reaching `dexRows` matches nothing and renders an empty compendium, with no error. §validate-client-supplied-customid-segments

## collection-target-frozen

`COLLECTION_TARGET` (`src/data/progression.ts`, 190) is frozen by a deliberate design
decision, not a value to keep in sync as content ships — do not "fix" it to track the
roster. It is the rarity-weight sum of the species roster the collection term shipped
against, and it must never become a live sum over `allSpecies()`.

What a live sum would do is specific: `recomputeRating` computes the term as
`Math.min(1, ownedWeight / COLLECTION_TARGET)`, so every new species shipped would raise
the denominator for players who already own exactly what they owned yesterday, and their
rating would FALL — retroactively, for content they never saw, with no action of their own
involved. That clamp at 1 is precisely what
lets new species act as alternate paths to the existing target instead of moving it: a
player already at the cap stays at the cap, and a player below it gains one more way to
reach the same number.

The shared argument behind every frozen denominator in this repo, and the table listing
all four of them, is `§park-target-frozen` in `docs/conventions/park-progression.md`.

## attendance-targets-frozen

Two constants behind park attendance are FROZEN, `COLLECTION_TARGET`'s rule applied twice
over: `ATTENDANCE_SPECIES_TARGET` (40) and `ATTRACTION_DRAW_TARGET` (210)
(`src/data/attendance.ts`) must never become live counts over
`allSpecies()`/`ATTRACTIONS`. The first denominates attendance's variety term (how many
distinct species the park keeps), the second its draw term (the summed draw of the
attractions built).

The tax is the same one and it lands on the park rather than the rating: a live
denominator would drop the attendance of every existing park the moment a new species or
a new attraction kind shipped, because the numerator did not move and the divisor did. The
`min(1, …)` clamp on each is what makes new content an ALTERNATE PATH to the same target
rather than silent inflation of it.

## decor-catalog-covers-every-biome

**Never ship a species whose `biomeTags` aren't covered by at least `ENRICHMENT_CAP_KINDS`
distinct decor kinds.** `tests/roster.test.ts`'s "every species can reach the enrichment
cap" test is the machine gate.

The three-kinds-per-biome decor catalog (`src/data/decor.ts`) is a precondition for the
cap, not incidental content: it was grown to that shape for exactly this reason, and the
gate would fail on the table that preceded enrichment, where coast, tundra and volcanic
each offered only one kind. A species whose biomes are thinly covered is not a content
gap that can be patched later — it is a resident that can never reach the top enrichment
rung, in a system where the rung is the whole point.

## archetype-art-fidelity-accepted

Dino art is keyed on archetype×diet with a per-species file as an optional override, so a
species with no file of its own costs no art and adding a species stays a data-only
change: `§dino-art-archetype-diet-with-species-override` in
`docs/conventions/art-resolver.md` is that guarantee. Archelon (uncommon, support
archetype, carnivore diet) is the shipped proof it holds — it was the first species to use
`support-carnivore` and needed no new art at all.

That fixed cost has a fidelity price: `archetype` is a combat concept, not a body-plan
one, so outliers share art loosely — `swift-carnivore` covers both `velociraptor` and
`quetzalcoatlus` (a beaked pterosaur), rendered as a scaled toothy theropod. Accepted
deliberately: a per-species `silhouette` field was considered and declined, since it would
have traded 8 images for roughly 12 plus a migration across all 40 species files, to fix
fidelity for a handful of outliers.

## validate-client-supplied-customid-segments

Everything after a `/dex list` pager customId's prefix is CLIENT-supplied, so
`parseDexFilters` (`src/modules/dex/service.ts`) validates each slug against the real union
and degrades an unrecognised one (including the `-` placeholder) to "no filter" — a raw
slug reaching `dexRows` would match nothing and render an empty compendium.

The command path reads its own options through that same parser rather than casting, so
there is exactly one validated way into `DexFilters`. Why the pager needs a customId of its
own at all, rather than the shared `pageRow`, is
`§filtered-lists-need-their-own-page-row` in
`docs/conventions/embed-payload-builders.md`.
