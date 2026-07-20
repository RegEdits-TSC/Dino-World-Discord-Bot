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

6. **Start the bot**:
   - **Direct**: `node dist/index.js`
   - **With systemd** (recommended): See the section below.

The bot will log "Logged in as ..." when connected. It stores all state in the SQLite database at `DATABASE_PATH`.

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
  "park": true
}
```

The `park` module is currently the only module. Set it to `false` to disable it.

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
   Should output: `Deployed 3 commands.` (for the park module).

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
   - Should reply with a message like `Collected 0 cash.` (0 is expected; dino income requires the hatchery module in a future release).
   - Tests the interaction handler and income calculation path.
   - Income logic is covered by automated tests; manual Collect is only to verify the interaction path works.

4. **Verify no errors in logs**:
   - Check the terminal (or `journalctl`) for any `ERROR` or `WARN` lines. The bot should log at `INFO` level with slash command invocations and results.
   - No `TypeError`, `SyntaxError`, or uncaught exceptions should appear.

### Outcomes

- ✅ **Pass**: All commands responded, embeds rendered, collect button worked, no errors in logs.
- ❌ **Fail**: Any command errored, embed was malformed, button didn't work, or error logs appeared.

If any step fails, check the bot's logs for the error and debug before merging / deploying to production.

### Known Limitations

- **Dino collection income**: The `/park view` Collect button will always yield 0 cash on this release. This is expected — dino hatching and collection income are part of a future module (Plan 2). For now, the income path is tested via automated unit tests in `src/tests/`.
- **Slash command registration**: If commands don't appear in your Discord server, ensure the bot has the `applications.commands` scope and `chat_input` permission in your OAuth application settings.
