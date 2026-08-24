# Operations Runbook

This guide covers deploying Dino World to production, running it as a system service, managing backups, and the release smoke test checklist.

## Deploying to a VPS

### Prerequisites

- **Node.js**: Install the current LTS version via [nvm](https://github.com/nvm-sh/nvm) (or your system package manager). The bot requires Node.js 22 or later — `better-sqlite3` 13 ships an N-API 10 binary that needs Node 22+, and `package.json` sets `engines.node` to `>=22`.
- **Git**: For cloning and pulling updates.
- **SQLite**: Usually included with the OS; required for local database operations.

### Deployment Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/RegEdits-TSC/Dino-World-Discord-Bot.git
   cd Dino-World-Discord-Bot
   ```

2. **Set up environment**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in the required values:
   - `DISCORD_TOKEN`: Your bot's token from the [Discord Developer Portal](https://discord.com/developers/applications).
   - `DISCORD_CLIENT_ID`: Your application's client ID.
   - `DATABASE_PATH`: Absolute path where the SQLite database will live, e.g., `/opt/dino-world/dino-world.db`.
   - `OWNER_ID`: Your Discord user ID for owner-only commands.

3. **Install dependencies**:
   ```bash
   npm ci
   ```
   Use `npm ci` (not `npm install`) for reproducible, production-ready installs.
   This pulls in `devDependencies` too, because step 4 below (`npm run build`)
   needs the TypeScript compiler — one of them. Another, `ffmpeg-static`, is a
   dev-only asset-pipeline dependency (used only by `make-gif`/`deploy-branding`,
   never at runtime) whose install script downloads an ~83 MB ffmpeg binary from
   a GitHub release, so this step needs network access to GitHub even though the
   running bot never touches ffmpeg. If you build in CI or on a separate machine
   and deploy only the compiled `dist/` here, prefer `npm ci --omit=dev` for
   *this* machine's install instead — it skips `ffmpeg-static` and every other
   `devDependency`, since none of them are needed to run `node dist/index.js`.

4. **Build the TypeScript**:
   ```bash
   npm run build
   ```
   This compiles `src/` to `dist/`.

5. **Register slash commands**:
   ```bash
   npm run deploy-commands
   ```
   This registers all enabled module commands with Discord. Do this once on first deploy and again whenever the enabled module set changes (see **Enabling / disabling modules** below).

   **Dev vs production scope:** if `DEV_GUILD_ID` is set in `.env`, `deploy-commands` registers to that guild only — this propagates **instantly**, which is ideal for testing. Leave `DEV_GUILD_ID` unset in production to register commands **globally** (available in every server the bot joins; global registration can take up to ~1 hour to appear). Do not have both a global set and a guild set with the same command names, or that guild will show each command twice.

6. **Deploy custom application emojis**:
   ```bash
   npm run deploy-emojis
   ```
   This uploads the 57 custom emojis to the bot's Discord application and writes `assets/emojis/manifest.json` (emoji name → sha256 of the uploaded PNG). **Commit that file right away.** If it goes missing, the next `deploy-emojis` run sees every hash as changed and deletes + recreates all 57 emojis with new snowflake IDs — every message already posted with an old `<:dw_cash:ID>` tag then renders as a broken emoji, silently and with no way to recover it by rerunning. This is the only irreversible live write in the deploy; run it once, after the code is built, before starting the bot.

7. **Start the bot**:
   - **Direct**: `node dist/index.js`
   - **With systemd** (recommended): See the section below.

   Start (or restart) the bot **after** `deploy-emojis` has run — the runtime emoji map (`emojiTag` / `rarityEmoji`) is fetched once at `ClientReady`, so a bot process already running when the emojis changed won't pick up the new IDs until it restarts.

The bot will log "Logged in as ..." when connected. It stores all state in the SQLite database at `DATABASE_PATH`.

### Park rendering

`/park view` renders a PNG park map in a worker thread using `@napi-rs/canvas`
(native, prebuilt binaries — no system libraries to install). Fonts are bundled
at `assets/fonts/` (Noto Sans + Noto Color Emoji), the map backdrop and the two
tile plates come from `assets/images/park/`, the HUD coin plus the lot and
rarity dino icons are drawn straight from `assets/emojis/svg/*.svg`, and embed
art (egg icons, site thumbnails, banners, archetype dino portraits) lives under
`assets/images/` — all
four directories must ship with the deploy. They are read relative to the
process working directory, so run the bot from the repo root (the systemd unit
already sets `WorkingDirectory`). The render worker preloads the park art once
at startup, which delays the first render only; every asset is individually
optional, and a missing or undecodable file degrades that one element back to a
flat fill or a unicode glyph rather than failing. If rendering fails or exceeds
~3s, `/park view` automatically falls back to the text-only embed — the command
never fails because of the renderer.

## Running as a Service

### Using systemd (Linux)

Create a unit file at `/etc/systemd/system/dino-world.service`:

```ini
[Unit]
Description=Dino World Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/dino-world
EnvironmentFile=/opt/dino-world/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
User=dinoworld
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Adjust `WorkingDirectory`, `EnvironmentFile`, and `User` to match your deployment:

- `WorkingDirectory`: The directory where the bot code lives (must contain `dist/` and `.env`).
- `EnvironmentFile`: Path to the `.env` file; systemd will load all `KEY=value` lines.
- `User`: A dedicated system user (e.g., `dinoworld`) that owns the bot process. Create this user with `useradd -r -s /bin/false dinoworld` if it doesn't exist.
- Logs are sent to systemd's journal; view them with `journalctl` (see below).

Enable and start the service:

```bash
sudo systemctl enable --now dino-world
```

View logs in real-time:

```bash
sudo journalctl -u dino-world -f
```

Check status:

```bash
sudo systemctl status dino-world
```

Stop the service:

```bash
sudo systemctl stop dino-world
```

### Using pm2 (Alternative)

If systemd is not available, [pm2](https://pm2.keymetrics.io/) is a simple alternative:

```bash
npm install -g pm2
pm2 start dist/index.js --name dino-world
pm2 save
pm2 startup
```

View logs:

```bash
pm2 logs dino-world
```

## Database Backups

The entire game state lives in a single SQLite database file (the file at `DATABASE_PATH`). SQLite's [online backup API](https://www.sqlite.org/backup.html) allows safe backups while the bot is running without stopping the service.

### Nightly Cron Backup

Add this line to your crontab (`crontab -e`):

```
0 3 * * * sqlite3 /opt/dino-world/dino-world.db ".backup '/opt/dino-world/backups/dino-$(date +\%F).db'"
```

This runs at 3 AM UTC daily, creating a backup named `dino-YYYY-MM-DD.db` (e.g., `dino-2025-03-15.db`). The `.backup` command is crash-safe and consistent; it does not require stopping the bot.

### Backup Retention

Implement a retention policy to avoid filling disk:

```bash
find /opt/dino-world/backups -name "dino-*.db" -mtime +30 -delete
```

Add this to crontab to delete backups older than 30 days:

```
0 4 * * * find /opt/dino-world/backups -name "dino-*.db" -mtime +30 -delete
```

### Off-Box Backups

For disaster recovery, copy backups to a remote location (cloud storage, another server, etc.). For example, with rsync:

```bash
0 5 * * * rsync -az /opt/dino-world/backups/ backup-server:/remote/dino-backups/
```

## Enabling / Disabling Modules

Dino World is a modular monolith. Gameplay features are toggled via `modules.json` at the repository root.

Example `modules.json`:

```json
{
  "park": true,
  "hatchery": true,
  "expeditions": true,
  "shop": true,
  "settings": true,
  "care": true,
  "trading": true,
  "leaderboards": true,
  "admin": true
}
```

Seventeen modules ship today:

- `park` — paddocks, upgrades, park rating, decorations.
- `hatchery` — eggs, incubation, hatching, Mythic purchases.
- `expeditions` — dispatching dinos on expeditions for loot.
- `shop` — egg/food/decor shop with a daily deal, and dino sales.
- `settings` — per-guild configuration (e.g. notification channel, world bulletin opt-in).
- `care` — feeding dinos and rescuing escapees.
- `trading` — player-to-player dino/egg/currency trades with escrow.
- `leaderboards` — server and global rankings by rating, cash, collection, legacy, battle stars, duel rating, season points, and attendance.
- `admin` — owner-only tools: grant resources, inspect/reset a player, fast-forward a player's clock (QA).
- `help` — in-game command reference and getting-started guide.
- `battles` — the PvE campaign: fight chapter stages with a squad for cash, shards, and eggs.
- `genelab` — pair or splice dinos for traits in the Gene Lab.
- `daily` — daily quest board, streaks, chests, and lifetime achievements.
- `world` — the daily world event and season, plus the opt-in world bulletin broadcast.
- `dex` — the species compendium, with filters and per-species detail.
- `duels` — free player-versus-player exhibition duels and the duel rating.
- `guests` — park attendance, the attraction catalog, and one-time attendance milestones.

Admin commands are gated to the OWNER_ID user and hidden from non-admins in the Discord UI. Set OWNER_ID in .env.

Set any flag to `false` to disable that module. The `ModuleRegistry` only wires up commands and components for modules whose flag is `true`, so disabling a module removes its slash commands the next time `npm run deploy-commands` runs.

### After Changing modules.json

1. **Restart the bot**: If using systemd:
   ```bash
   sudo systemctl restart dino-world
   ```

2. **Redeploy commands**: Discord's registered command set must match the enabled modules. Always run:
   ```bash
   npm run deploy-commands
   ```

   Commands for disabled modules will be removed from Discord. This is required for the bot to start cleanly on the next restart.

If commands and enabled modules don't match, the bot will log warnings and disabled module commands will appear to users but fail at runtime.

### Post-Deploy Smoke Check

After `npm run deploy-commands`, confirm the new command set is live by exercising one command per module in Discord:

- `/park view` — dashboard renders.
- `/park view` — a park-map image appears above the dashboard.
- `/hatch` (or `/shop`) — economy commands respond.
- `/feed all` and `/rescue` — care loop works.
- `/trade offer user:@someone give-cash:10` then the recipient runs `/trade accept id:<n>` — the escrow swap completes; `/trade list`, `/trade decline`, `/trade cancel` respond.
- `/top metric:rating` and `/top metric:collection scope:global` — leaderboards render.
- `/guests view` — attendance and the attraction catalog render; `/guests build attraction:picnic_lawn` responds.
- `/admin inspect user:@you` — returns your raw state (owner only).
- `/world` — today's event, season, and turnover countdown render, with the event banner image; `/settings world-news state:on` — confirms the opt-in bulletin toggle (run as a user with Manage Guild permission).

All commands should reply without an "application did not respond" timeout. If a command is missing, re-run `npm run deploy-commands` (guild deploys are instant; global takes up to ~1h).

## After a PR Merges (local development machine)

The loop for the Windows dev box, distinct from the VPS flow in the next section:
here the bot is a foreground `npm start` you manage by hand, and Windows file
locking changes the safe ordering.

### 1. Sync

```bash
git checkout main
git pull --ff-only
```

### 2. Decide whether dependencies moved

```bash
git diff --name-only HEAD@{1} HEAD | grep -E 'package(-lock)?\.json'
```

Anything printed — every Dependabot PR qualifies — means you need `npm ci`.
**Stop the bot first.** On Windows a running bot holds
`node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node` open for the
park renderer. `npm ci` clears `node_modules` before it reinstalls, then fails to
replace that one locked file and aborts, leaving `node_modules/.bin/` **empty**.
The symptom is confusing and looks unrelated: `vitest` disappears from `PATH` and
`npm test` fails with `'vitest' is not recognized as an internal or external
command`. Stop, reinstall, then start — never reinstall against a live process.

This is Windows-specific. Linux replaces an open file by swapping the inode, so
the VPS flow below reinstalls without stopping the service.

If nothing printed, skip `npm ci` — it is otherwise pure downtime.

### 3. Build and verify

```bash
npm run build      # the bot serves compiled dist/ — a merge alone changes nothing
npm run typecheck  # the only gate covering tests/ and scripts/
npm test
```

`npm run build` is `tsc` against `tsconfig.json`, which includes `src` only, and
`npm test` transpiles without typechecking. A type error in a test or a script
passes both and is caught only by `npm run typecheck`.

Chain these with `&&` rather than running them separately, and **never pipe a
command whose exit status you are checking** — `npm ci 2>&1 | tail -4` reports
`tail`'s exit code, so a hard install failure reads as success.

### 4. Restart

Find the process. PowerShell shows full command lines, which `tasklist` does not:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, CreationDate, @{n='Cmd';e={$_.CommandLine}} | Format-List
```

Kill the `node dist/index.js` child; the `npm start` wrapper exits with it. From
Git Bash, `MSYS_NO_PATHCONV=1` is required or MSYS rewrites `/PID` into a
filesystem path and `taskkill` rejects it:

```bash
MSYS_NO_PATHCONV=1 taskkill /PID <pid-of-node-dist-index.js> /F
npm start
```

### 5. Confirm the restart took

Re-run the PowerShell query and confirm there is **exactly one**
`node dist/index.js`. Two processes on one token makes every interaction fail with
`10062 Unknown interaction`, which reads like a code bug and is not one.

Startup logs `Logged in as …` and `Loaded N application emojis`.

To prove the *new* build is live, do not rely on that emoji count — it only moves
when the release actually changed emojis, so an unchanged count proves nothing
either way. Check the compile time and grep the built output for something the
release introduced:

```bash
ls -l --time-style=+%H:%M:%S dist/index.js
grep -c "<symbol the release added>" dist/modules/<touched-module>/index.js
```

### Conditional extras

| Run when | Command |
| --- | --- |
| A slash-command **builder** changed — options, choices, subcommands | `npm run deploy-commands` |
| Anything under `assets/emojis/` changed | `npm run build-emojis`, then `npm run deploy-emojis` |
| You want the payload gallery for cosmetic review | `npm run test:live` |
| A migration shipped | nothing — migrations apply automatically on boot |

Changing a command builder also requires exactly one running bot instance per
token, so run `deploy-commands` around the restart rather than alongside a second
process.

## Updating to a New Version

This is the **VPS / systemd** flow. For the local development machine, where the
bot is a foreground `npm start` and Windows file locking changes the safe
ordering, see [After a PR Merges](#after-a-pr-merges-local-development-machine)
above.

Before deploying a new version, **back up the database**:

```bash
cp /opt/dino-world/dino-world.db /opt/dino-world/dino-world.db.backup-$(date +%F)
```

Then:

1. **Pull the latest code**:
   ```bash
   cd /opt/dino-world
   git pull origin main
   ```

2. **Reinstall dependencies**:
   ```bash
   npm ci
   ```
   See step 3 of **Deployment Steps** above — this still needs `devDependencies`
   for the rebuild in the next step, so it also still pulls down the
   `ffmpeg-static` binary the asset pipeline needs and the running bot does not.

3. **Rebuild**:
   ```bash
   npm run build
   ```

4. **Redeploy commands** (if commands changed in this release):
   ```bash
   npm run deploy-commands
   ```

5. **Redeploy emojis** (if any emoji SVG/PNG changed in this release):
   ```bash
   npm run deploy-emojis
   ```
   Then commit the updated `assets/emojis/manifest.json` — see step 6 of **Deployment Steps** above for why losing that file is costly. Do this before restarting the service in the next step.

6. **Redeploy branding** (rare — only if `assets/branding/*` changed in this release):
   ```bash
   npm run deploy-branding -- --dry-run
   npm run deploy-branding
   ```
   This is a live write to the bot's Discord profile and is rate-limited to
   roughly two edits per hour, so it has no place in the routine checklist —
   run it only when the avatar or banner art actually changed, and run the
   `--dry-run` pass first. There is no automated check for the result; confirm
   it visually in a Discord client afterward.

7. **Restart the service**:
   ```bash
   sudo systemctl restart dino-world
   ```
   Restart **after** `deploy-emojis`, not before — the runtime emoji map is fetched once at `ClientReady`, so an already-running process won't see new emoji IDs until it restarts.

   On the first restart after this release, expect a one-time burst of proactive park alert DMs: `alerts_enabled` defaults to true for every pre-existing user row, so the first `alert_sweep` after boot finds most idle players already past their income cap. Sends are throttled (one per ~250ms) to keep this from hammering Discord's DM-open rate limit, but it's still worth watching the logs for 429s right after this restart.

8. **Verify** it started: Check logs and confirm the bot is online in your test server.

## Release Smoke Test

A ~5-minute manual test to run in a development Discord server after each release. This verifies core game flows work end-to-end. The test requires a live bot in a server you control; it cannot be automated.

### Prerequisites

- A development Discord server (your test guild).
- The bot invited to that server with manage commands + send messages + embed links permissions.
- Write access to the bot's source directory (to run commands).

### Steps

1. **Deploy commands**:
   ```bash
   npm run deploy-commands
   ```
   Should report `29` commands deployed (park, hatchery, expeditions, shop, settings, care, trading, leaderboards, admin, help, battles, genelab, daily, world, dex, duels, and guests modules combined).

2. **Start the bot**:
   ```bash
   npm run dev
   ```
   (Or if using systemd, verify it's running with `sudo systemctl status dino-world`.)
   
   Look for the log line: `Logged in as <BotName>#<Discriminator>.` (or just the username in modern Discord.js).

3. **In your development server, test each command**:

   **a) `/park view`**
   - Should display a dashboard embed showing:
     - **Cash**: Current coins (will be 0 if first-time player).
     - **Rating**: Park rating (initially 0).
     - **Dinos**: Dinosaur count (initially 0).
     - **Lots**: Paddock count (initially 0).
     - **Collect button**: A button to collect income (interact in the next step).
   - Embed should have a color and footer indicating the bot is live.

   **b) `/build kind:herbivore paddock`**
   - Should respond: `Built paddock #1.` (or similar).
   - Repeat 2 more times: you should build paddocks #2 and #3.
   - On the 4th build attempt: should respond that the lot limit (3) is reached and give the maximum-level message.
   - This tests the core build system and lot validation.

   **c) `/park rename name:Test`**
   - Park name should change to `Test`.
   - Subsequent `/park view` should show the new name.

   **d) `/upgrade lot:1`**
   - If the first paddock exists and you have enough cash (unlikely on first run; upgrade fails with "Not enough cash" if true):
     - Should respond with the upgrade success message or cash error.
     - If this is first-time testing, expect "Not enough cash" — this is normal and expected.
   - Tests the upgrade validation system.

   **e) Click the Collect button** (from `/park view`):
   - Should reply with a message like `Collected 0 cash.` on a fresh park with no assigned dinos, or a positive amount once a dino has been assigned to a paddock (see step 3j below).
   - Tests the interaction handler and income calculation path.

4. **Test the acquisition loop** (hatchery, expeditions, shop, and settings modules):

   **f) `/expedition start site:Coastal Dig`**
   - Should respond that a dino has been dispatched to the site.
   - Wait for the expedition's travel time to elapse, then run `/expedition claim`.
   - Should award an egg plus bonus cash/food, and a hatch/expedition ping should post to the configured notification channel (or DM if none is set — see step 4g).

   **g) `/eggs`**
   - Should list the egg claimed in the previous step.

   **h) `/incubate egg:<id>`**
   - Should mark the egg as incubating and report the time until it's ready.

   **i) `/hatch egg:<id>`** (once incubation completes)
   - Should show a "Crack it open!" button.
   - Clicking it should reveal a species-reveal card for the newly hatched dino.

   **j) `/dino assign dino:<id> lot:<paddock id>`**
   - Should confirm the dino was assigned to the paddock.
   - Wait a few minutes, then run `/park view` and click **Collect** — income should now accrue above 0.

   **k) `/shop view`**
   - Should show today's eggs, food, decor, and the Daily Deal.
   - `/shop egg rarity:common` — should buy a common egg and deduct cash.
   - `/sell dino:<id>` — should show a confirm button; confirming should pay out cash and shards (watch the 60-shard/day cap; sales past the cap still pay cash but no more shards for the day).

   **l) `/decorate lot:<id> item:Palm Tree`**
   - Should add the decoration to the paddock and raise its comfort/rating.

   **m) `/settings channel channel:#some-channel`** (run as a user with Manage Guild permission)
   - Should confirm the notification channel was set.
   - Future hatch/expedition pings should post to that channel instead of falling back to DM.
   - This channel does not receive the three proactive park alerts (escape warning, income cap, season ending) — those are always a DM; see step (p) below.

   **n) `/mythic species:<name>` (requires 8★ high-water park rating and 500 shards)**
   - Should show a confirm button and deduct nothing yet; confirming should deduct the shards and grant a Mythic egg of the requested species.

5. **Test the care loop** (care module — feeding and rescue):

   **o) Assign a dino to a paddock** (via `/dino assign dino:<id> lot:<paddock id>`, if not already done in step 3j) and let its hunger fall over time.
   - `/feed one dino:<id>` — should restore the dino's hunger and charge food.
   - `/feed all` — should feed every hungry dino, hungriest first, and report how many were fed. Any dino it could not feed should be named in a per-diet breakdown giving the units that diet needs and the stock actually held.

   **p) Trigger an escape, catching the proactive alert on the way, then clear it**
   - Leave a dino unfed long enough that its comfort drops below 25% and stays there past the 8-hour grace period.
   - With alerts on (`/park alerts state:on` — see step (q) for the toggle command itself), check your DMs periodically **during that same unfed wait, before the next bullet below**: once the dino is projected to escape within 12 hours, the next 15-minute alert sweep should DM you with 🍖 Feed all and 🔕 Mute buttons, never a channel post even if step (m) set a notification channel. This is a *pre*-escape warning — check for it before you run the next bullet, which stamps the escape and closes the window for good; there is nothing left to warn about once the dino has actually escaped.
   - `/park view` or `/dino list` should now show the dino as escaped, and its paddock's income should halt.
   - `/rescue dino:<id>` — should pay the recapture fee, clear the escape, and restore the dino's comfort.

   **q) `/park alerts state:off`** then **`/park alerts state:on`**
   - Should confirm alerts are off, then confirm they're back on.
   - Pressing 🔕 Mute on the alert DM from step (p) should have the same effect as `/park alerts state:off`.
   - 💰 Collect only appears on that combined alert when pending income has separately hit its cap (see Income, `docs/gameplay.md` §4) — step (p)'s setup alone won't show it.

6. **Verify no errors in logs**:
   - Check the terminal (or `journalctl`) for any `ERROR` or `WARN` lines. The bot should log at `INFO` level with slash command invocations and results.
   - No `TypeError`, `SyntaxError`, or uncaught exceptions should appear.

### Outcomes

- ✅ **Pass**: All commands responded, embeds rendered, collect button worked, no errors in logs.
- ❌ **Fail**: Any command errored, embed was malformed, button didn't work, or error logs appeared.

If any step fails, check the bot's logs for the error and debug before merging / deploying to production.

### Known Limitations

- **Dino collection income**: The `/park view` Collect button yields 0 cash until a dino has been hatched (or won from an expedition) and assigned to a paddock via `/dino assign`. This is expected on a brand-new park. Income logic is covered by automated unit tests in `tests/`.
- **Shard cap**: `/sell` stops awarding shards once the 60-shard daily cap is hit; cash payout continues regardless. This is expected, not a bug. (Raised from 40 so a 15-shard `/splice` doesn't starve the 500-shard Mythic purchase — see `docs/gameplay.md` §11.)
- **Slash command registration**: If commands don't appear in your Discord server, ensure the bot has the `applications.commands` scope and `chat_input` permission in your OAuth application settings.

## GitHub Repository

The repository lives at
`https://github.com/RegEdits-TSC/Dino-World-Discord-Bot` (public — see
note below).

Configuration enforced server-side:

- A ruleset on `main` requires a pull request with a passing CI `test`
  check before merging, and blocks force pushes and branch deletion.
  The repository admin role bypasses the PR requirement — that is how
  small doc/code changes land directly on main. CI still runs on every
  push to main.
- Pull requests merge by squash only; the squash commit title comes
  from the PR title and the body from the PR description. Head
  branches are deleted automatically after merge.
- GitHub Actions may only run GitHub-owned and verified-creator
  actions, and the default `GITHUB_TOKEN` is read-only.
- Dependabot vulnerability alerts, security-update PRs, and weekly
  version-update PRs (npm and github-actions ecosystems) are enabled.

The repo is public because branch rulesets are unavailable on private
repos under GitHub Free. To keep it private, upgrade to GitHub Pro/Team,
then flip visibility back with
`gh repo edit RegEdits-TSC/Dino-World-Discord-Bot --visibility private`;
the ruleset survives the switch.

To re-check all of this, run the assertion script in the final task of
`docs/superpowers/plans/2026-07-26-private-repo-setup.md`.
