# Repo Polish — README, Docs, and Public-Repo Essentials

Date: 2026-07-30
Branch: `repo-polish` (git worktree at `../Dino-World-Discord-Bot-repo-polish`, off `origin/main`)

## Problem

Dino World is a public repository, but it reads like a private one.

- `README.md` is a single wall of maintainer-oriented prose. Feature descriptions,
  setup steps, and testing detail run together with no visual hierarchy and no
  images, despite the repo shipping 17 committed banners.
- There is **no `LICENSE` file**, and `package.json` declares `ISC`. GitHub's
  license detection returns `null`, so the repo shows no license at all. Nobody
  can tell whether they are allowed to fork or self-host it.
- No `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and no issue or
  pull-request templates.
- Repository **topics are empty**, so the project is effectively unfindable
  through GitHub search or topic browsing.
- **Secret scanning and push protection are disabled**, on a repo whose whole
  operation depends on a `DISCORD_TOKEN`. Both features are free for public
  repositories.

## Goal

Make the repository legible and trustworthy to its three real audiences —
self-hosters, contributors, and players/server admins — without touching a line
of runtime code.

## Non-goals

- No changes to `src/`, `tests/`, or any gameplay behaviour.
- No gameplay screenshots. The design leaves room for them later, but this work
  ships with existing committed art only.
- No art or asset changes. The `art-assets-round-3` branch owns `assets/`.
- The package stays `private: true`. Nothing here is preparation for npm.
- No changes to CI workflow behaviour or Dependabot config.

## Decisions

These were settled during brainstorming and are not open questions.

| Decision | Choice |
|---|---|
| License | MIT, `Copyright (c) 2026 RegEdits-TSC` |
| README style | Classic left-aligned layout. Emoji on every section header and on each feature bullet; prose stays plain |
| Page structure | Lean landing README; deep content in `docs/commands.md` and `docs/gameplay.md` |
| Badges | Five: CI, license, Node, TypeScript, discord.js |
| Hero art | `banners/help.png` in README; `banners/eggs_incubator.png` on commands; `sites/amber_ridge-banner.png` on gameplay |
| Community files | All four: contributing, security, code of conduct, issue/PR templates |
| Code of Conduct | Contributor Covenant 2.1 |
| Reporting contact | GitHub private vulnerability reporting plus contacting `@RegEdits-TSC` — no email address published |
| Delivery | One branch, one pull request |

### Why no email contact

The maintainer's git identity is
`177423420+RegEdits-TSC@users.noreply.github.com`. GitHub noreply addresses are
outbound-only and **do not receive mail**, so publishing one as a reporting
contact would silently drop every report. The maintainer also deliberately keeps
their real address private. GitHub's private vulnerability reporting form solves
both problems: it is reachable, it is private, and it exposes no address.

## Deliverables

### 1. `README.md` — full rewrite

Structure, in order:

```
# Dino World 🦖
<badge row>
<hero image: assets/images/banners/help.png>
<one-paragraph tagline>

## ✨ Features
## 🚀 Quick Start
## 📚 Documentation
## 🧪 Development
## 📄 License
```

- **Badge row** — five badges on one line, described in deliverable 11.
- **Hero** — `![Dino World](assets/images/banners/help.png)`, repo-relative so it
  renders on GitHub and in local editors alike.
- **Tagline** — one paragraph: a dinosaur park tycoon game played entirely inside
  Discord; build a park, hatch eggs, run expeditions, fight a PvE campaign, trade
  with other players. One park per Discord user, shared across every server the
  bot joins.
- **Features** — eight emoji-led one-line bullets, one per system: park with
  rendered PNG map, eggs and collection, expeditions, PvE campaign, diet-typed
  care, trading, leaderboards, and the autocomplete/`/help` quality-of-life pair.

  Bullets use exact verified numbers rather than vague quantifiers: the roster is
  **30 species across six rarities**, not "dozens"; the campaign is four chapters
  of five stages. Where a number is not in the facts reference, the bullet is
  written without one.
- **Quick Start** — the existing setup sequence, tightened: copy `.env.example`,
  then `npm i`, `npm run deploy-commands`, `npm run build-emojis` followed by
  `npm run deploy-emojis`, and `npm run dev`. Keeps the existing notes that
  command changes require a redeploy and that `assets/emojis/manifest.json` must
  be committed after an emoji deploy.

  The environment table documents all six variables in `.env.example`, split by
  whether they are required: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`,
  `DATABASE_PATH`, and `OWNER_ID` are required; `DEV_GUILD_ID` and
  `TEST_CHANNEL_ID` are optional and only used for guild-scoped command
  deployment and the live test sweep. The current README documents only four and
  never explains the other two, which is why a self-hoster cannot tell what the
  live sweep needs.
