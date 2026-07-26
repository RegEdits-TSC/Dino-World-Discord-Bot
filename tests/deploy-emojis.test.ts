import { describe, it, expect } from 'vitest';
import { syncEmojis, sha, type EmojiRestOps } from '../src/core/emoji-sync.js';

const png = (s: string) => Buffer.from(s);
function recorder() {
  const calls: string[] = [];
  const ops: EmojiRestOps = {
    create: async (name) => { calls.push(`create:${name}`); },
    remove: async (id) => { calls.push(`remove:${id}`); },
  };
  return { calls, ops };
}

describe('syncEmojis', () => {
  it('skips unchanged, creates new, replaces changed (delete then create)', async () => {
    const { calls, ops } = recorder();
    const local = new Map([['same', png('A')], ['fresh', png('B')], ['edited', png('C2')]]);
    const remote = new Map([['same', 'id1'], ['edited', 'id2']]);
    const manifest: Record<string, string> = { same: sha(png('A')), edited: sha(png('C1')) };
    const r = await syncEmojis(local, remote, manifest, ops);
    expect(r.unchanged).toEqual(['same']);
    expect(r.created).toEqual(['fresh']);
    expect(r.replaced).toEqual(['edited']);
    expect(calls).toEqual(['create:fresh', 'remove:id2', 'create:edited']);
    expect(manifest.fresh).toBe(sha(png('B')));
    expect(manifest.edited).toBe(sha(png('C2')));
  });
  it('remote-missing but manifest-matching name is re-created (self-heal)', async () => {
    const { calls, ops } = recorder();
    const local = new Map([['ghost', png('X')]]);
    const manifest: Record<string, string> = { ghost: sha(png('X')) };
    const r = await syncEmojis(local, new Map(), manifest, ops);
    expect(r.created).toEqual(['ghost']);
    expect(calls).toEqual(['create:ghost']);
  });
  it('a mid-loop create failure keeps earlier uploads in the manifest and rethrows', async () => {
    const calls: string[] = [];
    const ops: EmojiRestOps = {
      create: async (name) => {
        if (name === 'second') throw new Error('rate limited');
        calls.push(`create:${name}`);
      },
      remove: async () => {},
    };
    const local = new Map([['first', png('1')], ['second', png('2')]]);
    const manifest: Record<string, string> = {};
    await expect(syncEmojis(local, new Map(), manifest, ops)).rejects.toThrow('rate limited');
    expect(manifest.first).toBe(sha(png('1')));
    expect(manifest.second).toBeUndefined();
  });
  it('reports remote orphans without touching them', async () => {
    const { calls, ops } = recorder();
    const r = await syncEmojis(new Map(), new Map([['stray', 'id9']]), {}, ops);
    expect(r.orphans).toEqual(['stray']);
    expect(calls).toEqual([]);
  });
});
