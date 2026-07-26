# Private Repo Creation & Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the local Dino World repository to GitHub as a private repo under RegEdits-TSC, with server-side enforcement of the PR-based workflow, squash-only merging, Actions hardening, Dependabot, and a verification pass proving every setting took.

**Architecture:** Everything is scripted through the gh CLI and `gh api` (REST, apiVersion 2022-11-28) so each setting is a recorded, re-runnable command. Local hygiene commits land before the repo is created so the first push is already clean. A final assertion pass re-reads every setting from the API and a real doc commit pushed directly to main proves the admin bypass.

**Tech Stack:** gh CLI 2.92.0, GitHub REST API, git, bash (Git Bash on Windows).

> **Amendment (2026-07-26, during execution):** The repo was created private per Task 6, then switched to **public** because branch rulesets (Task 10) are a paid feature on private repos under GitHub Free — creating one returned HTTP 403. The secret sweep (Task 3) had already passed clean. Task 6's verify and Task 11's assertion below are shown with their **public** expected values (edited post-switch); the Task 6 create command still shows `--private` as originally run. See the spec's amendment note.

## Global Constraints

- Every action — repo creation, pushes, PR/merge activity, settings changes — is performed as **RegEdits-TSC**. The gh CLI is currently authenticated as a different account; Task 1 fixes that and nothing else runs until it has.
- No AI/tool attribution anywhere: no `Co-Authored-By` trailers, no generated-with footers, no mention of AI in any commit, file, or setting. Git author/committer stays the existing config (`RegEdits-TSC <177423420+RegEdits-TSC@users.noreply.github.com>`).
- Sole sanctioned non-RegEdits-TSC author (spec §6, decided 2026-07-26): `dependabot[bot]` on its own dependency-update PRs.
- Public-facing text stays general (repo description: "A dinosaur park tycoon game played inside Discord"). README is current — do not modify it.
- CI pins verified latest-stable on 2026-07-26: `actions/checkout@v7`, `actions/setup-node@v7`, Node 24 (current active LTS). No bumps needed; do not touch `ci.yml`.
- Repo slug used throughout: `RegEdits-TSC/Dino-World-Discord-Bot`. Always pass it literally to `gh api` (do not rely on remote inference — Tasks 1–5 run before the remote exists).
- All commands below run from the repo root in the Bash (Git Bash) shell.

---

### Task 1: Authenticate gh as RegEdits-TSC (operator-interactive)

**Files:** none (machine auth state only)

**Interfaces:**
- Consumes: existing gh 2.92.0 install, currently authenticated as NDilbone.
- Produces: active gh account `RegEdits-TSC` with `repo` + `workflow` scopes, and a git credential path that authenticates pushes as RegEdits-TSC. Every later task depends on this.

- [ ] **Step 1: Operator logs in as RegEdits-TSC**

The operator types this in the Claude Code prompt (the `!` prefix runs it interactively in-session):

```
! gh auth login
```

Choices during the prompt: `GitHub.com` → `HTTPS` → authenticate in browser → sign in as **RegEdits-TSC**. Per gh's multiple-accounts behavior, the existing NDilbone login is kept and the newly added RegEdits-TSC account becomes the active one automatically.

- [ ] **Step 2: Verify active account and scopes**

Run: `gh auth status --active`
Expected: `✓ Logged in to github.com account RegEdits-TSC` with `Active account: true`, and `Token scopes:` including `repo` and `workflow`. (`workflow` is required — the first push contains `.github/workflows/ci.yml`.)

If NDilbone is still active: run `gh auth switch --hostname github.com --user RegEdits-TSC` and re-verify.

- [ ] **Step 3: Verify git pushes will authenticate as RegEdits-TSC**

Git Credential Manager is configured at system+global level and would win over gh's host-specific helper if it has a cached github.com credential, so test empirically:

```bash
printf 'protocol=https\nhost=github.com\n\n' | git credential fill | grep username
```

Expected: `username=RegEdits-TSC` (or `username=x-access-token`/similar coming from the gh helper — anything except `username=NDilbone`).

If it prints `username=NDilbone`, evict the cached credential and re-test:

