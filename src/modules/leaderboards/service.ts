import { eq, inArray } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { RARITY_WEIGHT } from '../../data/progression.js';
import { getSpecies } from '../../data/species/index.js';

export type Metric = 'rating' | 'cash' | 'collection';
export type Scope = 'server' | 'global';

export function collectionScore(ctx: Ctx, userId: string): number {
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
  const owned = new Set(dinos.map((d) => d.speciesId));
  return [...owned].reduce((s, id) => s + RARITY_WEIGHT[getSpecies(id).rarity], 0);
}

export function topPlayers(
  ctx: Ctx, metric: Metric, scope: Scope, guildId: string | null, limit = 10,
): Array<{ userId: string; displayName: string; value: number }> {
  // Candidate set: server scope = users seen in this guild (via user_guilds); global = all users.
  let users: Array<typeof schema.users.$inferSelect>;
  if (scope === 'server' && guildId) {
    const memberIds = ctx.db.select().from(schema.userGuilds)
      .where(eq(schema.userGuilds.guildId, guildId)).all().map((g) => g.userId);
    users = memberIds.length
      ? ctx.db.select().from(schema.users).where(inArray(schema.users.discordId, memberIds)).all()
      : [];
  } else {
    users = ctx.db.select().from(schema.users).all();
  }
  // Limitation: `collection` scores every candidate in JS (one query per user via
  // collectionScore) rather than a denormalized column — fine at v1 scale. If the
  // user base grows to thousands, denormalize a collectionScore column updated in
  // recomputeRating instead of widening this loop.
  // Limitation: `rating` reads the stored parkRating as-is; it does not settle each
  // ranked user's escapes first (settling everyone on every leaderboard read would be
  // expensive), so a board rating can lag an unsettled escape until that user next
  // interacts. Acceptable for a leaderboard.
  // Note: parkRating is stored ×100 (stars×100); the command layer (Task 7) divides
  // by 100 for display.
  const scored = users.map((u) => ({
    userId: u.discordId,
    displayName: u.displayName || u.discordId,
    value: metric === 'cash' ? u.cash : metric === 'rating' ? u.parkRating : collectionScore(ctx, u.discordId),
  }));
  scored.sort((a, b) => b.value - a.value);
  return scored.slice(0, limit);
}
