import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

describe('/hub', () => {
  it('routes through the real registry and answers ephemerally', async () => {
    // routeInteraction, never hubModule.commands[0].execute: findCommand missing would
    // make the router fall through in SILENCE, and a direct call cannot see that.
    const i = fakeCommand({ name: 'hub', user: 'u1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    expect(i.replies, 'the /hub command answered nothing').toHaveLength(1);
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('mints the users row for a first-time caller rather than throwing', () => {
    // toClockDinos does `.get()!` on the users row, so every read the hub will grow in
    // later tasks throws a TypeError for a player with no row. getOrCreateUser first is
    // what makes those reads safe, and this is the case that pins the ordering.
    const i = fakeCommand({ name: 'hub', user: 'brand-new' });
    return routeInteraction(ctx, testRegistry, i.asInteraction()).then(() => {
      const row = ctx.db.select().from(schema.users).all()
        .find((u) => u.discordId === 'brand-new');
      expect(row, 'no users row was minted for a first-time /hub caller').toBeTruthy();
    });
  });
});
