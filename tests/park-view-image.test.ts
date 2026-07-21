import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx } from './harness.js';
import { fakeCommand } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dashboardPayload, withParkImage } from '../src/modules/park/embeds.js';
import { parkModule } from '../src/modules/park/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

describe('withParkImage', () => {
  it('attaches park.png and points the embed image at it', () => {
    const u = getOrCreateUser(ctx, 'a', 'A');
    const base = dashboardPayload(u, [], 0, 0, 0);
    const out = withParkImage(base, Buffer.from([1, 2, 3]));
    expect(out.files).toHaveLength(1);
    expect(out.embeds[0].data.image?.url).toBe('attachment://park.png');
    expect(out.components).toBe(base.components);   // Collect button preserved
  });
});

describe('/park view', () => {
  it('always replies with exactly one embed (image or graceful text fallback)', async () => {
    getOrCreateUser(ctx, 'u1', 'U1');
    const cmd = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await parkModule.commands[0].execute(ctx, cmd.asChatInput());
    const reply = cmd.replies[0] as { embeds: unknown[] };
    expect(reply.embeds).toHaveLength(1);
  });

  it('viewing another park is read-only — one embed, no Collect button', async () => {
    getOrCreateUser(ctx, 'u1', 'U1');
    getOrCreateUser(ctx, 'other', 'Other');
    const cmd = fakeCommand({ name: 'park', sub: 'view', user: 'u1', options: { user: 'other' } });
    await parkModule.commands[0].execute(ctx, cmd.asChatInput());
    const reply = cmd.replies[0] as { embeds: unknown[]; components?: unknown[] };
    expect(reply.embeds).toHaveLength(1);
    expect(reply.components).toBeUndefined();   // no Collect button when viewing someone else
  });
});
