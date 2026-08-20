import { describe, it, expect } from 'vitest';
import { ModuleRegistry } from '../src/core/modules.js';
import type { ModuleManifest, SelectDef } from '../src/core/modules.js';
import { ALL_MODULES } from '../src/core/module-list.js';

describe('full module registry', () => {
  it('loads all modules without a name/prefix collision', () => {
    const flags = Object.fromEntries(ALL_MODULES.map((m) => [m.name, true]));
    const r = new ModuleRegistry(ALL_MODULES, flags);
    expect(ALL_MODULES).toHaveLength(17);
    expect(r.commands().length).toBe(29);
  });
});

describe('select menu registry', () => {
  const sel = (prefix: string): SelectDef => ({ prefix, execute: async () => {} });
  const mod = (name: string, selects?: SelectDef[]): ModuleManifest =>
    ({ name, commands: [], components: [], ...(selects ? { selects } : {}) });

  it('resolves a select by its customId prefix', () => {
    const r = new ModuleRegistry([mod('a', [sel('park')])], { a: true });
    expect(r.findSelect('park:build:u1')?.prefix).toBe('park');
    expect(r.findSelect('nope:x')).toBeUndefined();
  });

  it('a module with no selects array is legal and resolves nothing', () => {
    const r = new ModuleRegistry([mod('a')], { a: true });
    expect(r.findSelect('park:build:u1')).toBeUndefined();
  });

  it('throws at construction on a duplicate select prefix', () => {
    expect(() => new ModuleRegistry([mod('a', [sel('park')]), mod('b', [sel('park')])], { a: true, b: true }))
      .toThrow(/Duplicate select prefix/);
  });

  it('a select and a button MAY share a prefix — they are separate namespaces', () => {
    const m: ModuleManifest = {
      name: 'a', commands: [],
      components: [{ prefix: 'park', execute: async () => {} }],
      selects: [sel('park')],
    };
    expect(() => new ModuleRegistry([m], { a: true })).not.toThrow();
  });
});
