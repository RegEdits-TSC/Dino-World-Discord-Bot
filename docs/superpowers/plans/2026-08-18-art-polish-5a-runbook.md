# Art polish 5a — operator runbook

**Release:** `2026-08-18-art-polish-5a`
**Baseline:** `fd61ebe` on `main` (17 modules, 29 commands, 111 test files / ~1794 tests, 53 custom emoji)
**This branch:** `worktree-art-polish-5a`, 40 commits ahead of `fd61ebe`, working tree clean
**Verification performed:** local gate only (typecheck, full suite, build) and a byte/count audit of every claim below. **No live or irreversible step was run to produce this document** — every command below is written for the operator to run by hand, on the host, after reading it.

---

## What shipped

**No new commands, no new gameplay systems, no migration.** This is an art-and-hardening pass:

- **6 new banners** (`assets/images/banners/`, 1536×1024) closing ten previously-bare surfaces and three that were borrowing another feature's art: `guests`, `season`, `duel`, `dex`, `landmark`, `battles`.
- **6 new attraction art bands** (`assets/images/park/attraction-*.webp`, 270×150) — the park map now draws real art for the six guest attractions instead of a flat fill and a text label.
- **8 hero species portraits** (`assets/images/dinos/<speciesId>.webp`, 1024² transparent cutouts) — the five legendary and three mythic species that used to share three archetype images (a Mythic Indominus rendered as the same red Tyrannosaurus bust as a common bruiser) now get their own art with a rarity rim light, via an optional override (`dinoImage`) that falls back to archetype art when a species file is absent.
- **4 new emoji** (`dw_guest`, `dw_season`, `dw_duel`, `dw_landmark`) — SVG and PNG are committed (53 → 57 on disk); **the live Discord application still has only 53** until an operator runs `deploy-emojis` (step 5 below). `assets/emojis/manifest.json` still has 53 entries as of this writing — confirmed by inspection, not a claim.
- **A 17-module adversarial hardening sweep** found five confirmed defects, all fixed and regression-tested in this branch (see below).

**Test movement:** 111 → 112 test files, ~1794 → 1910 tests. Command count is unchanged at 29 (17 modules).

### The five defects the sweep fixed

The operator should know all five are in this release; the first is the one worth reading twice.

1. **S1 — cross-user authorization hole in `/duel accept`.** `duel:accept:<challengerId>:<defenderId>:<expiresAtMs>` validated the defender and the expiry but never the challenger segment. A player could forge `duel:accept:A:B:<future>` naming **any** other player `A` as the challenger — someone who never posted a challenge, never agreed to anything, and was never notified — and `resolveDuel` would move `A`'s rating anyway, repeatably, by incrementing the expiry to defeat the replay guard. Two fix rounds were needed: round 1 (`450dfa7`) checked `Message#interactionMetadata`, which proves only that the anchoring message came from *some* interaction of the named challenger's, not that they challenged this defender — it was closed for real in round 2 (`450dfa7` follow-up + `cf4aac0`) by checking the message's own button set (`Message#components`) for an exact-match `duel:accept:A:B:<exp>` custom_id, which only a genuine challenge card carries, plus clamping `expiresAtMs` from above so the replay window can't be pushed empty. `docs/superpowers/plans/2026-08-18-sweep-findings.md` (S1) has the full writeup, including the reproduction numbers (a forged accept moved a rating from 1000 to 984 with zero challenges ever posted).
2. **S2 — `park:collect` crashes for a non-player who clicks a public dashboard.** It's the only customId in the codebase with no owner-id segment and the only handler that never calls `getOrCreateUser`; a channel member who has never run a bot command gets a generic "Something went wrong" on every click, forever. Fixed by minting the user row before the read.
3. **S3 — `/admin fast-forward` shifts `lastFedAt` but not `escapedAt`.** An already-escaped dino's stamped escape instant stays fixed while the feeding/collection clock moves back underneath it, letting the next Collect pay for time the dino was shown as escaped — up to 31,640 cash for a park of nine escaped legendaries in the measured scenario. Fixed by shifting `escapedAt` alongside `lastFedAt`.
4. **S4 — the income-cap DM re-arms every 30 days for an idle park.** `pruneAlertRecords`' retention comment assumed every alert kind ages out safely once its window closes, which holds for escape alerts but not `income_cap` — pending income freezes once the cap is hit, so the same DM fires again the moment its 30-day-old record is pruned, forever, for a player who stopped playing. Fixed by exempting `income_cap` records from the prune.
5. **S5 — declining a duel challenge leaves the banner as an orphan attachment.** The decline update sent no `files` and no `attachments` key, so Discord kept the challenge card's `duel.webp` banner attached under a message that no longer had an embed referencing it. Fixed with an explicit `attachments: []` on the decline update, matching the accept path.

