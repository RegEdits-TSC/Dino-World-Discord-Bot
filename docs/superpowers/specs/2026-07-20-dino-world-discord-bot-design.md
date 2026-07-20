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
Launch roster: **25–30 species** across the six tiers, defined as TypeScript
data files (`src/data/species/*.ts`) — stats, rarity, biome tags, flavor text.
Adding a dino means adding a file; no code changes.

Egg artwork per rarity already exists (user-provided: `common.png` …
`mythic.png`) and is the visual centerpiece of the hatch flow.

### 3.2 Acquisition — eggs, gacha, shards

- **Eggs** come from expeditions (core loop) and a rotating shop (cash sink).
- Egg rarity determines the species pool; hatching rolls a species uniformly
  within that rarity.
- **Shards** are a single generic currency obtained by selling dinos. The
  amount is random, scaled by the sold dino's rarity.
- **Mythics** are obtainable two ways: a 500-shard purchase (deterministic
  pity path, player picks the species) or an ultra-rare (~0.2%) egg drop from
  the top expedition site.
- No premium currency in v1. The module system leaves a slot open for later.

### 3.3 Economy numbers (initial tuning — all values in data files)

| Rarity | Income/hr (base) | Sell → shards | Incubation |
|---|---|---|---|
| Common | 60 | 1–3 | 15 m |
| Uncommon | 150 | 3–6 | 1 h |
| Rare | 400 | 8–15 | 4 h |
| Epic | 1,100 | 20–35 | 12 h |
| Legendary | 3,000 | 50–80 | 24 h |
| Mythic | 9,000 | not sellable | 48 h |

- `income rate/hr = Σ dino (base[rarity] × comfort%) × (1 + facility bonuses)`
- `collect = rate × min(elapsed, cap_hours)`; `cap_hours` 8 → 24 via Visitor
  Center levels. Unassigned dinos earn nothing.
- Wallets: **cash** (income), **food** (care), **shards** (Mythic path).

### 3.4 Care

- Hunger drains 100 → 0 over **48 h** idle. Feeding consumes food units
  (cost scales with rarity).
- `comfort = hunger% × paddock_fit`; fit driven by paddock type and decor
  matching species biome tags (max 1.0, wrong/crowded 0.5).
- Comfort < 25% for > 8 h (grace period) → **escape**: that lot's income
  halts, recapture fee scaled by rarity, comfort resets to 50%. No permanent
  loss — punishing, not cruel.

### 3.5 Expeditions

One concurrent expedition per player. Sites are data files, unlocked by park
rating:

| Site | Unlock | Duration | Egg odds |
|---|---|---|---|
| Coastal Dig | — | 15 m | C 70 / U 30 |
| Amber Ridge | 1.5★ | 1 h | C 45 / U 40 / R 15 |
| Frozen Cliffs | 2.5★ | 4 h | U 40 / R 40 / E 20 |
| Volcano Core | 4★ | 8 h | R 40 / E 40 / L 19.8 / M 0.2 |

Loot rolls on claim (egg + bonus cash/food). Rolls use injected seeded RNG.

### 3.6 Hatchery

One incubator slot at start; facility upgrade grants up to 3. Hatch flow is a
three-beat reveal: egg art + rarity color → "Crack it open!" button + short
suspense edit sequence → species reveal card with stats and a duplicate-sell
shortcut.

### 3.7 Park rating (0–5★)

`rating = 40% collection (species owned, rarity-weighted) + 35% park (lots,
levels, decor) + 25% average comfort`. Recomputed on relevant change, stored
denormalized on `users` for indexed leaderboards. Rating gates dig sites, lot
slots (3 → 8), and shop tiers.

### 3.8 Building — slot/lot system

Park = expandable list of lots. Each lot holds a paddock (dinos + decor) or a
facility (visitor center, hatchery upgrades, etc.). Lots level up. No spatial
coordinates; a coordinate grid could be added later as a module if ever
wanted.

### 3.9 Shop and trading

- **Shop:** daily rotation — eggs (≤ Epic; occasional Legendary), food
  bundles; buildings/decor always available. Primary cash sink.
