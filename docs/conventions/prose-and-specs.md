# Prose and specs

Fires on: the repo's written material rather than its code — `CLAUDE.md` itself,
`README.md`, everything under `docs/` (including `docs/conventions/` and
`docs/superpowers/`), the community files (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`SECURITY.md`, `LICENSE`, the issue and PR templates), `.github/dependabot.yml`,
`.env.example`, `.gitignore` and `.claude/`.

## Headlines

- Never write a count into prose and never trust one you read there: the next test, pin or call site to land makes it wrong silently and nobody goes back to the line. Write the command that derives it instead. §no-counts-in-prose
- How many filename pins the suite holds against a base art name is exactly such a figure — derive it with the recipe, never record it. §never-write-pin-counts-in-prose
- A spec is a dated record of a decision as it was made, so a spec proven wrong after implementation is NEVER corrected in place; the correction lives in the conventions, naming the dead mechanism. §specs-are-dated-records
- Audit art call sites with `grep -rn 'assetImage(' src/`, never by kind literal — one call site passes the kind as a VARIABLE and is invisible to a literal grep. §audit-by-grepping-assetimage

## no-counts-in-prose

Never write a count into prose, and never trust one you find in prose. The next test,
pin, call site or asset to land makes the number wrong the moment it lands, silently, and
nobody goes back to update the line — so a written count is a claim that decays without
anything failing. Record the command that derives it and re-run that command instead of
reading the number.

The two figures this repo is most often tempted to write down are how many test files
hand-roll a `Sender` fake and how many `fakeButton` sites dispatch through
`routeInteraction`. Both are derived on demand instead, and each recipe lives with the
thing it counts: `§sender-fakes-hand-rolled-grep` in
`docs/conventions/notify-and-runtime.md`, and `§router-guard-test-evidence` in
`docs/conventions/router-and-registry.md`.

## never-write-pin-counts-in-prose

How many filename pins the suite holds against a base art name is a figure to derive,
never one to write into prose:
`grep -rho '[A-Za-z0-9_-]*\.webp' tests/ | sort | uniq -c` if you actually need it. The
next pin to land makes a written count wrong, silently, which is the general rule stated
in the section above. The resolver default that makes such a pin valid at all is
`§unseeded-returns-base` in `docs/conventions/art-resolver.md`.

## specs-are-dated-records

Specs in this repo are dated records of a decision as it was made, so a spec proven
wrong after implementation is deliberately NOT corrected in place. The worked example is
`docs/superpowers/specs/2026-08-27-operator-refunds-design.md` §3 case 6, whose
reset-boundary mechanism is false and shipped as unreachable dead code: the correction
lives at `§spec-createdAt-boundary-is-false` in `docs/conventions/admin-service.md`, and
a reader who finds the spec's mechanism should implement from there instead.

## audit-by-grepping-assetimage

**Audit art call sites with `grep -rn 'assetImage(' src/`, never by kind literal.**
`src/modules/help/index.ts` calls `assetImage(t.art.kind, t.art.name, i.user.id)` — the
kind is a VARIABLE read off `HELP_TOPICS`, the only such call site in `src/`, and it is
invisible to an `assetImage('sites'` / `assetImage('banners'` grep. Every literal-grep
enumeration run over this feature missed it, repeatedly; that one line serves every
art-bearing help topic and it shipped unseeded until a reviewer read the file.
