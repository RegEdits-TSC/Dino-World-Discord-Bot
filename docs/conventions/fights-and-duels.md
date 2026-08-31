# Fights and duels

Fires on: everything under `src/modules/battles/` and `src/modules/duels/` — the fight
pipeline, the four-frame cinematic built by `fightFrames`, the edit queue behind it and
the duel challenge handler — plus the suites over them (`tests/battles-embeds.test.ts`,
`tests/battles-module.test.ts` and `tests/duels.test.ts`).

## Headlines

- The fight pipeline is commit-before-present: `runFight` commits every write in ONE transaction before the first Discord edit, so never move a write into the frame loop — a crash or a Skip mid-cinematic must cost animation frames only, never state. §commit-before-present
- `fightFrames` picks its thumbnail ONCE, up front, off `rosterFor` — re-derive it anywhere else and the frame can show an enemy the fight never fielded. §fightframes-thumb-picked-once
- A boss stage whose portrait is missing degrades to NO thumbnail and must never fall back to archetype art: `rosterFor`'s lead entry on a 1-dino squad IS the boss, so the fallback would draw the named boss as a generic archetype. §boss-portrait-never-falls-back-to-archetype
- One merged `thumb` ref feeds `dress()` (F1-F3), F4's `setThumbnail` and both `files` arrays — a second code path is a second way for F1 and F4 to disagree about what was uploaded. §one-merged-thumb-ref
- `fightFrames` attaches files on frame 1 and frame 4 ONLY, each uploading exactly what its own embed references; give F2 or F3 a `files` or `attachments` key and F1's uploads are replaced, so its `attachment://` URLs stop resolving. §frames-attach-f1-f4-only
- F1 and F4 both send `attachments: []` UNCONDITIONALLY, not only when they have files — a deploy missing `assets/images/sites/` is exactly the case where F1 has no files of its own, and making either send conditional reopens three distinct defects. §f1-f4-unconditional-empty-attachments
- `tests/battles-embeds.test.ts`'s frame-contract test is the machine gate for those rules, and the Skip button replays the same F4 payload via `i.update` — let the two paths drift and only one of them is gated. §frame-contract-gate-and-skip-replay
- `fightFrames` is the ONE surface that must not be converted to `attach`, however many refs it grows. §fightframes-attach-exception
- Every edit to a presented fight goes through `queueEdit`; without that serialization a beat frame can land after F4 and restore an embed pointing at a banner F4 already dropped — a permanently broken image. §queue-edits-on-presented-message
- A client-supplied INSTANT needs clamping from ABOVE as well as below: narrowing the duel replay window's upper edge to `ctx.now()` looks tighter and instead empties the window, letting one fixed customId replay forever. §clamp-client-instant-from-above

## commit-before-present

The fight pipeline is **commit-before-present**: `runFight` commits every
write (energy, rewards, progress, XP, boss egg) in ONE transaction before the
first Discord edit, so a crash or Skip mid-cinematic loses animation frames
only, never state — never move a write into the frame loop.

## fightframes-thumb-picked-once

`fightFrames` picks its thumbnail once, up front: the boss portrait on a boss
stage, else the archetype art of `rosterFor(stage, squad.length)[0]` — the same
lead enemy the Enemies field opens with, so the frame can never disagree with
the fight. Deriving it from `rosterFor` rather than re-picking it is the whole point;
that function is the single source of truth for who is fielded and which entry is the
boss, stated at `§rosterfor-single-source` in
`docs/conventions/battle-content-and-balance.md`.

## boss-portrait-never-falls-back-to-archetype

A boss stage whose portrait is missing degrades to **no** thumbnail;
it must never fall back to archetype art, because `rosterFor`'s lead entry on a
1-dino squad IS the boss — the fallback would quietly render the named boss as its own
generic archetype. A missing portrait is not an error in the first place, which is what
makes the no-thumbnail outcome acceptable rather than a hole to plug: see
`§boss-portraits-committed-and-degradable` in `docs/conventions/art-asset-files.md`.

## one-merged-thumb-ref

One merged `thumb` ref feeds `dress()` (F1-F3), F4's
`setThumbnail`, and both `files` arrays, so the F1/F4 upload contract holds
without a second code path. Split it into two lookups and F4 can come to reference a
file F1 never uploaded, or the reverse.

