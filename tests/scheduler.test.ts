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

  it('a fresh Scheduler over the same DB retries a timer whose handler failed (restart recovery)', async () => {
    const ctx = makeCtx();
    const s1 = ctx.scheduler;
    s1.register('flaky', async () => { throw new Error('down'); });
    s1.enqueue({ kind: 'flaky', userId: 'u1', refId: 1, originGuildId: null, firesAt: 10 });
    expect(await s1.tick(20)).toBe(0);            // attempted, failed, blocked in-process
    expect(await s1.tick(30)).toBe(0);            // still blocked by the attempted set
    const s2 = new Scheduler(ctx.db);             // simulated restart
    let fired = 0;
    s2.register('flaky', async () => { fired++; });
    expect(await s2.tick(40)).toBe(1);
    expect(fired).toBe(1);
  });
  it('a handler registered after the first tick never fires timers that tick already attempted', async () => {
    // Pins the boot-order hazard: register() must run before the first tick.
    const ctx = makeCtx();
    const s = ctx.scheduler;
    s.enqueue({ kind: 'late', userId: 'u1', refId: 1, originGuildId: null, firesAt: 10 });
    expect(await s.tick(20)).toBe(0);             // unregistered kind → attempted anyway
    let fired = 0;
    s.register('late', async () => { fired++; });
    expect(await s.tick(30)).toBe(0);
    expect(fired).toBe(0);
  });
  it('an in-flight timer is not double-fired by an overlapping tick', async () => {
    const ctx = makeCtx();
    const s = ctx.scheduler;
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    let calls = 0;
    s.register('slow', async () => { calls++; await gate; });
    s.enqueue({ kind: 'slow', userId: 'u1', refId: 1, originGuildId: null, firesAt: 10 });
    const first = s.tick(20);                     // starts, blocks in the handler
    const second = await s.tick(21);              // overlapping tick sees it in `attempted`
    expect(second).toBe(0);
    release();
    expect(await first).toBe(1);
    expect(calls).toBe(1);
  });
});
