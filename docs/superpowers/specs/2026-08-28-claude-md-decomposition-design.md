# Decomposing CLAUDE.md into path-triggered convention docs

Design, 2026-08-28.

## 1. The problem, measured

`CLAUDE.md` is 1829 lines / 21,464 words / 150 KB, loaded in full at the start
of every session and inside every subagent. 48 top-level bullets, wildly
uneven: operator refunds 265 lines, battles 128, art variants 127, the customId
and router guards 117, enrichment 105, the season track 98. The top eight
bullets are 55% of the file.

It grew the way it did for a good reason — each shipped feature writes its
post-mortem here, and that is why the rules carry their *why*. Nothing is
wrong with the content. What is wrong is that all of it loads regardless of the
task: the seeded variant resolver loads while tuning a boss, the refund ledger
loads while authoring an emoji SVG.

Four distinct costs, all confirmed as goals for this work:

1. **Per-session token cost.** ~38k tokens before any work begins.
2. **Agent reliability.** Rules buried at line 1100 of a 1829-line file are
   missed, and the file restates the same principle in up to eight places.
3. **Human readability.** It cannot be navigated or maintained by hand.
4. **Growth rate.** Every feature appends 100–265 lines; nothing is retired.

An analysis pass decomposed the file to the **rule** level rather than the
bullet level and found **335 distinct rules** — a 265-line bullet holds
roughly fifteen rules belonging to three different subjects.

### What this is not

The original framing was to move generic guidance up to the user-level
`CLAUDE.md` and leave a small repo file. That does not work: of 335 rules, five
are project-independent. The user file already holds the portable process
rules (dependency freshness, tests track code, no attribution). Moving
"generic" content up saves 5 rules of 335. The problem is not user-vs-repo
scope; it is that a design journal is being used as an always-loaded preamble.

## 2. Decisions

| Decision | Choice |
| --- | --- |
| Delivery mechanism | Path-triggered `PreToolUse` hooks injecting context |
| Injection model | Two-tier: headline block injected, full body one `Read` away |
| Fidelity | Every rule and every load-bearing *why* survives; duplicated principle statements and non-re-derivable correction history are cut |
| Always-loaded core | Tripwires plus a topic index, ~8 rules |
| Cut axis | **By file, not by subject** |
| User-level `CLAUDE.md` | Gains the five genuinely portable process rules |

The mechanism was chosen over repo skills and over a plain docs index because
both rely on the agent deciding to look. A hook does not.

The cut axis is the decision that took two attempts. The first partition cut
topics by **subject** while drawing globs by **file type**, and the two did not
line up. Measured against the last 60 commits it fired a median of 5–6 docs
(900–1280 lines) and one commit fired all nine (1720 lines) — more text than
the monolith it replaced, delivered in nine pieces. It also left
`src/data/species/**` (53 files) matching no glob at all.

So: **a doc is defined by the set of files that trigger it, then named for
whatever those files have in common** — even where the result reads as a
grab-bag. A rule is filed with the doc owning the file where **the mistake is
made**, not the file where the mechanism lives. `never-rarity-emoji-to-setEmoji`
belongs where buttons are minted, not beside `src/core/emojis.ts`.

## 3. Architecture

```
CLAUDE.md                      ~90 lines, always loaded
  8 tripwire rules + a one-line index of the 28 docs

docs/conventions/<slug>.md      28 docs, ~2000 lines total
  ## Headlines                  what the hook injects
  <body>                        full reasoning, one Read away

.claude/settings.json           PreToolUse hooks, one entry per doc
.claude/hooks/conventions.mjs   emits a doc's headline block, once per agent

tests/conventions.test.ts       the machine gate
```

### 3.1 The hook

`PreToolUse` supports `hookSpecificOutput.additionalContext`, and a handler
takes an `if` field using permission-rule syntax that matches the **path**, not
just the tool name:

```json
{
  "matcher": "Edit|Write|Read",
  "hooks": [{
    "type": "command",
    "if": "Edit(src/modules/battles/**)",
    "command": "node ${CLAUDE_PROJECT_DIR}/.claude/hooks/conventions.mjs fights-and-duels"
  }]
}
```

