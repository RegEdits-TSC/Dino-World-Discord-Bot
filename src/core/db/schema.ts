import { sqliteTable, text, integer, primaryKey, check, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { DUEL_START_RATING } from '../../data/battle/constants.js';

export const users = sqliteTable('users', {
  discordId: text('discord_id').primaryKey(),
  displayName: text('display_name').notNull().default(''),
  parkName: text('park_name').notNull().default("New Park"),
  parkRating: integer('park_rating').notNull().default(0),
  ratingHighWater: integer('rating_high_water').notNull().default(0),
  cash: integer('cash').notNull().default(500),
  shards: integer('shards').notNull().default(0),
  shardsWindowStart: integer('shards_window_start_ms').notNull().default(0),
  shardsWindowEarned: integer('shards_window_earned').notNull().default(0),
  energy: integer('energy').notNull().default(10),
  energyUpdatedAt: integer('energy_updated_at_ms').notNull().default(0),
  questStreak: integer('quest_streak').notNull().default(0),
  questStreakBest: integer('quest_streak_best').notNull().default(0),
  lastQuestClaimAt: integer('last_quest_claim_at_ms').notNull().default(0),
  // Gates the two proactive alerts (escape, income cap) AND duel results — the three
  // completion notifications stay unconditional: those were asked for by starting the
  // hatch, the breeding, the expedition. A duel result is unrequested and arrives
  // because someone else acted, which is exactly what this flag is for. adminReset
  // deliberately does not restore this — see the comment in admin/service.ts.
  alertsEnabled: integer('alerts_enabled', { mode: 'boolean' }).notNull().default(true),
  // Cosmetic prestige ladder (src/data/landmarks.ts). Deliberately read by NOTHING in
  // rating.ts, clock.ts, lotSlots or matchedKindCount: the sink's power-freedom is
  // structural rather than a filter someone has to remember. Monotone — only the next
  // tier is ever purchasable — which is also what removes the refund question.
  landmarkTier: integer('landmark_tier').notNull().default(0),
  // The showcase a visitor sees on your park card. `motto` is free text; mention
  // injection is already dead because src/index.ts sets allowedMentions: { parse: [] }
  // client-wide, the same shield /park rename relies on — do not add a second
  // sanitiser here, it would only be a second thing to keep in sync.
  motto: text('motto').notNull().default(''),
  // Deliberately NO foreign key to dinos.id: a featured dino can be sold, traded away
  // or reset, and a dangling reference must resolve to "no feature" rather than error.
  // Same reasoning as breedings.parentA/parentB. Resolution happens at read time in
  // src/modules/park/showcase.ts; nothing sweeps this column.
  featuredDinoId: integer('featured_dino_id'),
  // Elo, the ONE thing spec 3b stores that cannot be derived: it is order-dependent,
  // so replaying the duels log cannot rebuild it. A plain integer, never ×100 like
  // parkRating. Deliberately no CHECK constraint — see src/data/battle/elo.ts.
  duelRating: integer('duel_rating').notNull().default(DUEL_START_RATING),
  // The squad this player fields in duels, or [] to fall back to their top 3 by level.
  // No foreign key, same reasoning as featuredDinoId above: a listed dino can be sold,
  // traded away or reset, and a dangling id must resolve to "not in my squad" rather
  // than error. duelSquad() filters at read time; nothing sweeps this column.
  duelSquad: text('duel_squad', { mode: 'json' }).$type<number[]>().notNull().default([]),
  lastCollectAt: integer('last_collect_at_ms').notNull(),
  createdAt: integer('created_at_ms').notNull(),
}, (t) => [
  check('cash_nonneg', sql`${t.cash} >= 0`),
  check('shards_nonneg', sql`${t.shards} >= 0`),
  check('energy_nonneg', sql`${t.energy} >= 0`),
]);

export const foodInventory = sqliteTable('food_inventory', {
  userId: text('user_id').notNull().references(() => users.discordId),
  foodId: text('food_id').notNull(),
  qty: integer('qty').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.userId, t.foodId] }),
  check('food_qty_nonneg', sql`${t.qty} >= 0`),
]);

export const lots = sqliteTable('lots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  type: text('type', { enum: ['paddock', 'facility'] }).notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  level: integer('level').notNull().default(1),
  decor: text('decor', { mode: 'json' }).$type<string[]>().notNull().default([]),
});

