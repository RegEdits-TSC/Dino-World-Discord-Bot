import { describe, it, expect } from 'vitest';
import { raceTimeout, renderPark } from '../src/core/render/client.js';
import type { ParkSnapshot } from '../src/modules/park/snapshot.js';

const snap = {} as unknown as ParkSnapshot;   // renderPark passes it straight to `run`

describe('raceTimeout', () => {
  it('resolves when the promise beats the timeout', async () => {
    await expect(raceTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });
  it('rejects when the timeout wins', async () => {
    await expect(raceTimeout(new Promise<number>(() => {}), 10)).rejects.toThrow(/timeout/);
  });
});

describe('renderPark (injected runner)', () => {
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  it('returns the runner buffer', async () => {
    await expect(renderPark(snap, async () => buf, 1000)).resolves.toBe(buf);
  });
  it('rejects when the runner errors (caller will fall back to text)', async () => {
    await expect(renderPark(snap, async () => { throw new Error('boom'); }, 1000)).rejects.toThrow('boom');
  });
  it('rejects when the runner exceeds the timeout', async () => {
    await expect(renderPark(snap, () => new Promise<Buffer>(() => {}), 10)).rejects.toThrow(/timeout/);
  });
});
