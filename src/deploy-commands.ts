import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadConfig } from './core/config.js';
import { ModuleRegistry } from './core/modules.js';
import { ALL_MODULES } from './core/module-list.js';

const config = loadConfig();
const registry = new ModuleRegistry(ALL_MODULES, config.modules);
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
