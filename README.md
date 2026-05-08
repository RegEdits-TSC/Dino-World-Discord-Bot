# Dino-World

[![build](https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/actions/workflows/build.yml)
[![codeql](https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/actions/workflows/codeql.yml)
[![release](https://img.shields.io/github/v/release/RegEdits-TSC/Dino-World-Discord-Bot?include_prereleases&sort=semver)](https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/releases)
[![java](https://img.shields.io/badge/java-21-007396?logo=openjdk&logoColor=white)](https://adoptium.net)
[![license](https://img.shields.io/github/license/RegEdits-TSC/Dino-World-Discord-Bot)](LICENSE)

A modular Discord bot built around a dinosaur tycoon experience — collect eggs,
hatch dinosaurs, level up, and grow a park across themed habitats. Java 21,
JDA 6, SQLite, Caffeine. Designed to be small enough to fit in your head and
structured enough that adding a new feature is a single new package.

> **This is a personal project.** The repository is public so anyone curious
> can see how it's built — it isn't packaged, documented, or supported for
> others to host. I run the only deployment. There's no setup guide here on
> purpose.

---

## What it does

Players progress a tycoon-style game inside Discord through slash commands:

- **Shop & eggs** — buy eggs from a `/shop` menu gated by player level and
  unlocked habitats; rarer "determined" eggs surface as players progress.
- **Leveling & slots** — XP unlocks dinosaur slots in fixed tiers
  (`LEVELS_PER_SLOT = 10`), capping shop purchases until the next milestone.
- **Habitats** — themed environments unlock new species and shop entries.
- **Profile** — `/profile` summarizes a keeper's park, level, and progress.
- **Admin tools** — `/admin reset player|tycoon` for moderation and recovery.

The whole game state lives in a single SQLite file. The bot's process is
stateless — restarts and crashes are non-events.

---

## Tech stack

| Layer        | Choice                                                     |
|--------------|------------------------------------------------------------|
| Language     | Java 21 (LTS, modern preview features off)                 |
| Discord API  | JDA 6.4.1                                                  |
| Persistence  | SQLite via HikariCP, with WAL mode                         |
| Caching      | Caffeine (in-process, bounded)                             |
| Logging      | Logback (rolling files + runtime-tunable levels)           |
| Metrics      | Micrometer (primitives only — no exporter pinned)          |
| Config       | dotenv-java + SnakeYAML                                    |
| Tests        | JUnit 5, Mockito                                           |
| Build        | Gradle (Kotlin DSL) + Shadow for the fat jar               |

Versions are pinned in a single `val` block at the top of
[`build.gradle.kts`](build.gradle.kts) — that's the only place to edit them.

---

## Architecture highlights

- **Modules over megafiles.** Each feature is a self-contained package
  registered via `java.util.ServiceLoader`. Current modules:
  `core`, `notify`, `players`, `zoo`. Adding a new one means a new folder
  plus an SPI entry — no central wiring file to touch.

- **Per-module SQL migrations.** Each module owns its `V<n>__*.sql` files
  under `src/main/resources/db/migrations/<module>/`. Versions are scoped
  per-module, so two modules can both ship a `V1` without colliding. The
  runner records applied migrations and refuses to re-run them.

- **Developer surface.** A `/debug` command tree (gated to a single
  Discord user ID) exposes:
    - runtime log-level changes — `/debug log set <logger> <level>`
    - cache statistics — `/debug cache stats`
    - module + DB introspection — `/debug system modules` / `db`
    - supervised restart and clean shutdown

- **Supervised restart.** `/debug system restart` exits with code `64`;
  the launcher (`run.sh` / `run.bat` / a systemd unit) relaunches the JVM.
  Code `0` stops cleanly. The bot's own process never has to coordinate
  its own restart.

- **Verified, pruning backups.** A nightly script uses SQLite's online
  `.backup`, verifies integrity, gzips the result, and only prunes old
  copies once a new verified-good one exists. A failed backup never
  deletes a known-good predecessor.

- **Permission gate.** Slash-command permissions are denied by default
  for `/debug`; the runtime gate is the source of truth, not Discord's
  UI hint. Only a configured developer ID can execute privileged commands.

---

## Built-in commands

| Command                                | Audience          | Purpose                                      |
|----------------------------------------|-------------------|----------------------------------------------|
| `/ping`                                | everyone          | gateway latency check                        |
| `/profile`                             | players           | tycoon stats, level, slot usage              |
| `/shop`                                | players           | buy eggs (level/habitat-gated)               |
| `/admin reset player\|tycoon`          | server admins     | reset a player's or all tycoon state         |
| `/debug log {set\|get\|list\|reset}`   | developer only    | runtime logger control                       |
| `/debug cache stats`                   | developer only    | per-cache size / hit rate / evictions        |
| `/debug system {modules\|db}`          | developer only    | module + database introspection              |
| `/debug system {restart\|shutdown}`    | developer only    | supervised lifecycle control                 |

The full surface evolves as new modules ship.

---

## Repository layout

```
src/main/java/dev/homeology/dinoworld/
├── core/          # framework: module SPI, command dispatch, lifecycle
├── command/       # command abstractions
└── modules/
    ├── core/      # /ping, /debug, error reporting
    ├── notify/    # cross-module notification helpers
    ├── players/   # accounts, levels, profile
    └── zoo/       # tycoon gameplay: shop, eggs, habitats, dinosaurs
src/main/resources/
├── db/migrations/<module>/  # per-module SQL migrations
└── META-INF/services/...    # ServiceLoader registrations
```

---

## Why this might be interesting

- A small, opinionated take on **plugin-style architecture in plain Java** —
  no Spring, no DI container, no annotation magic; just `ServiceLoader` and
  a thin lifecycle.
- A **per-module migration runner** that's tiny, deterministic, and treats
  modules as the unit of versioning rather than the database.
- A live example of building a **tycoon game inside Discord** — every
  interaction is ephemeral, every state transition is a SQL write, and
  the UX is constrained to slash commands and embeds.

---

## License

[MIT](LICENSE) — the code is permissively licensed. Attribution preserved;
no warranty.
