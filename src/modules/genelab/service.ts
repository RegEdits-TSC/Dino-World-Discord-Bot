import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import type { Rarity } from '../../data/types.js';
import { getSpecies } from '../../data/species/index.js';
import { locksFor, lockLabel } from '../../core/locks.js';
import { hungerAt, drainMsFor } from '../../core/clock.js';
import { eventMods } from '../../core/world.js';
import { breedingSlots } from '../park/service.js';
import {
  modProduct, pickTrait, rollSlotCount, spliceTrait, TRAITS, BRED_SLOT_ODDS, type TraitDomain, type TraitId,
} from '../../data/traits.js';
import {
  BREED_MS, BREED_FEE, BREED_COOLDOWN_MS, BREED_UPGRADE_CHANCE,
  BREED_MIN_HUNGER, SPLICE_SHARD_COST, breedableRarity, upgradeRarity,
} from '../../data/breeding.js';
import { track } from '../../core/stats.js';

export class BreedError extends Error {}
export type Breeding = typeof schema.breedings.$inferSelect;
export type Egg = typeof schema.eggs.$inferSelect;
type Dino = typeof schema.dinos.$inferSelect;

export interface StartOpts {
  /** Validate and price the pairing without charging, inserting or scheduling. */
  dryRun?: boolean;
}

export function activeBreedings(ctx: Ctx, userId: string): Breeding[] {
  return ctx.db.select().from(schema.breedings)
    .where(and(eq(schema.breedings.userId, userId), isNull(schema.breedings.claimedAt))).all();
}

/**
 * dinoId -> epoch ms at which it may breed again. Derived from claimed rows; no column.
 *
 * User-scoped, so a cooldown does NOT follow a dino that changes hands: the new owner
 * sees it as ready. Accepted — the alternative is a column on `dinos`, and the dino had
 * to survive a whole trade negotiation to dodge at most one breed cycle.
 *
 * Scans this user's whole claim history rather than only the rows still in cooldown:
 * a claimed row is never deleted, so the scan grows with lifetime breeds. Negligible
 * at any realistic count (a slot yields at most ~48 claims a day), but if it ever
 * matters, filter on `claimedAt > now - max(BREED_COOLDOWN_MS)` in SQL.
 */
export function breedCooldowns(ctx: Ctx, userId: string): Map<number, number> {
  const out = new Map<number, number>();
  const claimed = ctx.db.select().from(schema.breedings)
    .where(and(eq(schema.breedings.userId, userId), isNotNull(schema.breedings.claimedAt))).all();
  for (const b of claimed) {
    const until = b.claimedAt! + BREED_COOLDOWN_MS[b.rarity];
    for (const id of [b.parentA, b.parentB]) {
      if ((out.get(id) ?? 0) < until) out.set(id, until);
    }
  }
  return out;
}

function ownedDino(ctx: Ctx, userId: string, id: number): Dino {
  const d = ctx.db.select().from(schema.dinos)
    .where(and(eq(schema.dinos.id, id), eq(schema.dinos.userId, userId))).get();
  if (!d) throw new BreedError(`You do not own dino #${id}.`);
  return d;
}

