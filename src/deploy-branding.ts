import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './core/config.js';
import { assertAnimatedAccepted, assertUploadable, toDataUri } from './core/branding.js';

export type Asset = 'avatar' | 'banner';

export function selectAssets(argv: string[]): Asset[] {
  const avatarOnly = argv.includes('--avatar-only');
  const bannerOnly = argv.includes('--banner-only');
  if (avatarOnly && bannerOnly) {
    throw new Error('Pass --avatar-only or --banner-only, not both (omit both to send each).');
  }
  if (avatarOnly) return ['avatar'];
  if (bannerOnly) return ['banner'];
  return ['avatar', 'banner'];
}

async function main(): Promise<void> {
  const config = loadConfig();
  const rest = new REST().setToken(config.token);
  const assets = selectAssets(process.argv.slice(2));

  const body: Record<string, string> = {};
  for (const asset of assets) {
    const buf = readFileSync(resolve(process.cwd(), 'assets/branding', `${asset}.gif`));
    assertUploadable(buf, 'gif');
    body[asset] = toDataUri(buf, 'image/gif');
  }

  let res: { avatar?: string | null; banner?: string | null };
  try {
    res = await rest.patch(Routes.user(), { body }) as typeof res;
  } catch (err) {
    // Status and Discord's error code only. An API error body can echo request
    // context back, and the request carries the bot token.
    const e = err as { status?: number; code?: number; rawError?: { retry_after?: number } };
    if (e.status === 429) {
      const wait = e.rawError?.retry_after;
      throw new Error(
        `Rate limited (429)${wait ? `, retry after ${wait}s` : ''}. ` +
        'Discord allows roughly two profile edits per hour — use --avatar-only or --banner-only.',
      );
    }
    throw new Error(`Profile update failed: HTTP ${e.status ?? '?'}, Discord code ${e.code ?? '?'}.`);
  }

  for (const asset of assets) assertAnimatedAccepted(res[asset], asset);
  console.log(`Updated ${assets.join(' and ')} — Discord confirmed each as animated.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
