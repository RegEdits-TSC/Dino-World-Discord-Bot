# Help topics

Fires on: `src/modules/help/index.ts`, where `HELP_TOPICS` and the `/help` builder both
live, and `tests/help.test.ts`, the gate over their bodies.

## Headlines

- `HELP_TOPICS` stores a LAZY art descriptor (`art?: { kind, name }`), never a built `ImageRef` — `assetImage` returns a fresh `AttachmentBuilder` per call and the map is module-level, so a built ref would be shared by every reader forever. §help-topics-lazy-art-descriptor
- The `park` topic deliberately carries NO art descriptor: it defers and renders the reader's own map, degrading to a text-only embed when the render throws. §help-park-topic-defers
- Adding or removing a topic KEY changes the `/help` builder's own choices and forces `npm run deploy-commands`; adding a field to the value type, or a line to an existing topic's body, does not. §help-topic-key-forces-deploy
- `tests/help.test.ts` scrapes `/park`'s subcommand list out of the REAL builder JSON and fails until `HELP_TOPICS.park.body` names every one, so a new `/park` subcommand needs its help line in the same change. §help-body-must-name-every-subcommand

## help-topics-lazy-art-descriptor

`HELP_TOPICS` (`src/modules/help/index.ts`) stores a LAZY art descriptor
(`art?: { kind, name }`), never a built `ImageRef` — `assetImage` returns a
fresh `AttachmentBuilder` per call and the map is module-level (same class of
mistake as calling `emojiTag` in a module constant).

This file also holds the repo's only `assetImage` call whose `kind` is a variable, read
off that same map, which is the reason an art-call-site audit greps the function name
rather than a kind literal: `§audit-by-grepping-assetimage` in
`docs/conventions/prose-and-specs.md`.

## help-park-topic-defers

The `park` topic has no
descriptor: it defers and renders the reader's own map, degrading to a
text-only embed when `buildParkSnapshot`/`renderPark` throws.

## help-topic-key-forces-deploy

Adding or
removing a topic KEY changes the `/help` builder choices and forces
`npm run deploy-commands`. Adding a field to the value type does not, and neither does
adding a line to an EXISTING topic's body — including the line the subcommand gate below
demands.

## help-body-must-name-every-subcommand

`tests/help.test.ts` scrapes `/park`'s subcommand list straight from the
REAL builder JSON and fails until `HELP_TOPICS.park.body` (`src/modules/help/index.ts`)
mentions every one of them, so a `/park` subcommand added without its help line takes the
suite red until that line is written — `/park motto` and `/park feature` each landed that
way. The help copy ships in the same change as the subcommand or the change does not go
green.
