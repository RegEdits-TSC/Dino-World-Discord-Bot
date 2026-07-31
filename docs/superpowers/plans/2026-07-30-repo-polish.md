# Repo Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Dino World's repository into a legible, trustworthy public project — a lean landing README, a command reference and gameplay guide under `docs/`, the missing MIT license, the four community files, and the GitHub settings that are currently switched off.

**Architecture:** Documentation and metadata only. Nothing in this plan executes at runtime, so correctness is about references resolving and facts being true, not about behaviour. Every gameplay number comes from one committed source of truth — the facts reference — rather than from memory or from the current README. Work happens on branch `repo-polish` in a dedicated worktree so it never collides with `art-assets-round-3`.

**Tech Stack:** Markdown, GitHub issue-form YAML, shields.io badges, the `gh` CLI, npm scripts (`typecheck`, `test`).

## Global Constraints

These apply to every task. A task's requirements implicitly include this section.

- **Working directory is the worktree:** `C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot-repo-polish`, branch `repo-polish`, based on `origin/main` @ `a2a6276`. Never edit the main checkout at `C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot` — another branch is live there.
- **Authorship:** every artifact is authored by **RegEdits-TSC**. That is the `author` field in `package.json`, the copyright holder in `LICENSE`, and any maintainer reference in the docs. Use the bare name — never `Name <email>` form.
- **No email address appears anywhere**, in any file this plan creates or edits. Not in `CODE_OF_CONDUCT.md`, not in `SECURITY.md`, not in `package.json`, not in an issue template. Where upstream template text ships an email placeholder such as `[INSERT CONTACT METHOD]`, **remove and replace it** — never fill it in with an address, and never leave the placeholder in place.
- **No attribution to any tool, assistant, AI, model, or generator** in any file, commit message, or PR body. Commit messages are written in the project's own voice.
- **Contact routing:** everywhere an email would conventionally go, point at GitHub instead — the private vulnerability reporting form for security and conduct reports, `@RegEdits-TSC` for everything else.
- **Repository URL:** `https://github.com/RegEdits-TSC/Dino-World-Discord-Bot`
- **Facts rule:** `docs/gameplay.md` may not state a game number that does not appear in `docs/superpowers/specs/2026-07-30-repo-polish-gameplay-facts.md`. Anything that document lists under "Open questions and gaps" is not safe to publish — omit it or state it qualitatively.
- **No changes to `src/`, `tests/`, `assets/`, the CI workflow, or Dependabot config.** `package.json` changes are metadata fields only — no dependency, script, or `engines` edits.
- **Commit after every task.** One commit per task, message in the imperative.

## Before you start

The worktree is a fresh checkout with no `node_modules`. Install once:

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot-repo-polish"
npm ci
```

Read the spec once before Task 1 — it is the contract this plan implements:
`docs/superpowers/specs/2026-07-30-repo-polish-design.md`

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `LICENSE` | MIT grant, so GitHub detects a license | 1 |
| `package.json` | Package metadata: license, author, description, keywords, repo links | 1 |
| `SECURITY.md` | How to report a vulnerability privately; secret-handling rules | 2 |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 with a GitHub reporting channel | 2 |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Structured bug intake | 3 |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Structured feature intake | 3 |
| `.github/ISSUE_TEMPLATE/config.yml` | Disables blank issues, links docs | 3 |
| `.github/PULL_REQUEST_TEMPLATE.md` | PR checklist including the typecheck gate | 3 |
| `CONTRIBUTING.md` | Dev setup, repo conventions, the typecheck gate, module registration | 4 |
| `docs/commands.md` | Every slash command, grouped, with gates and autocomplete flags | 5 |
| `docs/gameplay.md` | Player-facing guide to every system | 6, 7 |
| `README.md` | Landing page: badges, hero, features, quick start, doc links | 8 |

---

### Task 1: LICENSE and package.json metadata

This is first because it is the most consequential gap: the repository is public and currently shows **no license at all**, while `package.json` claims `ISC`.

**Files:**
- Create: `LICENSE`
- Modify: `package.json:2-27` (metadata fields only)

**Interfaces:**
- Consumes: nothing.
- Produces: the `LICENSE` file that README's license badge links to in Task 8, and the `license: "MIT"` field that Task 9's authorship check asserts.

- [ ] **Step 1: Create `LICENSE` with the verbatim MIT text**

```
MIT License

Copyright (c) 2026 RegEdits-TSC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Do not reflow, indent, or wrap this text differently — GitHub's licensee detector matches against the canonical wording, and a reformatted file may fail to register as MIT.

- [ ] **Step 2: Edit the metadata fields in `package.json`**

Change these five and add three. Leave `private`, `main`, `type`, `directories`, `engines`, `scripts`, `dependencies`, `devDependencies`, and `overrides` exactly as they are.

```json
{
  "name": "dino-world-bot",
  "version": "1.0.0",
  "description": "A dinosaur park tycoon game played entirely inside Discord",
  "private": true,
  "main": "index.js",
  "keywords": [
    "discord",
    "discord-bot",
    "discordjs",
    "typescript",
    "sqlite",
    "drizzle-orm",
    "game"
  ],
  "author": "RegEdits-TSC",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/RegEdits-TSC/Dino-World-Discord-Bot.git"
  },
  "bugs": {
    "url": "https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/issues"
  },
  "homepage": "https://github.com/RegEdits-TSC/Dino-World-Discord-Bot#readme"
}
```

`author` is the bare string. Do **not** write `"RegEdits-TSC <...>"`.

- [ ] **Step 3: Verify the JSON still parses and the fields landed**

Run:
```bash
node -e "const p=require('./package.json'); console.log(p.license, '|', p.author, '|', p.keywords.length, '|', p.repository.url)"
```
Expected: `MIT | RegEdits-TSC | 7 | git+https://github.com/RegEdits-TSC/Dino-World-Discord-Bot.git`

