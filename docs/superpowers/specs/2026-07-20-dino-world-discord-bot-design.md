# Dino World Discord Bot — Design Specification

**Date:** 2026-07-20
**Author:** RegEdits-TSC
**Status:** Approved pending final review

## 1. Vision

A fully functional dinosaur park tycoon game played entirely inside Discord,
drawing on Jurassic World Evolution (park management, dino care) and Jurassic
World: The Game (collection, eggs, timers). Players build a park, collect
dinosaurs through eggs and expeditions, care for them, and climb leaderboards.

Primary engineering goal beyond gameplay: **features must be easy to add and
remove**. Every gameplay system is a self-contained module that can be toggled
off without touching the rest of the bot.

## 2. Core Decisions

| Decision | Choice |
|---|---|
| Park ownership | Per-user, global — one park per Discord user, shared across all servers |
| V1 pillars | DNA/eggs + hatching, park building, dino care (battles deferred) |
| Pacing | Idle accrual with caps — resources accrue offline, collected on interaction |
| Language / framework | TypeScript + discord.js v14 |
| Hosting | VPS (single Node process, systemd or pm2) |
| Database | SQLite (WAL) + Drizzle ORM; migration path to Postgres via Drizzle if ever needed |
| Presentation | Hybrid: embed dashboards for frequent actions, rendered PNG park map on demand |
| Building model | Slot/lot system — no coordinate grid; map render auto-arranges |
| Architecture | Modular monolith with module registry; renderer in worker thread |
| Repo | GitHub `RegEdits-TSC`, private initially, public once stable. All commits authored by RegEdits-TSC. |

Explicitly rejected: generic DB cache layer (SQLite is in-process and
microsecond-fast; app-level caching adds staleness risk for no gain). Targeted
caching only: species data in memory at boot, rendered PNGs cached by
park-state hash.

## 3. Game Design

### 3.1 Rarities and roster

Six rarity tiers: **Common, Uncommon, Rare, Epic, Legendary, Mythic**.
Launch roster: **30 species** — Common 8, Uncommon 7, Rare 6, Epic 4,
Legendary 3, Mythic 2 — defined as TypeScript data files
(`src/data/species/*.ts`). Adding a dino means adding a file; no code changes.
Authoring the actual species list (names, diets, biomes, flavor text) is an
implementation-plan task using these per-tier counts.

Species data file fields: `id`, `name`, `rarity`, `diet`
(herbivore | carnivore), `biomeTags` (e.g. forest, coast, tundra, volcanic),
`flavor`, `spriteRef`. There is **no combat/stat system in v1** — income,
care costs, and sell values derive from rarity alone. The hatch reveal card
shows: name, rarity, diet, biome tags, income/hr, flavor text.

Egg artwork per rarity already exists (user-provided: `common.png` …
`mythic.png`) and is the visual centerpiece of the hatch flow.

### 3.2 Acquisition — eggs, gacha, shards

- **Eggs** come from expeditions (core loop) and a rotating shop (cash sink).
- Egg rarity determines the species pool; hatching rolls a species uniformly
  within that rarity — except eggs carrying a preset `species_id` (Mythic
  pity purchases), which hatch that exact species.
- **Shards** are a single generic currency obtained by selling dinos. The
  amount is random, scaled by the sold dino's rarity. Shard gain from sales
  is capped at **40 shards per rolling 24 h** (data-file value) — the "idle
  accrual with caps" pillar applied to the endgame currency. Sales beyond the
  cap still pay cash but yield 0 shards (the sell confirmation shows this
  before committing).
- **Mythics** are obtainable two ways:
  1. **Pity path:** `/mythic` costs 500 shards, requires high-water rating
     ≥ 4★, and grants a **Mythic egg with the chosen species preset**. It
     goes to the egg inventory and incubates normally (48 h).
  2. **Lottery path:** an ultra-rare (0.2%) egg drop from Volcano Core.
  With the 40/day shard cap, the pity path takes ≥ 13 days of maximally
  active play; the intended cadence for engaged players is ~3–4 weeks per
  Mythic.