- **Documentation** — a link table to `docs/commands.md`, `docs/gameplay.md`,
  `docs/ops.md`, and `CONTRIBUTING.md`.
- **Development** — condensed: `npm run typecheck`, `npm run build`, the two test
  tiers, and the CI note. Deep contributor detail lives in `CONTRIBUTING.md`,
  not here.

  The current README advertises a `/verify` command. That is not an npm script —
  it is a local editor-tooling command file under `.claude/`, which means nothing
  to a contributor who does not use the same editor setup, and it is exactly the
  kind of tooling reference that does not belong in a durable public artifact.
  **Both `README.md` and `CONTRIBUTING.md` drop the `/verify` reference** and
  document the underlying commands instead: `npm run typecheck`, `npm test`, and
  `npm run test:live`.
- **License** — one line naming MIT and linking `LICENSE`.

Content rules:

- Every factual claim currently in `README.md` either survives in compressed form
  or moves to `docs/gameplay.md`. Exactly two things are deliberately dropped
  rather than carried over, and nothing else: the hardcoded "21 custom
  application emojis" count, removed rather than updated so it cannot rot again;
  and the `/verify` reference, for the reason given under Development above.
- No attribution to any tool, assistant, or generator anywhere in the output.

### 2. `docs/commands.md` — command reference

Opens with the `eggs_incubator.png` banner and a one-line intro, followed by one
table per group. Groups and their order:

| Group | Commands |
|---|---|
| 🏞️ Park & Building | `/park view`, `/park rename`, `/build`, `/upgrade`, `/decorate`, `/dino list\|assign\|unassign` |
| 🥚 Eggs & Hatching | `/eggs`, `/incubate`, `/hatch`, `/mythic` |
| 🍖 Care | `/feed one`, `/feed all`, `/rescue` |
| 🗺️ Expeditions | `/expedition start\|status\|claim` |
| ⚔️ Battles | `/battle chapters`, `/battle fight` |
| 🛒 Economy | `/shop view\|egg\|food`, `/sell` |
| 🤝 Trading | `/trade offer\|list\|accept\|decline\|cancel` |
| 🏆 Progress | `/top`, `/help` |
| ⚙️ Server & Admin | `/settings channel`, `/admin give\|inspect\|reset\|fast-forward` |

Each table has three columns: **Command**, **What it does**, **Notes**. The Notes
column carries autocomplete flags and permission gates. A single sentence above
the first table explains that options marked as autocompleting suggest valid
values as you type, so that fact is stated once rather than eighteen times.

Permission gates to state explicitly: `/settings channel` requires the Manage
Server permission; every `/admin` subcommand is restricted to the bot owner.

The authoritative command inventory is Appendix A.

### 3. `docs/gameplay.md` — gameplay guide

Opens with the `amber_ridge-banner.png` banner. Contains the systems prose that
the README sheds, expanded into player-facing sections. The section list mirrors
the facts reference so nothing verified goes unused:

1. **Getting started** — that a park is created implicitly on your first command,
   and the starting package.
2. **Currencies** — cash, shards, food, and battle energy, and where each is
   visible.
3. **Your park** — lots, building, upgrading, decor, and the rendered map.
4. **Income** — how assigned dinos earn, and what raises or caps it.
5. **Eggs and hatching** — the six rarities, incubation times, incubator slots.
6. **The roster** — 30 species across six rarities, and the diet split.
7. **Care** — hunger, comfort, escapes, and rescue.
8. **Food** — the six diet-typed items and the feeding rules.
9. **Expeditions** — sites, durations, gates, and rewards.
10. **The battle campaign** — chapters, stages, energy, stars, and rewards.
11. **Shop and selling** — the daily rotation, the rarity ceiling, sell payouts.
12. **Trading** — the offer flow and what can be traded.
13. **Rating and leaderboards** — how rating is computed and how `/top` ranks.
14. **Notifications** — what the bot pings you about, and the channel/DM split.

Written for a player, not a maintainer: no file paths, no code identifiers, no
function names.

Every number in this document must trace to the companion facts reference
described in Appendix B. **The implementer may not invent, round, or approximate
a game mechanic.** Where a fact is missing or listed there under "Open questions
and gaps", the mechanic is described qualitatively without numbers rather than
guessed at. The three documentation traps in Appendix B — shards being invisible,
rating being frozen, and there being no `/start` — must be respected, and the
five suspected defects must not be written up as intended behaviour.

