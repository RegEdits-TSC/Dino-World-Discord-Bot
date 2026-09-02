import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeButton, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { getOrCreateUser } from '../src/modules/park/service.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx({ nowMs: 1_000_000 }); getOrCreateUser(ctx, 'u1', 'U1'); });

describe('the hub component', () => {
  it('hub:open REPLIES a fresh ephemeral and never updates the clicked message', async () => {
    // It is clicked on the park card and on an alert DM. An i.update there would destroy
    // the surface the player came from.
    const b = fakeButton({ customId: 'hub:open:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies, 'hub:open answered nothing').toHaveLength(1);
    // harness.ts has no `updates` accessor — reply vs update is discriminated through the
    // parallel `replyKinds` array (all four ack methods push into the same `replies`).
    expect(b.replyKinds, 'hub:open updated the message it was clicked on').toEqual(['reply']);
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('hub:refresh UPDATES in place, shedding the previous render', async () => {
    const b = fakeButton({ customId: 'hub:refresh:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replyKinds).toEqual(['update']);
    // attachments: [] sheds the previous render's uploads; content: '' clears any result
    // line a previous hub:feedall wrote above the card.
    expect((b.replies[0] as { attachments?: unknown[] }).attachments).toEqual([]);
  });

  it('refuses a click by someone who is not the owner', async () => {
    const b = fakeButton({ customId: 'hub:refresh:u1', user: 'intruder' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replyKinds ?? []).not.toContain('update');
    expect((b.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('acknowledges an unknown action instead of leaving it to time out', async () => {
    // A stale id from an older deploy lands here. deferUpdate is a silent ack; a bare
    // return paints "This interaction failed" after three seconds.
    const b = fakeButton({ customId: 'hub:whatever:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.deferOpts, 'the default arm did not acknowledge').toHaveLength(1);
    expect(b.replies).toHaveLength(0);
  });
});