```bash
printf 'protocol=https\nhost=github.com\n\n' | git credential reject
printf 'protocol=https\nhost=github.com\n\n' | git credential fill | grep username
```

(If a browser/GCM prompt appears during the re-test, sign in as RegEdits-TSC.)

- [ ] **Step 4: Confirm no GH_TOKEN override**

Run: `echo "${GH_TOKEN:-unset}"`
Expected: `unset` (a set GH_TOKEN would silently override the active account for all gh commands).

### Task 2: Untrack `.idea/` and ignore it

**Files:**
- Modify: `.gitignore`
- Delete (from index only, files stay on disk): `.idea/.gitignore`, `.idea/discord.xml`, `.idea/material_theme_project_new.xml`

**Interfaces:**
- Consumes: nothing.
- Produces: quiet `git status` — later tasks assume a clean tree apart from intended changes.

- [ ] **Step 1: Add `.idea/` to `.gitignore`**

Append this block to `.gitignore` (after the `# Logs` section):

```
# IDE
.idea/
```

- [ ] **Step 2: Untrack the three committed `.idea` files**

Run: `git rm -r --cached .idea`
Expected: three `rm '.idea/...'` lines.

- [ ] **Step 3: Verify status is exactly the intended change**

Run: `git status --porcelain`
Expected: exactly `M  .gitignore` (staged after next step or unstaged now) and three `D  .idea/...` entries — the previously-untracked `.idea` files (`Dino-World-Discord-Bot.iml`, `modules.xml`, `vcs.xml`) no longer appear at all.

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "Ignore JetBrains IDE config"
```

- [ ] **Step 5: Verify untracked**

Run: `git ls-files .idea`
Expected: no output.

### Task 3: Full-history secret sweep (read-only gate)

**Files:** none

**Interfaces:**
- Consumes: full local git history.
- Produces: go/no-go for publishing. **If this task finds a real secret, STOP — do not proceed to Task 6.** History pushed to a remote cannot be un-leaked.

- [ ] **Step 1: Sweep for Discord-token-shaped strings**

```bash
git log -p --all | grep -nE '[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{25,}' || echo CLEAN
```

Expected: `CLEAN`.

- [ ] **Step 2: Sweep for credential-style assignments**

```bash
git log -p --all | grep -niE "(token|secret|password|api[_-]?key)\s*[=:]\s*['\"]?[A-Za-z0-9+/_-]{20,}" || echo CLEAN
```

Expected: `CLEAN`. (`.env.example` placeholders like `your-bot-token` are under 20 chars and will not match.)

- [ ] **Step 3: Judge any hit**

If either grep printed lines: inspect each. Only proceed if every hit is plainly not a secret (e.g. a long identifier in code). Anything token-like → stop and surface to the operator; the fix (history rewrite) is out of this plan's scope.

### Task 4: Add Dependabot version-update config

**Files:**
- Create: `.github/dependabot.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: weekly version-update PRs for npm and github-actions once the repo exists and Task 9 enables Dependabot. Content verified against the Dependabot options reference.

- [ ] **Step 1: Write the file**

Create `.github/dependabot.yml` with exactly:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

(`directory: "/"` is correct for both ecosystems — for github-actions it scans `/.github/workflows`.)

- [ ] **Step 2: Commit**

```bash
git add .github/dependabot.yml
git commit -m "Add Dependabot version updates for npm and GitHub Actions"
```

### Task 5: Offline verification gate

**Files:** none

**Interfaces:**
- Consumes: the committed tree from Tasks 2 and 4.
- Produces: proof the tree is green before it becomes the repo's public (well, private) face. CI on the first push must pass; this catches failure locally first.

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 2: Offline test suite**

Run: `npm test`
Expected: all tests pass (463 tests across 52 files as of this plan), exit 0.

### Task 6: Create the private repo and push

**Files:** none (creates remote `origin`)

**Interfaces:**
- Consumes: Task 1's auth (active account RegEdits-TSC), Tasks 2–5's clean green tree.
- Produces: private repo `RegEdits-TSC/Dino-World-Discord-Bot`, remote `origin`, `main` pushed. Tasks 7–11 configure this repo.

