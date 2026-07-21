import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadConfig } from './core/config.js';
import { ModuleRegistry } from './core/modules.js';
import { parkModule } from './modules/park/index.js';
import { hatcheryModule } from './modules/hatchery/index.js';
import { expeditionsModule } from './modules/expeditions/index.js';
import { shopModule } from './modules/shop/index.js';
import { settingsModule } from './modules/settings/index.js';
import { careModule } from './modules/care/index.js';

const config = loadConfig();
const registry = new ModuleRegistry([parkModule, hatcheryModule, expeditionsModule, shopModule, settingsModule, careModule], config.modules);
const body = registry.commands().map((c) => c.data.toJSON());
const rest = new REST().setToken(config.token);

// DEV_GUILD_ID set → deploy to that guild only (propagates instantly, ideal for testing).
// Unset → deploy globally for production (available in every server; can take up to ~1h to appear).
const devGuildId = process.env.DEV_GUILD_ID;
if (devGuildId) {
  await rest.put(Routes.applicationGuildCommands(config.clientId, devGuildId), { body });
  console.log(`Deployed ${body.length} commands to dev guild ${devGuildId} (instant).`);
} else {
  await rest.put(Routes.applicationCommands(config.clientId), { body });
  console.log(`Deployed ${body.length} global commands (may take up to ~1h to appear).`);
}