Two of the eight sweep classes (transaction atomicity, event-scaled price/cost routing) produced zero findings — recorded as a result, not a gap.

---

## Local verification gate — results

Run in this worktree on 2026-08-18, against `HEAD` (see commit SHA at the bottom):

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`) | **PASS**, no output |
| `npx vitest run` | **PASS** — 112 test files, 1910 tests, 0 failed |
| `npm run build` (`tsc` against `src` only) | **PASS**, no output |
| `git status --porcelain` | empty — nothing uncommitted |

Specifically confirmed inside the suite run:

- `tests/contract.test.ts` — `expect(body).toHaveLength(29)` — **29 commands**, unchanged from baseline. This is the proof `deploy-commands` is unnecessary; see below.
- `tests/registry-load.test.ts` — `ALL_MODULES` has length 17, `r.commands().length` is 29.
- `tests/images.test.ts`, `tests/emoji-assets.test.ts`, `tests/docs-assets.test.ts` — all pass; ran these five files in isolation too (167 tests, 5 files, all green) to confirm none of the counts below are asserted only incidentally by the full-suite run.

### Claim-by-claim audit (as instructed — verified against the tree, not the plan)

| Claim | Verified value | Status |
|---|---|---|
| `tests/contract.test.ts` asserts exactly 29 commands | `expect(body).toHaveLength(29)` at line 52 | **Verified** |
| `assets/images/banners/` holds exactly 32 files | `ls` returns 32 files | **Verified** |
| `docs/assets/prompts.md` banner counts agree | "32 embed banners" appears twice (lines 7, 432) | **Verified** |
| `assets/emojis/svg/` holds exactly 57 | `ls \| wc -l` → 57 | **Verified** |
| `assets/emojis/png/` holds exactly 57 | `ls \| wc -l` → 57 | **Verified** |
| `docs/ops.md` emoji count agrees | "uploads the 57 custom emojis" (line 64), "Seventeen modules ship" section elsewhere unaffected | **Verified** |
| `docs/assets/prompts.md` emoji count agrees | "The 57 application emojis in `assets/emojis/`" (line 2212) | **Verified** |
| `assets/images/dinos/` holds 8 archetype files + 8 species portraits | 16 files total: `bruiser-carnivore/herbivore`, `support-carnivore/herbivore`, `swift-carnivore/herbivore`, `tank-carnivore/herbivore` (8 archetype) + `indominus`, `indoraptor`, `liopleurodon`, `mosasaurus`, `quetzalcoatlus`, `spinoraptor`, `tyrannosaurus`, `ultimasaurus` (8 species) | **Verified** |
| `assets/images/park/` holds the 6 new `attraction-*.webp` bands | `attraction-amber_carousel`, `attraction-gift_shop`, `attraction-grand_atrium`, `attraction-picnic_lawn`, `attraction-sky_gondola`, `attraction-viewing_platform` — all 6 present | **Verified** |
| No file under `drizzle/` changed in this branch — no migration ships | `git diff <merge-base>...HEAD --stat -- drizzle/` returns empty | **Verified**, checked against merge-base `fd61ebe` (= current `origin/main` tip), not just the last commit |

No discrepancy found between what the release claims and what is actually in the tree. Every count above matches exactly.

---

## Operator steps

Do these **in order**, on the deployment host, with your own hands. Nothing in this section was executed to produce this document.

**Why `deploy-commands` is not on this list:** no task in this release changes a command builder. `tests/contract.test.ts` pins the serialized builder body at exactly 29 entries and it is green in the gate above — that is the mechanical proof, not a promise. `HELP_TOPICS` gained `art` on five existing topic values but no new topic **key** (a new key would change `/help`'s own choices and force a redeploy; a new field on an existing value does not). Running `deploy-commands` anyway is not free — it re-PUTs the guild's command set live — so skip it.

**Why assets can never be hot-added, once for all of the ordering below:** `assetImage` (`src/core/images.ts`) caches `existsSync` per path for the process lifetime. A running bot that already resolved a banner's path as missing will never see the file appear without a restart. This is the reason step 8 is mandatory, not advisory, and why it must come after every write below it.

### Step 1 — render the emoji PNGs

```bash
npm run build-emojis
```

Expected: `Rendered 57 emoji PNGs to assets/emojis/png/.` Then run `git status --porcelain assets/emojis/png` and expect **no output** — the four new PNGs were already committed by the branch, so this run is a confirmation that the committed bytes match what the current renderer produces, not a new write.

**Why it sits first:** it must precede step 5 (`deploy-emojis`). `src/deploy-emojis.ts` reads only `assets/emojis/png/`; an SVG that was never rendered simply does not exist to the deployer, and a new emoji whose PNG is missing is silently absent from the upload — no error, no warning.

### Step 2 — confirm the gate (already done above, for reference)

`npm run typecheck`, `npx vitest run`, `npm run build` — all green, reported above. Nothing to re-run here unless the host's checkout differs from this worktree.

**Why it sits here in the design's own step list:** art, PNGs, banner call sites, and the updated doc counts all had to land in the **same commit set** — `tests/docs-assets.test.ts` scrapes the emoji and banner counts out of `docs/ops.md` and `docs/assets/prompts.md` and asserts them against the number of files actually committed. A commit that added a banner without touching the doc count would be red, and so would the reverse. This branch's history already satisfies that; there is nothing further to commit at this step.

### Step 3 — merge, pull on the host, rebuild there

```bash
# on the host
git pull
npm ci && npm run build
```

Expected: clean install, clean `tsc`.

**Why it sits here:** the bot runs compiled `dist/`, so the host needs its own build — assets themselves are never compiled or copied, every path resolves from the process working directory at runtime (which is why the systemd unit sets `WorkingDirectory` to the repo root). A new banner forces a `src` change regardless (the orphan check in `tests/images.test.ts` demands a call site for every committed banner), and the new `ParkArt` attraction family certainly does, so there is always something for this build to compile.

### Step 4 — back up the database

Back up the live DB per standing practice — the SQLite online-backup command, never a raw file copy out from under a running process:

```bash
sqlite3 /opt/dino-world/dino-world.db ".backup '/opt/dino-world/backups/dino-$(date +%F)-pre-art-polish-5a.db'"
```

**Why it sits here:** before the first irreversible write (step 5) and before the restart (step 8), and after the host build so a failed build never even reaches this point. **This release ships no migration** — verified above against the merge-base diff, not just the last commit — so there is no schema change riding along with this backup. If a future release's sweep ever forces a migration, that finding is named its own release gate per this project's standing convention, and this backup step becomes the one that matters most; it is not that convention here.

### Step 5 — deploy the emoji — THE ONE IRREVERSIBLE STEP

```bash
npm run deploy-emojis
```

Expected: `Emojis synced: 4 created, 0 replaced, 53 unchanged (57 local).`

**⚠️ This is the single irreversible live write in this entire release.** `assets/emojis/manifest.json` hashes the exact PNG bytes of each uploaded emoji, so a rerun only touches what actually changed — which is what makes the `53 unchanged` half of the expected line the important half, not the `4 created` half. **If you see any non-zero `replaced` count, stop immediately** — it means existing emoji were deleted and recreated with new snowflake ids, and every message already posted with an old `<:dw_cash:ID>`-style tag now renders as a broken emoji, silently, with no way back. Work out which PNG bytes moved before touching anything else.

### Step 6 — commit `manifest.json` immediately

```bash
git add assets/emojis/manifest.json
git commit -m "Record the emoji manifest after deploying the four new icons"
git push
```

**Why "immediately" is literal, not just "soon":** the manifest is written in a `finally` block in `src/deploy-emojis.ts`, so it exists on disk even after a partial or outright failed run — commit it **even then**. A partial run's manifest is the only record of which emoji already made it to Discord. If the manifest is lost before it's committed, the next `deploy-emojis` run sees every one of the 57 hashes as "changed" and deletes-and-recreates all of them with new snowflake ids — invalidating every emoji in every message ever posted, silently, with no way to recover it by rerunning anything.

This is the only file this release changes outside the branch itself, and it's changed by a tool (`deploy-emojis`), never by hand.

### Step 7 — restart the bot

```bash
sudo systemctl restart dino-world
```

Expected log line: **`Loaded 57 application emojis`** — check this specific line, not `Logged in as …`, which only proves the gateway connected and says nothing about whether the new emoji ids or the new art are actually loaded.

**Why this restart is mandatory — three independent reasons, any one of which alone would require it:**

1. The park worker preloads its rasters once at boot — the six new attraction bands and the underlying ground art are only picked up by a fresh worker.
2. `assetImage` caches per-path `existsSync` results for the process lifetime — a process that already resolved a new banner's path as missing before this deploy will never see it appear.
3. The emoji map is fetched once at `ClientReady` — a process still running from before step 5 keeps the old 53-emoji map even though Discord now has 57.

Run **exactly one** bot process per token. Duplicate instances race each other and produce a `10062` (interaction failed) on every command — that reads like a code bug in this release and is not one; see the standing note on single-instance operation.

### Step 8 — `test:live` — LAST, not earlier

```bash
npm run test:live
```

Expected: `~59 ok, 0 failed. Cosmetic review: check <#TEST_CHANNEL_ID> in the dev guild.`