## frames-attach-f1-f4-only

`fightFrames`
(`src/modules/battles/embeds.ts`) attaches files on **frame 1 and frame 4
only**, and each attaching frame uploads exactly the files its embed
references. F2/F3 must carry no `files`/`attachments` key at all — F1's
uploads survive and their `attachment://` URLs keep resolving.

## f1-f4-unconditional-empty-attachments

**F1 and F4 both
send `attachments: []` unconditionally** (plus their own `files` when the art
exists), because a payload carrying `files` (or an explicit `attachments` array)
replaces the message's whole attachment set (discord.js `MessagePayload`). That buys
three distinct things, and losing the key is a separate defect in each:
it is how F4 sheds the chapter banner it no longer references — never dress F4 with
the chapter banner again — how the no-art case
avoids stranding F1's upload as a bare attachment card, and — on F1 — how a
`battle:again` replay avoids inheriting the *previous* fight's outcome banner,
since `presentFight` re-edits the message F4 last wrote and an F1 with neither
key would leave that banner live under F1–F3.

Both must stay unconditional rather than fire only when the frame has files: a
deploy missing `assets/images/sites/` is exactly the case where F1 has no files
of its own, and it is exactly the case the bare-attachment-card defect appears in.

## frame-contract-gate-and-skip-replay

`tests/battles-embeds.test.ts`'s frame-contract test
is the machine gate; the skip button replays the same F4 payload via
`i.update`, so both paths must stay identical.

## fightframes-attach-exception

`fightFrames` (`src/modules/battles/embeds.ts`) is the one exception to the rule that
every embed image is wired through `attach` (`§always-use-attach` in
`docs/conventions/embed-payload-builders.md`): every ref
it builds is dressed onto several embeds and the files are then split across two
payloads by the F1/F4 contract — do not convert any of them, however many there are.

## queue-edits-on-presented-message

F4's
payload can reach two send sites — `presentFight`'s closing `editReply` and,
if a Skip races it, the button handler's `i.update`
(`src/modules/battles/index.ts`). Handing each of those sends its own fresh
`attachments: []` is one half of what the pair needs, and is stated at
`§payload-never-shared-across-two-sends` in
`docs/conventions/embed-payload-builders.md`.

The other half is ORDERING, not just unshared arrays: `entry.skipped` is
only observable between frames, so a Skip landing while a beat frame's
`editReply` is in flight cannot stop that PATCH, and a beat frame landing after
F4 restores an embed pointing at a chapter banner F4 already dropped — a
permanently broken image. `queueEdit` serializes every edit on a presentation
behind the previous one and re-checks a guard before sending, so F4 is the last
PATCH in either interleaving; the lock is free during the frame loop's own
`ctx.sleep` (`§ctx-sleep-injected` in `docs/conventions/notify-and-runtime.md`), so a
Skip clicked between frames still answers instantly. Any future third writer to a
presented message must go through the same queue.

## clamp-client-instant-from-above

A client-supplied INSTANT
needs clamping from ABOVE as well as below. The duel handler pairs this with the
customId guards (`§clicked-id-on-message` in
`docs/conventions/router-and-registry.md`) as a second rule worth copying.

`expiresAtMs` was bounded only as
"finite and in the future", and `challengeAlreadyResolved`
(`src/modules/duels/service.ts`) derives its replay window's lower edge from it —
`[expiresAtMs - TTL, expiresAtMs]`. Narrowing that window's UPPER edge to `ctx.now()`
looks tighter and is the opposite: the window is then empty for any anchor past
`now + TTL`, the guard returns false unconditionally, and one fixed customId replays
forever (three replays turned 1 duel row into 4). The handler's
`expiresAtMs <= ctx.now() + DUEL_CHALLENGE_TTL_MS` clamp is what makes the original
bound sound: it forces `expiresAtMs - TTL <=` the click that wrote the first row, so a
later click of the SAME id recomputes the SAME window and provably finds that row
inside it.

Only the clamp is load-bearing: relaxing it reopens the incrementing-anchor
bypass the bound alone cannot see. The bound (`<= expiresAtMs` rather than
`<= ctx.now()`) is defence-in-depth, not a second lock — under the clamp the two are
provably equivalent, and reverting the bound to `ctx.now()` with the clamp still in
place leaves the duel suite green.