- No premium currency in v1. The module system leaves a slot open for later.

### 3.3 Economy

**Income (faucet):**

| Rarity | Income/hr (base) | Sell → shards | Incubation | Feed cost (food) |
|---|---|---|---|---|
| Common | 60 | 1–3 | 15 m | 5 |
| Uncommon | 150 | 3–6 | 1 h | 10 |
| Rare | 400 | 8–15 | 4 h | 20 |
| Epic | 1,100 | 20–35 | 12 h | 40 |
| Legendary | 3,000 | 50–80 | 24 h | 80 |
| Mythic | 9,000 | not sellable | 48 h | 160 |

- `rate/hr = Σ dino (base[rarity] × comfort%) × (1 + Σ facility bonuses)`
  (facility bonuses are additive; see 3.8).
- `cap_hours` (8 → 24) is derived at read time from the Visitor Center's
  level — it is not stored on the user.
- Unassigned and escaped dinos earn nothing.

**Accrual model (normative — this is the game-clock pure function):**
income integrates over the elapsed window rather than snapshotting a rate.
Hunger decays linearly and nothing else changes while a player is away, so
per dino the integral reduces to
`mean(comfort at window start, comfort at window end) × base × hours`,
computed piecewise with two truncation events:

- the accrual cap: contribution stops at `cap_hours`;
- a computed escape: if a dino's comfort crosses below 25% and stays there
  past the 8 h grace period, its lot's income halts at that computed moment
  (see 3.4).

Snapshotting at collect time was rejected (over-punishes returning players);
snapshotting at last-collect was rejected (feeding just before collect would
make hunger economically irrelevant).

**Sinks (all values data-file tuning, targets in days-of-income terms):**

| Sink | Initial value | Tuning target |
|---|---|---|
| Shop egg — Common | 500 cash | impulse buy |
| Shop egg — Uncommon | 2,000 | a few hours of early income |
| Shop egg — Rare | 8,000 | ~1 day early-mid income |
| Shop egg — Epic | 30,000 | ~1–2 days mid income |
| Shop egg — Legendary | 120,000 | ~2 days late income (rare stock) |
| Food | 10 cash per unit (bundles 10/50/100) | feeding a dino ≈ 5–10% of its daily income |
| Paddock build | 2,000 | early milestone |
| Facility build / upgrade | see 3.8 table | payback in 2–4 days of the bonus it grants |
| Lot upgrade | ×2.5 per level | mid-game sink |
| Recapture fee | ≈ 4 h of that dino's base income | sting, not spiral |

**Wallets:** cash (income), food (care), shards (Mythic path). All wallet
mutations go through the Economy Service (see §5).

### 3.4 Care

- **Hunger** is stored per dino and drains 100 → 0 over **48 h**, computed
  lazily. Feeding it is the only care action.
- **Feed semantics:** one feed action refills that dino's hunger to 100 and
  costs `feed_cost[rarity]` food units (table in 3.3). `/feed all` feeds
  hungriest-first; each dino is an atomic action; if food runs out mid-batch
  it feeds as many as affordable and reports who was skipped.
- **Comfort is derived, never stored:**
  `comfort = hunger% × paddock_fit`. There is no comfort column; every read
  computes it from hunger and the paddock.
- **Paddock fit** (discrete): `1.0` — paddock diet type matches AND at least
  one decor item matches a species biome tag; `0.75` — diet type matches, no
  matching decor; `0.5` — wrong diet type. Paddock capacity = 2 × level;
  assignment beyond capacity is blocked at the boundary, so overcrowding
  cannot occur.
- **Escape:** comfort < 25% continuously for > 8 h (grace) → the dino is
  marked escaped (`escaped_at`); its lot's income halts from the computed
  escape moment. `/rescue` pays the recapture fee and sets hunger to
  `min(100, 50 / paddock_fit)` — i.e. comfort re-evaluates to ~50% — and
  clears the escape. No permanent loss — punishing, not cruel.

### 3.5 Expeditions