- [ ] **Step 4: Verify no email crept into either file**

Run:
```bash
grep -nE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' LICENSE package.json || echo "clean"
```
Expected: `clean`

- [ ] **Step 5: Commit**

```bash
git add LICENSE package.json
git commit -m "Add MIT license and fill in package metadata

The repository was public with no LICENSE file and a package.json that
claimed ISC, so GitHub detected no license at all and nobody could tell
whether they were allowed to fork or self-host it."
```

---

### Task 2: SECURITY.md and CODE_OF_CONDUCT.md

Grouped because both route reports to the same GitHub channel, and a reviewer would accept or reject that decision once rather than twice.

**Files:**
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`

**Interfaces:**
- Consumes: nothing.
- Produces: both files are linked from `CONTRIBUTING.md` (Task 4) and from `.github/ISSUE_TEMPLATE/config.yml` (Task 3). The reporting URL used in both is `https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/security/advisories/new`.

- [ ] **Step 1: Create `SECURITY.md`**

```markdown
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
```

- [ ] **Step 2: Fetch the canonical Contributor Covenant 2.1 text**

Use WebFetch against `https://www.contributor-covenant.org/version/2/1/code_of_conduct/code_of_conduct.md` and keep the wording verbatim. Reproducing it from memory risks subtle divergence from the licensed text.

If the fetch fails, stop and report it rather than paraphrasing the covenant.

- [ ] **Step 3: Create `CODE_OF_CONDUCT.md` from that text, with the contact placeholder replaced**

The stock text contains this line in the Enforcement section:

```
Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the community leaders responsible for enforcement at
[INSERT CONTACT METHOD].
```

Replace that sentence with:

```
Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported to the maintainer by
[opening a private report](https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/security/advisories/new)
or by contacting [@RegEdits-TSC](https://github.com/RegEdits-TSC) on GitHub.
```

Leave the rest of the covenant unchanged, including its attribution footer to the Contributor Covenant project — that footer is part of the license terms for reusing the text and is not tool attribution.

- [ ] **Step 4: Verify no placeholder and no email survived**

Run:
```bash
grep -nE '\[INSERT|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' SECURITY.md CODE_OF_CONDUCT.md || echo "clean"
```
Expected: `clean`

If this prints a match, the placeholder replacement in Step 3 was incomplete. Fix it before committing.

- [ ] **Step 5: Verify the covenant kept its structure**

Run:
```bash
grep -c '^## ' CODE_OF_CONDUCT.md
```
Expected: `5` — Our Pledge, Our Standards, Enforcement Responsibilities, Scope, Enforcement (plus an Attribution section that may use a different heading level depending on the source formatting; a count of 5 or 6 is acceptable, anything lower means content was lost).

- [ ] **Step 6: Commit**

```bash
git add SECURITY.md CODE_OF_CONDUCT.md
git commit -m "Add security policy and code of conduct

Both route reports through GitHub private advisories rather than an
email address. The project has no contact address to publish: the git
identity is a GitHub noreply address, and those cannot receive mail."
```

---

