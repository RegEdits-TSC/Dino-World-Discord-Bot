import { describe, it, expect } from 'vitest';
import { ModuleRegistry } from '../src/core/modules.js';
import { parkModule } from '../src/modules/park/index.js';
import { hatcheryModule } from '../src/modules/hatchery/index.js';
import { expeditionsModule } from '../src/modules/expeditions/index.js';
import { shopModule } from '../src/modules/shop/index.js';
import { settingsModule } from '../src/modules/settings/index.js';
import { careModule } from '../src/modules/care/index.js';
import { tradingModule } from '../src/modules/trading/index.js';
import { leaderboardsModule } from '../src/modules/leaderboards/index.js';

describe('full module registry', () => {
  it('loads all modules without a name/prefix collision', () => {
    const flags = { park: true, hatchery: true, expeditions: true, shop: true, settings: true, care: true, trading: true, leaderboards: true };
    const r = new ModuleRegistry([parkModule, hatcheryModule, expeditionsModule, shopModule, settingsModule, careModule, tradingModule, leaderboardsModule], flags);
    expect(r.commands().length).toBe(17);
  });
});
