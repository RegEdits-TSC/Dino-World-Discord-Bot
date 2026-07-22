# Dino World

Dino World is a dinosaur park tycoon game played entirely inside Discord.
Players build a park, collect dinosaurs through eggs and expeditions, care
for them, and climb leaderboards, all through slash commands. Each park is
owned by a single Discord user and is shared globally across every server
the bot is in. The bot is built with TypeScript and discord.js, stores its
data in a local SQLite database via Drizzle ORM, and is organized as a
modular monolith so gameplay systems can be added or removed independently.
`/park view` renders a PNG park-map image of your paddocks and facilities
alongside the dashboard, falling back to the text-only embed if rendering
is unavailable.
Options that take an id — eggs, dinos, lots, trades, expedition sites, shop
rarities, admin species — offer autocomplete suggestions as you type, with
currently-valid picks listed first and everything else tagged with its state.

## Setup

Copy the environment template and fill in your own values:

```
cp .env.example .env
```

`DISCORD_TOKEN` and `DISCORD_CLIENT_ID` come from your application in the
Discord Developer Portal, `DATABASE_PATH` is where the SQLite database file
will be created, and `OWNER_ID` is the Discord user ID that should have
access to owner-only commands.

Install dependencies:

```
npm i
```

Register the bot's slash commands with Discord:

```
npm run deploy-commands
```

Re-run this whenever command definitions change — autocomplete flags and
option descriptions are part of the registered command shape.

Start the bot in development mode (restarts on file changes):

```
npm run dev
```

## Building & type checking

Type checking is run as part of the test suite, but you can also check types independently:

```
npm run typecheck
```

Build the TypeScript to JavaScript:

```
npm run build
```

## Testing

Run the test suite with:

```
npm test
```

## Deployment & Operations

For deploying to a VPS, running as a system service, managing backups, and the release smoke test checklist, see [Operations Runbook](docs/ops.md).
