# Slash-Command Autocomplete — Design

Date: 2026-07-22
Status: Approved

## Goal

Every option that takes a looked-up identifier (egg id, dino id, lot id, trade id, species key) or a per-user-validity value (expedition site, shop rarity) gets Discord native autocomplete, so players never have to copy raw ids out of embeds. Free typing of raw ids keeps working everywhere — autocomplete is a suggestion layer, not a gate.

## Decisions (locked)

1. **Filtering semantics**: show ALL owned/relevant entries, valid targets first, invalid ones state-tagged (e.g. `hatching, 3h left`). Invalid entries remain selectable; the existing execute-path validation errors ephemerally as today. Discord's 25-row cap means valid entries can never be crowded out.
2. **Trade scope**: full support. `give-dinos` / `give-eggs` / `want-dinos` / `want-eggs` all get multi-token list completion. `want-*` providers read the in-flight `user` option to list the counterparty's items.
3. **Static-choice conversions**: `/expedition start site` and `/shop egg rarity` convert from `.addChoices` to autocomplete for per-user filtering (unlocked sites, today's rotation) with richer labels.
4. **Label style (style C)**: entity emoji anchor + display name + UPPERCASE tags only for urgent states.
   - Eggs: `🥚 #12 Rare — READY`, `🥚 #15 Epic — hatching, 3h left`, `🥚 #3 Common — not incubating`
   - Dinos: `🦖 #7 Velociraptor — VERY HUNGRY (lot 3)`, `🦖 #9 Dilophosaurus — ESCAPED, rescue first`. Hunger renders as `fed Xh ago`; the `VERY HUNGRY` tag replaces it when ≥36h since last fed (75% of the 48h escape window).
   - Labels are plain text + emoji, ≤100 chars (Discord limit).
5. **Architecture (approach A)**: per-module providers + shared core kit. Each module owns its autocomplete handlers next to its commands; shared formatting/sorting/completion utilities live in `src/core/autocomplete.ts`.

## Core plumbing

### `src/core/modules.ts`

`CommandDef` gains one optional method; no `ModuleRegistry` changes (autocomplete interactions carry `commandName`, so `findCommand` already resolves them):

```ts
interface CommandDef {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
  execute(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(ctx: Ctx, i: AutocompleteInteraction): Promise<void>;
}
```

### `src/core/router.ts`

Third dispatch branch, checked before the current `!isCommand && !isButton` early-return:

- `interaction.isAutocomplete()` → `registry.findCommand(interaction.commandName)` → call `cmd.autocomplete(ctx, i)` if defined, else `i.respond([])`.
- The autocomplete branch has its own try/catch that calls `i.respond([])` on failure — `AutocompleteInteraction` has no `reply()`, so the existing ephemeral-reply catch path must never see it. Failures log at debug level (fires per keystroke).
- `touchPresence` is NOT called for autocomplete interactions — no DB writes on keystrokes.

### `src/core/autocomplete.ts` (new)

Shared kit, single source of truth for style C:

- `respondRanked(i, entries)` — sorts valid-first (stable within groups), caps at 25, maps to `{name, value}`, responds.
- Label builders: `eggLabel`, `dinoLabel`, `lotLabel`, `tradeLabel`, `siteLabel`, `rarityLabel`, `speciesLabel`.
- `matches(query, ...haystacks)` — case-insensitive substring match against id, name, rarity, etc.
- `listCompleter(rawInput, candidates, opts)` — multi-token completion for trade id-lists (see Hard cases).
- Empty-state helper — builds a single informational row with a sentinel value.

## Provider matrix

All providers scope to the invoking user unless noted, filter by the typed query via `matches`, and rank via `respondRanked`.

| Command / option | Valid group (first) | Invalid group (tagged) | Notes |
|---|---|---|---|
| `/incubate egg` | not incubating | `hatching, Xh left`; `READY — use /hatch` | slot-full stays an execute-path error, not a validity split |
| `/hatch egg` | `hatchesAt <= now` → `READY` | `hatching, Xh left`; `not incubating` | |
| `/upgrade lot` | below max level | `MAX LEVEL` | |
| `/dino assign dino` | not escaped | `ESCAPED`; current lot shown | |
| `/dino assign lot` | paddocks with capacity | `FULL` | non-paddock lots excluded entirely (never valid) |
| `/dino unassign dino` | currently assigned | unassigned tagged | |
| `/decorate lot` | paddock lots | — | non-paddocks excluded |
| `/sell dino` | owned, not mythic, not trade-locked | `MYTHIC — can't sell`; `locked in trade #N` | label appends sell value |
| `/shop egg rarity` (converted) | today's rotation, with prices | `not in today's shop` | uses `dailyEggOffers` |
| `/feed one dino` | not escaped, sorted hungriest-first | `ESCAPED — /rescue first` | label shows hunger; runs `settleEscapes` first |
| `/rescue dino` | escaped only | `not escaped` | runs `settleEscapes` first |
| `/expedition start site` (converted) | unlocked, cost + duration in label | `LOCKED — needs ★N` | uses existing `listSites(hw)` |
| `/trade accept id`, `/trade decline id` | incoming pending (`toUser` = invoker) | wrong direction tagged (`your outgoing — use /trade cancel`) | runs `expireStale` first; label `#5 ← @sender — give … / want …` |
| `/trade cancel id` | outgoing pending (`fromUser` = invoker) | wrong direction tagged | same |
| `/trade offer give-dinos`, `give-eggs` | own items minus locked / escaped / incubating / mythic | — (invalid excluded; list UX) | `listCompleter` |
| `/trade offer want-dinos`, `want-eggs` | counterparty items, same exclusions | — | reads in-flight `user` option; no user picked → `pick user first` row |
| `/admin give dino-species` | all 30 REGISTRY species | — | label `Velociraptor (rare)`, value = species id |

Unchanged: `/mythic species`, `/build kind`, `/decorate item`, `/top metric|scope` (small static always-valid choice sets); all `user`/`channel` options (native pickers); plain amounts (`cash`, `food`, `units`, `hours`); `/admin reset confirm` (confirmation friction is intentional — never autocomplete it).

## Hard cases

### Trade list completion (`listCompleter`)

- Input `12, 4` → prior tokens `["12"]`, active token `"4"` → suggest items matching `4`; each choice is `{name: "12, 45 — 🦖 Velociraptor", value: "12, 45"}`. Selection replaces the whole field, preserving prior ids.
- Already-entered ids are excluded from suggestions (dedup).
- At `TRADE_MAX_ITEMS_PER_SIDE` tokens, respond with a single `max N items per side` row.
- 100-char limits apply to both name and value. Name: elide the prefix visually (`…, 45 — Velociraptor`). Value: if the full list would exceed 100 chars, respond with an informational `list too long — type manually` row.
- Token grammar matches `parseIdList` (split on `/[\s,]+/`, positive integers).

### In-flight option read (`want-*`)

`i.options.get('user')?.value` yields the counterparty snowflake mid-typing (Discord sends partial options during autocomplete). Absent → informational row `pick user first`.

### Stale picks and raw typing

Dropdown snapshots can rot (egg hatches elsewhere, trade expires between suggest and submit). No new handling: execute-path validation already rejects with ephemeral errors. Users can always ignore suggestions and type raw ids — no behavior change for existing muscle memory.

### Empty states

Never `respond([])` for a genuinely empty inventory — show one informational row with an actionable label and a sentinel value that fails cleanly in the existing execute path:

- Integer options: sentinel value `0` (no row id 0 exists → clean "not owned"-style error if actually submitted).
- String options: sentinel value `-` (hits existing unknown-X errors).
- Example label: `No eggs — /shop egg or /expedition start`.

## Error handling & performance

- Provider throws → router catches → `i.respond([])` (empty dropdown), debug log. Autocomplete never sends ephemeral replies.
- 3-second Discord deadline: all queries are single-user indexed SQLite lookups — no debounce or caching needed.
- Providers never call `getOrCreateUser` (no row creation from keystrokes). Missing user row → empty/informational rows. Exceptions: `settleEscapes` (care) and `expireStale` (trading) run in providers because label accuracy depends on them; both are idempotent and cheap.

## Testing

New harness helper `fakeAutocomplete({ name, sub?, user, guild?, focused, options? })` in `tests/harness.ts`: `isAutocomplete: () => true` (others false), `options.getFocused(true)` → `{name, value}`, `options.get('user')` for in-flight reads, `respond(choices)` pushes to `replies` for assertion — same pattern as `fakeCommand`.

Coverage:

- **Router**: dispatch to handler; command without handler → `respond([])`; throwing provider → `respond([])`, no crash; no presence write on autocomplete.
- **Core kit units**: `listCompleter` (token split, dedup, prefix re-emit, item cap, char caps), `matches`, `respondRanked` (valid-first order, 25 cap), every label builder (exact style C strings).
- **Per provider**: golden path (valid-first order, correct labels) plus at least one edge each — empty-state sentinel row, escaped/locked/mythic exclusions, `want-*` with no user picked, ready-vs-hatching split, locked-site tag, off-rotation rarity tag, hungriest-first order, trade direction filtering.
- **Regression**: all existing execute-path tests untouched — raw-id submission still validates identically.

## Registration & deploy

- No new commands or modules: the 18-command count and 5-site registration checklist are unchanged. Only option builders and `CommandDef` methods change.
- `npm run deploy-commands` must be re-run after merge (option shapes changed). Single-bot-instance rule stands.

## Docs (same change, not follow-up)

- README command tables: note autocomplete-enabled options.
- Option descriptions updated (e.g. `'Egg id from /eggs'` → `'Egg — start typing to search'`).
- Repo CLAUDE.md: document the `autocomplete?` CommandDef contract and the invariant "providers only respond(), never reply()".