export function startBreeding(
  ctx: Ctx, userId: string, aId: number, bId: number,
  guildId: string | null, opts: StartOpts = {},
): Breeding {
  const now = ctx.now();
  if (aId === bId) throw new BreedError('Pick two different dinos.');
  const a = ownedDino(ctx, userId, aId);
  const b = ownedDino(ctx, userId, bId);
  const sa = getSpecies(a.speciesId);
  const sb = getSpecies(b.speciesId);

  if (!breedableRarity(sa.rarity) || !breedableRarity(sb.rarity)) throw new BreedError('Mythics cannot breed.');
  if (sa.rarity !== sb.rarity) throw new BreedError('Both parents must be the same rarity.');
  if (sa.diet !== sb.diet) throw new BreedError('Both parents must be the same diet.');

  const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, userId)).all();
  const slots = breedingSlots(lots);
  if (slots === 0) throw new BreedError('Build a Gene Lab first — /build kind:gene_lab.');
  if (activeBreedings(ctx, userId).length >= slots)
    throw new BreedError('All Gene Lab breeding slots are busy. Upgrade the Gene Lab for more.');

  // Affordability is checked HERE, in the shared block, not left to economy.apply inside the
  // transaction below — otherwise a dry run passes cleanly and the confirm button then throws
  // InsufficientFundsError, which is the one failure the preview exists to rule out, and a
  // different error class for Task 9 to catch. economy.apply stays the backstop.
  const fee = BREED_FEE[sa.rarity];
  const cash = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get()!.cash;
  if (cash < fee)
    throw new BreedError(`Breeding a ${sa.rarity} pair costs ${fee.toLocaleString('en-US')} cash — you have ${cash.toLocaleString('en-US')}.`);

  const locks = locksFor(ctx, userId);
  const cooldowns = breedCooldowns(ctx, userId);
  for (const d of [a, b]) {
    // No settleEscapes() first, unlike the battle path: an escape that is due but not yet
    // written still fails the hunger gate below, because the worst-case escape threshold
    // (0.25 comfort at 0.5 paddock fit = 50 hunger, minus the 8 h grace drain) is already
    // under BREED_MIN_HUNGER. The column check just buys the clearer message.
    if (d.escapedAt !== null) throw new BreedError(`Dino #${d.id} has escaped — rescue it first.`);
    if (d.lotId === null) throw new BreedError(`Dino #${d.id} must be in a paddock to breed.`);
    const lock = locks.dinos.get(d.id);
    if (lock) throw new BreedError(`Dino #${d.id} is ${lockLabel(lock)}.`);
    const until = cooldowns.get(d.id) ?? 0;
    if (until > now) throw new BreedError(`Dino #${d.id} is still cooling down from its last breeding.`);
    // Hunger is derived, never read off the column: a dino that has not been fed for
    // a day and a half still stores 100 while actually sitting near zero.
    if (hungerAt(d.hunger, d.lastFedAt, now, drainMsFor(d.traits)) < BREED_MIN_HUNGER)
      throw new BreedError(`Dino #${d.id} is too hungry to breed — feed it first.`);
  }

  // Fertile is a parent-side trait, so take the better of the two. Migration Season's
  // breedMs (1.25 on the affected day, else 1) composes into this SAME term so the
  // preview, the committed row, and the scheduler timer at :147 (readyAt is computed
  // before the dryRun early return below) can never disagree about the world's effect.
  const timeMult = Math.min(modProduct(a.traits, 'breedTime'), modProduct(b.traits, 'breedTime')) * eventMods(now).breedMs;
  // Rounded because readyAt lands in an integer column and drives a Discord timestamp;
  // every current multiplier is exact, but a future one need not be.
  const readyAt = Math.round(now + BREED_MS[sa.rarity] * timeMult);
  // THE provenance write, and the only one — claimBreeding just reads this column back.
  // Safe to freeze here because a parent cannot acquire viaTrade between start and claim:
  // the sole writer is moveItems, reached only through acceptTrade, which re-runs
  // verifySide against live locks on BOTH sides (the request side with no waiver at all,
  // the offer side waiving only its own trade id) — and locksFor resolves breedings after
  // trades, so a pending parent always reads back as kind 'breeding' and is refused. The
  // flag is never cleared, and dinos.id is AUTOINCREMENT so an id cannot be recycled onto
  // a different animal. See the fix report for the full reachability argument.
  const viaTrade = a.viaTrade || b.viaTrade;

  if (opts.dryRun) {
    // Unsaved preview row (id 0 = never persisted). /breed start renders this so the
    // confirm button cannot fail on a rule the preview already passed.
    return {
      id: 0, userId, parentA: a.id, parentB: b.id, rarity: sa.rarity,
      speciesId: null, traits: [], viaTrade, startedAt: now, readyAt, claimedAt: null,
    };
  }

  return ctx.db.transaction(() => {
    ctx.economy.apply(userId, { cash: -fee }, `breed:${sa.rarity}`, now);
    const row = ctx.db.insert(schema.breedings).values({
      userId, parentA: a.id, parentB: b.id, rarity: sa.rarity, viaTrade,
      startedAt: now, readyAt,
    }).returning().get();
    track(ctx, userId, 'breedings_started', 1);
    // Inserting the pending row IS the parent lock — locksFor derives escrow from it,
    // so there is no flag to set and nothing to sweep.
    ctx.scheduler.enqueue({ kind: 'breeding_ready', userId, refId: row.id, originGuildId: guildId, firesAt: readyAt });
    return row;
  });
}

/**
 * 70% of each slot is drawn from the parents' combined traits, 30% mutates from
 * the full pool. Slot count uses BRED_SLOT_ODDS, which beats a wild hatch — that
 * gap is the whole reason to breed.
 */
export function inheritTraits(parentA: string[], parentB: string[], rng: () => number): string[] {
  // Tolerant like traitDefs: a trait id retired from the table must not poison a
  // pairing whose parents were rolled before the removal.
  const pool = [...new Set([...parentA, ...parentB])].filter((id) => id in TRAITS) as TraitId[];
  // Same roller as a wild hatch, different odds table — BRED_SLOT_ODDS beats
  // WILD_SLOT_ODDS, and that gap is the reason to breed.
  const count = rollSlotCount(BRED_SLOT_ODDS, rng);

  const out: TraitId[] = [];
  const used = new Set<TraitDomain>();
  for (let i = 0; i < count; i++) {
    // Filtering on the domain already excludes everything in `out`, since every push
    // marks its own domain used — which is also what keeps the one-per-domain rule.
    const eligible = pool.filter((id) => !used.has(TRAITS[id].domain));
    const inherit = eligible.length > 0 && rng() < 0.7;
    const picked = inherit
      ? eligible[Math.floor(rng() * eligible.length)]
      : pickTrait(rng, used);
    if (!picked) break;
    out.push(picked);
    used.add(TRAITS[picked].domain);
  }
  return out;
}

