import type { ModuleManifest } from './modules.js';
import { parkModule } from '../modules/park/index.js';
import { hatcheryModule } from '../modules/hatchery/index.js';
import { expeditionsModule } from '../modules/expeditions/index.js';
import { shopModule } from '../modules/shop/index.js';
import { settingsModule } from '../modules/settings/index.js';
import { careModule } from '../modules/care/index.js';
import { tradingModule } from '../modules/trading/index.js';
import { leaderboardsModule } from '../modules/leaderboards/index.js';
import { adminModule } from '../modules/admin/index.js';
import { helpModule } from '../modules/help/index.js';
import { battlesModule } from '../modules/battles/index.js';
import { geneLabModule } from '../modules/genelab/index.js';

// The one and only module array. index.ts, deploy-commands.ts, and the test
// suite all consume this list, so registered handlers and deployed builders
// can never drift apart by editing one copy.
export const ALL_MODULES: ModuleManifest[] = [
  parkModule, hatcheryModule, expeditionsModule, shopModule, settingsModule,
  careModule, tradingModule, leaderboardsModule, adminModule, helpModule,
  battlesModule, geneLabModule,
];