Needs all six of these set in `.env` — the script exits 1 naming the first one that's missing:

```
DISCORD_TOKEN
DISCORD_CLIENT_ID
DATABASE_PATH
OWNER_ID
DEV_GUILD_ID
TEST_CHANNEL_ID
```

**Why it must run last and not any earlier:** it parity-asserts `assets/emojis/manifest.json` against the *live* Discord application-emoji list. Run it before step 5 and every one of the four new emoji reports as `manifest emoji 'dw_guest' missing on Discord` — a failure that means only "you ran this too early," not a real defect. It's REST-only (never calls `client.login`), so it's safe to run against a live bot process — but it does re-PUT the dev guild's command set with every module forced on, making it that guild's last command writer; anything that wants a different command set there has to run after it, not before.

**This is the acceptance check for the whole release, and the only place a human eye lands on the new art.** Roughly 59 cases post their real embeds, components and attachments to `TEST_CHANNEL_ID`. Walk the channel and specifically confirm:

- Each of the six new banners renders **on its own embed**, not as a bare attachment card underneath one.
- The six attraction bands **read against the lot plates** on the park map rather than fighting them for attention — this was called out as a real risk in the design (the map already carried one art band; this takes it to seven).
- All eight hero portraits show their rarity rim light as a **hard specular edge**, with **no halo and no clipped glow**. A degraded portrait is worse than the shared archetype art it replaced — and the recovery is a no-code-change one: deleting the file restores the previous fallback behavior exactly, because the null-art path was preserved on purpose.

