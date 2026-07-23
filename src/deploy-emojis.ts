import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './core/config.js';

const config = loadConfig();
const rest = new REST().setToken(config.token);
const PNG_DIR = resolve(process.cwd(), 'assets/emojis/png');
const MANIFEST = resolve(process.cwd(), 'assets/emojis/manifest.json');

const local = new Map<string, Buffer>();
for (const f of readdirSync(PNG_DIR).filter((n) => n.endsWith('.png')).sort()) {
  local.set(f.replace('.png', ''), readFileSync(resolve(PNG_DIR, f)));
}
const manifest: Record<string, string> = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const res = await rest.get(Routes.applicationEmojis(config.clientId)) as
  { items: Array<{ id: string; name: string }> };
const remote = new Map(res.items.map((e) => [e.name, e.id]));

let created = 0, replaced = 0, unchanged = 0;
for (const [name, png] of local) {
  const digest = sha(png);
  const existingId = remote.get(name);
  if (existingId && manifest[name] === digest) { unchanged++; continue; }
  if (existingId) {          // changed → delete + recreate (new ID; runtime refetches on next boot)
    await rest.delete(Routes.applicationEmoji(config.clientId, existingId));
    replaced++;
  } else { created++; }
  await rest.post(Routes.applicationEmojis(config.clientId), {
    body: { name, image: `data:image/png;base64,${png.toString('base64')}` },
  });
  manifest[name] = digest;
}
for (const name of remote.keys()) {
  if (!local.has(name)) console.log(`Orphan on Discord (no local PNG, left in place): ${name}`);
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Emojis synced: ${created} created, ${replaced} replaced, ${unchanged} unchanged (${local.size} local).`);