One expedition at a time, and **a new one cannot start until the previous is
claimed** (boundary-validated). Sites are data files, unlocked by high-water
rating:

| Site | Unlock | Duration | Egg odds |
|---|---|---|---|
| Coastal Dig | — | 15 m | C 70 / U 30 |
| Amber Ridge | 1.5★ | 1 h | C 45 / U 40 / R 15 |
| Frozen Cliffs | 2.5★ | 4 h | U 40 / R 40 / E 20 |
| Volcano Core | 4★ | 8 h | R 40 / E 40 / L 19.8 / M 0.2 |

Loot rolls on claim (egg + bonus cash/food). Rolls use injected seeded RNG.
Note: the 40/day shard cap (3.2) is what prevents low-site spam from
out-earning progression on the shard economy.

### 3.6 Hatchery

One incubator slot at start; Hatchery Lab levels grant up to 3. Hatch flow is
a three-beat reveal: egg art + rarity color → "Crack it open!" button + short
suspense edit sequence → species reveal card (fields per 3.1) with a
duplicate-sell shortcut.

### 3.7 Park rating (0–5★)

`rating = 40% collection (species owned, rarity-weighted) + 35% park (lots,
levels, decor) + 25% average comfort`. Recomputed on relevant change and
stored denormalized on `users` for indexed leaderboards.

**Unlocks use a high-water mark:** `rating_high_water` (stored, monotonic)
gates dig sites, lot slots (3 → 8), shop stock ceiling, and the `/mythic`
purchase. A rating drop never revokes content: built lots, in-flight
expeditions, and purchases are unaffected. Live rating is used only for
leaderboards and the trading gate (deliberately a live check).

### 3.8 Building — lots and facilities

Park = expandable list of lots (3 slots → 8 via high-water rating). Each lot
holds a paddock (dinos + decor) or a facility. No spatial coordinates; a
coordinate grid could be added later as a module.

**Paddocks:** diet-typed (herbivore/carnivore), capacity 2 × level, hold
decor items that provide biome-tag matches (fit, 3.4) and park points (3.7).

**Facilities (v1 set — data files, initial numbers):**

| Facility | Levels | Effect per level | Build → max-level upgrade cost |
|---|---|---|---|
| Visitor Center | 1–5 | cap_hours 8/12/16/20/24; +0/5/10/15/20% income | 5,000 → 500,000 |
| Hatchery Lab | 1–3 | incubator slots 1/2/3 | 10,000 → 150,000 |
| Food Court | 1–3 | +4/8/12% income | 8,000 → 200,000 |

Upgrade costs scale ~×2.5 per level; targets: payback in 2–4 days from the
granted bonus. Income bonuses from all facilities are additive in the 3.3
formula.

### 3.9 Shop and trading

- **Shop:** daily rotation of eggs and food bundles; buildings/decor always
  available. Primary cash sink. **Stock ceiling by high-water rating:**
  < 1★ ≤ Uncommon; 1★ ≤ Rare; 2★ ≤ Epic; 3.5★+ Legendary appears in ~10% of
  rotations. Mythic eggs are never sold.
- **Trading:** escrowed offers (dinos, eggs, cash, food; max 5 items per
  side). Pending trades lock listed items. Acceptance re-verifies both
  inventories inside a single transaction, then swaps atomically.
- **Anti-abuse:** rating ≥ 2★ (live) on both sides; max 3 trades/day;
  Mythics untradeable and unsellable. **Traded-in dinos and eggs are flagged
  `via_trade` and sell for 0 shards** (cash only) — combined with the 40/day
  shard cap this closes the alt→main shard funnel; trades move collection,
  not endgame currency.

### 3.10 Social

- **Leaderboards:** `/top rating|cash|collection`, global and per-server.
  Per-server scope comes from the `user_guilds` table: every interaction
  upserts (user, guild, last_seen), so a server's board shows players who
  have used the bot in that server. (Tradeoff, accepted: you appear on a
  server's board only after interacting there. This avoids the privileged
  Guild Members intent entirely.) `users.display_name` is snapshotted on
  interaction so boards render without REST lookups.
