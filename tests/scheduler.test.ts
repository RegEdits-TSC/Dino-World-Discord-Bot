import { describe, it, expect } from 'vitest';
import { Scheduler } from '../src/core/scheduler.js';
import { makeCtx } from './harness.js';

describe('Scheduler', () => {
  it('fires due timers once, in order, and skips future ones', async () => {
    const ctx = makeCtx();
    const s = new Scheduler(ctx.db);
    const fired: number[] = [];
    s.register('test', async (t) => { fired.push(t.refId); });
    s.enqueue({ kind: 'test', userId: 'u1', refId: 1, originGuildId: null, firesAt: 100 });
    s.enqueue({ kind: 'test', userId: 'u1', refId: 2, originGuildId: null, firesAt: 200 });
    s.enqueue({ kind: 'test', userId: 'u1', refId: 3, originGuildId: null, firesAt: 999 });
    expect(await s.tick(250)).toBe(2);
    expect(fired).toEqual([1, 2]);
    expect(await s.tick(250)).toBe(0);        // no double-fire
  });

  it('isolates a throwing handler and does not retry it in-process', async () => {
    const ctx = makeCtx();
    const s = new Scheduler(ctx.db);
    s.register('bad', async () => { throw new Error('x'); });
    const ok: number[] = [];
    s.register('good', async (t) => { ok.push(t.refId); });
    s.enqueue({ kind: 'bad', userId: 'u1', refId: 1, originGuildId: null, firesAt: 1 });
    s.enqueue({ kind: 'good', userId: 'u1', refId: 2, originGuildId: null, firesAt: 2 });
    expect(await s.tick(10)).toBe(1);         // only 'good' counts as fired
    expect(ok).toEqual([2]);
    expect(await s.tick(10)).toBe(0);         // 'bad' not retried (in attempted set)
  });

  it('ignores timers whose kind has no registered handler', async () => {
    const ctx = makeCtx();
    const s = new Scheduler(ctx.db);
    s.enqueue({ kind: 'unregistered', userId: 'u1', refId: 1, originGuildId: null, firesAt: 1 });
    expect(await s.tick(10)).toBe(0);
  });
});