Three properties of the mechanism carry this design:

- **It fires per file per tool call.** That is the unit the cost is paid on,
  and it is what makes the saving large. See §6 for the consequence if this
  turns out to be false.
- **It fires inside subagents**, with `agent_id` in the payload. This repo runs
  subagent-driven development; implementer subagents are the primary consumers
  of these rules and currently swallow all 1829 lines each.
- **State is per agent.** The script injects a given doc **once per
  `session_id` + `agent_id`**, so a ten-file edit sweep in one module pays for
  its doc once, not ten times.

### 3.2 The headline block

Each doc opens with a headline block: one imperative line per rule, carrying
the rule **and its consequence**, plus an anchor into the body.

```
[art-asset-files] full reasoning: docs/conventions/art-asset-files.md
- Wire art with attach(embed, payload, slot, ref); hand-assigning payload.files
  shipped three attachment defects and is banned by tests/images.test.ts. §attach
- attach APPENDS and call order is upload order; three tests mock by
  1st-call/2nd-call identity, so never reorder or hoist the lookups. §attach
- Two refs on one payload must resolve to distinct basenames, or
  attachment://<name>.webp is ambiguous and one slot renders the wrong picture. §dedupe
```

The consequence is not decoration. A headline reading "always use `attach`"
invites a reader to judge the rule; one naming the three defects it prevented
does not.

**Body-required rules.** Five rules cannot survive compression to one line, and
for those the hook injects the full passage instead of a headline:

1. `notify-payload-omits-attachments` and `payload-never-shared-across-two-sends`
   **contradict as headlines**. On `src/modules/park/alert-embeds.ts` — one
   payload object, two send sites, on the notify path — one says "hand each send
   its own `attachments: []`" and the other says "never let a payload reaching
   `deliverNotification` carry an `attachments` key". Only the bodies reconcile
   them.
2. `one-more-face-moves-half-the-seeds` / `new-face-is-inert-for-unseeded-bases`
   are a matched pair whose branch depends on whether the base has a seeded call
   site — determinable only by `grep -rn 'assetImage(' src/`.
3. `no-test-proves-a-variant-is-reachable` is a disclosure with no imperative
   form. The paragraph *is* the gate.
4. `null-prototype-catalog-maps` — a line can carry the incantation but not that
   **both** the `as` and the `satisfies` are required, and that dropping either
   silently returns `any` and discards the literal's type check.
5. `router-guard-test-evidence` is two unrelated things in one rule; one line
   carries one of them.

### 3.3 Always-loaded core

Eight rules, for two reasons only: the rule governs any line you write
anywhere, or the damage lands before any file is opened.

- `.js` on every relative import (ESM NodeNext).
- Time from `ctx.now()`, randomness from `ctx.rng()`.
- DB access is synchronous drizzle/better-sqlite3, never awaited.
- Any command-builder change requires `npm run deploy-commands`.
- Exactly one bot process per token. (No file triggers this at all.)
- Option sets past 25 use autocomplete, never `addChoices` — which **throws at
  builder construction, i.e. at boot**. The roster is at 52 species. This is a
  crash, never a degrade, and it is reachable from a species data file nobody
  would think to attach a builder rule to.
- A money-spending button carries the rung, page or amount it was minted for in
  its customId, validated in the handler. This is the class that charged 32x its
  own label on a live landmark button.
- `npm run build` does not typecheck tests; `npm run typecheck` is the gate.

Twenty-two further rules that a first pass tiered as "always" were pushed down
to a file-scoped doc. Two were dropped from the core deliberately:
`audit-by-grepping-assetimage` means nothing until the art doc has been read,
and `boundary-blind-to-pre-deploy-resets` is an operator fact whose own source
text argues that a line printed on every render is a line people stop seeing.

Plus the index: one line per doc naming it and when it applies, so a planning
turn that opens no file still knows what exists.

## 4. The partition