- **Park visits:** `/park view @user` and `/park map @user`, read-only.

## 4. Architecture

### 4.1 Modular monolith

Single Node process. Two layers plus data:

**Kernel (`src/core/`)** — no gameplay code:
- Discord client wrapper (discord.js v14, login; default intents only — no
  privileged intents required by this design)
- Interaction router (commands/buttons/modals/autocomplete → owning module;
  also upserts `user_guilds` and `display_name` on every interaction)
- Module registry (reads `modules.json` flags, loads manifests, deploys slash
  commands for enabled modules)
- Scheduler (DB-backed timer queue; fires hatch/expedition events, survives
  restarts via boot scan for overdue timers)
- Economy service (atomic wallet mutations + `tx_log` audit rows)
- Game clock (pure functions: piecewise income integration per 3.3, hunger
  decay, comfort derivation, escape-moment computation)
- Asset manager (egg art, sprites)

**Modules (`src/modules/*`)** — one folder each: `park`, `hatchery`,
`expeditions`, `care`, `shop`, `trading`, `leaderboards`, `renderer`,
`admin`. Each exports a manifest:

```ts
{ name, commands[], components[], onLoad(ctx), onUnload(ctx), migrations[] }
```

Modules receive kernel services via a context object and never import each
other's internals. Disabling a module removes its commands from Discord on
next deploy. Adding battles later = new folder, zero kernel changes.

**Renderer** runs in a worker thread — PNG generation never blocks the
gateway. Renders cached by park-state hash; unchanged park reuses the last
image. Render failure degrades to a text-embed map with a notice; the bot
keeps running.

### 4.2 Time model and notifications

No per-park cron. Income and hunger are computed lazily from timestamps when
the player interacts (idle-game standard). The scheduler only fires discrete
events (egg hatched, expedition returned).

**Notification routing:** timers store `origin_guild_id` — the guild where
the triggering action was issued (null for DMs). Delivery chain: origin
guild's configured notification channel (mentioning the user) → user DM →
mark handled silently. A closed DM (403) is permanent for that delivery — no
retry, fall through to silent.

## 5. Data Model

SQLite via Drizzle. Species/sites/facilities/decor are **data files, not
tables** — the DB stores player state only.

| Table | Purpose / key fields |
|---|---|
| `users` | PK `discord_id`; park name, `display_name` (snapshot), denormalized `park_rating`, `rating_high_water` (monotonic, gates unlocks), wallets (cash/food/shards), `last_collect_at`, shard-cap window fields |
| `dinos` | FK user, nullable FK lot (unassigned earns nothing), `species_id` → data file, nickname, hunger, `escaped_at`, `via_trade`, `locked` (escrow), timestamps. **No comfort column — always derived.** |
| `lots` | FK user; `type` paddock\|facility, `kind` → data file, name, level, `decor` JSON |
| `eggs` | FK user; rarity, nullable preset `species_id` (Mythic pity), source, `via_trade`, `locked`, `obtained_at`, `incubation_started_at` / `hatches_at` (null = in inventory) |
| `expeditions` | FK user; `site_id` → data file, `departed_at`, `returns_at`, `loot` JSON (rolled on claim), `claimed_at` |
| `trades` | from/to user FKs, offer/request JSON, status lifecycle, timestamps; pending trades lock items |
| `tx_log` | FK user; cash/food/shards deltas, reason, timestamp — full economy audit |
| `timers` | kind, FK user, ref id, `origin_guild_id`, `fires_at`, `handled_at` — generic queue, any module enqueues its own kinds |
| `user_guilds` | (user_id, guild_id) PK, `last_seen_at` — upserted on every interaction; powers per-server leaderboards |
| `guild_settings` | PK `guild_id`; notification channel (null = DM only) |

Integrity rules:
- Every currency mutation flows through the Economy Service → one SQLite
  transaction + audit row. Wallets can never go negative (service guard + DB
  CHECK).
