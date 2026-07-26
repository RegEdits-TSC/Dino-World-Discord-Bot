import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './core/config.js';
import { syncEmojis } from './core/emoji-sync.js';

const config = loadConfig();
const rest = new REST().setToken(config.token);
const PNG_DIR = resolve(process.cwd(), 'assets/emojis/png');
const MANIFEST = resolve(process.cwd(), 'assets/emojis/manifest.json');

const local = new Map<string, Buffer>();
for (const f of readdirSync(PNG_DIR).filter((n) => n.endsWith('.png')).sort()) {
  local.set(f.replace('.png', ''), readFileSync(resolve(PNG_DIR, f)));
}
let manifest: Record<string, string> = {};
if (existsSync(MANIFEST)) {
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    throw new Error(`Corrupt manifest at ${MANIFEST} — delete it and rerun (this safely re-uploads everything).`);
  }
}

const res = await rest.get(Routes.applicationEmojis(config.clientId)) as
  { items: Array<{ id: string; name: string }> };
const remote = new Map(res.items.map((e) => [e.name, e.id]));

let result;
try {
  result = await syncEmojis(local, remote, manifest, {
    create: (name, png) => rest.post(Routes.applicationEmojis(config.clientId), {
      body: { name, image: `data:image/png;base64,${png.toString('base64')}` },
    }).then(() => {}),
    remove: (id) => rest.delete(Routes.applicationEmoji(config.clientId, id)).then(() => {}),
  }, console.log);
} finally {
  // Written on every exit — success or thrown error — so a partial run never
  // loses the record of emojis it already uploaded.
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}
console.log(`Emojis synced: ${result.created.length} created, ${result.replaced.length} replaced, ${result.unchanged.length} unchanged (${local.size} local).`);
