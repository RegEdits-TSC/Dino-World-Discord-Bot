import { sqliteTable, text, integer, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  discordId: text('discord_id').primaryKey(),
  displayName: text('display_name').notNull().default(''),
  parkName: text('park_name').notNull().default("New Park"),
  parkRating: integer('park_rating').notNull().default(0),
  ratingHighWater: integer('rating_high_water').notNull().default(0),
  cash: integer('cash').notNull().default(500),
  food: integer('food').notNull().default(20),
  shards: integer('shards').notNull().default(0),
  shardsWindowStart: integer('shards_window_start_ms').notNull().default(0),
  shardsWindowEarned: integer('shards_window_earned').notNull().default(0),
  lastCollectAt: integer('last_collect_at_ms').notNull(),
  createdAt: integer('created_at_ms').notNull(),
}, (t) => [
  check('cash_nonneg', sql`${t.cash} >= 0`),
  check('food_nonneg', sql`${t.food} >= 0`),
  check('shards_nonneg', sql`${t.shards} >= 0`),
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
  locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
  hatchedAt: integer('hatched_at_ms').notNull(),
});

export const eggs = sqliteTable('eggs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  rarity: text('rarity', { enum: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] }).notNull(),
  speciesId: text('species_id'),
  source: text('source', { enum: ['expedition', 'shop', 'trade', 'admin'] }).notNull(),
  viaTrade: integer('via_trade', { mode: 'boolean' }).notNull().default(false),
  locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
  obtainedAt: integer('obtained_at_ms').notNull(),
  incubationStartedAt: integer('incubation_started_at_ms'),
  hatchesAt: integer('hatches_at_ms'),
});

export const expeditions = sqliteTable('expeditions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.discordId),
  siteId: text('site_id').notNull(),
  departedAt: integer('departed_at_ms').notNull(),
  returnsAt: integer('returns_at_ms').notNull(),
  loot: text('loot', { mode: 'json' }).$type<{ eggRarity: string; cash: number; food: number } | null>(),
  claimedAt: integer('claimed_at_ms'),
});

export interface TradeSide { dinoIds: number[]; eggIds: number[]; cash: number; food: number }

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
});
