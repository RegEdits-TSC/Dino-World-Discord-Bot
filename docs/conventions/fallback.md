# No doc claims this file yet

Fires on: any file under `src/`, `scripts/` or `tests/` that no topic doc's globs claim —
a new `src/core/*.ts`, a new module's `service.ts`, a new top-level test.

## Headlines

No convention doc covers this file's subject. That is not a promise that no rule applies
to the change you are making, and it is not an invitation to invent one here.

- The **Always true** rules in `CLAUDE.md` apply to every file in the repo, including this
  one, and are deliberately not repeated in any topic doc.
- The **Topics** index in `CLAUDE.md` lists every doc, what it owns and which files it
  fires on. A rule for the code you are about to write very often lives under a
  neighbouring topic — read the doc for the subsystem you are calling INTO, not only for
  the file you are editing.
- `docs/conventions/manifest.json` maps each doc to the exact globs that trigger it. Grep
  it for a path, a directory or a filename to find which doc, if any, claims a neighbour
  of this file, then read that doc directly.

If this change establishes something the next person has to follow, it belongs in a topic
doc with a trigger glob that would have fired here — not in a comment, and not in a note
nothing loads.
