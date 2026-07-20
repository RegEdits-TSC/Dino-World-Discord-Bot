import { describe, it, expect } from 'vitest';
import { makeCtx, fakeCommand, mulberry32 } from './harness.js';

describe('harness', () => {
  it('ctx time is controllable and rng deterministic', () => {
    const ctx = makeCtx();
    ctx.setNow(1234); expect(ctx.now()).toBe(1234);
    const a = mulberry32(7)(); const b = mulberry32(7)();
    expect(a).toBe(b);
  });
  it('fake interaction records replies', async () => {
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await i.asChatInput().reply({ content: 'hi' });
    expect(i.replies).toEqual([{ content: 'hi' }]);
  });
});