28 subject docs plus the fallback doc of §5.1, which fires only where nothing
else matches. Every one of **837 tracked files has an owner**: 787 fire exactly
one doc, 50 fire exactly two, none fires three, **zero orphans**. All 237 globs
match at least one real file. All 335 rules land: 327 in docs, 8 in the core,
none lost, none duplicated.

The counts in this section are the partition **as measured, before the
amendments of §5**. The amendments move four rules, add the fallback globs and
add nine files to `embed-payload-builders`; §5.4 is what turns eight files into
the partition's only three-doc files.

| Doc | Rules | Primary triggers |
| --- | ---: | --- |
| `park-surface` | 27 | `park/{index,embeds,visit,showcase,dinos}.ts`, `core/text.ts` |
| `park-progression` | 24 | `park/{service,rating,ranks,attendance,landmarks,escapes}.ts`, `guests/**`, `data/{paddocks,facilities,progression,landmarks,attendance,attractions}.ts`, `docs/gameplay.md` |
| `command-and-handler-surface` | 21 | `src/modules/*/index.ts`, `core/autocomplete.ts` |
| `router-and-registry` | 18 | `core/{router,components,modules,module-list,config,logger}.ts`, `deploy-commands.ts`, `modules.json` |
| `embed-payload-builders` | 18 | `src/modules/*/embeds.ts`, `*-embeds.ts`, `admin/ledger.ts`, `core/paginate.ts` |
| `escrow-and-item-moves` | 18 | `core/{locks,species-seen}.ts`, `trading/**`, `shop/**`, `hatchery/**`, `genelab/**`, `expeditions/**`, `data/{trade,shop,sell,traits,breeding}.ts` |
| `admin-service` | 17 | `admin/{service,guard}.ts` |
| `economy-core` | 16 | `core/economy.ts`, `data/tx-reasons.ts` |
| `art-resolver` | 15 | `core/images.ts`, `core/rolls.ts` |
| `art-asset-files` | 13 | `assets/images/**`, `docs/assets/prompts.md`, the `scripts/` art pipeline |
| `park-png-renderer` | 13 | `core/render/**`, `data/render-icons.ts`, `park/snapshot.ts`, `assets/images/park/**`, `assets/fonts/**` |
| `clock-comfort-and-feeding` | 13 | `core/clock.ts`, `data/{decor,foods,care}.ts`, `care/**` |
| `timers-and-alerts` | 11 | `park/alert-*.ts`, `core/scheduler.ts`, `world/broadcast.ts` |
| `schema-and-migrations` | 10 | `core/db/**`, `drizzle/**`, `drizzle.config.ts`, `scripts/backfill-species-seen.ts` |
| `admin-ledger` | 10 | `admin/{ledger,index}.ts` |
| `battle-content-and-balance` | 10 | `data/battle/**`, `data/sites.ts` |
| `fights-and-duels` | 10 | `battles/**`, `duels/**` |
| `season-track` | 10 | `daily/{season,season-embeds,hooks}.ts`, `data/seasons.ts` |
| `leaderboards` | 9 | `leaderboards/**` |
| `notify-and-runtime` | 7 | `core/{notify,context}.ts`, `src/index.ts` |
| `daily-quests-and-stats` | 6 | `daily/{index,service,hooks,embeds}.ts`, `data/{quests,achievements}.ts`, `core/stats.ts` |
| `emoji-pipeline` | 5 | `assets/emojis/**`, `core/{emojis,emoji-sync,render-svg,trait-display}.ts`, `build-emojis.ts`, `deploy-emojis.ts` |
| `world-events` | 5 | `core/world.ts`, `data/world-events.ts`, `world/{index,embeds}.ts` |
| `species-and-dex` | 5 | `data/species/**`, `data/{types,rarity,progression,attendance}.ts`, `dex/**` |
| `test-harness-and-gates` | 5 | `tests/harness.ts`, `tests/lib/**`, `scripts/test-live.ts`, the build config |
| `help-topics` | 4 | `help/index.ts` |
| `bot-profile-branding` | 4 | `assets/branding/**`, `core/branding.ts`, `deploy-branding.ts`, `scripts/make-gif.ts` |
| `prose-and-specs` | 3 | `CLAUDE.md`, `README.md`, `docs/**`, community files, `.claude/**` |