export function claimBreeding(ctx: Ctx, userId: string, breedingId: number): { egg: Egg; upgraded: boolean } {
  const now = ctx.now();
  const b = ctx.db.select().from(schema.breedings)
    .where(and(eq(schema.breedings.id, breedingId), eq(schema.breedings.userId, userId))).get();
  if (!b) throw new BreedError('No such breeding.');
  if (b.claimedAt !== null) throw new BreedError('That breeding has already been claimed.');
  if (b.readyAt > now) throw new BreedError('That breeding is not ready yet.');

  // Parents may have changed since the pairing started; read them fresh and
  // degrade gracefully if one is gone.
  const a = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, b.parentA)).get();
  const bb = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, b.parentB)).get();
  const traitsA = a?.traits ?? [];
  const traitsB = bb?.traits ?? [];

  const upgraded = ctx.rng() < BREED_UPGRADE_CHANCE;
  const rarity: Rarity = upgraded ? upgradeRarity(b.rarity) : b.rarity;
  // upgradeRarity caps at legendary, so a legendary pair rolls an upgrade that changes
  // nothing. Report what actually happened — `upgraded` alone would lie to the UI.
  const reallyUpgraded = rarity !== b.rarity;
  const traits = inheritTraits(traitsA, traitsB, ctx.rng);
  const sameSpecies = a && bb && a.speciesId === bb.speciesId && !reallyUpgraded;
  // Provenance survives breeding: without this, a traded-in parent launders into
  // full-shard offspring, reopening the alt-to-main funnel. Read straight off the row
  // that startBreeding froze — deliberately NOT re-derived from the live parents, which
  // cannot have changed (see the note at the write site) and which are nullable here, so
  // a second source would only add a way for the two to disagree and would leave both
  // sites individually unpinnable by any test.
  const viaTrade = b.viaTrade;

  return ctx.db.transaction(() => {
    const egg = ctx.db.insert(schema.eggs).values({
      userId, rarity, speciesId: sameSpecies ? a!.speciesId : null,
      source: 'breeding', obtainedAt: now, viaTrade, traits,
    }).returning().get();
    ctx.db.update(schema.breedings)
      .set({ claimedAt: now, traits, speciesId: egg.speciesId })
      .where(eq(schema.breedings.id, breedingId)).run();
    track(ctx, userId, 'breedings_claimed', 1);
    return { egg, upgraded: reallyUpgraded };
  });
}

/**
 * Repeatable shard sink: re-rolls one trait slot on a dino the player already
 * owns. On a 0-trait dino, slot 0 ADDS a trait (see spliceTrait); otherwise it
 * replaces the chosen slot, drawing from any domain the surviving trait is not
 * using — the one-trait-per-domain rule holds without this function checking it.
 */
export function spliceDino(ctx: Ctx, userId: string, dinoId: number, slot: number): { before: string[]; after: string[] } {
  const d = ownedDino(ctx, userId, dinoId);
  if (locksFor(ctx, userId).dinos.has(dinoId))
    throw new BreedError('That dino is busy — it is locked in a trade or breeding.');
  if (d.escapedAt !== null) throw new BreedError('That dino has escaped — rescue it first.');
  // Number.isInteger, not isFinite: the custom id is client-supplied, and a fractional
  // slot like 0.5 passes both a finite check AND the range check below (0.5 <= 1), then
  // reaches spliceTrait, where `out[0.5] = picked` sets a non-index property that
  // JSON.stringify silently drops — shards get debited for a trait write that never
  // happens. This guard is what keeps spliceDino safe even if a caller's own
  // parsing (e.g. the confirm button's Number.isInteger check) is ever bypassed or removed.
  if (!Number.isInteger(slot)) throw new BreedError('Pick trait slot 1 or 2.');
  if (slot < 0 || slot > Math.min(d.traits.length, 1))
    throw new BreedError('That dino has no trait in slot 2 yet — splice slot 1 first.');

  const before = d.traits;
  const after = spliceTrait(before, slot, ctx.rng);
  ctx.db.transaction(() => {
    // Throws InsufficientFundsError if the player cannot pay; the outer transaction
    // means a failed update can never leave them charged.
    ctx.economy.apply(userId, { shards: -SPLICE_SHARD_COST }, `splice:${dinoId}`, ctx.now());
    ctx.db.update(schema.dinos).set({ traits: after }).where(eq(schema.dinos.id, dinoId)).run();
    track(ctx, userId, 'splices_done', 1);
  });
  return { before, after };
}
