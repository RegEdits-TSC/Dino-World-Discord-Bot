# Diet-based food types — design

Date: 2026-07-24
Status: approved pending final review

## Goal

Replace the single generic `food` resource with diet-matched food items so
carnivores and herbivores eat different things, make carnivore food slightly
more expensive, surface the (currently silent) wrong-diet paddock penalty with
a warn-and-confirm flow, and hard-block feeding food that does not match a
dino's diet. Each item gets shop art (custom emoji) plus a shop banner image.

## Decisions (from brainstorm)

- Multiple named items per diet, differentiated by **quality tiers**.
- Higher tier perk = **lasts longer** (overfills hunger past 100).
- Wrong-diet paddock assignment = **warn + confirm buttons**, not a hard block.
- Wrong-diet feeding = **hard block** (service-level, not just UI).
- Existing generic food stock = **cash refund** at the old 10/unit price.
- `/feed` gets an optional `food` option (diet-filtered autocomplete);
  omitted → auto-pick cheapest owned matching item. `/feedall` always
  auto-cheapest per dino.
- Storage = data-driven catalog + normalized inventory table (approach A).
- Food stays tradeable, typed per item.
- Art = 6 per-item custom emojis **and** one shop food-market banner.

## 1. Food catalog

New `src/data/foods.ts`, same data-driven pattern as paddocks/decor:

| id | name | diet | tier | unitCost | fillTo |
|---|---|---|---|---|---|
| `ferns` | Ferns | herbivore | 1 | 10 | 100 |
| `fruit_basket` | Fruit Basket | herbivore | 2 | 15 | 125 |
| `royal_greens` | Royal Greens | herbivore | 3 | 20 | 150 |
| `fish` | Fish | carnivore | 1 | 12 | 100 |
| `goat` | Goat | carnivore | 2 | 18 | 125 |
| `prime_steak` | Prime Steak | carnivore | 3 | 24 | 150 |

- Carnivore = +20% over the herbivore item of the same tier.
- Tier-1 herbivore price equals the old generic `FOOD_UNIT_COST` (10), so the
  baseline economy is unchanged.
- `fillTo` 125 → ~60 h before empty (drain unchanged at 100/48 h); 150 → 72 h.
- Per-unit value is intentionally slightly worse each tier up (e.g. tier 2 fair
  value 12.5, charged 15): premium buys convenience and escape safety, not raw
  efficiency, so tier 1 stays relevant.
- Feeding still consumes `RARITY[rarity].feedCost` **units** of whichever item
  is used; rarity cost scaling is untouched.
- `FoodDef` shape: `{ id, name, diet, tier, unitCost, fillTo, emoji, fallback }`
  (emoji = app-emoji name, fallback = unicode).

## 2. Schema, economy, migration

### Schema

- New `food_inventory` table: `(user_id text, food_id text, qty int)`,
  PK `(user_id, food_id)`, CHECK `qty >= 0`. Rows created lazily on first
  acquire.
- `users.food` column dropped (and its CHECK).
- `tx_log` gains nullable `food_id` text; `food_delta` now means units of that
  item.
- `TradeSide.food: number` → `foods: Partial<Record<FoodId, number>>`
  (JSON-column shape change only, no DDL).
- Expedition `loot.food: number` → `{ foodId, qty }`: tier-1 item, diet chosen
  50/50 via `ctx.rng()`.

### Economy

- `WalletDelta` gains `foods?: Partial<Record<FoodId, number>>`.
- `EconomyService.apply` upserts inventory rows inside the same transaction,
  throws `InsufficientFundsError('food')` (carrying the item name for the
  user-facing message) when any item would go negative, and writes one ledger
  row per touched food item. Cash/shards path untouched.

### One-time migration (scripted, before the column drop)

1. Per user: `cash += food * 10`, ledger row `food-refund:migration`.
2. Pending trades: rewrite both sides `cash += food * 10`, remove the `food`
   key. Trades stay open; nothing to unlock (food was never escrowed).
3. Unclaimed expedition loot: same conversion, `food * 10` added to loot cash.

Single-process synchronous sqlite → no concurrency concerns; runs as a scripted
data migration in the existing drizzle push flow.

## 3. Feeding flow

### `/feed dino [food]`

- New optional `food` option. Autocomplete is filtered to the target dino's
  diet and uses plain-text labels (`Fish ×40 — fills 100`) — no custom emoji
  tags in autocomplete labels (repo rule; Discord renders them literally).
  Provider follows the existing contract: read-only, `i.respond` only.
- Omitted → auto-pick the cheapest owned matching item with
  `qty >= feedCost`.
- Explicit wrong-diet value (typed raw, bypassing autocomplete) → hard block in
  `feedDino`: `CareError` — "Rexy is a carnivore — she won't eat Ferns."
  Validation lives in the service, not just the UI.
- No matching food owned → `CareError` naming what to buy.
- Effect: consume `feedCost` units of the item, set `hunger = item.fillTo`,
  `lastFedAt = now`.