Each test file is routed to the doc of the code it tests. **`tests/**` appears
as a glob nowhere** — it fired on 97% of src-touching commits, which is
wallpaper by construction, since this repo's standing rule is that behaviour
changes ship a test.

### 4.1 The 50 double-fires

Five classes, each a file with two genuine jobs. (Under §5.4 eight of the
`index.ts` files in class 1 gain a third.)

1. 14 `src/modules/*/index.ts` fire `command-and-handler-surface` plus their
   module's doc. All 17 declare both a command array and a component or select
   array, so `commands` and `components` **cannot be cut apart** — no task that
   opens a module entry point needs one without the other.
2. 10 `embeds.ts` files fire `embed-payload-builders` plus their module's doc.
3. 18 `assets/images/park/**` rasters fire both art docs, so shipping a seasonal
   ground surfaces the null-init and fallback-chain contracts.
4. `data/progression.ts` and `data/attendance.ts` fire `park-progression` and
   `species-and-dex` — they hold the frozen denominators, and new content is the
   only thing that ever tempts anyone to move one.
5. `docs/gameplay.md` fires `park-progression` and `prose-and-specs`.

`src/modules/park/index.ts` is the worst-served file — 21 edits in 60 commits,
two docs — and no file-level cut avoids it. Splitting `park-surface` in two was
measured: it moved the maximum from 62 to 60 lines and the median not at all,
while scattering rules that span the two files. Rejected.

## 5. Amendments the audit forced

Two adversarial passes measured the partition against real history. Structure
held; four things did not.

### 5.1 Coverage is a photograph, not a property — non-optional

201 of 237 globs are literal paths. `src/core/`, `src/data/`, `scripts/` and the
`src/` root have **zero wildcard coverage**, and 85 of 122 test files are named
individually. Measured: **of the 183 files added under `src|tests|scripts` in
the last 60 commits, 52% would have orphaned at birth** — including
`core/locks.ts`, `core/world.ts`, `core/stats.ts`, `core/components.ts`,
`core/text.ts`, `admin/ledger.ts`, `park/alert-sweep.ts` and 51 test files. A
new module's `service.ts` fires nothing today, taking the entire service-layer
rule set with it.

Fix: catch-all fallback globs (`src/core/*.ts`, `src/data/*.ts`, `src/*.ts`,
`scripts/*`, `tests/*.ts`, `src/modules/*/*.ts`) routed to a short fallback doc,
ranked **below** the specific globs so they fire only when nothing else matched.
Cost: +3 lines on the median, zero on the per-file median.

Paired with a machine gate, because the rule nobody enforces is the rule that
rots. `tests/conventions.test.ts` fails when:

- any tracked file matches no doc glob (the orphan criterion, enforced);
- any glob matches no tracked file (dead glob);
- any headline anchor does not resolve to a heading in its body;
- `CLAUDE.md` exceeds its line cap;
- any doc in `docs/conventions/` has no trigger in `.claude/settings.json`.

### 5.2 Post-merge operator steps cannot fire from a path hook

`deploy-emojis`, `deploy-branding`, `backfill-species-seen` and `test:live` all
surface while editing and never again — hours or days before the moment they
matter. `test:live` is worst placed: its triggers are `scripts/test-live.ts`,
`src/modules/**/embeds.ts` and `assets/images/**`, and the last two do not fire
the doc it lives in, so shipping new art never mentions the gallery.

Fix: these four move to a `Stop`-hook checklist keyed on what the session
actually touched, not to a path trigger. Only `deploy-commands` stays in the
always-core, where it already earns its place.

### 5.3 Four misfiled rules

- `SEASON_EPOCH = 690` is at `src/core/world.ts:94` (verified), which fires
  `world-events`; the rule sits in `season-track`. Editing the constant surfaces
  neither it nor its "retroactively renumbers every badge already earned"
  consequence. Add `core/world.ts` to `season-track`.
