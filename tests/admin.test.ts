import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeCommand } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { requireOwner } from '../src/modules/admin/guard.js';
import { adminGive, adminReset, AdminError } from '../src/modules/admin/service.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });   // config.ownerId === 'owner'

describe('requireOwner', () => {
  it('lets the owner through with no reply', async () => {
    const cmd = fakeCommand({ name: 'admin', sub: 'give', user: 'owner' });
    expect(await requireOwner(ctx, cmd.asChatInput())).toBe(true);
    expect(cmd.replies).toHaveLength(0);
  });
  it('rejects a non-owner ephemerally', async () => {
    const cmd = fakeCommand({ name: 'admin', sub: 'give', user: 'mallory' });
    expect(await requireOwner(ctx, cmd.asChatInput())).toBe(false);
    expect((cmd.replies[0] as { content: string }).content).toContain('Owner only');
  });
});

describe('adminGive', () => {
  it('grants cash + a dino atomically and recomputes rating', () => {
    getOrCreateUser(ctx, 'p', 'P');   // starts with 500 cash
    adminGive(ctx, 'p', 'P', { cash: 1000, dinoSpecies: 'triceratops' });
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.cash).toBe(1500);
    const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'p')).all();
    expect(dinos).toHaveLength(1);
    expect(dinos[0].speciesId).toBe('triceratops');
    expect(u.parkRating).toBeGreaterThan(0);   // recomputed with the new dino
  });
  it('grants an egg with the admin source and null species', () => {
    adminGive(ctx, 'p', 'P', { eggRarity: 'legendary' });   // getOrCreateUser seeds p
    const egg = ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'p')).get()!;
    expect(egg.rarity).toBe('legendary');
    expect(egg.source).toBe('admin');
    expect(egg.speciesId).toBeNull();
  });
  it('rejects an empty give and an unknown species', () => {
    expect(() => adminGive(ctx, 'p', 'P', {})).toThrow(AdminError);
    expect(() => adminGive(ctx, 'p', 'P', { dinoSpecies: 'godzilla' })).toThrow(AdminError);
  });
});

describe('adminReset', () => {
  it('wipes a player’s stuff and restores new-player defaults', () => {
    getOrCreateUser(ctx, 'p', 'P');
    adminGive(ctx, 'p', 'P', { cash: 9000, shards: 50, dinoSpecies: 'triceratops', eggRarity: 'rare' });
    ctx.db.insert(schema.lots).values({ userId: 'p', type: 'paddock', kind: 'carnivore_paddock', name: 'Pen' }).run();
    adminReset(ctx, 'p');
    const u = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'p')).get()!;
    expect(u.cash).toBe(500);
    expect(u.food).toBe(20);
    expect(u.shards).toBe(0);
    expect(u.parkRating).toBe(0);
    expect(u.ratingHighWater).toBe(0);
    expect(u.parkName).toBe('New Park');
    expect(ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, 'p')).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'p')).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'p')).all()).toHaveLength(0);
    expect(u.displayName).toBe('P');   // user row kept
  });
});