- [ ] **Step 1: Create + push**

```bash
gh repo create RegEdits-TSC/Dino-World-Discord-Bot --private --source=. --remote=origin --push --description "A dinosaur park tycoon game played inside Discord"
```

Expected: `✓ Created repository RegEdits-TSC/Dino-World-Discord-Bot on GitHub` followed by a successful push of `main`. (Owner prefix works because RegEdits-TSC is the active account — you cannot create into another user's namespace, which is why Task 1 must have run.)

- [ ] **Step 2: Verify repo identity**

```bash
gh repo view RegEdits-TSC/Dino-World-Discord-Bot --json name,visibility,owner,defaultBranchRef --jq '{name: .name, visibility: .visibility, owner: .owner.login, default: .defaultBranchRef.name}'
```

Expected (post-switch): `{"default":"main","name":"Dino-World-Discord-Bot","owner":"RegEdits-TSC","visibility":"PUBLIC"}` — the create command makes it PRIVATE; Task 10 switches it to PUBLIC to unlock rulesets.

- [ ] **Step 3: Verify remote**

Run: `git remote -v`
Expected: `origin  https://github.com/RegEdits-TSC/Dino-World-Discord-Bot.git` (fetch + push).

### Task 7: Merge style and feature surface

**Files:** none (remote settings)

**Interfaces:**
- Consumes: repo from Task 6.
- Produces: squash-only merging (title from PR title, body from PR body), auto-delete head branches, wiki/projects off.

- [ ] **Step 1: PATCH the repo settings**

```bash
gh api --method PATCH repos/RegEdits-TSC/Dino-World-Discord-Bot \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -F has_wiki=false \
  -F has_projects=false \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY
```

Expected: JSON response echoing the repo with the new values. (`-F` sends real booleans; `-f` sends the enum strings. `squash_merge_commit_title=PR_TITLE` is only valid alongside `allow_squash_merge=true`, which this same call sets.)

- [ ] **Step 2: Verify**

```bash
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge, autodelete: .delete_branch_on_merge, wiki: .has_wiki, projects: .has_projects, title: .squash_merge_commit_title, message: .squash_merge_commit_message}'
```

Expected: `{"autodelete":true,"merge":false,"message":"PR_BODY","projects":false,"rebase":false,"squash":true,"title":"PR_TITLE","wiki":false}`

### Task 8: Actions hardening

**Files:** none (remote settings)

**Interfaces:**
- Consumes: repo from Task 6.
- Produces: Actions restricted to GitHub-owned + verified-creator actions; default `GITHUB_TOKEN` read-only. CI uses only `actions/checkout` and `actions/setup-node` (both GitHub-owned), so nothing breaks.

- [ ] **Step 1: Restrict allowed actions (two calls, in this order)**

```bash
gh api --method PUT repos/RegEdits-TSC/Dino-World-Discord-Bot/actions/permissions \
  -F enabled=true -f allowed_actions=selected
gh api --method PUT repos/RegEdits-TSC/Dino-World-Discord-Bot/actions/permissions/selected-actions \
  -F github_owned_allowed=true -F verified_allowed=true
```

Expected: both exit 0 (204 No Content, no body printed).

- [ ] **Step 2: Default workflow token read-only**

```bash
gh api --method PUT repos/RegEdits-TSC/Dino-World-Discord-Bot/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```

Expected: exit 0 (204).

- [ ] **Step 3: Verify**

```bash
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot/actions/permissions --jq '{enabled: .enabled, allowed: .allowed_actions}'
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot/actions/permissions/selected-actions
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot/actions/permissions/workflow
```

Expected, in order:
`{"allowed":"selected","enabled":true}`
`{"github_owned_allowed":true,"verified_allowed":true,"patterns_allowed":[]}`
`{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}`

### Task 9: Dependabot enablement

**Files:** none (remote settings)

**Interfaces:**
- Consumes: repo from Task 6, `.github/dependabot.yml` from Task 4 (already pushed).
- Produces: vulnerability alerts + automated security-fix PRs; combined with Task 4's file, the full Dependabot surface from spec §5.

- [ ] **Step 1: Enable alerts, then security fixes (order matters — fixes depend on alerts)**

```bash
gh api --method PUT repos/RegEdits-TSC/Dino-World-Discord-Bot/vulnerability-alerts
gh api --method PUT repos/RegEdits-TSC/Dino-World-Discord-Bot/automated-security-fixes
```

Expected: both exit 0 (204 No Content). No extra Accept headers needed — gh sends them.

- [ ] **Step 2: Verify**

```bash
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot/vulnerability-alerts && echo "alerts: on"
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot/automated-security-fixes --jq '{enabled: .enabled}'
```

Expected: `alerts: on` (the GET returns 204 when enabled) and `{"enabled":true}`.

### Task 10: Main branch ruleset

**Files:** none (remote settings)

**Interfaces:**
- Consumes: repo from Task 6; CI workflow already on main (required check context is the job id `test`; `integration_id` 15368 is the GitHub Actions app, verified live).
- Produces: active ruleset — PR + green `test` required to merge, force-push and deletion blocked, repository-admin bypass (actor_id 5) for direct pushes.

- [ ] **Step 0: Make the repo public (required on GitHub Free)**

Rulesets are a paid feature on private repos; on Free they require a public repo. The Task 3 secret sweep must have passed clean before this runs — public git history is permanent.

```bash
gh repo edit RegEdits-TSC/Dino-World-Discord-Bot --visibility public --accept-visibility-change-consequences
gh repo view RegEdits-TSC/Dino-World-Discord-Bot --json visibility --jq .visibility
```

Expected: `PUBLIC`. (Skip this step if the repo is already public or the account has GitHub Pro/Team.)

- [ ] **Step 1: Create the ruleset**

```bash
gh api --method POST repos/RegEdits-TSC/Dino-World-Discord-Bot/rulesets --input - <<'EOF'
{
  "name": "Protect default branch",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "test", "integration_id": 15368 }
        ]
      }
    }
  ]
}
EOF
```

Expected: 201 with the created ruleset JSON (note its `id`). `required_approving_review_count` is 0 because a solo maintainer cannot approve their own PR — 1 would deadlock every merge. `deletion` = restrict deletions; `non_fast_forward` = block force pushes.

- [ ] **Step 2: Verify the rules apply to main**

```bash
gh api repos/RegEdits-TSC/Dino-World-Discord-Bot/rules/branches/main --jq '[.[].type] | sort | join(",")'
```

Expected: `deletion,non_fast_forward,pull_request,required_status_checks`

### Task 11: End-to-end verification

**Files:**
- Modify: `docs/ops.md` (append new section at end of file)

**Interfaces:**
- Consumes: everything above.
- Produces: pass/fail report on every setting; proof the admin bypass works (a real direct push to the PR-protected main); green CI on the pushed main; the ops runbook documenting the repo config (spec's docs-in-sync requirement).

- [ ] **Step 1: Run the assertion script**

```bash
REPO=RegEdits-TSC/Dino-World-Discord-Bot
fail=0
check() {
  if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 (got '$2', want '$3')"; fail=1; fi
}
check "visibility PUBLIC"     "$(gh repo view $REPO --json visibility --jq .visibility)" "PUBLIC"
check "owner RegEdits-TSC"    "$(gh repo view $REPO --json owner --jq .owner.login)" "RegEdits-TSC"
check "squash on"             "$(gh api repos/$REPO --jq .allow_squash_merge)" "true"
check "merge commits off"     "$(gh api repos/$REPO --jq .allow_merge_commit)" "false"
check "rebase off"            "$(gh api repos/$REPO --jq .allow_rebase_merge)" "false"
check "auto-delete branches"  "$(gh api repos/$REPO --jq .delete_branch_on_merge)" "true"
check "wiki off"              "$(gh api repos/$REPO --jq .has_wiki)" "false"
check "projects off"          "$(gh api repos/$REPO --jq .has_projects)" "false"
check "squash title PR_TITLE" "$(gh api repos/$REPO --jq .squash_merge_commit_title)" "PR_TITLE"
check "squash body PR_BODY"   "$(gh api repos/$REPO --jq .squash_merge_commit_message)" "PR_BODY"
check "actions selected"      "$(gh api repos/$REPO/actions/permissions --jq .allowed_actions)" "selected"
check "github-owned allowed"  "$(gh api repos/$REPO/actions/permissions/selected-actions --jq .github_owned_allowed)" "true"
check "verified allowed"      "$(gh api repos/$REPO/actions/permissions/selected-actions --jq .verified_allowed)" "true"
check "token read-only"       "$(gh api repos/$REPO/actions/permissions/workflow --jq .default_workflow_permissions)" "read"
check "vuln alerts on"        "$(gh api repos/$REPO/vulnerability-alerts >/dev/null 2>&1 && echo on || echo off)" "on"
check "security fixes on"     "$(gh api repos/$REPO/automated-security-fixes --jq .enabled)" "true"
check "ruleset active"        "$(gh api repos/$REPO/rulesets --jq '.[0].enforcement')" "active"
check "rules on main"         "$(gh api repos/$REPO/rules/branches/main --jq '[.[].type] | sort | join(",")')" "deletion,non_fast_forward,pull_request,required_status_checks"
RSID=$(gh api repos/$REPO/rulesets --jq '.[0].id')
check "admin bypass"          "$(gh api repos/$REPO/rulesets/$RSID --jq '.bypass_actors[0].actor_id')" "5"
echo
if [ $fail -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "CHECKS FAILED"; fi
```

Expected: 19 `PASS` lines, `ALL CHECKS PASSED`. Any `FAIL` → re-run that setting's task step, then re-run this script.

- [ ] **Step 2: Document the repo config in the ops runbook**

Append to the end of `docs/ops.md`:

```markdown

## GitHub Repository

The repository lives at
`https://github.com/RegEdits-TSC/Dino-World-Discord-Bot` (public — see
note below).

Configuration enforced server-side:

- A ruleset on `main` requires a pull request with a passing CI `test`
  check before merging, and blocks force pushes and branch deletion.
  The repository admin role bypasses the PR requirement — that is how
  small doc/code changes land directly on main. CI still runs on every
  push to main.
- Pull requests merge by squash only; the squash commit title comes
  from the PR title and the body from the PR description. Head
  branches are deleted automatically after merge.
- GitHub Actions may only run GitHub-owned and verified-creator
  actions, and the default `GITHUB_TOKEN` is read-only.
- Dependabot vulnerability alerts, security-update PRs, and weekly
  version-update PRs (npm and github-actions ecosystems) are enabled.

The repo is public because branch rulesets are unavailable on private
repos under GitHub Free. To keep it private, upgrade to GitHub Pro/Team,
then flip visibility back with
`gh repo edit RegEdits-TSC/Dino-World-Discord-Bot --visibility private`;
the ruleset survives the switch.

To re-check all of this, run the assertion script in the final task of
`docs/superpowers/plans/2026-07-26-private-repo-setup.md`.
```

- [ ] **Step 3: Commit and push directly to main — this IS the bypass test**

```bash
git add docs/ops.md
git commit -m "Document GitHub repository configuration in ops runbook"
git push origin main
```

Expected: push succeeds despite the ruleset's PR requirement (repository-admin bypass, exercised by a real doc change — no synthetic empty commit needed). If the push is rejected with a rulesets error, the bypass actor is misconfigured — re-check Task 10.

- [ ] **Step 4: Confirm CI green on main**

```bash
gh run watch --repo RegEdits-TSC/Dino-World-Discord-Bot --exit-status \
  "$(gh run list --repo RegEdits-TSC/Dino-World-Discord-Bot --branch main --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: the run completes with `✓` and the watch command exits 0. (If the push-triggered run hasn't registered yet, this watches the previous main run — also required green; wait a few seconds and re-run to catch the newest.)

- [ ] **Step 5: Operator confirms 2FA (manual, cannot be scripted)**

While signed in to github.com as RegEdits-TSC, open `https://github.com/settings/security` and confirm two-factor authentication is **enabled**. Report the result; if disabled, enable it before doing anything else with the account.