### 4. `LICENSE`

Verbatim MIT license text. Copyright line: `Copyright (c) 2026 RegEdits-TSC`.
Placed at the repository root, unmodified and unwrapped, so GitHub's licensee
detector recognises it and displays MIT in the sidebar.

### 5. `package.json` metadata

Field changes only. No dependency, script, or `engines` changes.

| Field | From | To |
|---|---|---|
| `license` | `"ISC"` | `"MIT"` |
| `description` | `""` | `"A dinosaur park tycoon game played entirely inside Discord"` |
| `author` | `""` | `"RegEdits-TSC"` |
| `keywords` | `[]` | `["discord", "discord-bot", "discordjs", "typescript", "sqlite", "drizzle-orm", "game"]` |
| `repository` | absent | `{ "type": "git", "url": "git+https://github.com/RegEdits-TSC/Dino-World-Discord-Bot.git" }` |
| `bugs` | absent | `{ "url": "https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/issues" }` |
| `homepage` | absent | `"https://github.com/RegEdits-TSC/Dino-World-Discord-Bot#readme"` |

`private: true` and `main` stay as they are.

### 6. `CONTRIBUTING.md`

The maintainer-facing detail the README sheds, rewritten for someone who has
never seen the codebase. Sections:

- **Getting set up** — clone, `npm i`, `.env`, a dev Discord application, and a
  dev guild.
- **Repository conventions** — the rules an outside contributor will otherwise
  break: ESM NodeNext means every relative import carries a `.js` extension;
  time comes from `ctx.now()` and randomness from `ctx.rng()`, never `Date.now()`
  or `Math.random()`; database access is synchronous and never awaited.
- **Before you commit** — the load-bearing one: `npm test` does **not**
  typecheck, and `npm run build` does not typecheck tests. Run
  `npm run typecheck` before committing anything that touches `tests/` or
  `scripts/`.
- **Testing** — what the offline suite covers, and what the live REST sweep does
  and which environment variables it needs.
- **Adding a module** — the four registration sites: `modules.json`,
  `ALL_MODULES` in `src/core/module-list.ts`, the command count in
  `tests/registry-load.test.ts`, and the expected modules in
  `tests/config.test.ts`.
- **Changing a command builder** — requires `npm run deploy-commands`, and only
  one bot instance may run per token.
- **Pull requests** — what a good PR contains, and that CI runs typecheck plus
  the offline suite on every PR.

Source material is the repository `CLAUDE.md`. It must be rewritten in the
project's own voice, with no reference to any assistant or tool.

### 7. `SECURITY.md`

- **Supported versions** — the latest commit on `main`; this is a self-hosted
  bot with no release channel.
- **Reporting** — GitHub's private vulnerability reporting form, with a direct
  link. Explicitly: do not open a public issue for a vulnerability.
