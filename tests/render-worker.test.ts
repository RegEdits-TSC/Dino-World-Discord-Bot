import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
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
