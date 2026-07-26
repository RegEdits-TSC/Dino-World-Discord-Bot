# Private repo creation and configuration — design

Date: 2026-07-26
Status: implemented (see amendment below)

## Amendment (2026-07-26, during implementation)

The repository was made **public**, not private. Branch rulesets and
classic branch protection are unavailable on private repositories under
a GitHub Free plan (`gh api` returns HTTP 403 "Upgrade to GitHub Pro or
make this repository public"). Server-side enforcement of the PR +
green-CI workflow — the core of this design's protection — was judged
more valuable than privacy for a pre-release project, so visibility was
switched to public to unlock rulesets at no cost. The full-history
secret sweep (§2) had already run clean, so no committed credentials
were exposed. Everywhere below that says "private", read "public"; the
protection, merge, Actions, Dependabot, and authorship decisions are
unchanged.

## Goal

Publish the existing local Dino World repository to GitHub as a private
repo under the RegEdits-TSC account, configured so that the day-to-day
workflow — feature work through PRs, small doc/code changes pushed
directly to main — is enforced by the platform rather than by habit, and
so that every action in the repo's history and audit log is performed by
RegEdits-TSC.

The project is still in active development, so all public-facing text
(repo description, README) stays general. The README is already up to
date and is not changed by this work.

## Decisions

| Decision | Choice |
| --- | --- |
| Owner / visibility | `RegEdits-TSC/Dino-World-Discord-Bot`, private |
| Acting account | RegEdits-TSC for everything; gh CLI re-authenticated before any repo action (current gh login is a different account) |
| Main protection | Ruleset: require PR + green CI to merge; repository-admin bypass for direct pushes |
| Merge style | Squash only |
| Dependabot | Alerts + security-update PRs + version-update PRs (npm and github-actions ecosystems) |
| `.idea/` | Ignore and untrack |
| Execution | Scripted via gh CLI / `gh api`, with a post-setup assertion pass |

## 1. Account and creation

- The operator re-authenticates gh as RegEdits-TSC (`gh auth login`;
  the existing login remains available as a secondary account via
  `gh auth switch`). All subsequent steps run under RegEdits-TSC.
- `gh repo create RegEdits-TSC/Dino-World-Discord-Bot --private
  --source . --push` with the general description "A dinosaur park
  tycoon game played inside Discord."
- No license file: private repository, default all-rights-reserved.

## 2. Pre-push hygiene

- Add `.idea/` to `.gitignore` and `git rm --cached` the three tracked
  `.idea` files, so IDE config is machine-local and git status stays
  quiet.
- One-time full-history sweep for secret-shaped strings (bot tokens,
  etc.) before the first push. The working tree is already verified
  clean (`.env` ignored, `.env.example` placeholder-only, CI needs no
  secrets), but history published to a remote cannot be un-leaked, so
  the sweep runs once before anything leaves the machine.

## 3. Main branch ruleset

A single ruleset targeting the default branch:

- Require a pull request before merging, with **0 required approvals** —
  a solo maintainer cannot approve their own PR, so requiring 1 would
  deadlock every merge.
- Required status check: the CI `test` job (typecheck + offline suite).
- Block force pushes; restrict branch deletion.
- Bypass actor: the Repository admin role. This is what allows small
  doc/code changes to be pushed directly to main. CI still runs on
  every push to main, and the repo's `/verify` command covers the
  pre-push check locally.

## 4. Repository settings

- Squash merge only; merge commits and rebase merging disabled. The
  squash commit's author is the PR author.
- Automatically delete head branches after merge.
- Wiki and Projects disabled; Issues stay enabled for backlog tracking.
- Actions hardening: default `GITHUB_TOKEN` permissions set to
  read-only, and allowed actions restricted to GitHub-owned and
  verified-creator actions (CI uses only `actions/checkout` and
  `actions/setup-node`).

## 5. Security

- Dependabot vulnerability alerts and automated security-update PRs
  enabled via API; a committed `dependabot.yml` adds weekly
  version-update PRs for the npm and github-actions ecosystems, keeping
  dependencies and pinned actions on latest stable.
- Secret-scanning push protection is not available on free private
  repositories (it requires the paid Advanced Security add-on). The
  mitigation is the section-2 history sweep, the ignored `.env`, and a
  CI pipeline that needs no repository secrets.
- Manual item the script cannot perform: confirm two-factor
  authentication is enabled on the RegEdits-TSC account.

## 6. Authorship

- Repo owner, every push, every PR open and merge, and every settings
  change in the audit log: RegEdits-TSC. Commit history is already
  uniformly authored by RegEdits-TSC with no co-author trailers
  (verified against the full log).
- Squash-only merging means each PR lands as a single commit authored
  by the PR author.
- **Sole sanctioned exception**, decided 2026-07-26: `dependabot[bot]`
  as the author of its own dependency-update PRs and commits. No other
  non-RegEdits-TSC author is ever acceptable in this repository.

## 7. Verification

- A post-setup assertion pass re-reads every configured setting via
  `gh api` — ruleset present and active, squash-only flags, Dependabot
  enablement, Actions permissions — and reports pass/fail per item.
- A trivial direct push to main proves the admin bypass works.
- CI on the pushed main must go green (existing workflow, no secrets
  required).
- At implementation time, verify the pinned CI action versions and Node
  version against upstream latest stable before the first push, per
  standing dependency policy.

## Out of scope

- README changes (already current and intentionally general).
- Deployment/VPS operations (covered by docs/ops.md).
- Any public visibility, license selection, or community files
  (CONTRIBUTING, CODE_OF_CONDUCT) — single-maintainer private repo.
