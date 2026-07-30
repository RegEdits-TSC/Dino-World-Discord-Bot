# Security Policy

## Supported versions

Dino World is a self-hosted bot with no release channel. Only the latest commit
on `main` is supported. If you are self-hosting an older commit, update before
reporting a problem.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through GitHub's private vulnerability reporting:

**[Open a private security advisory](https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/security/advisories/new)**

Include what you found, how to reproduce it, and what an attacker could do with
it. You will get a response on the advisory thread.

## Handling secrets

The bot reads its credentials from a `.env` file, which is gitignored and must
never be committed:

| Variable | Why it is sensitive |
| --- | --- |
| `DISCORD_TOKEN` | Full control of the bot account. Anyone holding it can read and post as your bot. |
| `DISCORD_CLIENT_ID` | Not secret on its own, but identifies your application. |
| `OWNER_ID` | The Discord user ID allowed to run owner-only `/admin` commands. |

When you file an issue or a pull request, **never paste a token** — not in a
description, not in a log excerpt, not in a screenshot. Redact it first.

If a token is exposed, regenerate it immediately in the
[Discord Developer Portal](https://discord.com/developers/applications) under
your application's Bot settings. Regenerating invalidates the leaked token.

## Scope

Dino World has no user accounts, no payment handling, and no personal data
beyond Discord user IDs. The realistic security surface is:

- exposure of the bot token,
- the owner-only `/admin` commands, which can grant resources and reset players,
- the SQLite database file, which holds every park's state.
