import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { tradingModule } from '../src/modules/trading/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';

const cmd = () => tradingModule.commands[0];
const H = 3_600_000;

function seedTrade(ctx: ReturnType<typeof makeCtx>, over: Partial<typeof schema.trades.$inferInsert> = {}) {
  return ctx.db.insert(schema.trades).values({
    fromUser: 'u1', toUser: 'u2',
    offer: { dinoIds: [], eggIds: [], cash: 100, food: 0 },
    request: { dinoIds: [], eggIds: [], cash: 0, food: 5 },
    createdAt: ctx.now(), ...over,
  }).returning().get();
}

describe('/trade accept|decline|cancel id autocomplete', () => {
  it('accept: incoming trades first, outgoing tagged toward /trade cancel', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    const incoming = seedTrade(ctx, { fromUser: 'u2', toUser: 'u1' });
    const outgoing = seedTrade(ctx);
    const i = fakeAutocomplete({ name: 'trade', sub: 'accept', user: 'u1', focused: { name: 'id', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([incoming.id, outgoing.id]);
    expect(rows[0].name).toBe(`🤝 #${incoming.id} ← u2 — give 🍖 5 / get 💰 100`);
    expect(rows[1].name).toContain('your outgoing, use /trade cancel');
  });

  it('cancel: outgoing first, incoming tagged toward /trade accept', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    const incoming = seedTrade(ctx, { fromUser: 'u2', toUser: 'u1' });
    const outgoing = seedTrade(ctx);
    const i = fakeAutocomplete({ name: 'trade', sub: 'cancel', user: 'u1', focused: { name: 'id', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    const rows = i.replies[0] as Array<{ name: string; value: number }>;
    expect(rows.map((r) => r.value)).toEqual([outgoing.id, incoming.id]);
    expect(rows[0].name).toBe(`🤝 #${outgoing.id} → u2 — give 💰 100 / get 🍖 5`);
  });

  it('expired trades vanish (expireStale runs first)', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'u1'); getOrCreateUser(ctx, 'u2', 'u2');
    seedTrade(ctx, { fromUser: 'u2', toUser: 'u1', createdAt: 0 });
    ctx.setNow(25 * H);   // past TRADE_EXPIRY_MS (24h)
    const i = fakeAutocomplete({ name: 'trade', sub: 'accept', user: 'u1', focused: { name: 'id', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'No pending trades', value: 0 }]);
  });
});
