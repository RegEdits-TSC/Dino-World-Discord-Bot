import { createHash } from 'node:crypto';

export interface EmojiRestOps {
  create(name: string, png: Buffer): Promise<void>;
  remove(id: string): Promise<void>;
}
export interface SyncResult { created: string[]; replaced: string[]; unchanged: string[]; orphans: string[] }

export function sha(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}

// Hash-manifest sync of local PNGs to Discord application emojis. `manifest`
// is mutated per successful upload so the caller's finally-write never claims
// an emoji that a mid-loop failure never created.
export async function syncEmojis(
  local: Map<string, Buffer>,
  remote: Map<string, string>,
  manifest: Record<string, string>,
  ops: EmojiRestOps,
  log: (line: string) => void = () => {},
): Promise<SyncResult> {
  const result: SyncResult = { created: [], replaced: [], unchanged: [], orphans: [] };
  for (const [name, png] of local) {
    const digest = sha(png);
    const existingId = remote.get(name);
    if (existingId && manifest[name] === digest) { result.unchanged.push(name); continue; }
    if (existingId) {        // changed → delete + recreate (new ID; runtime refetches on next boot)
      await ops.remove(existingId);
    }
    await ops.create(name, png);
    manifest[name] = digest;
    if (existingId) { result.replaced.push(name); log(`Replaced: ${name}`); }
    else { result.created.push(name); log(`Created: ${name}`); }
  }
  for (const name of remote.keys()) {
    if (!local.has(name)) {
      result.orphans.push(name);
      log(`Orphan on Discord (no local PNG, left in place): ${name}`);
    }
  }
  return result;
}
