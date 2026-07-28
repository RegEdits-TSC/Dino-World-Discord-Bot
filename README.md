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
`/help [topic]` is how to play — run it with no topic for a first-ten-minutes
walkthrough plus a topic index, or pass a topic (getting-started, park, eggs,
expeditions, shop, care, trading, ranks, battles) for a focused guide on that
system.
Embeds carry generated art — egg icons per rarity, expedition site art — living
under `assets/images/`; every embed degrades gracefully and still renders,
just without the image, when a file is absent.
Food comes in six diet-typed items — Ferns, Fruit Basket, and Royal Greens for
herbivores; Fish, Goat, and Prime Steak for carnivores — bought by item and
quantity via `/shop food item:<food> units:<n>`, with carnivore food costing
about 20% more than the matching herbivore tier. Higher tiers overfill hunger
(up to 150) so dinos stay fed longer between feedings, and `/feed` only
accepts food matching a dino's diet.
Battles are a PvE campaign fought with your collection: `/battle chapters`
shows four chapters themed to the expedition sites (five stages each, the
fifth a boss), and `/battle fight stage:<stage> dino1:<id> [dino2] [dino3]`
sends a squad of one to three dinos into an auto-resolved fight that plays
back as a four-frame cinematic with a Skip button. Attempts spend energy
(10 max, one back every 10 minutes), wins pay cash and food scaled by a 0–3
star rating plus one-time first-clear shards, every fight pays per-dino
battle XP up to level 10, and each chapter's boss first-clear awards a
high-rarity egg and unlocks the next chapter alongside that site's rating
gate.

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

Build and upload the bot's 21 custom application emojis:

```
npm run build-emojis
npm run deploy-emojis
```

`build-emojis` renders the hand-authored SVGs under `assets/emojis/svg/` to
committed PNGs under `assets/emojis/png/`; `deploy-emojis` uploads any
changed PNGs to Discord and writes `assets/emojis/manifest.json`, which must
be committed afterward — see [Operations Runbook](docs/ops.md) for why.

Start the bot in development mode (restarts on file changes):

```
npm run dev
```

## Building & type checking

Type checking is separate from the test suite (`npm test` runs vitest only and does not
typecheck) — run it explicitly:

```
npm run typecheck
```

Build the TypeScript to JavaScript:

```
npm run build
```

## Testing

There are two tiers, plus a repo command that runs both.

Run the offline suite with:

```
npm test
```

This is a strict Discord-semantics simulation — reply-once and defer rules,
payload-size limits, and option getters checked against each command's real
builder are all enforced the way discord.js itself would enforce them. It
covers every entry point (commands, buttons, autocomplete) and the
multi-step journeys that string them together (hatch an egg, run an
expedition, trade with another player, and so on).

Run the live sweep against a dev guild with:

```
npm run test:live
```

This tier is REST-only: it deploys the current builders to `DEV_GUILD_ID` so
Discord itself validates them, then drives the same commands and posts every
resulting embed, button row, and image to `TEST_CHANNEL_ID` for a human to
scroll through and cosmetically review, and checks that every emoji the bot
references is actually deployed. It never opens a gateway connection, so it's
safe to run while the bot is live — it won't collide with the running
instance's session. Requires `DISCORD_TOKEN`, `DEV_GUILD_ID`, and
`TEST_CHANNEL_ID` set in `.env`.

The `/verify` repo command runs typecheck, both test tiers (skipping the live
sweep if its env vars aren't set), and reports a pass/fail summary.

CI runs typecheck and the offline suite on every pull request and on pushes to main.

## Deployment & Operations

For deploying to a VPS, running as a system service, managing backups, and the release smoke test checklist, see [Operations Runbook](docs/ops.md).