- Single process + synchronous better-sqlite3 = serialized writes; races are
  structurally impossible. Idempotent button handling (double-click "Collect"
  → "already collected").

## 6. Commands

Grouped by owning module (~15 top level; module off = commands gone).
Autocomplete on dino/lot names.

- **park:** `/park view|map [@user]`, `/park rename`, `/build`, `/upgrade`,
  `/decorate`, `/dino list|info|assign|nickname`
- **hatchery:** `/eggs`, `/incubate`, `/hatch`, `/mythic` (shard pity shop)
- **expeditions:** `/expedition start|status|claim`
- **care:** `/feed <dino|all>`, `/rescue <dino>`
- **shop:** `/shop`, `/sell dino` (confirm modal; shows shard yield incl.
  cap/via_trade zeroing before committing)
- **trading:** `/trade offer|list|accept|decline|cancel`
- **leaderboards:** `/top rating|cash|collection [scope]`
- **guild config (requires Manage Guild):** `/settings channel`
- **admin (bot owner only):** `/admin give|wipe|module`

Dashboard buttons (Collect, Feed All, Map, Shop, Eggs) edit the original
message in place — no channel spam. Slow paths (render) defer immediately to
respect Discord's 3-second interaction deadline.

## 7. Error Handling

- **Validate at boundaries only:** ownership, funds, capacity, and state
  checks at interaction entry (incl. unclaimed-expedition block, paddock
  capacity, shard-cap disclosure); friendly ephemeral error embeds. Internal
  code trusts validated state — no defensive null piles.
- **Atomicity:** any failure mid-operation rolls back the whole transaction.
- **Crash recovery:** DB-backed timers; boot scan fires overdue events. Lazy
  accrual is downtime-immune by design.
- **Degradation:** renderer failure → text map fallback. Transient Discord
  API errors → retry with backoff; closed DMs are permanent, not retried.
- **Logging:** structured logs (pino) + `tx_log` for economy disputes.

## 8. Testing Strategy

Goal: **everything testable off-Discord; manual Discord testing minimal.**

Design choices that serve this goal:
- Handlers are thin: parse → service call → return reply payload (embeds and
  components as plain data). All game logic lives in services and pure
  functions.
- RNG is injected and seedable — gacha, shard, and loot tests are
  deterministic.
- Test pyramid (vitest):
  1. **Pure functions** — piecewise income integration (incl. mid-window
     escape truncation and cap boundary), hunger decay, comfort/fit, rating,
     gacha/shard/loot rolls; golden path + edges (zero dinos, comfort 0,
     empty park, shard cap hit).
  2. **Services** — in-memory SQLite: economy atomicity, no-negative
     invariant, audit rows, trade escrow/locking + via_trade flagging,
     scheduler boot scan, high-water monotonicity.
  3. **Simulated interaction harness** — fake interaction context drives the
     full pipeline (router → module → DB → reply payload) with zero network.
     Every command and button gets at least one harness test.
  4. **Module lifecycle** — registry loads/unloads modules cleanly; disabled
     module's commands absent.
  5. **Renderer smoke** — render completes; stable output hash for a fixed
     park state.
- Remaining manual surface (per-release smoke checklist in a dev guild, ~5
  minutes): commands visible, egg art displays, button latency feels right.
- CI: GitHub Actions runs vitest on every push (versions pinned to latest
  stable at implementation time).

## 9. Repository & Conventions

- GitHub `RegEdits-TSC`, **private** until stable, then public.
- **All commits authored by RegEdits-TSC** — no other author identities, no
  tool attributions, ever.
- Dependencies pinned to latest stable at implementation time (verified
  upstream, no pre-releases).
- Tests and docs ship in the same change as the behavior they cover.
- Ops: systemd/pm2 on VPS, token in `.env` (with `.env.example`), nightly DB
  file backup.

## 10. Out of Scope (v1) — Future Modules

Battles/arena, quests and dailies, premium currency, coordinate-grid park
layout, hybrid/superhybrid breeding, third-party plugin loading. Each fits
the module system without kernel changes.
