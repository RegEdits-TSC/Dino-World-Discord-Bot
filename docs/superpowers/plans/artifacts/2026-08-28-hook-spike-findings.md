# Hook-mechanism spike findings

Task 1 of `docs/superpowers/plans/2026-08-28-claude-md-decomposition.md`.
Run 2026-08-28 against Claude Code 2.1.250 on Windows 11, Node 22.

**Verdict: all three checks pass. Proceed with the plan as written.**

The decomposition's entire saving rests on three properties that the
documentation asserts and nothing had exercised. Each was probed directly with a
throwaway `PreToolUse` hook that logged its payload and injected a unique marker
string.

## 1. `additionalContext` reaches the model — yes

The marker `SPIKE_MARKER_7F3A` appeared in the model's context verbatim,
delivered as `PreToolUse:Read hook additional context`. This is the mechanism the
whole design depends on and it works as documented.

## 2. Firing is per file, not per message — yes

Three files read in a single assistant message produced **three** hook
invocations and three separate injections:

```json
{"event":"PreToolUse","tool":"Read","file":"...\\vitest.config.ts","session":"eccde7a2","agent":null,"agentType":null}
{"event":"PreToolUse","tool":"Read","file":"...\\docs\\commands.md","session":"eccde7a2","agent":null,"agentType":null}
{"event":"PreToolUse","tool":"Read","file":"...\\.gitignore","session":"eccde7a2","agent":null,"agentType":null}
```

This is the load-bearing one. The spec's §6 stop condition was that a coarser
trigger would collapse the 30x saving and force a re-cut into fewer, larger
docs. It does not: the unit charged is one file per tool call, which is the unit
the partition was measured against.

## 3. It fires inside subagents, identified — yes

An `Explore` subagent reading one file produced:

```json
{"event":"PreToolUse","tool":"Read","file":"...\\docs\\ops.md","session":"eccde7a2","agent":"a03244cc37e50e3d0","agentType":"Explore"}
```

The subagent independently confirmed the marker reached its context and that the
string appears nowhere in the file it read.

Note the shape: **`session_id` is shared with the main thread while `agent_id`
differs.** That is exactly what the Task 3 dedupe key needs — keying on
`session_id` alone would inject a doc into the main thread and then silently
starve every subagent of it, which is the reverse of what this feature is for,
since implementer subagents are its primary consumers.

## Findings that change Task 3

1. **`file_path` is absolute, with Windows backslashes.**
   `C:\Users\Claude\Documents\GitHub\Dino-World-Discord-Bot\vitest.config.ts`, not
   `vitest.config.ts`. The plan already specified normalising separators and
   relativising against the repo root; this confirms it as required rather than
   defensive. A matcher written against the raw value would match no glob at all
   and the hook would be silently inert — passing every test that mocked its
   input.

2. **Hook config is hot-reloaded.** `.claude/settings.json` was created
   mid-session and took effect on the next tool call with no restart. No operator
   step is needed to activate the hook in Task 15.

3. **No workspace-trust dialog appeared** for a project-settings `command` hook in
   this session. Do not rely on that holding for a fresh clone or another machine.

## What was not tested

- `Edit` payloads. `Write` was exercised incidentally — writing this very file
  fired the hook and delivered the marker — so the `matcher` covers more than
  `Read` and `tool_input.file_path` is populated for a write. `Edit` and
  `MultiEdit` remain untested and are assumed to share the shape.
- Behaviour when the hook exits non-zero or times out. The plan's constraint —
  every hook exits 0 on every path, never 2 — is written from the documented
  exit-code semantics, not from a probe.
- Whether `additionalContext` has a size limit. The documentation states none.
  The largest headline block is well under 200 lines, so this is not on the
  critical path.