- **Trading:** escrowed offers (dinos, eggs, cash, food on both sides).
  Pending trades lock listed items. Acceptance re-verifies both inventories
  inside a single transaction, then swaps atomically.
- **Anti-abuse:** rating ≥ 2★ on both sides, max 3 trades/day, Mythics
  untradeable (and unsellable) so the endgame can't be alt-funneled.

### 3.10 Social

- **Leaderboards:** `/top rating|cash|collection`, global and per-server.
- **Park visits:** `/park view @user` and `/park map @user`, read-only.

## 4. Architecture

### 4.1 Modular monolith

Single Node process. Two layers plus data:

**Kernel (`src/core/`)** — no gameplay code:
- Discord client wrapper (discord.js v14, login, intents)
- Interaction router (commands/buttons/modals/autocomplete → owning module)
- Module registry (reads `modules.json` flags, loads manifests, deploys slash
  commands for enabled modules)
- Scheduler (DB-backed timer queue; fires hatch/expedition events, survives
  restarts via boot scan for overdue timers)
- Economy service (atomic wallet mutations + `tx_log` audit rows)
- Game clock (pure lazy-accrual math: elapsed → income/hunger with caps)
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

### 4.2 Time model

No per-park cron. Income and hunger are computed lazily from timestamps when
the player interacts (idle-game standard). The scheduler only fires discrete
events (egg hatched, expedition returned → DM or configured guild channel).

## 5. Data Model

SQLite via Drizzle. Species/sites/buildings/decorations are **data files, not
tables** — the DB stores player state only.

| Table | Purpose / key fields |
|---|---|
| `users` | PK `discord_id`; park name, denormalized `park_rating`, wallets (cash/food/shards), `cash_cap`, `last_collect_at`, `last_care_tick_at` |
| `dinos` | FK user, nullable FK lot (unassigned earns nothing), `species_id` → data file, nickname, hunger, comfort, `locked` (trade escrow), timestamps |
| `lots` | FK user; `type` paddock\|facility, `kind` → data file, name, level, `decor` JSON |
| `eggs` | FK user; rarity, source, `locked`, `obtained_at`, `incubation_started_at` / `hatches_at` (null = in inventory) |
| `expeditions` | FK user; `site_id` → data file, `departed_at`, `returns_at`, `loot` JSON (rolled on claim), `claimed_at` |
| `trades` | from/to user FKs, offer/request JSON, status lifecycle, timestamps; pending trades lock items |
| `tx_log` | FK user; cash/food/shards deltas, reason, timestamp — full economy audit |
| `timers` | kind, FK user, ref id, `fires_at`, `handled_at` — generic queue, any module enqueues its own kinds |
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
- **hatchery:** `/eggs`, `/incubate`, `/hatch`, `/mythic` (shard shop)
- **expeditions:** `/expedition start|status|claim`
- **care:** `/feed <dino|all>`, `/rescue <dino>`
- **shop:** `/shop`, `/sell dino` (confirm modal)
- **trading:** `/trade offer|list|accept|decline|cancel`
- **leaderboards:** `/top rating|cash|collection`
- **admin (owner only):** `/admin give|wipe|module`, `/settings channel`

Dashboard buttons (Collect, Feed All, Map, Shop, Eggs) edit the original
message in place — no channel spam. Slow paths (render) defer immediately to
respect Discord's 3-second interaction deadline.

## 7. Error Handling

- **Validate at boundaries only:** ownership, funds, and state checks at
  interaction entry; friendly ephemeral error embeds. Internal code trusts
  validated state — no defensive null piles.
- **Atomicity:** any failure mid-operation rolls back the whole transaction.
- **Crash recovery:** DB-backed timers; boot scan fires overdue events. Lazy
  accrual is downtime-immune by design.
- **Degradation:** renderer failure → text map fallback. Transient Discord
  API errors → retry with backoff.
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
  1. **Pure functions** — income, decay, rating, gacha/shard/loot rolls;
     golden path + edges (zero dinos, cap boundary, comfort 0, empty park).
  2. **Services** — in-memory SQLite: economy atomicity, no-negative
     invariant, audit rows, trade escrow/locking, scheduler boot scan.
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