- `fastforward-column-guards` and `admin-covers-daily-tables` sit in
  `admin-service`. A new migration adding a time column surfaces
  "reset must cover every table the feature reads" but never the rule that
  `adminFastForward` must shift the column and guard its `0` sentinel. Add
  `drizzle/**` and `core/db/schema.ts` to `admin-service`.
- `audit-by-grepping-assetimage` carries **empty** trigger paths in the
  inventory — its own signal that no file edit reaches it — and was nevertheless
  filed behind `core/images.ts`, the file the audit is not about. It moves to
  `prose-and-specs`, which is what fires while a spec is being written.
- `track-inside-the-measured-write` sits with `core/stats.ts`, but every
  `track()` call site is inside some module's `service.ts`. Add
  `src/modules/*/service.ts`.

### 5.4 One declined call, reversed

The nine `assetImage` call sites outside `embeds.ts` — `care/index.ts`,
`expeditions/index.ts`, `hatchery/index.ts`, `help/index.ts`,
`leaderboards/index.ts`, `park/index.ts`, `shop/index.ts`, `trading/index.ts`
and `core/notify.ts` (all verified by grep) — were left out of
`embed-payload-builders` on a stated cost that measurement showed was inflated:
**the per-file median does not move at all**, the per-commit median moves 52 to
58.5, and the worst commit is unchanged. Eight files become three-doc files.

`help/index.ts` is precisely the variable-`kind` call site that a plan, three
reconnaissance passes and two implementers all walked past. Declining a
self-identified correctness gap for a cost that does not move the median is not
defensible. They go in.

### 5.5 One stated weakness withdrawn

The partition claimed `npc-level-sanity-cap-frozen` was unreachable because
`NPC_LEVEL_SANITY_CAP` lives in `src/data/progression.ts`. It does not.
`grep -rn 'SANITY_CAP' src/ tests/` finds it only as a local const in
`tests/battle-content.test.ts:12` and as a comment in
`src/data/battle/chapters/founders_park.ts:79` — both fire
`battle-content-and-balance`, the doc it is filed in. The rule is correctly
placed. Recorded because a false weakness invites a future editor to "fix" a
placement that is already right.

## 6. What this costs and what it saves

Figures re-scored against real rule lengths. The first estimate assumed one
line per rule; the median rule summary is 34 words (2.6 lines) and 192 of 335
carry `compressible: NONE`, so the original numbers understated injection by
~2.3x. These are the corrected ones.

| | today | after |
| --- | ---: | ---: |
| typical file edit | 1829 | **~54–70** |
| p90 file edit | 1829 | ~102 |
| worst single file (`park/index.ts`) | 1829 | 162 |
| always-core, every session | 1829 | ~90 |
| whole large feature, cumulative | 1829 | ~852 |

Roughly **30x on the unit the hook actually charges**. Two caveats stated
plainly rather than buried:

- **On a 89-file feature merge the cumulative saving is about 2x, not 30x.** The
  win comes from injections being small and per-file, never from the corpus
  being smaller. Total text *grows* ~23%, which is the point: nothing reads all
  of it.
- **The whole saving rests on the hook firing once per file per tool call.** The
  documentation says it does. Nothing here has proved it. **Task 1 of the
  implementation plan is a spike that proves it — including that the `if` glob
  syntax handles `src/modules/*/index.ts` and `assets/**` on Windows paths —
  before anyone writes 28 docs.** If the trigger is coarser than one file per
  call, this partition does not deliver and should be re-cut for fewer, larger
  units.

## 7. Deduplication

Seventeen principles are stated in full at multiple sites. Each is stated **once**
in its home doc; every other site keeps its own formula plus a cross-reference,
and any clause unique to that site survives. The largest:

- *Derived, never stored — nothing sweeps, nothing drifts*: six full statements
  (escrow, quest progress, world events, attendance, the reversed flag, legacy
  rank). Home: `schema-and-migrations`, with escrow as the worked example.
- *A pure read never writes; a monotone high-water is stamped only in a write
  context*: six statements. Home: `park-progression`, on
  `legacyRank`/`bumpLegacyBest`, which names the pattern. The `/guests` instance
  keeps its unique consequence — it costs a pending trade.