export const dinos = sqliteTable('dinos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  lotId: integer('lot_id').references(() => lots.id),
  speciesId: text('species_id').notNull(),
  nickname: text('nickname'),
  hunger: integer('hunger').notNull().default(100),
  lastFedAt: integer('last_fed_at_ms').notNull(),
  escapedAt: integer('escaped_at_ms'),
  viaTrade: integer('via_trade', { mode: 'boolean' }).notNull().default(false),
  battleXp: integer('battle_xp').notNull().default(0),
  traits: text('traits', { mode: 'json' }).$type<string[]>().notNull().default([]),
  hatchedAt: integer('hatched_at_ms').notNull(),
});

export const eggs = sqliteTable('eggs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  rarity: text('rarity', { enum: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] }).notNull(),
  speciesId: text('species_id'),
  source: text('source', { enum: ['expedition', 'shop', 'trade', 'admin', 'battle', 'breeding', 'quest'] }).notNull(),
  viaTrade: integer('via_trade', { mode: 'boolean' }).notNull().default(false),
  // Bred eggs carry their rolled inheritance here; wild eggs stay [] and roll at hatch.
  // An empty array on a BRED egg is a real result (25% under BRED_SLOT_ODDS), not "unset",
  // so hatchEgg discriminates on `source`, never on this array's length.
  traits: text('traits', { mode: 'json' }).$type<string[]>().notNull().default([]),
  obtainedAt: integer('obtained_at_ms').notNull(),
  incubationStartedAt: integer('incubation_started_at_ms'),
  hatchesAt: integer('hatches_at_ms'),
});

export const battleProgress = sqliteTable('battle_progress', {
  userId: text('user_id').notNull().references(() => users.discordId),
  stageId: text('stage_id').notNull(),
  stars: integer('stars').notNull().default(0),
  firstClearedAt: integer('first_cleared_at_ms'),
  attempts: integer('attempts').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.userId, t.stageId] }),
  check('stars_range', sql`${t.stars} >= 0 AND ${t.stars} <= 3`),
]);

// parentA/parentB deliberately carry NO foreign key to dinos.id: a claimed row is
// history, and the dino it names may later be sold. While a breeding is pending its
// parents are locked (src/core/locks.ts), so they cannot vanish mid-flight.
export const breedings = sqliteTable('breedings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  parentA: integer('parent_a').notNull(),
  parentB: integer('parent_b').notNull(),
  rarity: text('rarity', { enum: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] }).notNull(),
  speciesId: text('species_id'),
  traits: text('traits', { mode: 'json' }).$type<string[]>().notNull().default([]),
  viaTrade: integer('via_trade', { mode: 'boolean' }).notNull().default(false),
  startedAt: integer('started_at_ms').notNull(),
  readyAt: integer('ready_at_ms').notNull(),
  claimedAt: integer('claimed_at_ms'),
});

export const expeditions = sqliteTable('expeditions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  siteId: text('site_id').notNull(),
  departedAt: integer('departed_at_ms').notNull(),
  returnsAt: integer('returns_at_ms').notNull(),
  loot: text('loot', { mode: 'json' })
    .$type<{ eggRarity: string; cash: number; food: { foodId: string; qty: number } } | null>(),
  claimedAt: integer('claimed_at_ms'),
});

export interface TradeSide { dinoIds: number[]; eggIds: number[]; cash: number; foods: Record<string, number> }

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fromUser: text('from_user').notNull().references(() => users.discordId),
  toUser: text('to_user').notNull().references(() => users.discordId),
  offer: text('offer', { mode: 'json' }).$type<TradeSide>().notNull(),
  request: text('request', { mode: 'json' }).$type<TradeSide>().notNull(),
  status: text('status', { enum: ['pending', 'accepted', 'declined', 'cancelled', 'expired'] }).notNull().default('pending'),
  createdAt: integer('created_at_ms').notNull(),
  resolvedAt: integer('resolved_at_ms'),
});

export const txLog = sqliteTable('tx_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  cashDelta: integer('cash_delta').notNull().default(0),
  foodDelta: integer('food_delta').notNull().default(0),
  foodId: text('food_id'),
  shardsDelta: integer('shards_delta').notNull().default(0),
  reason: text('reason').notNull(),
  createdAt: integer('created_at_ms').notNull(),
});

