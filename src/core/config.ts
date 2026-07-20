import { z } from 'zod';
import { readFileSync } from 'node:fs';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DATABASE_PATH: z.string().min(1),
  OWNER_ID: z.string().min(1),
});

export interface Config {
  token: string; clientId: string; databasePath: string; ownerId: string;
  modules: Record<string, boolean>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = envSchema.parse(env);
  const modules = JSON.parse(readFileSync(new URL('../../modules.json', import.meta.url), 'utf8'));
  return {
    token: e.DISCORD_TOKEN, clientId: e.DISCORD_CLIENT_ID,
    databasePath: e.DATABASE_PATH, ownerId: e.OWNER_ID, modules,
  };
}
