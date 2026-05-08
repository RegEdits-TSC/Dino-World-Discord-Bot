# Changelog

All notable changes to Dino-World are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The bot is in **v1.0 beta** — breaking changes between minor versions
are possible. See [SECURITY.md](SECURITY.md) for the supported-versions
policy.

## [Unreleased]

### Added
- _Track here as work lands on `main` between releases._

### Changed

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
