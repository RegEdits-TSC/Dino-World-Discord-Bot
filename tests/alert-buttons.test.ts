import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ButtonInteraction } from 'discord.js';
import { makeCtx, fakeButton } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { parkModule } from '../src/modules/park/index.js';
import { expeditionsModule } from '../src/modules/expeditions/index.js';
import { startExpedition } from '../src/modules/expeditions/service.js';

const alertComp = () => parkModule.components.find((c) => c.prefix === 'alert')!;
const expComp = () => expeditionsModule.components.find((c) => c.prefix === 'exp')!;
const seed = (ctx: ReturnType<typeof makeCtx>) =>
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();

describe('alert buttons', () => {
  it('is registered AFTER the park prefix so components[0] stays park', () => {
    expect(parkModule.components[0].prefix).toBe('park');
    expect(parkModule.components.map((c) => c.prefix)).toContain('alert');
  });

  it('rejects a bystander with an ephemeral reply and changes nothing', async () => {
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'alert:mute:u1', user: 'someone_else' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(JSON.stringify(b.replies[0])).toContain('not your park');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(true);
  });

  it('mute sets the flag off and updates the alert in place', async () => {
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'alert:mute:u1', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(false);
    const p = b.replies[0] as { components?: unknown[]; attachments?: unknown[] };
    expect(p.components).toEqual([]);                 // buttons are consumed
    expect(p.attachments).toEqual([]);                // the alert carried a banner file
  });

  it('collect on an empty park reports nothing to collect rather than throwing', async () => {
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'alert:collect:u1', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(JSON.stringify(b.replies[0]).toLowerCase()).toContain('nothing to collect');
    const p = b.replies[0] as { attachments?: unknown[] };
    expect(p.attachments).toEqual([]);                 // the alert carried a banner file
  });

  it('feed all with no food reports it instead of throwing', async () => {
    const ctx = makeCtx(); seed(ctx);
    const lot = ctx.db.insert(schema.lots)
      .values({ userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'p' }).returning().get();
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 10, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const b = fakeButton({ customId: 'alert:feedall:u1', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(JSON.stringify(b.replies[0]).toLowerCase()).toMatch(/food|fed 0|nothing/);
    const p = b.replies[0] as { attachments?: unknown[] };
    expect(p.attachments).toEqual([]);                 // the alert carried a banner file
  });

  it('an unknown action defers before the owner check, even with a mismatched uid', async () => {
    // Seven of the ten live prefixes have no fallback; an unhandled click shows the user
    // "This interaction failed". daily/ach are the precedent: deferUpdate, before the
    // owner check, so a stale customId from an older deploy is silently absorbed.
    //
    // uid deliberately does NOT match the clicker here: with a matching uid the owner
    // check falls through regardless of guard order, so that shape can't distinguish
    // "unknown-action check first" from "owner check first". A mismatched uid can —
    // the correct order defers silently; a swapped order would hit the owner check
    // first and reply with the ephemeral "not your park" message instead.
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'alert:whatever:someone_else', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(b.deferOpts.length).toBe(1);
    expect(b.replies).toHaveLength(0);
  });

  it('a truncated customId with no uid segment also defers rather than erroring', async () => {
    // The more realistic stale-deploy case: an older customId shape with fewer
    // segments, so `uid` is `undefined` — still must not match the clicker's id,
    // and must still resolve through the unknown-action branch first.
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'alert:whatever', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(b.deferOpts.length).toBe(1);
    expect(b.replies).toHaveLength(0);
  });

  it('exp:claim rejects a bystander', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const comp = expeditionsModule.components.find((c) => c.prefix === 'exp')!;
    const b = fakeButton({ customId: 'exp:claim:u1', user: 'nope' });
    await comp.execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(JSON.stringify(b.replies[0])).toContain('not your');
  });

  it('exp:claim succeeds for the owner and updates the message with the loot', async () => {
    const ctx = makeCtx(); seed(ctx);
    startExpedition(ctx, 'u1', 'coastal_dig', null);
    ctx.setNow(ctx.now() + 15 * 60_000);   // coastal_dig's duration — now returned
    const b = fakeButton({ customId: 'exp:claim:u1', user: 'u1' });
    await expComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(JSON.stringify(b.replies[0])).toContain('Coastal Dig');
    expect(JSON.stringify(b.replies[0])).toContain('claimed');
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).all()).toHaveLength(1);
  });

  it('exp:claim surfaces "not returned yet" on a stale click — the button carries no expedition id, so it always resolves the caller\'s CURRENT dig', async () => {
    const ctx = makeCtx(); seed(ctx);
    startExpedition(ctx, 'u1', 'coastal_dig', null);
    // ctx.now() is still before returnsAt: the exact shape of clicking an old
    // notification's button after re-departing on a trip that has not landed yet —
    // claimExpedition always resolves the CALLER's own active dig, never the one the
    // notification was originally about, since the button carries no expedition id.
    const b = fakeButton({ customId: 'exp:claim:u1', user: 'u1' });
    await expComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(JSON.stringify(b.replies[0])).toContain('not returned yet');
    expect(ctx.db.select().from(schema.eggs).where(eq(schema.eggs.userId, 'u1')).all()).toHaveLength(0);
  });

  it('exp defers before the owner check on an unknown action, even with a mismatched uid', async () => {
    // Same shape as the alert-prefix ordering test above (Task 9's precedent): a
    // matching uid can't distinguish "unknown-action first" from "owner check first",
    // so the uid here deliberately does NOT match the clicker.
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'exp:whatever:someone_else', user: 'u1' });
    await expComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(b.deferOpts.length).toBe(1);
    expect(b.replies).toHaveLength(0);
  });
});
