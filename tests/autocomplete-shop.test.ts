import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { shopModule } from '../src/modules/shop/index.js';
import { dailyEggOffers } from '../src/modules/shop/service.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';
import { SHOP_EGG_PRICES } from '../src/data/shop.js';
import type { Rarity } from '../src/data/types.js';
import { eq } from 'drizzle-orm';

const cmd = (name: string) => shopModule.commands.find((c) => c.data.name === name)!;

describe('/shop egg rarity autocomplete', () => {
  it('ranks today\'s offers first with prices, tags the rest', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    ctx.db.update(schema.users).set({ ratingHighWater: 500 }).where(eq(schema.users.discordId, 'u1')).run();
    const offers = dailyEggOffers(500, ctx.now());
    const i = fakeAutocomplete({ name: 'shop', sub: 'egg', user: 'u1', focused: { name: 'rarity', value: '' } });
    await cmd('shop').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: string }>;
    expect(rows).toHaveLength(5);
    for (const [n, row] of rows.entries()) {
      const inRotation = offers.includes(row.value as never);
      expect(inRotation).toBe(n < offers.length);   // valid-first ordering
      if (inRotation) expect(row.name).toContain(`${SHOP_EGG_PRICES[row.value as Rarity].toLocaleString('en-US')} cash`);
      else expect(row.name).toContain("not in today's shop");
    }
  });

  it('treats a missing user row as high-water 0 without creating a row', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'shop', sub: 'egg', user: 'ghost', focused: { name: 'rarity', value: '' } });
    await cmd('shop').autocomplete!(ctx, i.asAutocomplete());
    expect((i.replies[0] as unknown[]).length).toBe(5);
    expect(ctx.db.select().from(schema.users).all()).toEqual([]);
  });
});

describe('/sell dino autocomplete', () => {
  it('tags mythic and trade-locked dinos, appends sale value to valid ones', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1');
    const mk = (over: Partial<typeof schema.dinos.$inferInsert>) =>
      ctx.db.insert(schema.dinos).values({ userId: 'u1', speciesId: 'velociraptor', lastFedAt: 0, hatchedAt: 0, ...over }).returning().get();
    const ok = mk({});                                         // velociraptor is rare -> 500 cash
    const traded = mk({ speciesId: 'triceratops', viaTrade: true });
    const locked = mk({ speciesId: 'stegosaurus', locked: true });
    const mythic = mk({ speciesId: 'indominus' });
    const i = fakeAutocomplete({ name: 'sell', user: 'u1', focused: { name: 'dino', value: '' } });
    await cmd('sell').autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([ok.id, traded.id, locked.id, mythic.id]);
    expect(rows[0].name).toBe(`🦖 #${ok.id} Velociraptor — 500 cash`);
    expect(rows[1].name).toBe(`🦖 #${traded.id} Triceratops — 50 cash, 0 shards (via trade)`);
    expect(rows[2].name).toBe(`🦖 #${locked.id} Stegosaurus — locked in a trade`);
    expect(rows[3].name).toBe(`🦖 #${mythic.id} Indominus rex — MYTHIC, can't sell`);
  });
});