### `/feedall`

Per dino: cheapest-tier owned matching item, hungriest-first order (unchanged),
skip when none affordable. Summary embed shows spend per item.

### Clock changes (overfill)

- `comfortAt` clamps the hunger term: `min(hungerAt/100, 1) * fit`. An
  overfilled dino sits at full comfort until hunger drains back under 100.
- `accruedIncome` mean-comfort trapezoid becomes piecewise: split at the
  instant hunger crosses 100 (flat segment at `fit`, then linear). A plain
  two-point mean is wrong across that crossing — regression test required.
- Escape math (`comfortCrossing`) already handles `hungerAtFed > 100`
  correctly; no change.

## 4. Habitat warn + confirm

- `assignDino` gains a diet precheck: species diet ≠ paddock diet throws new
  `DietMismatchError` (carrying species and paddock names) unless called with
  `allowMismatch: true`. `DietMismatchError` is control flow for the confirm
  UI, not a failure.
- The `/assign` command catches it and replies with a warning embed —
  "⚠️ Velociraptor is a carnivore — Herbivore Paddock halves comfort: earns
  less, escapes sooner." — plus Confirm/Cancel buttons (60 s collector).
  Confirm re-calls with `allowMismatch: true`; cancel/timeout leaves the dino
  where it was.
- Buttons use unicode emoji only (`setEmoji` rejects empty rarity tags — the
  known hazard stays away).
- Existing silent penalty surfaced everywhere: `/dinos` list and the park embed
  mark mismatched dinos with ⚠️.

## 5. Surfaces

- **Shop**: Food Market section, two diet groups, each line
  `emoji name — cost/unit, fills N`. Banner
  `assets/images/shop_food_market.png` via `assetImage` (null-degrade);
  generation prompt added to `docs/assets/prompts.md`. Purchase command takes
  a `food` item option (autocomplete, plain labels with owned qty) + `amount`
  int; bundle quick-picks 10/50/100 stay.
- **Trading**: offer builder takes item + qty per food entry; each distinct
  food stack counts as 1 item toward `TRADE_MAX_ITEMS_PER_SIDE`. `verifySide`
  checks `food_inventory` per item. Trade embeds render food with emoji tags.
- **Expeditions**: claim embed shows the typed loot item with emoji tag + qty.
- **Balance/park UI**: food line becomes an owned-items list grouped by diet
  (nonzero only; "none" when empty).
- **Help**: `/help` text updated for feed/shop/trade changes.

## 6. Art

- 6 hand-authored SVGs:
  `assets/emojis/svg/dw_{ferns,fruit_basket,royal_greens,fish,goat,prime_steak}.svg`,
  rendered by the existing `build-emojis` pipeline (ellipse-gradient
  `userSpaceOnUse` gotcha and the ≤2% pure-black guard both apply), deployed by
  `deploy-emojis` (manifest tracks hashes).
- Unicode fallbacks: 🌿 ferns, 🍎 fruit basket, 🥬 royal greens, 🐟 fish,
  🍖 goat, 🥩 prime steak. Runtime lookup via `emojiTag`; never a module-level
  constant.
- Shop banner generated on Higgsfield (`docs/assets/prompts.md` prompt); a
  missing file renders the embed without art, never an error.
- Ship order: `build-emojis` → `deploy-emojis` → `deploy-commands` (builders
  change) — exactly one bot instance running.

## 7. Error handling

All existing degrade patterns hold: `CareError`/`ShopError`/`TradeError` are
user-facing messages; `InsufficientFundsError` names the food item; missing
emoji → unicode fallback; missing banner → embed without image; autocomplete
router errors → empty suggestion list.

## 8. Testing

- Catalog invariants: 6 items, +20% carnivore premium per tier, cost and fill
  monotonically increasing per tier within a diet.
- Clock: comfort clamped at `fit` while hunger > 100; `accruedIncome`
  piecewise across the 100-crossing (regression test a plain trapezoid fails);
  escape timing with overfill.
- Care: fillTo applied, units consumed, wrong-diet hard block, auto-cheapest
  pick, no-matching-food error; feedall over a mixed-diet park including the
  skip path.
- Economy: foods delta upsert, negative rejected, ledger rows carry `food_id`.
- Migration: refund math + ledger entry, pending-trade side rewrite, unclaimed
  loot conversion.
- Trading: per-item verify, accept nets to zero per item, food stacks count
  toward the item cap.
- Assign: mismatch throws without `allowMismatch`, succeeds with it; matched
  diet unaffected.
- Emoji PNG guard picks up the 6 new assets automatically.

## 9. Docs

README food section; repo CLAUDE.md note on the fillTo > 100 comfort-clamp
invariant; banner prompt in `docs/assets/prompts.md`.

## Out of scope

- Species-level food preferences (favorite foods) — possible later layer on
  the same catalog.
- Per-food emoji in autocomplete labels (Discord limitation).
- Battles, better-sqlite3 major bump (tracked separately).