- **Secrets** — `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `OWNER_ID` live in
  `.env`, which is gitignored. Never paste a token into an issue, a pull request,
  or a log excerpt. If a token is exposed, regenerate it in the Discord Developer
  Portal immediately.
- **Scope** — this is a game bot with no user accounts and no payment handling;
  the realistic surface is token exposure, the owner-only `/admin` commands, and
  the SQLite database file.

### 8. `CODE_OF_CONDUCT.md`

Contributor Covenant 2.1, verbatim, with the enforcement contact replaced by:
report through GitHub's private vulnerability reporting form, or by contacting
`@RegEdits-TSC` on GitHub. No email address appears.

### 9. Issue templates

`.github/ISSUE_TEMPLATE/bug_report.yml` — a YAML issue form, not a markdown
template, so the fields are enforced. Fields: what happened; the exact command
run; what you expected; whether you are self-hosting or playing on someone
else's instance; commit SHA or version if self-hosting; relevant log output.

`.github/ISSUE_TEMPLATE/feature_request.yml` — fields: the problem you are
hitting; the behaviour you want; alternatives you considered.

`.github/ISSUE_TEMPLATE/config.yml` — `blank_issues_enabled: false`, with a
contact link pointing at the documentation.

### 10. `.github/PULL_REQUEST_TEMPLATE.md`

A markdown template with: a summary section; a testing checklist covering
`npm run typecheck` and `npm test`; a prompt for screenshots when embed output
changes; and a checkbox for "this changes a command builder, so
`npm run deploy-commands` is required after merge".

### 11. GitHub repository settings

Applied with the `gh` CLI, which is authenticated as `RegEdits-TSC` with the
`repo` scope.

- **Topics** — `discord-bot`, `discordjs`, `typescript`, `sqlite`, `drizzle-orm`,
  `game`, `nodejs`, `dinosaurs`. Currently empty; this is the single largest
  discoverability gap.
- **Secret scanning** and **push protection** — enable both. Free on public
  repositories. Push protection blocks a Discord token from being committed in
  the first place, which is the one setting here with real preventive value.
- **Private vulnerability reporting** — enable. This is the channel both
  `SECURITY.md` and `CODE_OF_CONDUCT.md` point at, so it must be live before
  those files describe it.
- **Description** — already set and already good; leave it.
- **Homepage** — leave unset. No site exists.

Badges, all on one line under the title:

| Badge | Implementation |
|---|---|
| CI | `https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/actions/workflows/ci.yml/badge.svg`, linked to the workflow. Live status; the workflow is named `CI` and runs on pull requests and pushes to `main`. |
| License | shields.io static, MIT, linked to `LICENSE` |
| Node | shields.io static, `node >= 22`, matching `engines.node` |
| TypeScript | shields.io static |
| discord.js | shields.io static, major version 14 |

The four static badges can drift if a major version changes. This is accepted:
they are coarse enough that drift is rare, and a live version badge would require
either a shields dynamic-JSON query against the repo or a third-party service.

## Verification

Nothing in this change executes, so verification is about correctness of
references rather than behaviour.

1. `npm run typecheck` — proves the `package.json` edit did not break the build
   graph.
2. `npm test` — the offline suite, unchanged, must stay green.
3. **Link check** — every relative link in `README.md`, `docs/commands.md`, and
   `docs/gameplay.md` resolves to a file that exists in the repository.
4. **Image check** — every image path referenced resolves to a real file under
   `assets/images/`.
5. **Command accuracy check** — compare `docs/commands.md` against the command
   names the module manifests actually build, in both directions: every command
   documented must exist, and every registered command must be documented.
   Appendix A is the expected set — 39 entries including subcommands.
6. **Rendered check, after the pull request is open** — confirm the issue forms
   render as forms rather than raw YAML, confirm the badges resolve, and confirm
   GitHub's sidebar now reports the MIT license.

Steps 3 through 5 are mechanical and should be scripted during implementation
rather than eyeballed.

## Risks

- **Asset-path collision.** If `art-assets-round-3` converts art to WebP, the
  banner paths referenced by the README and both docs pages need updating at
  rebase time. Low effort, but it will not surface as a test failure — a broken
  image renders as a broken image.
- **Documentation drift.** `docs/commands.md` and `docs/gameplay.md` are
  hand-written and can fall behind the code. Verification step 5 catches command
  drift at implementation time but is not a standing CI gate; making it one is
  out of scope here.
- **Fact accuracy.** The gameplay guide states numbers that came from source
  extraction. Appendix B records the citation for each so a reviewer can check
  them, and the guide is forbidden from stating any number not in that appendix.

## Appendix A — command inventory

Extracted from the module manifests. 11 modules, 14 top-level commands, 39
including subcommands, autocomplete on 18.

| Module | Command | Subcommand | Description | Autocomplete | Gate |
|---|---|---|---|---|---|
| park | `/park` | view | Park dashboard | — | — |
| park | `/park` | rename | Rename your park | — | — |
| park | `/build` | — | Build on an empty lot | — | — |
| park | `/upgrade` | — | Upgrade a lot | lot | — |
| park | `/dino` | list | List your dinos | — | — |
| park | `/dino` | assign | Assign a dino to a paddock | dino, lot | — |
| park | `/dino` | unassign | Remove a dino from its paddock | dino | — |
| park | `/decorate` | — | Add decor to a paddock | lot | — |
| hatchery | `/eggs` | — | Your eggs and incubator | — | — |
| hatchery | `/incubate` | — | Start incubating an egg | egg | — |
| hatchery | `/hatch` | — | Hatch a ready egg | egg | — |
| hatchery | `/mythic` | — | Spend shards on a Mythic egg | — | — |
| expeditions | `/expedition` | start | Start an expedition | site | — |
| expeditions | `/expedition` | status | Check your active expedition | — | — |
| expeditions | `/expedition` | claim | Claim a returned expedition | — | — |
| shop | `/shop` | view | Today's shop | — | — |
| shop | `/shop` | egg | Buy an egg | rarity | — |
| shop | `/shop` | food | Buy food | item | — |
| shop | `/sell` | — | Sell a dino for cash and shards | dino | — |
| settings | `/settings` | channel | Set the notification channel | — | Manage Server |
| care | `/feed` | one | Feed a single dino | dino, food | — |
| care | `/feed` | all | Feed every hungry dino, hungriest first | — | — |
| care | `/rescue` | — | Recapture an escaped dino | dino | — |
| trading | `/trade` | offer | Offer a trade | six option fields | — |
| trading | `/trade` | list | Your pending trades | — | — |
| trading | `/trade` | accept | Accept a trade | id | — |
| trading | `/trade` | decline | Decline a trade | id | — |
| trading | `/trade` | cancel | Cancel a trade you sent | id | — |
| leaderboards | `/top` | — | Leaderboards by rating, cash, or collection | — | — |
| admin | `/admin` | give | Grant resources to a player | dino-species | Owner |
| admin | `/admin` | inspect | Dump a player's raw state | — | Owner |
| admin | `/admin` | reset | Reset a player to a fresh start | — | Owner |
| admin | `/admin` | fast-forward | Advance a player's clock | — | Owner |
| help | `/help` | — | How to play, across nine topics | — | — |
| battle | `/battle` | chapters | Browse the campaign | — | — |
| battle | `/battle` | fight | Fight a stage with a squad of one to three dinos | stage, dino1-3 | — |

## Appendix B — verified gameplay facts

The facts live in a companion document,
[`2026-07-30-repo-polish-gameplay-facts.md`](./2026-07-30-repo-polish-gameplay-facts.md),
because they run to roughly 780 lines and would drown this spec.

That document is a citation-backed inventory of every player-visible number,
rule, and gate in the bot, extracted from source against commit `a2a6276` — the
same commit this branch is based on. Every claim carries a `path:line` citation,
facts derived by reasoning rather than read off a constant are marked
`(inferred)`, and it ends with an explicit list of things that could not be
verified.

It is organised into fifteen sections: currencies and starting state; park, lots
and building; income; eggs, rarities and hatching; the species roster; care;
food; expeditions; the battle campaign; shop and selling; trading; rating, ranks
and leaderboards; notifications; `/help` as a player surface; and open questions.

**Rule for the implementer:** `docs/gameplay.md` may not state a game number that
does not appear in that document. Anything listed under "Open questions and gaps"
is not safe to publish and must be omitted or stated qualitatively.

### Corrections the extraction caught

The reference is not a transcription of the current README — it corrects it. The
most consequential fix was structural: the first extraction pass read line
numbers from the `art-assets-round-3` working tree, where fifteen source files
differ from this branch. Every citation was re-resolved against `a2a6276` before
the document was written.

Substantive corrections worth knowing while writing the docs:

- A Legendary-ceiling shop day shows **four** eggs, not three: Legendary is
  filtered out of the three-draw base pool and arrives on a separate 10% roll.
- The rarity feed-cost column (5/10/20/40/80/160) is **food units, not cash**.
- Star ratings check zero-knockout first, so a fast win with two or more
  knockouts scores 2 stars, not 3.
- There are **eight** decor items, not seven.
- There are **three** kinds of notification, not two — the two timer-driven ones
  plus immediate trade notifications.

### Documentation traps

The reference flags several places where the intuitive sentence is wrong. These
are called out here because they are exactly what a doc writer would otherwise
write:

- **Shards are visible nowhere.** The dashboard has five fields and none is
  shards; the only shard total rendered anywhere is the owner-only
  `/admin inspect`. Do not tell readers to check their shards on `/park view`.
- **Park rating is frozen between rating-changing actions.** It is not recomputed
  by `/park view`, by collecting income, or by the passage of time, even though
  the comfort term decays continuously. Do not write "your rating drops as your
  dinos get hungry".
- **There is no `/start`.** A park is created implicitly on your first command —
  and also when someone offers you a trade.

### Behaviour that looks like a bug

The extraction surfaced five behaviours that read as defects rather than design.
**None of them is in scope for this work**, and the gameplay guide must not
document them as features. They are recorded here so they are not lost:

1. A **trade-locked egg can still be incubated and hatched**, which strands the
   trade — the offered egg no longer exists to transfer.
2. Hatching a **traded egg launders the shard cap**: the resulting dino is not
   marked as trade-acquired, so selling it earns shards that a directly traded
   dino would not.
3. **Battle shards bypass the 40-shard sell cap** entirely.
4. A **second Visitor Center raises income but not the income cap**, because the
   cap reads the first matching lot by id rather than the highest level.
5. The **Volcano Core boss fights at level 11**, above the level 10 player cap,
   and nothing in the interface says so.

These should be raised with the maintainer as separate issues.
