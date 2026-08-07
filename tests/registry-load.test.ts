import { describe, it, expect } from 'vitest';
import { ModuleRegistry } from '../src/core/modules.js';
import { ALL_MODULES } from '../src/core/module-list.js';

describe('full module registry', () => {
  it('loads all modules without a name/prefix collision', () => {
    const flags = Object.fromEntries(ALL_MODULES.map((m) => [m.name, true]));
    const r = new ModuleRegistry(ALL_MODULES, flags);
    expect(ALL_MODULES).toHaveLength(14);
    expect(r.commands().length).toBe(25);
  });
});
