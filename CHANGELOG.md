# Changelog

All notable changes to Dino-World are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The bot is in **v1.0 beta** — breaking changes between minor versions
are possible. See [SECURITY.md](SECURITY.md) for the supported-versions
policy.

## [Unreleased]

### Added
- New `staff` module with four hireable NPC roles (data-driven via
  `data/staff/roles.yaml`):
  - **Zookeeper** — auto-feeds the lowest-happiness dinos in an
    enclosure each hour, bypassing the human feed cooldown; capacity
    stacks across multiple zookeepers.
  - **Vet** — halves happiness decay in the assigned enclosure.
  - **Scientist** — multiplicative incubation speedup at egg purchase
    (0.75× per hire, floored at 0.5×).
  - **Marketer** — additive boost to dino hourly income (+15% per
    hire, capped at +45%).
- `/staff list|hire|fire|assign|rename|roles` — slash surface with
  autocomplete on `staff_id` and `enclosure_id`.
- Hourly `staff.wages` tick: pays staff via `wages.tick` ledger entries.
  Underpaid players have staff fired highest-wage-first (tie-break:
  most-recent-hire), with `wages.unpaid:<role>` ledger entries and
  durable DMs; balances never go negative.
- Hourly `staff.autofeed` tick: zookeepers reset happiness on the
  lowest-happiness dinos in their assigned enclosure.

### Changed
- Bumped JDK toolchain and CI from 21 (LTS) to 25 (current LTS).
  Java is forward-compatible so existing JDK 21 deployments will keep
  running, but new builds and `/about` will report Java 25.
- `HappinessTickService` now consults `StaffEffectsService` for a
  per-enclosure decay multiplier (vet effect; identity 1.0 when staff
  module is disabled).
- `IncomeTickService` applies the per-player marketer income multiplier
  before crediting the ledger.
- `EggService` applies the per-player scientist incubation multiplier
  at purchase time; eggs already incubating are unaffected.

### Fixed

### Security

---

## [1.0.0-beta1] — 2026-05-08

Initial public beta.

### Added
- Tycoon-style game loop inside Discord: shop, eggs, hatching, levels,
  habitats, profile, and admin tools.
- 30 dinosaur species across six rarities (common → mythic) shipped in
  `data/dinos/*.yaml` and `data/rarities.yaml`.
- Persistent state in a single SQLite file (HikariCP, WAL mode).
- In-process Caffeine caches (bounded) for hot read paths.
- Logback rolling log files with runtime-tunable levels.
- Branch-protected `main` ruleset tracked as code under
  `.github/rulesets/main-protection.json`.

### Security
- Hardened `DinoCatalog` jar walker against Zip Slip (rejects entries
  containing `..` or `\` before resolving via the classloader).
- Wrapped `InputStreamReader` in try-with-resources in `DinoCatalog` and
  `RarityCatalog` to prevent reader leaks on parse failure.
- Published [SECURITY.md](SECURITY.md) with private vulnerability
  reporting and beta-scope SLAs.

### CI / tooling
- GitHub Actions: build & test (JDK 21), CodeQL (security-extended +
  security-and-quality), Conventional Commits PR title lint.
- Dependabot grouped weekly updates for Gradle deps and GitHub Actions.
- Release workflow: tag push (`v*`) → shadow jar attached to a generated
  GitHub Release with categorised release notes.
- `.gitattributes` pins line endings and binary handling so Windows
  checkouts stop fighting Linux CI.

[Unreleased]: https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/compare/v1.0.0-beta1...HEAD
[1.0.0-beta1]: https://github.com/RegEdits-TSC/Dino-World-Discord-Bot/releases/tag/v1.0.0-beta1