- *State in the customId; the repaint is a second layer, never the guard*: ten
  statements. The core states the obligation; `router-and-registry` holds one
  anchor table.
- *`MessagePayload`: a `files` key or explicit `attachments` replaces the whole
  attachment set, and `create()` only shallow-copies it*: five statements, and
  the source of the contradiction in §3.2.
- *A frozen denominator; a live count would retroactively tax existing players*:
  seven constants. Home: one table in `park-progression`;
  `NPC_LEVEL_SANITY_CAP` and `SEASON_EPOCH` keep their own reasoning, which a
  table cannot carry.
- *A green suite proves nothing about a seam it cannot observe*: eight
  statements. Home: `test-harness-and-gates`. Each instance keeps its own
  mechanism — why *that* test could pass while proving nothing — and drops the
  shared moral.

Correction history is kept wherever a future reader could plausibly re-derive
the wrong belief, and cut where it is merely history. The reset-marker
correction, which records that the spec's `users.createdAt` mechanism is false
and shipped as dead code, stays.

## 8. The user-level CLAUDE.md

Five rules, project-independent, currently buried in the repo file:

- Never write a derived count into prose; state the grep that produces it.
- A mock must forward every argument, or the test exercises nothing.
- A guard nobody has watched fail is not yet a guard.
- A parameter whose default would silently preserve stale state is required,
  never defaulted.
- Specs are dated records: correct them elsewhere with a "superseded" note,
  never in place.

Two candidates were **rejected** as not portable:
`no-await-between-check-and-write` is sound only because better-sqlite3 is
synchronous, and at user scope becomes actively wrong advice in any async-DB
project; `no-test-fixtures-in-assets` depends on vitest's parallel forks plus
committed assets. Both stay repo-scope.

## 9. Retention

The growth problem is the reason this was needed, so the fix ships with it:

- A shipped feature's post-mortem goes to its **topic doc**, never to
  `CLAUDE.md`. The always-core changes only when a rule becomes cross-cutting.
- `CLAUDE.md`'s line cap is enforced by `tests/conventions.test.ts`. Raising it
  is a deliberate act with a diff, not a drift.
- A new doc is a new entry in the index, a new hook trigger and a new test
  assertion — three visible edits, which is the point.

## 10. What this does not fix

- **Stale same-message component replay** — the class that charged 32x — is
  untouched. It remains queued as separate work.
- **Generated files never fire an edit hook.**
  `unnecessary-recreate-caught-only-by-reading-sql`, whose entire content is
  "the only gate is reading the emitted SQL by eye", is keyed to `drizzle/**`,
  written by drizzle-kit via bash. It never appears at the moment it exists to
  serve. Same for the 244 binaries under `assets/images/**`.
- **Plan-time decisions** — commissioning a face, scoping a chapter, choosing a
  frozen constant — happen while writing a spec, which fires only the three-rule
  `prose-and-specs`. Partially mitigated by moving
  `audit-by-grepping-assetimage` there; not solved.
- **Four rules reach fewer files than the mistake they prevent.**
  `never-emojitag-in-module-constant` reaches 9 of the 19 files that call
  `emojiTag`; the `assetImage` mock rules sit in `art-resolver` while the mistake
  is made in three test files that fire other docs; `no-test-fixtures-in-assets`
  is filed with the asset docs while the mistake is made in a subject test; the
  "do not widen `pageRow`" half fires only when `core/paginate.ts` itself is
  edited, which is exactly how the dex pager shipped broken the first time.
  Recorded rather than hidden; no file-level cut gathers them.

## 11. Verification

- `npm test`, `npm run typecheck`, `npm run build` green.
- `tests/conventions.test.ts` green: zero orphans, zero dead globs, every anchor
  resolves, `CLAUDE.md` under cap, every doc has a trigger.
- Every one of the 335 rules traced to its new home; the audit is a mapping
  table, not a claim. `git` holds the original, so the trace is checkable.
- A real edit in each of five representative files confirms the expected doc
  fires and nothing else does.
- No behaviour change: this touches no `src/` file. `npm run deploy-commands` is
  not needed, no migration is involved, and the bot needs no restart.
