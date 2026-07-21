import { describe, it, expect } from 'vitest';
import { ModuleRegistry } from '../src/core/modules.js';
import { parkModule } from '../src/modules/park/index.js';
import { hatcheryModule } from '../src/modules/hatchery/index.js';
import { expeditionsModule } from '../src/modules/expeditions/index.js';
import { shopModule } from '../src/modules/shop/index.js';
import { settingsModule } from '../src/modules/settings/index.js';

describe('full module registry', () => {
  it('loads all Plan 2 modules without a name/prefix collision', () => {
    const flags = { park: true, hatchery: true, expeditions: true, shop: true, settings: true };
    const r = new ModuleRegistry([parkModule, hatcheryModule, expeditionsModule, shopModule, settingsModule], flags);
    expect(r.commands().length).toBe(13);
  });
});
