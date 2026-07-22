# Operations Runbook

This guide covers deploying Dino World to production, running it as a system service, managing backups, and the release smoke test checklist.

## Deploying to a VPS

### Prerequisites

- **Node.js**: Install the current LTS version via [nvm](https://github.com/nvm-sh/nvm) (or your system package manager). The bot requires Node.js 18 or later.
- **Git**: For cloning and pulling updates.
- **SQLite**: Usually included with the OS; required for local database operations.

### Deployment Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-org/dino-world-bot.git
   cd dino-world-bot
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

6. **Start the bot**:
   - **Direct**: `node dist/index.js`
   - **With systemd** (recommended): See the section below.

The bot will log "Logged in as ..." when connected. It stores all state in the SQLite database at `DATABASE_PATH`.

### Park rendering

`/park view` renders a PNG park map in a worker thread using `@napi-rs/canvas`
(native, prebuilt binaries — no system libraries to install). Fonts are bundled
at `assets/fonts/` (Noto Sans + Noto Color Emoji) and must ship with the deploy;
they are read relative to the process working directory, so run the bot from the
repo root (the systemd unit already sets `WorkingDirectory`). If rendering fails
or exceeds ~3s, `/park view` automatically falls back to the text-only embed —
the command never fails because of the renderer.

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

Nine modules ship today:

- `park` — paddocks, upgrades, park rating, decorations.
- `hatchery` — eggs, incubation, hatching, Mythic purchases.
- `expeditions` — dispatching dinos on expeditions for loot.
- `shop` — daily egg/food/decor rotation and dino sales.
- `settings` — per-guild configuration (e.g. notification channel).
- `care` — feeding dinos and rescuing escapees.
- `trading` — player-to-player dino/egg/currency trades with escrow.
- `leaderboards` — server and global rankings by rating, cash, and collection.
- `admin` — owner-only tools: grant resources, inspect/reset a player, fast-forward a player's clock (QA).

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
- `/admin inspect user:@you` — returns your raw state (owner only).

All commands should reply without an "application did not respond" timeout. If a command is missing, re-run `npm run deploy-commands` (guild deploys are instant; global takes up to ~1h).

## Updating to a New Version

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

3. **Rebuild**:
   ```bash
   npm run build
   ```

4. **Redeploy commands** (if commands changed in this release):
   ```bash
   npm run deploy-commands
   ```

5. **Restart the service**:
   ```bash
   sudo systemctl restart dino-world
   ```

6. **Verify** it started: Check logs and confirm the bot is online in your test server.

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
   Should report `17` commands deployed (park, hatchery, expeditions, shop, settings, care, trading, and leaderboards modules combined).

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
   - Should show today's egg, food, and decor rotation.
   - `/shop egg rarity:common` — should buy a common egg and deduct cash.
   - `/sell dino:<id>` — should show a confirm button; confirming should pay out cash and shards (watch the 40-shard/day cap; sales past the cap still pay cash but no more shards for the day).

   **l) `/decorate lot:<id> item:Palm Tree`**
   - Should add the decoration to the paddock and raise its comfort/rating.

   **m) `/settings channel channel:#some-channel`** (run as a user with Manage Guild permission)
   - Should confirm the notification channel was set.
   - Future hatch/expedition pings should post to that channel instead of falling back to DM.

   **n) `/mythic species:<name>` (requires 4★ high-water park rating and 500 shards) → grants a Mythic egg.**
   - Should deduct the shards and grant a Mythic egg of the requested species.

5. **Test the care loop** (care module — feeding and rescue):

   **o) Assign a dino to a paddock** (via `/dino assign dino:<id> lot:<paddock id>`, if not already done in step 3j) and let its hunger fall over time.
   - `/feed one dino:<id>` — should restore the dino's hunger and charge food.
   - `/feed all` — should feed every hungry dino, hungriest first, and report how many were fed (and how many were skipped for lack of food).

   **p) Trigger and clear an escape**
   - Leave a dino unfed long enough that its comfort drops below 25% and stays there past the 8-hour grace period.
   - `/park view` or `/dino list` should now show the dino as escaped, and its paddock's income should halt.
   - `/rescue dino:<id>` — should pay the recapture fee, clear the escape, and restore the dino's comfort.

6. **Verify no errors in logs**:
   - Check the terminal (or `journalctl`) for any `ERROR` or `WARN` lines. The bot should log at `INFO` level with slash command invocations and results.
   - No `TypeError`, `SyntaxError`, or uncaught exceptions should appear.

### Outcomes

- ✅ **Pass**: All commands responded, embeds rendered, collect button worked, no errors in logs.
- ❌ **Fail**: Any command errored, embed was malformed, button didn't work, or error logs appeared.

If any step fails, check the bot's logs for the error and debug before merging / deploying to production.

### Known Limitations

- **Dino collection income**: The `/park view` Collect button yields 0 cash until a dino has been hatched (or won from an expedition) and assigned to a paddock via `/dino assign`. This is expected on a brand-new park. Income logic is covered by automated unit tests in `tests/`.
- **Shard cap**: `/sell` stops awarding shards once the 40-shard daily cap is hit; cash payout continues regardless. This is expected, not a bug.
- **Slash command registration**: If commands don't appear in your Discord server, ensure the bot has the `applications.commands` scope and `chat_input` permission in your OAuth application settings.
