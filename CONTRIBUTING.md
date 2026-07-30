# Contributing to Dino World

Thanks for your interest. This is a TypeScript Discord bot backed by SQLite, and
it has a few conventions that are easy to trip over. Reading this first will
save you a round of review.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting set up

You need **Node 22 or newer** (`engines.node` enforces this) and your own Discord
application for development.

```bash
git clone https://github.com/RegEdits-TSC/Dino-World-Discord-Bot.git
cd Dino-World-Discord-Bot
npm i
cp .env.example .env
```

Fill in `.env` from your application in the
[Discord Developer Portal](https://discord.com/developers/applications). See the
[README](README.md#quick-start) for what each variable does.

Register the commands against a test guild, then start the bot:

```bash
npm run deploy-commands
npm run dev
```

Setting `DEV_GUILD_ID` deploys commands to that one guild instantly. Leaving it
unset deploys globally, which Discord can take up to an hour to propagate — use a
dev guild while you work.

## Repository conventions

These are not style preferences. Breaking them causes real bugs.

**Imports carry a `.js` extension.** The project is ESM with NodeNext module
resolution, so a relative import must be written `./service.js` even though the
file on disk is `service.ts`.

**Time and randomness come from the context, never the global.** Use `ctx.now()`
instead of `Date.now()` and `ctx.rng()` instead of `Math.random()`. Tests inject
both, so a direct global call makes the behaviour untestable and
non-deterministic.

**Database access is synchronous.** The stack is drizzle over better-sqlite3 —
call `.get()`, `.all()`, or `.run()` and use the result directly. Do not `await`
a database call.

**Validate at the boundaries.** Check user input, external API responses, file
I/O, and environment variables. Past those boundaries, trust internal code rather
than piling up defensive null checks.

## Before you commit

**`npm test` does not typecheck.** Neither does `npm run build`, which only
compiles `src`. A type error in a test file passes both and still breaks the
build later.

Run the typecheck explicitly:

```bash
npm run typecheck
```

This is `tsc --noEmit` over `src`, `tests`, and `scripts`. Run it before every
commit that touches `tests/` or `scripts/`.

## Testing

There are two tiers.

**The offline suite** is the one you run constantly:

```bash
npm test
```

It is a strict simulation of Discord's semantics, not a loose mock. Reply-once
and defer-before-edit rules are enforced, payload size limits are checked, and
option getters are validated against each command's real builder — so a fixture
with a misspelled option key fails loudly instead of silently returning null. It
covers commands, buttons, autocomplete, and the multi-step journeys that string
them together.

**The live sweep** posts real output to a Discord channel for cosmetic review:

```bash
npm run test:live
```

It needs `DISCORD_TOKEN`, `DEV_GUILD_ID`, and `TEST_CHANNEL_ID` in `.env`. It is
REST-only — it never opens a gateway connection, so it is safe to run while the
bot is live and will not collide with the running instance's session.

## Adding a module

Registering a new module touches four places. Miss one and the tests will tell
you, but it is faster to do all four up front:

1. `modules.json` — the enabled-module list.
2. `src/core/module-list.ts` — add it to the `ALL_MODULES` array. Both
   `src/index.ts` and `src/deploy-commands.ts` import from here, so neither needs
   editing.
3. `tests/registry-load.test.ts` — update the expected command count.
4. `tests/config.test.ts` — update the expected module list.

## Changing a command

If you change a command builder — adding an option, changing a description,
marking an option as autocompleting — Discord needs to be told:

```bash
npm run deploy-commands
```

Run exactly **one bot instance per token**. Two processes on the same token race
each other and every command fails with an unknown-interaction error, which looks
like a code bug but is not.

## Pull requests

Open a pull request against `main`. A good one:

- does one thing, and says what in the description;
- includes a test that would have failed before the change;
- passes `npm run typecheck` and `npm test`;
- includes screenshots if it changes what an embed or image looks like.

CI runs the typecheck and the offline suite on every pull request and on pushes
to `main`.

Never skip, disable, or weaken a test to make a change pass. If a test fails,
find the cause.

## Reporting security problems

Do not open a public issue. See [SECURITY.md](SECURITY.md).
