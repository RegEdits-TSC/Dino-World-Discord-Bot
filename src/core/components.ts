import type { MessageComponentInteraction } from 'discord.js';

/**
 * Structural view of one message component. Message#components is a
 * `TopLevelComponent[]` whose ActionRow members expose `customId` on each child, and
 * whose v2 container/section members nest another `components` array underneath. This
 * repo only ever mints ActionRows of buttons, but the walk below recurses regardless:
 * failing to look inside a nesting component would fail CLOSED, i.e. it would break a
 * legitimate click rather than let a forged one through.
 */
interface ComponentLike {
  customId?: string | null;
  components?: readonly ComponentLike[];
}

/**
 * Is the clicked customId actually present on the message that carries it?
 *
 * Parsing a customId proves nothing about who minted it. A component interaction can be
 * emitted straight at the gateway with any custom_id the attacker likes, anchored on any
 * message they can address — and `routeInteraction` (src/core/router.ts) dispatches on
 * the customId PREFIX alone, never checking that the message belongs to the module
 * handling it. So a handler that merely splits its own segments is trusting the
 * attacker's arithmetic.
 *
 * Message#components is the one part of that picture the client does not author: it is
 * Discord's own record of the buttons the BOT put on the message. Checking the clicked
 * id against that set is what turns "these segments parse" into "the bot minted exactly
 * this id, on this message". It is strictly stronger than binding a segment to
 * Message#interactionMetadata, which only proves the anchoring message came from SOME
 * interaction of that player's — a public /park view card, a /duel record, or their
 * genuine challenge to somebody else all satisfy that and prove nothing about the id.
 *
 * Exact equality, never a prefix match: the id's every segment — an owner, a page, a
 * ladder rung, an expiry anchor — is only trustworthy if the whole string came back.
 *
 * Fails CLOSED: a message with no components, or one whose components Discord did not
 * send, authorises nothing.
 */
export function clickedIdIsOnMessage(i: MessageComponentInteraction): boolean {
  const rows = (i.message?.components ?? []) as readonly ComponentLike[];
  const found = (list: readonly ComponentLike[]): boolean => list.some((c) =>
    c.customId === i.customId || (c.components !== undefined && found(c.components)));
  return found(rows);
}
