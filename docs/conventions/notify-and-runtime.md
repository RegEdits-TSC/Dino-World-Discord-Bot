# Notify and runtime

Fires on: `src/core/notify.ts`, `src/core/context.ts` and `src/index.ts` — the three
places a `Ctx` is shaped or a passive notification is delivered — plus
`tests/notify.test.ts` and `tests/notify-handlers.test.ts`.

## Headlines

- A passive notification carries a `NotifyPayload`: `string | { content?, embeds?, files?, components?, allowedMentions? }`. §notify-payload-shape
- Keep `Ctx.notify`'s third argument typed `message: string`, never widened to `NotifyPayload` — a string is already a valid payload, so widening buys nothing and breaks every call site and the harness fake. §notify-third-arg-stays-string
- `deliverNotification` merges the `<@id>` ping through `withMention` on the CHANNEL path only; DMs go out unmentioned. §notify-mention-channel-path-only
- `src/index.ts` sets `allowedMentions: { parse: [] }` client-wide so user-supplied text can never echo a role mention into public content — and that default silently ate the `<@id>` on every channel-routed notification too. §client-wide-allowed-mentions-parse-none
- A per-message `allowedMentions: { users: [userId] }` REPLACES the client-wide default for that one message; discord.js's `MessagePayload` does not merge the two. §per-message-allowed-mentions-replaces
- `Sender` fakes are hand-rolled per test file, not in the harness, so a shape change has no single call site to grep — find them with `grep -rl 'channelSend' tests/`, and note only `npm run typecheck` catches a stale one. §sender-fakes-hand-rolled-grep
- Every `Ctx` construction site must supply `sleep(ms)` — real `setTimeout` in production, an instant stub in tests and in the live script. §ctx-sleep-injected

## notify-payload-shape

Passive notifications carry a `NotifyPayload` (`src/core/notify.ts`):
`string | { content?, embeds?, files?, components?, allowedMentions? }`.

## notify-third-arg-stays-string

`Ctx.notify`'s third argument stays `message: string` on purpose — a string
is a valid payload, so every call site keeps working and the
`ctx.notifications` fake in `tests/harness.ts` is untouched.

## notify-mention-channel-path-only

`deliverNotification`
merges the `<@id>` ping through `withMention` on the CHANNEL path only; DMs go
out unmentioned.

## client-wide-allowed-mentions-parse-none

`src/index.ts` sets `allowedMentions: { parse: [] }` client-wide (so
`/dino rename`/`/park rename` can't echo a user-supplied role mention into
public content), and that default silently ate the `<@id>` on every
channel-routed notification too — channel notifications did not actually ping
anybody until `withMention` shipped.

## per-message-allowed-mentions-replaces

`withMention` sets a per-message
`allowedMentions: { users: [userId] }`, which REPLACES the client default for
that one message (discord.js `MessagePayload` doesn't merge the two),
restoring the ping without making anything else mentionable — the same fix
landed on the trade-offer reply.

## sender-fakes-hand-rolled-grep

`Sender` fakes are hand-rolled per test
file, not in the harness, so a shape change has no single call site to grep
— `grep -rl 'channelSend' tests/` is the reliable way to find every one
(`tests/notify.test.ts`, `tests/notify-handlers.test.ts`,
`tests/journeys.test.ts`, `tests/world-broadcast.test.ts`,
`tests/alert-sweep.test.ts` — a starting point rather than an inventory, since the next
sweep-style test to land will add one without anyone remembering to update this line, so
re-run the grep rather than trusting the list) — and only
`npm run typecheck` catches a stale one.

## ctx-sleep-injected

`Ctx` carries `sleep(ms)` for the fight cinematic — real
`setTimeout` in `src/index.ts`, instant stub in `tests/harness.ts` `makeCtx`
and `scripts/test-live.ts`; every future Ctx construction site must provide
it.
