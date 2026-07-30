import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { handleRenderRequest } from '../src/core/render/protocol.js';
import { createRunner } from '../src/core/render/client.js';

describe('handleRenderRequest', () => {
  it('returns ok with the png for a successful render', () => {
    const png = Buffer.from('png-bytes');
    const reply = handleRenderRequest({ id: 7, snapshot: {} as never }, () => png);
    expect(reply).toEqual({ id: 7, ok: true, png });
  });
  it('returns ok:false with the error string when the render throws', () => {
    const reply = handleRenderRequest({ id: 8, snapshot: {} as never }, () => { throw new Error('bad snapshot'); });
    expect(reply.id).toBe(8);
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('bad snapshot');
  });
});

class FakeWorker extends EventEmitter {
  sent: unknown[] = [];
  postMessage(m: unknown) { this.sent.push(m); }
}

describe('createRunner', () => {
  it('resolves with a Buffer and ignores stale replies for older ids', async () => {
    const w = new FakeWorker();
    const run = createRunner(() => w as never);
    const p = run({} as never);
    const req = w.sent[0] as { id: number };
    w.emit('message', { id: req.id - 1, ok: true, png: Buffer.from('stale') });   // ignored
    w.emit('message', { id: req.id, ok: true, png: Buffer.from('fresh') });
    await expect(p).resolves.toEqual(Buffer.from('fresh'));
  });
  it('rejects on an error reply and on a worker error event', async () => {
    const w = new FakeWorker();
    const run = createRunner(() => w as never);
    const p1 = run({} as never);
    w.emit('message', { id: (w.sent[0] as { id: number }).id, ok: false, error: 'boom' });
    await expect(p1).rejects.toThrow('boom');
    const p2 = run({} as never);
    w.emit('error', new Error('worker died'));
    await expect(p2).rejects.toThrow('worker died');
  });
});

describe('worker entry', () => {
  // Vitest's default `forks` pool runs each test file in a child PROCESS, where `parentPort` is null,
  // so importing the worker entry registers no listener — it only executes the module's top-level
  // await. Under a `threads` pool that would not hold (the import would hijack vitest's own message
  // port), so the boot pin is skipped there rather than corrupting the run.
  it.skipIf(!isMainThread)('boots: its top-level art preload resolves and never rejects', async () => {
    await expect(import('../src/core/render/worker.js')).resolves.toBeDefined();
  });

  // A booted module alone does not prove the art is used, and the wiring cannot be observed from the
  // main thread (the entry exports nothing and only reacts to a real MessagePort). These two source
  // assertions pin the parts with the worst failure modes: a preload without `.catch` turns one bad
  // asset into a permanently image-less /park view, and a render call without `art` silently renders
  // the flat fallback forever while every other test stays green.
  it('preloads the art with a never-reject guard and passes it into every render', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/core/render/worker.ts'), 'utf8');
    expect(src).toMatch(/await\s+loadParkArt\(\)\.catch\(/);
    expect(src).toMatch(/renderParkPng\(\s*\w+\s*,\s*art\s*\)/);
  });
});
