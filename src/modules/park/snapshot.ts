import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { getSpecies } from '../../data/species/index.js';
import { lotSlots } from '../../data/progression.js';
import { settleEscapes } from './escapes.js';
import { seasonFor, type Season } from '../../core/world.js';

export interface SnapshotDino { speciesId: string; rarity: Rarity; escaped: boolean }
export interface SnapshotLot {
  id: number; type: 'paddock' | 'facility'; kind: string; name: string;
  level: number; decorCount: number; dinos: SnapshotDino[];
}
export interface ParkSnapshot {
  parkName: string; cash: number; parkRating: number;
  dinoCount: number; escapedCount: number; lotCap: number;
  // Cosmetic season the map's ground art draws for — optional so an older or synthetic
  // snapshot with no season resolves to the base (non-seasonal) ground art in draw.ts,
  // rather than requiring every literal ParkSnapshot in the codebase to name one.
  season?: Season;
  // Cosmetic landmark tier the map draws a monument for — optional for the same reason
  // season is: two hand-built ParkSnapshot literals in the render tests would otherwise
  // fail to typecheck, and a snapshot built before this feature must still render.
  // Omitted entirely at tier 0, so a park with no landmark produces byte-identical output.
  landmarkTier?: number;
  lots: SnapshotLot[];
}

// Read-only park state for the renderer. Settles escapes first (Plan 3 rule),
// then returns a plain object safe to postMessage across the worker boundary.
export function buildParkSnapshot(ctx: Ctx, userId: string): ParkSnapshot {
  settleEscapes(ctx, userId);
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
  if (!user) throw new Error(`No park for user ${userId}`);
  const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, userId)).all();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();

  const byLot = new Map<number, SnapshotDino[]>();   // key: lotId (0 = unassigned)
  let escapedCount = 0;
  for (const d of dinos) {
    const escaped = d.escapedAt !== null;
    if (escaped) escapedCount++;
    const sd: SnapshotDino = { speciesId: d.speciesId, rarity: getSpecies(d.speciesId).rarity, escaped };
    const key = d.lotId ?? 0;
    let arr = byLot.get(key);
    if (!arr) { arr = []; byLot.set(key, arr); }
    arr.push(sd);
  }

  return {
    parkName: user.parkName, cash: user.cash, parkRating: user.parkRating,
    dinoCount: dinos.length, escapedCount, lotCap: lotSlots(user.ratingHighWater),
    season: seasonFor(ctx.now()),
    ...(user.landmarkTier > 0 ? { landmarkTier: user.landmarkTier } : {}),
    lots: lots.map((l) => ({
      id: l.id, type: l.type, kind: l.kind, name: l.name, level: l.level,
      decorCount: l.decor.length, dinos: byLot.get(l.id) ?? [],
    })),
  };
}
