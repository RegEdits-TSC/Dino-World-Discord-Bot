<!--
  PR title must match Conventional Commits: <type>(<optional-scope>): <summary>
  Allowed types: feat, fix, refactor, chore, docs, test, perf, style
  Subject must start with a letter and not end with a period (regex ^[A-Za-z].*[^.]$).
  See .github/workflows/pr-title.yml for the rule.
-->

## Summary
<!-- One or two sentences. What does this change? -->

## Why
<!--
  The motivation. Link to an issue (`Closes #N`) if there is one,
  or describe the user-visible problem this solves.
-->

## Test plan
<!--
  How you verified this works. Even "ran ./gradlew build" counts.
  For UI changes, mention which command/button/flow you exercised.
-->
- [ ] `./gradlew --no-daemon build` passes locally
- [ ] Manually exercised the affected path in Discord (if applicable)
- [ ] No new CodeQL alerts in CI

## Breaking changes
<!--
  Anything a player or operator would notice. Schema migrations, config
  renames, removed commands, changed defaults. Leave "None" if not applicable.
-->
None