export const timers = sqliteTable('timers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  userId: text('user_id').notNull(),
  refId: integer('ref_id').notNull(),
  originGuildId: text('origin_guild_id'),
  firesAt: integer('fires_at_ms').notNull(),
  handledAt: integer('handled_at_ms'),
});

export const userGuilds = sqliteTable('user_guilds', {
  userId: text('user_id').notNull(),
  guildId: text('guild_id').notNull(),
  lastSeenAt: integer('last_seen_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.guildId] })]);

export const guildSettings = sqliteTable('guild_settings', {
  guildId: text('guild_id').primaryKey(),
  notifyChannelId: text('notify_channel_id'),
  // Off by default: a server that set a channel for hatch pings never asked for
  // a daily world bulletin in it.
  worldBroadcast: integer('world_broadcast', { mode: 'boolean' }).notNull().default(false),
});

export const userStats = sqliteTable('user_stats', {
  userId: text('user_id').notNull().references(() => users.discordId),
  stat: text('stat').notNull(),
  value: integer('value').notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.userId, t.stat] }),
  check('stat_value_nonneg', sql`${t.value} >= 0`),
]);

export const dailyQuests = sqliteTable('daily_quests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  dayKey: text('day_key').notNull(),
  slot: integer('slot').notNull(),
  questId: text('quest_id').notNull(),
  baseline: integer('baseline').notNull(),
  target: integer('target').notNull(),
  claimedAt: integer('claimed_at_ms'),
  notifiedAt: integer('notified_at_ms'),
}, (t) => [uniqueIndex('daily_quests_user_day_slot').on(t.userId, t.dayKey, t.slot)]);

export const achievementClaims = sqliteTable('achievement_claims', {
  userId: text('user_id').notNull().references(() => users.discordId),
  trackId: text('track_id').notNull(),
  tier: integer('tier').notNull(),
  claimedAt: integer('claimed_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.trackId, t.tier] })]);

// Idempotency record for the proactive alert sweep. This is NOT derived state: it
// records that a side effect (a DM) happened, so it can never drift the way a stored
// escapeAt would. The sweep sends iff the condition holds now AND no row exists whose
// firedForMs equals the current instant.
//   kind:  'escape' | 'income_cap'
//   refId: dinoId for escape, 0 for income_cap
//   tier:  'heads_up' | 'last_call' for escape, '' for income_cap
export const alertsSent = sqliteTable('alerts_sent', {
  userId: text('user_id').notNull().references(() => users.discordId),
  kind: text('kind').notNull(),
  refId: integer('ref_id').notNull(),
  tier: text('tier').notNull(),
  firedForMs: integer('fired_for_ms').notNull(),
  sentAt: integer('sent_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.kind, t.refId, t.tier] })]);

// Which species a player has EVER owned. Like alerts_sent above, this records that a
// side effect happened — it is NOT derived state, and it deliberately cannot be
// re-derived: ownership is destructive (/sell deletes the dino, trading moves it,
// adminReset deletes it) and tx_log carries no species column, so live inventory
// cannot answer "have they ever had one". firstAt is the earliest acquisition, kept
// by INSERT OR IGNORE on the composite key rather than overwritten.
export const speciesSeen = sqliteTable('species_seen', {
  userId: text('user_id').notNull().references(() => users.discordId),
  speciesId: text('species_id').notNull(),
  firstAt: integer('first_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.speciesId] })]);

// One row per resolved duel, inserted once and never updated. Everything else the
// duel feature needs is derived from it at read time: the win/loss/draw record
// (count rows on either side), the per-pair cooldown (max created_at_ms for an
// ordered pair), and the double-accept guard for a live challenge. There is no
// status column and nothing sweeps this table.
//   result:   ALWAYS from the challenger's side, so no reader has to flip it.
//   eloDelta: the challenger's signed change; the defender's is its exact negation.
export const duels = sqliteTable('duels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  challengerId: text('challenger_id').notNull().references(() => users.discordId),
  defenderId: text('defender_id').notNull().references(() => users.discordId),
  mode: text('mode', { enum: ['ghost', 'live'] }).notNull(),
  result: text('result', { enum: ['win', 'loss', 'draw'] }).notNull(),
  eloDelta: integer('elo_delta').notNull(),
  createdAt: integer('created_at_ms').notNull(),
});