### Task 3: Issue and pull-request templates

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/PULL_REQUEST_TEMPLATE.md`

**Interfaces:**
- Consumes: `SECURITY.md` from Task 2 (linked from `config.yml`).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Create `.github/ISSUE_TEMPLATE/bug_report.yml`**

```yaml
name: Bug report
description: Something in the bot behaves incorrectly
labels: ["bug"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report this. Please do not include your
        bot token or any other secret in this issue.

  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: What did the bot do, and what did you expect it to do instead?
      placeholder: I ran /hatch on a ready egg and the reply said the egg was still incubating.
    validations:
      required: true

  - type: input
    id: command
    attributes:
      label: Command
      description: The exact slash command and options you used.
      placeholder: /battle fight stage:1-3 dino1:12
    validations:
      required: true

  - type: dropdown
    id: role
    attributes:
      label: Are you self-hosting?
      options:
        - I am self-hosting this bot
        - I am playing on someone else's instance
        - Not sure
    validations:
      required: true

  - type: input
    id: version
    attributes:
      label: Commit
      description: If self-hosting, the commit SHA you are running (`git rev-parse --short HEAD`).
      placeholder: a2a6276
    validations:
      required: false

  - type: textarea
    id: logs
    attributes:
      label: Relevant log output
      description: Paste any error output. This is rendered as code, so no backticks are needed.
      render: shell
    validations:
      required: false
```

- [ ] **Step 2: Create `.github/ISSUE_TEMPLATE/feature_request.yml`**

```yaml
name: Feature request
description: Suggest a new command, mechanic, or improvement
labels: ["enhancement"]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem are you hitting?
      description: Describe the situation that prompted this, not the solution.
      placeholder: I can't tell how many shards I have without selling something.
    validations:
      required: true

  - type: textarea
    id: proposal
    attributes:
      label: What should happen instead?
      description: The behaviour you want.
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives you considered
    validations:
      required: false
```

- [ ] **Step 3: Create `.github/ISSUE_TEMPLATE/config.yml`**

```yaml
blank_issues_enabled: false
contact_links:
  - name: How to play
    url: https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/blob/main/docs/gameplay.md
    about: The gameplay guide explains every system in the game.
  - name: Command reference
    url: https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/blob/main/docs/commands.md
    about: Every slash command, what it does, and who can run it.
  - name: Report a security vulnerability
    url: https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/security/advisories/new
    about: Report privately. Do not open a public issue for a vulnerability.
```

- [ ] **Step 4: Create `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## Summary

<!-- What does this change, and why? -->

## Testing

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes

<!--
`npm test` does not typecheck, and `npm run build` does not typecheck tests.
Run `npm run typecheck` separately — especially if you touched tests/ or scripts/.
-->

## Checklist

- [ ] This changes a command builder, so `npm run deploy-commands` is required after merge
- [ ] Embed or image output changed, and screenshots are attached below
- [ ] Documentation is updated to match the behaviour change

## Screenshots

<!-- Required if this changes what an embed, button row, or image looks like. -->
```

- [ ] **Step 5: Verify every YAML file parses**

Run:
```bash
node -e "
const fs=require('fs');
for (const f of ['bug_report.yml','feature_request.yml','config.yml']) {
  const t=fs.readFileSync('.github/ISSUE_TEMPLATE/'+f,'utf8');
  if(!t.trim()) throw new Error(f+' is empty');
  if(t.includes('\t')) throw new Error(f+' contains a tab, which is invalid YAML');
  console.log(f, 'ok', t.split('\n').length, 'lines');
}
"
```
Expected: three `ok` lines, no error.

A tab character is the single most common way these forms fail to render, which is why it is checked explicitly. Final confirmation that they render as forms happens in Task 10, after the PR is open.

- [ ] **Step 6: Commit**

```bash
git add .github/ISSUE_TEMPLATE .github/PULL_REQUEST_TEMPLATE.md
git commit -m "Add issue forms and a pull request template

Issue forms rather than markdown templates, so the fields are enforced.
The PR template calls out the typecheck gate, which npm test does not
cover."
```

---

### Task 4: CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`
- Read for source material: `CLAUDE.md` (repository root) — rewrite in the project's own voice; do not copy any sentence that references a tool or assistant.

**Interfaces:**
- Consumes: `SECURITY.md`, `CODE_OF_CONDUCT.md` from Task 2.
- Produces: the file README links to in Task 8.

- [ ] **Step 1: Create `CONTRIBUTING.md`**

```markdown
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
```

- [ ] **Step 2: Verify no tool or assistant reference leaked in from the source material**

Run:
```bash
grep -niE 'claude|anthropic|\bAI\b|assistant|copilot|LLM|generated' CONTRIBUTING.md || echo "clean"
```
Expected: `clean`

- [ ] **Step 3: Verify every internal link resolves**

Run:
```bash
node -e "
const fs=require('fs');
const t=fs.readFileSync('CONTRIBUTING.md','utf8');
const links=[...t.matchAll(/\]\((?!https?:)([^)#]+)/g)].map(m=>m[1]);
let bad=0;
for(const l of links){ if(!fs.existsSync(l)){ console.log('MISSING', l); bad++; } }
console.log(bad===0?'all '+links.length+' local links resolve':'BROKEN LINKS: '+bad);
"
```
Expected: `all 3 local links resolve` — `CODE_OF_CONDUCT.md`, `README.md`, `SECURITY.md`.

`README.md` exists already (it is rewritten in Task 8, not created), so this passes now.

- [ ] **Step 4: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "Add contributing guide

Documents the conventions an outside contributor would otherwise break:
the .js import extension, ctx.now/ctx.rng over the globals, synchronous
database access, and the typecheck gate that npm test does not cover."
```

---

### Task 5: docs/commands.md

**Files:**
- Create: `docs/commands.md`
- Read for the authoritative command list: `docs/superpowers/specs/2026-07-30-repo-polish-design.md` — Appendix A

**Interfaces:**
- Consumes: nothing.
- Produces: the page README links to in Task 8, and the page Task 9's command-accuracy check validates.

- [ ] **Step 1: Create `docs/commands.md`**

Write the file with this exact structure. The banner path and the intro paragraph are fixed; the tables come from Appendix A of the spec.

````markdown
# Command Reference

![Dino World](../assets/images/banners/eggs_incubator.png)

Every slash command Dino World registers. Options marked **autocomplete** suggest
valid values as you type — start typing and pick from the list rather than
looking an id up by hand.

New here? The [gameplay guide](gameplay.md) explains the systems these commands
drive, and `/help` walks you through your first ten minutes in Discord.

## 🏞️ Park and building

| Command | What it does | Notes |
| --- | --- | --- |
| `/park view` | Your park dashboard, with a rendered map of your lots | Falls back to a text-only embed if the map cannot be rendered |
| `/park rename` | Rename your park | Up to 60 characters |
| `/build` | Build on an empty lot | |
| `/upgrade` | Upgrade a lot to the next level | Autocomplete: lot |
| `/decorate` | Add decor to a paddock | Autocomplete: lot |
| `/dino list` | List every dino you own | Paginated, 10 per page |
| `/dino assign` | Put a dino in a paddock so it starts earning | Autocomplete: dino, lot |
| `/dino unassign` | Take a dino out of its paddock | Autocomplete: dino |

## 🥚 Eggs and hatching

| Command | What it does | Notes |
| --- | --- | --- |
| `/eggs` | Your egg inventory and incubator status | Paginated, 10 per page |
| `/incubate` | Start incubating an egg | Autocomplete: egg |
| `/hatch` | Hatch an egg that has finished incubating | Autocomplete: egg. Reveals the species on a button press |
| `/mythic` | Trade shards for a Mythic egg | Asks for confirmation before spending |

## 🍖 Care

| Command | What it does | Notes |
| --- | --- | --- |
| `/feed one` | Feed a single dino | Autocomplete: dino, food. Food must match the dino's diet |
| `/feed all` | Feed every hungry dino, hungriest first | |
| `/rescue` | Recapture a dino that escaped | Autocomplete: dino |

## 🗺️ Expeditions

| Command | What it does | Notes |
| --- | --- | --- |
| `/expedition start` | Send a dino out to a site | Autocomplete: site |
| `/expedition status` | Check how long your active expedition has left | |
| `/expedition claim` | Collect the rewards from a returned expedition | |

## ⚔️ Battles

| Command | What it does | Notes |
| --- | --- | --- |
| `/battle chapters` | Browse the campaign, your stars, and your energy | Prev/Next buttons |
| `/battle fight` | Send a squad of one to three dinos into a stage | Autocomplete: stage, dino1, dino2, dino3. Costs energy |

## 🛒 Shop and selling

| Command | What it does | Notes |
| --- | --- | --- |
| `/shop view` | Today's shop rotation | Changes once a day |
| `/shop egg` | Buy an egg | Autocomplete: rarity. Only rarities in today's rotation |
| `/shop food` | Buy food by item and quantity | Autocomplete: item |
| `/sell` | Sell a dino for cash and shards | Autocomplete: dino |

## 🤝 Trading

| Command | What it does | Notes |
| --- | --- | --- |
| `/trade offer` | Offer a trade to another player | Autocomplete on all six give/want fields |
| `/trade list` | Your pending trades, incoming and outgoing | Paginated, 10 per page |
| `/trade accept` | Accept a trade offered to you | Autocomplete: id |
| `/trade decline` | Decline a trade offered to you | Autocomplete: id |
| `/trade cancel` | Withdraw a trade you sent | Autocomplete: id |

## 🏆 Progress

| Command | What it does | Notes |
| --- | --- | --- |
| `/top` | Leaderboards by rating, cash, or collection | Server or global scope |
| `/help` | How to play, across nine topics | Run with no topic for a first-ten-minutes walkthrough |

## ⚙️ Server settings and admin

| Command | What it does | Notes |
| --- | --- | --- |
| `/settings channel` | Set where the bot posts hatch and expedition notifications | **Requires the Manage Server permission** |
| `/admin give` | Grant resources to a player | Autocomplete: dino-species. **Bot owner only** |
| `/admin inspect` | Dump a player's raw state | **Bot owner only** |
| `/admin reset` | Reset a player to a fresh start | **Bot owner only** |
| `/admin fast-forward` | Advance a player's clock, for testing | **Bot owner only** |
````

- [ ] **Step 2: Verify the banner path resolves**

Run:
```bash
node -e "
const fs=require('fs');
const t=fs.readFileSync('docs/commands.md','utf8');
const imgs=[...t.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m=>'docs/'+m[1]);
const path=require('path');
for(const i of imgs){ const p=path.normalize(i); console.log(fs.existsSync(p)?'ok '+p:'MISSING '+p); }
"
```
Expected: `ok assets\images\banners\eggs_incubator.png` (path separators vary by platform; what matters is `ok`, not `MISSING`).

- [ ] **Step 3: Verify the command list matches the registry, in both directions**

Run:
```bash
node -e "
const fs=require('fs');
const doc=fs.readFileSync('docs/commands.md','utf8');
const documented=new Set([...doc.matchAll(/\`\/([a-z]+(?: [a-z-]+)?)\`/g)].map(m=>m[1]));
console.log('documented:', documented.size);
console.log([...documented].sort().join('\n'));
"
```
Expected: **36 entries**, matching Appendix A of the spec. Compare the printed list against Appendix A by eye and confirm both directions — nothing documented that does not exist, nothing registered that is missing. Task 9 repeats this check against the live module registry.

- [ ] **Step 4: Commit**

```bash
git add docs/commands.md
git commit -m "Add command reference

Groups all 36 commands and subcommands by what a player is trying to do
rather than by module, and states the autocomplete and permission rules
once each instead of per row."
```

---

### Task 6: docs/gameplay.md — getting started through the roster

Split across two tasks because the guide is long and a reviewer should be able to reject the economy half without re-reading the collection half.

**Files:**
- Create: `docs/gameplay.md` (sections 1–6 only; Task 7 appends the rest)
- Read for every number: `docs/superpowers/specs/2026-07-30-repo-polish-gameplay-facts.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a file Task 7 appends to. End this task with the file containing sections 1–6 and nothing else — do not stub the later headings.

- [ ] **Step 1: Read the facts reference sections you need**

Read these sections in full before writing: *Currencies and starting state*; *Park, lots, and building*; *Income and how dinos earn*; *Eggs, rarities, and hatching*; *Species roster*. Also read *Open questions and gaps* in full — anything listed there must not be stated as fact.

- [ ] **Step 2: Create `docs/gameplay.md` with the header and sections 1–6**

Header, verbatim:

````markdown
# Gameplay Guide

![Dino World](../assets/images/sites/amber_ridge-banner.png)

How Dino World actually works — what everything costs, how long things take, and
what raises your rating. For the commands themselves, see the
[command reference](commands.md).
````

Then write these six sections. Every number must come from the facts reference;
transcribe its tables rather than paraphrasing them.

1. **Getting started** — there is no `/start` or `/register`; your park is created
   the first time you run any command, and also if someone offers you a trade.
   Give the starting package as a table: cash, battle energy, park name, rating,
   the starting pantry, lot slots, incubator slots. State that you begin with no
   dinos, eggs, or built lots.
2. **Currencies** — a table of cash, shards, food, and battle energy: what each
   is, how it is earned, and what it is spent on. **State plainly that there is
   no player-facing screen showing your shard balance** — the only place a shard
   total appears is the per-sale confirmation message. Do not tell readers to
   check shards on `/park view`.
3. **Your park** — lot slots and how they grow with rating; the lot types and what
   each does; build and upgrade costs; decor and what it affects; and that
   `/park view` renders a map image of your lots.
4. **Income** — how an assigned dino earns over time, the per-rarity income rates,
   what the hunger and comfort terms do to that rate, and what caps it. Write this
   qualitatively where the facts reference marks something inferred.
5. **Eggs and hatching** — the six rarities in order; the incubation-time table;
   how incubator slots work and that a finished egg keeps occupying its slot until
   you hatch it; that the species is rolled at the moment of hatching and is a
   flat pick within the rarity, with no duplicate protection; and that a new dino
   arrives unassigned and earns nothing until you assign it.
6. **The roster** — 30 species across six rarities. Give the per-rarity counts and
   the full species list. Include the herbivore/carnivore split, since it
   determines what each dino can eat.

- [ ] **Step 3: Verify no number contradicts the facts reference**

Re-read your draft against the facts reference section by section. For every
numeral in the draft, confirm the same numeral appears in the reference. Where
the reference marks a fact `(inferred)`, soften the wording — "roughly", "about",
or drop the number.

Run this to list every numeral you have committed to, as a review aid:

```bash
node -e "
const t=require('fs').readFileSync('docs/gameplay.md','utf8');
const nums=[...t.matchAll(/\b\d[\d,]*\b/g)].map(m=>m[0]);
console.log([...new Set(nums)].join('  '));
"
```

Check each one against the reference. This is the highest-risk step in the plan —
a wrong number here is a documented lie that no test will catch.

- [ ] **Step 4: Verify the three documentation traps are respected**

Run:
```bash
grep -niE 'shards on /park|check your shards|rating (drops|falls|decays)|/start|/register' docs/gameplay.md || echo "clean"
```
Expected: `clean`, or matches only where the text is explicitly saying the
opposite (for example "there is no `/start`"). Read any match before accepting it.

- [ ] **Step 5: Commit**

```bash
git add docs/gameplay.md
git commit -m "Add gameplay guide: getting started, currencies, park, eggs, roster

Every number is transcribed from the verified facts reference rather
than from the old README prose."
```

---

### Task 7: docs/gameplay.md — care through notifications

**Files:**
- Modify: `docs/gameplay.md` (append sections 7–14)
- Read for every number: `docs/superpowers/specs/2026-07-30-repo-polish-gameplay-facts.md`

**Interfaces:**
- Consumes: `docs/gameplay.md` as left by Task 6.
- Produces: the finished guide that README links to in Task 8.

- [ ] **Step 1: Read the facts reference sections you need**

Read in full: *Care: hunger, comfort, escapes*; *Food*; *Expeditions*; *Battle campaign*; *Shop and selling*; *Trading*; *Rating, ranks, and leaderboards*; *Notifications*. Re-read *Open questions and gaps*.

- [ ] **Step 2: Append sections 7–14**

7. **Care** — how hunger decays; what comfort is and what raises it; what makes a
   dino escape and how `/rescue` works. **Do not write that your rating drops as
   your dinos get hungry** — rating is only recalculated on rating-changing
   actions, so the displayed number does not move on its own.
8. **Food** — the six items as a table: name, diet, tier, price, and the hunger
   value each fills to. Explain that feeding sets hunger to that value rather than
   adding to it, that higher tiers overfill past 100 so dinos stay fed longer, and
   that a dino only accepts food matching its diet. Note the feed cost is measured
   in **food units, not cash**.
9. **Expeditions** — the sites, their durations, what each pays, and the rating
   gates that unlock them.
10. **The battle campaign** — four chapters of five stages, the fifth a boss; the
    energy system; how the star rating is decided, in the order the game actually
    checks it; what the rewards are and how stars scale them; first-clear shard
    bonuses; per-dino battle XP and its cap; and what a boss first-clear awards
    and unlocks. Mention that rewards are banked before the cinematic plays, so
    skipping never costs a payout.
11. **Shop and selling** — the daily rotation and how many eggs it shows; the
    rarity ceiling driven by your best-ever rating; egg prices; and sell payouts,
    including that Mythics cannot be sold.
12. **Trading** — the offer, accept, decline, and cancel flow; what can be traded;
    and the restrictions. Describe only behaviour the reference confirms.
13. **Rating and leaderboards** — how rating is computed, how it displays as stars,
    what it gates, and how `/top` ranks by rating, cash, and collection across
    server and global scope.
14. **Notifications** — the three kinds: egg ready, expedition returned, and trade
    activity. Explain the channel-versus-DM behaviour and that `/settings channel`
    sets the destination.

- [ ] **Step 3: Do not document the five suspected defects as features**

The facts reference records five behaviours that read as bugs rather than design.
None of them belongs in this guide. Do not write up: hatching a trade-locked egg;
the traded-egg shard-cap laundering; battle shards bypassing the sell cap; the
second Visitor Center not raising the income cap; or the Volcano Core boss's level.

Run:
```bash
grep -niE 'trade-locked|launder|bypass|level 11|second visitor' docs/gameplay.md || echo "clean"
```
Expected: `clean`

- [ ] **Step 4: Verify every numeral again**

Run the numeral listing from Task 6 Step 3 over the finished file and check each
value against the facts reference. The file is now complete, so this is the last
chance to catch a wrong number before it ships.

- [ ] **Step 5: Verify the guide has all fourteen sections and no code references**

Run:
```bash
node -e "
const t=require('fs').readFileSync('docs/gameplay.md','utf8');
const h=[...t.matchAll(/^## (.+)$/gm)].map(m=>m[1]);
console.log(h.length+' sections:'); console.log(h.join('\n'));
const leaks=[...t.matchAll(/src\/[a-z\/]+\.ts|\.ts:\d+/g)].map(m=>m[0]);
console.log(leaks.length?'CODE REFERENCES LEAKED: '+leaks.join(', '):'no code references');
"
```
Expected: `14 sections:` followed by the list, then `no code references`.

- [ ] **Step 6: Commit**

```bash
git add docs/gameplay.md
git commit -m "Add gameplay guide: care, food, expeditions, battles, economy

Completes the guide. Numbers come from the verified facts reference,
and behaviour flagged there as suspect is deliberately left out rather
than written up as intended design."
```

---

### Task 8: README.md rewrite

Last of the content tasks, because it links to everything the earlier tasks created — so every link it makes can be verified immediately.

**Files:**
- Modify: `README.md` (full rewrite, replacing all 141 lines)

**Interfaces:**
- Consumes: `docs/commands.md` (Task 5), `docs/gameplay.md` (Tasks 6–7), `CONTRIBUTING.md` (Task 4), `LICENSE` (Task 1). All must exist before this task runs.
- Produces: the landing page. Nothing depends on it.

- [ ] **Step 1: Replace `README.md` entirely with this content**

````markdown
# Dino World 🦖

[![CI](https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/actions/workflows/ci.yml/badge.svg)](https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-5FA04E?logo=node.js&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![discord.js](https://img.shields.io/badge/discord.js-14-5865F2?logo=discord&logoColor=white)](https://discord.js.org/)

![Dino World](assets/images/banners/help.png)

A dinosaur park tycoon game played entirely inside Discord. Build a park, hatch
eggs into a collection of 30 species, send dinos on expeditions, fight a PvE
campaign, and trade with other players — all through slash commands. Each park
belongs to one Discord user and travels with them across every server the bot is
in.

## ✨ Features

- 🏞️ **Build a park** — paddocks, facilities, and decor across lots you unlock as
  your rating grows, with `/park view` rendering your layout as a map image
- 🥚 **Hatch and collect** — 30 species across six rarities, from Common up to
  Mythic, each egg incubating on its own timer
- 🗺️ **Run expeditions** — send dinos out to themed sites and claim what they
  bring back
- ⚔️ **Fight a campaign** — four chapters of five stages, each ending in a boss,
  played out as a cinematic with star ratings and first-clear rewards
- 🍖 **Keep them fed** — six diet-typed foods, with herbivores and carnivores
  refusing each other's meals and hunger driving how much your park earns
- 🤝 **Trade** — offer dinos, eggs, and food to other players and settle it in
  Discord
- 🏆 **Climb leaderboards** — ranked by rating, cash, or collection, for your
  server or globally
- ⌨️ **Play without memorising ids** — every id option autocompletes, and `/help`
  walks you through your first ten minutes

## 🚀 Quick Start

Copy the environment template and fill in your own values:

```bash
cp .env.example .env
```

| Variable | Required | What it is |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Your bot's token, from the Discord Developer Portal |
| `DISCORD_CLIENT_ID` | yes | Your application's client id |
| `DATABASE_PATH` | yes | Where the SQLite database file is created |
| `OWNER_ID` | yes | The Discord user id allowed to run owner-only `/admin` commands |
| `DEV_GUILD_ID` | no | Deploy commands to one guild instantly instead of globally. Leave unset in production |
| `TEST_CHANNEL_ID` | no | Channel the live test sweep posts to |

Install dependencies:

```bash
npm i
```

Register the slash commands with Discord:

```bash
npm run deploy-commands
```

Re-run this whenever command definitions change — autocomplete flags and option
descriptions are part of the registered shape, so Discord will not pick them up
otherwise.

Build and upload the custom application emojis:

```bash
npm run build-emojis
npm run deploy-emojis
```

`build-emojis` renders the hand-authored SVGs in `assets/emojis/svg/` to PNGs in
`assets/emojis/png/`. `deploy-emojis` uploads any changed PNGs and rewrites
`assets/emojis/manifest.json`, **which must be committed afterward** — see the
[operations runbook](docs/ops.md) for why.

Start the bot, restarting on file changes:

```bash
npm run dev
```

Run exactly one bot instance per token. Two processes on the same token race each
other and every command fails.

## 📚 Documentation

| Guide | What is in it |
| --- | --- |
| [Command reference](docs/commands.md) | Every slash command, what it does, and who can run it |
| [Gameplay guide](docs/gameplay.md) | How the systems work — costs, timers, rewards, and gates |
| [Operations runbook](docs/ops.md) | Deploying to a VPS, running as a service, backups, release checks |
| [Contributing](CONTRIBUTING.md) | Setup, repository conventions, and how to send a change |

In Discord, `/help` is the in-game version: run it with no topic for a
first-ten-minutes walkthrough, or pass one of its nine topics for a focused guide.

## 🧪 Development

Type checking is separate from the test suite. `npm test` runs vitest without
typechecking, and `npm run build` only compiles `src`, so a type error in a test
file passes both:

```bash
npm run typecheck
```

Compile to JavaScript:

```bash
npm run build
```

Run the offline suite:

```bash
npm test
```

This is a strict simulation of Discord's semantics — reply-once and defer rules,
payload size limits, and option getters checked against each command's real
builder. It covers commands, buttons, autocomplete, and the multi-step journeys
that string them together.

Run the live sweep against a dev guild:

```bash
npm run test:live
```

This deploys the current builders to `DEV_GUILD_ID` so Discord itself validates
them, drives every command, and posts the resulting embeds, buttons, and images
to `TEST_CHANNEL_ID` for cosmetic review. It is REST-only and never opens a
gateway connection, so it is safe to run while the bot is live.

CI runs the typecheck and the offline suite on every pull request and on pushes
to `main`.

## 📄 License

MIT — see [LICENSE](LICENSE).
````

- [ ] **Step 2: Verify every local link and image resolves**

Run:
```bash
node -e "
const fs=require('fs'), path=require('path');
const t=fs.readFileSync('README.md','utf8');
const refs=[...t.matchAll(/\]\((?!https?:)([^)#]+)/g)].map(m=>m[1]);
let bad=0;
for(const r of refs){ const p=path.normalize(r); if(!fs.existsSync(p)){ console.log('MISSING', p); bad++; } }
console.log(bad===0 ? 'all '+refs.length+' local references resolve' : 'BROKEN: '+bad);
"
```
Expected: `all 8 local references resolve` — the license badge target, `package.json`, the hero image, three `docs/` pages, `CONTRIBUTING.md`, and `LICENSE`.

If `docs/ops.md` reports missing, stop — it should already exist on this branch.

- [ ] **Step 3: Verify the dropped claims are actually gone**

Run:
```bash
grep -niE '/verify|21 custom|dozens of species' README.md || echo "clean"
```
Expected: `clean`

- [ ] **Step 4: Verify no tool attribution**

Run:
```bash
grep -niE 'claude|anthropic|\bAI\b|assistant|generated with' README.md || echo "clean"
```
Expected: `clean`

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Rewrite the README as a landing page

Badges, a hero image, and eight feature lines up top; setup, docs
links, and development below. The deep material moved to the command
reference and gameplay guide.

Documents all six environment variables rather than four, and drops
the /verify reference, which was never an npm script."
```

---

### Task 9: Full verification sweep

**Files:**
- Create: `<scratchpad>/verify-docs.mjs` — a throwaway checker. **Do not commit it.** Making documentation checks a standing CI gate is explicitly out of scope, so this script lives outside the repository.

Use the session scratchpad directory for the script:
`C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/41a2130c-d8a2-44ed-b0e9-802944c05530/scratchpad/verify-docs.mjs`

**Interfaces:**
- Consumes: every file created in Tasks 1–8.
- Produces: a pass/fail report. No repository artifact.

- [ ] **Step 1: Write the checker**

```javascript
import fs from 'node:fs'
import path from 'node:path'

const REPO = 'C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot-repo-polish'
process.chdir(REPO)

const DOCS = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
  'docs/commands.md', 'docs/gameplay.md']
const ALL = [...DOCS, 'LICENSE', 'package.json',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/config.yml']

let failures = 0
const fail = (m) => { console.log('FAIL  ' + m); failures++ }
const pass = (m) => console.log('ok    ' + m)

// 1. every expected file exists
for (const f of ALL) fs.existsSync(f) ? pass('exists: ' + f) : fail('missing: ' + f)

// 2. local links and images resolve
for (const doc of DOCS) {
  if (!fs.existsSync(doc)) continue
  const text = fs.readFileSync(doc, 'utf8')
  const dir = path.dirname(doc)
  const refs = [...text.matchAll(/\]\((?!https?:|mailto:)([^)#]+)/g)].map((m) => m[1])
  for (const ref of refs) {
    const resolved = path.normalize(path.join(dir, ref))
    fs.existsSync(resolved) ? pass(`link ${doc} -> ${ref}`) : fail(`broken link in ${doc}: ${ref}`)
  }
}

// 3. no email addresses anywhere
for (const f of ALL) {
  if (!fs.existsSync(f)) continue
  const hits = fs.readFileSync(f, 'utf8').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)
  hits ? fail(`email address in ${f}: ${hits.join(', ')}`) : pass('no email: ' + f)
}

// 4. no unfilled template placeholders
for (const f of ALL) {
  if (!fs.existsSync(f)) continue
  const hits = fs.readFileSync(f, 'utf8').match(/\[INSERT[^\]]*\]|\bTBD\b|\bTODO\b/g)
  hits ? fail(`placeholder in ${f}: ${hits.join(', ')}`) : pass('no placeholder: ' + f)
}

// 5. no tool attribution
for (const f of ALL) {
  if (!fs.existsSync(f)) continue
  const hits = fs.readFileSync(f, 'utf8')
    .match(/\bclaude\b|\banthropic\b|\bco-authored-by\b|generated with/gi)
  hits ? fail(`attribution in ${f}: ${hits.join(', ')}`) : pass('no attribution: ' + f)
}

// 6. package.json metadata
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
pkg.license === 'MIT' ? pass('license MIT') : fail('license is ' + pkg.license)
pkg.author === 'RegEdits-TSC' ? pass('author RegEdits-TSC') : fail('author is ' + pkg.author)
pkg.private === true ? pass('still private') : fail('private flag changed')

// 7. LICENSE names the right holder
const lic = fs.readFileSync('LICENSE', 'utf8')
lic.includes('Copyright (c) 2026 RegEdits-TSC') ? pass('license copyright') : fail('license copyright line wrong')

// 8. command cross-check runs separately through tsx — see Step 2 below.
//    A plain Node script cannot import module-list.ts, and the registry field
//    is `cmd.data`, not `cmd.builder`.

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
```

- [ ] **Step 2: Run the checker**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot-repo-polish"
node "C:/Users/Claude/AppData/Local/Temp/claude/C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot/41a2130c-d8a2-44ed-b0e9-802944c05530/scratchpad/verify-docs.mjs"
```
Expected: `ALL CHECKS PASSED`.

If check 8 prints `SKIP`, the module list could not be imported as TypeScript from a plain Node script. In that case run the cross-check through tsx instead:

```bash
npx tsx -e "
import { ALL_MODULES } from './src/core/module-list.js';
import fs from 'node:fs';
const registered = new Set();
for (const mod of ALL_MODULES)
  for (const cmd of mod.commands ?? []) {
    const j = cmd.builder.toJSON();
    const subs = (j.options ?? []).filter(o => o.type === 1);
    if (subs.length) subs.forEach(s => registered.add(j.name + ' ' + s.name));
    else registered.add(j.name);
  }
const doc = fs.readFileSync('docs/commands.md','utf8');
const documented = new Set([...doc.matchAll(/\`\/([a-z]+(?: [a-z-]+)?)\`/g)].map(m => m[1]));
const missing = [...registered].filter(r => !documented.has(r));
const extra = [...documented].filter(d => !registered.has(d));
console.log('registered:', registered.size, 'documented:', documented.size);
console.log(missing.length ? 'UNDOCUMENTED: ' + missing.join(', ') : 'nothing undocumented');
console.log(extra.length ? 'NOT REGISTERED: ' + extra.join(', ') : 'nothing extra');
"
```
Expected: `nothing undocumented` and `nothing extra`.

- [ ] **Step 3: Run the typecheck**

```bash
npm run typecheck
```
Expected: exit 0, no output. This proves the `package.json` edit did not break the build graph.

- [ ] **Step 4: Run the offline suite**

```bash
npm test
```
Expected: all tests pass. Nothing in this change touches runtime code, so any failure here is either a pre-existing failure on `main` or a `package.json` mistake — investigate before continuing, and do not weaken a test to get past it.

- [ ] **Step 5: Fix anything the sweep found, then re-run**

If any check failed, fix the underlying file and re-run steps 2–4 until clean. Commit fixes with a message naming what was wrong.

There is nothing to commit for this task if everything passed — the checker is deliberately not part of the repository.

---

### Task 10: GitHub repository settings and the pull request

Runs last, because `SECURITY.md` and `CODE_OF_CONDUCT.md` describe a reporting channel that does not exist yet — this task creates it.

**Files:** none. This task changes GitHub-side settings and opens the PR.

**Interfaces:**
- Consumes: everything from Tasks 1–9, verified clean.
- Produces: the live repository configuration the shipped docs describe.

- [ ] **Step 1: Confirm the current state before changing it**

```bash
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot --jq '{topics: .topics, secret_scanning: .security_and_analysis.secret_scanning.status, push_protection: .security_and_analysis.secret_scanning_push_protection.status}'
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot/private-vulnerability-reporting --jq '.enabled'
```
Expected, matching what the spec recorded: empty topics, both scanning statuses `disabled`, and `false`. If any is already enabled, skip that sub-step rather than re-applying it.

- [ ] **Step 2: Set the repository topics**

```bash
gh repo edit RegEdits-TSC/Dino-World-Discord-Bot \
  --add-topic discord-bot \
  --add-topic discordjs \
  --add-topic typescript \
  --add-topic sqlite \
  --add-topic drizzle-orm \
  --add-topic game \
  --add-topic nodejs \
  --add-topic dinosaurs
```

- [ ] **Step 3: Enable secret scanning and push protection**

```bash
gh api -X PATCH repos/RegEdits-TSC/Dino-World-Discord-Bot \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

Push protection is the one with real preventive value: it blocks a Discord token from being committed in the first place.

- [ ] **Step 4: Enable private vulnerability reporting**

```bash
gh api -X PUT repos/RegEdits-TSC/Dino-World-Discord-Bot/private-vulnerability-reporting
```

This must succeed before the PR merges — both `SECURITY.md` and
`CODE_OF_CONDUCT.md` send people to this form.

- [ ] **Step 5: Verify every setting took**

```bash
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot --jq '{topics: .topics, secret_scanning: .security_and_analysis.secret_scanning.status, push_protection: .security_and_analysis.secret_scanning_push_protection.status}'
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot/private-vulnerability-reporting --jq '.enabled'
```
Expected: eight topics listed, both statuses `enabled`, and `true`.

- [ ] **Step 6: Push the branch and open the pull request**

```bash
cd "C:/Users/Claude/Documents/GitHub/Dino-World-Discord-Bot-repo-polish"
git push -u origin repo-polish
gh pr create --base main --head repo-polish \
  --title "Make the repository presentable to the public" \
  --body "$(cat <<'BODY'
The repository has been public while reading like a private one. This adds
what a public project needs and fixes what was wrong.

## What changed

- **MIT `LICENSE`**, and `package.json` corrected from `ISC`. GitHub previously
  detected no license at all, so nobody could tell whether they could fork or
  self-host this.
- **README rewritten** as a landing page: badges, a hero image, eight feature
  lines, setup, and links out. The deep material moved to two new guides.
- **`docs/commands.md`** — all 36 commands and subcommands, grouped by what a
  player is trying to do, with permission gates and autocomplete flags stated.
- **`docs/gameplay.md`** — how every system actually works. Numbers are
  transcribed from a citation-backed extraction of the source, not from the old
  README prose.
- **Community files** — contributing guide, security policy, code of conduct,
  issue forms, and a PR template.
- **Repository settings** — topics set, secret scanning and push protection
  enabled, private vulnerability reporting enabled.

## Fixes to existing claims

- The README documented four environment variables; `.env.example` has six.
  `DEV_GUILD_ID` and `TEST_CHANNEL_ID` were never explained, so there was no way
  to tell what the live test sweep needed.
- The README advertised a `/verify` command, which is not an npm script. The real
  commands are named instead.
- The hardcoded emoji count is gone rather than updated, so it cannot go stale
  again.

## Verification

- `npm run typecheck` and `npm test` pass.
- Every local link and image reference in the new docs resolves.
- The command reference cross-checks against the module registry in both
  directions.
- No email address, template placeholder, or stale claim survives in any shipped
  file.

No runtime code changed.
BODY
)"
```

- [ ] **Step 7: Confirm the rendered result**

Open the PR in a browser and check three things that only render server-side:

1. Both issue forms appear as **forms with fields**, not raw YAML. Visit
   `https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/issues/new/choose` on
   the branch to confirm.
2. All five badges load. A broken badge shows as a small grey error image.
3. The repository sidebar reports **MIT** once the branch merges — on the PR, at
   minimum confirm `LICENSE` renders with GitHub's license header.

Report anything that did not render rather than assuming it worked.

---

## Self-Review

Checked against the spec:

**Spec coverage** — all eleven deliverables map to tasks: LICENSE and
`package.json` to Task 1; `SECURITY.md` and `CODE_OF_CONDUCT.md` to Task 2;
issue and PR templates to Task 3; `CONTRIBUTING.md` to Task 4; `docs/commands.md`
to Task 5; `docs/gameplay.md` to Tasks 6 and 7; `README.md` to Task 8; GitHub
settings and badges to Tasks 8 and 10. All seven verification steps from the spec
appear in Task 9 (steps 1–5, mechanical) and Task 10 step 7 (rendered check).

**Placeholders** — none. Every file has its content written out, except
`docs/gameplay.md`, whose numbers are deliberately sourced from the committed
facts reference by section name rather than duplicated here; that is a real
source, not a deferral.

**Type consistency** — the reporting URL
`https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/security/advisories/new`
is identical in `SECURITY.md`, `CODE_OF_CONDUCT.md`, and `config.yml`. The banner
paths differ correctly by location: `assets/images/banners/help.png` from the
repository root in README, `../assets/images/...` from inside `docs/`.

**Ordering** — Task 8 links to files created in Tasks 4–7, so its link check can
only pass if it runs after them. Task 10 enables the reporting channel that Task
2's files describe; the PR does not merge until it exists.
