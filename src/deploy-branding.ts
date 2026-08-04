import 'dotenv/config';
import { REST, Routes, DiscordAPIError, RateLimitError } from 'discord.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './core/config.js';
import { assertAnimatedAccepted, assertUploadable, toDataUri } from './core/branding.js';

// Usage: deploy-branding [--avatar-only | --banner-only] [--dry-run]
//   --avatar-only / --banner-only  Send one asset instead of both, so a retry
//                                  after a rate limit does not re-spend the
//                                  budget on the asset that already went through.
//   --dry-run                      Read both files, validate them, and print
//                                  what would be sent — no request is issued.

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

export function isDryRun(argv: string[]): boolean {
  return argv.includes('--dry-run');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const assets = selectAssets(argv);
  const dryRun = isDryRun(argv);

  const body: Record<string, string> = {};
  for (const asset of assets) {
    const buf = readFileSync(resolve(process.cwd(), 'assets/branding', `${asset}.gif`));
    assertUploadable(buf, 'gif');
    body[asset] = toDataUri(buf, 'image/gif');
    if (dryRun) console.log(`${asset}.gif: ${(buf.length / 1e6).toFixed(2)} MB — uploadable.`);
  }

  if (dryRun) {
    console.log(`Dry run: would update ${assets.join(' and ')}. No request sent.`);
    return;
  }

  const config = loadConfig();
  // rejectOnRateLimit opts this one route into throwing RateLimitError on a
  // 429 instead of @discordjs/rest's default of sleeping retry_after and
  // retrying silently — which would otherwise hide a ~2/hour profile-edit
  // limit behind up to an hour of no output.
  const rest = new REST({ rejectOnRateLimit: [Routes.user()] }).setToken(config.token);

  let res: { avatar?: string | null; banner?: string | null };
  try {
    res = await rest.patch(Routes.user(), { body }) as typeof res;
  } catch (err) {
    // Never log headers or a raw API error body: it can echo request context
    // back, and the request carries the bot token.
    if (err instanceof RateLimitError) {
      const waitS = Math.ceil(err.retryAfter / 1000);
      throw new Error(
        `Rate limited, retry after ${waitS}s. ` +
        'Discord allows roughly two profile edits per hour — use --avatar-only or --banner-only.',
      );
    }
    if (err instanceof DiscordAPIError) {
      throw new Error(`Profile update failed: HTTP ${err.status}, Discord code ${err.code}.`);
    }
    // DNS, TLS, and abort failures never reach either branch above — name and
    // code are the only diagnostics that stay within the no-body/no-headers rule.
    const e = err as { name?: string; code?: unknown };
    throw new Error(`Profile update failed: ${e.name ?? 'Error'}${e.code ? ` (${e.code})` : ''}.`);
  }

  for (const asset of assets) assertAnimatedAccepted(res[asset], asset);
  console.log(`Updated ${assets.join(' and ')} — Discord confirmed each as animated.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