### Step 9 — confirm the release is closed

```bash
git status --porcelain   # expect empty — manifest.json was committed in step 6
git log --oneline -5     # expect the manifest commit at HEAD, on the merged branch, pushed
```

No further operator steps after this. `deploy-commands` was not run and was not needed (see the note above step 1). `deploy-branding` is unrelated to this release — nothing under `assets/branding/` changed — and is not run.

---

## Quick-reference: ordering constraints in one place

| Order | Step | Must come after | Because |
|---|---|---|---|
| 1 | `build-emojis` | — | must precede `deploy-emojis`, which reads only the rendered PNGs |
| 2 | Verify gate (already done) | step 1 | art + PNGs + doc counts must land in one commit set, `tests/docs-assets.test.ts` enforces it |
| 3 | Host `git pull && npm ci && npm run build` | merge | bot runs compiled `dist/`, never source |
| 4 | DB backup | host build succeeds | before the one irreversible write; after a build that could have failed |
| 5 | `deploy-emojis` ⚠️ irreversible | backup | the only live, non-idempotent-on-failure write in this release |
| 6 | Commit `manifest.json` | deploy-emojis, even on partial failure | it's written in a `finally`; losing it makes all 57 emoji look changed next run |
| 7 | Restart bot | manifest committed | assets, park rasters, and the emoji map all load once at boot/ready and never hot-reload |
| 8 | `test:live` | restart | parity-asserts the manifest against the live emoji list; also the only human visual check |
| 9 | Confirm clean | test:live | closes the release |

---

## Confirmation

No live or irreversible step was run in the course of producing this runbook or the verification above: `deploy-emojis`, `deploy-commands`, `deploy-branding`, `test:live`, `build-emojis`, any bot start/stop/restart, any push/PR/merge, and anything touching the live database were all left for the operator, exactly as scoped. The only commands executed were `npm run typecheck`, `npx vitest run`, `npm run build`, and read-only `git`/`ls`/`grep`/`node -e` inspection of the working tree.
