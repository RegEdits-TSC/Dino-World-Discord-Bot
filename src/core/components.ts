import type { MessageComponentInteraction } from 'discord.js';

/**
 * Structural view of one message component. Message#components is a
 * `TopLevelComponent[]` whose ActionRow members expose `customId` on each child, and
 * whose v2 container/section members nest another `components` array underneath. This
 * repo only ever mints ActionRows of buttons and selects, but the walk below recurses
 * regardless: failing to look inside a nesting component would fail CLOSED, i.e. it
 * would break a legitimate click rather than let a forged one through.
 *
 * `options` is only ever populated on a select's own component (a button has none) and
 * is read by `submittedValuesAreOnMessage` below, never by `clickedIdIsOnMessage`.
 */
interface ComponentLike {
  customId?: string | null;
  components?: readonly ComponentLike[];
  options?: readonly { value?: string }[];
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
 * Fails CLOSED: a nullish or empty clicked id, a message with no components, or one
 * whose components Discord did not send, authorises nothing. The clicked-id guard
 * matters on its own terms, not just defensively — without it, an absent `i.customId`
 * would satisfy `undefined === undefined` against a component that likewise carries no
 * `customId` (an unset property reads back `undefined`, same as a nullish clicked id),
 * matching by coincidence rather than by the bot's own record.
 *
 * Section accessories and Label children are deliberately NOT walked: they sit outside
 * `.components`, nothing in this repo mints them, and modals are not routed. If Components
 * V2 Sections or modals ever arrive, extend the walk in the same change.
 */
export function clickedIdIsOnMessage(i: MessageComponentInteraction): boolean {
  if (typeof i.customId !== 'string' || i.customId.length === 0) return false;
  const rows = (i.message?.components ?? []) as readonly ComponentLike[];
  const found = (list: readonly ComponentLike[]): boolean => list.some((c) =>
    c.customId === i.customId || (c.components !== undefined && found(c.components)));
  return found(rows);
}

/**
 * Are the submitted values ones the bot actually offered on this menu?
 *
 * `clickedIdIsOnMessage` proves the bot minted THIS MENU on THIS MESSAGE. It proves
 * nothing about `i.values`, which arrive on a separate client-supplied channel and are
 * never mentioned in the customId. Nothing in the installed discord.js or
 * discord-api-types claims Discord's gateway rejects a value absent from the option list,
 * a count outside min_values/max_values, or a click on a disabled component — so this
 * repo assumes none of it is enforced.
 *
 * Deliberately a SEPARATE exported function rather than folded into clickedIdIsOnMessage:
 * the router calls that guard for every component including buttons, which have no values
 * to check.
 *
 * A corollary worth stating: do NOT close a select flow by disabling the menu. Neither
 * guard reads `disabled`, so a disabled select is not a lock. Close a flow by removing the
 * component.
 *
 * A second corollary, now load-bearing rather than merely inconvenient: NEVER mint a select
 * with `min_values: 0`. `routeInteraction` (src/core/router.ts) calls this guard for every
 * select centrally, and an empty `values` array fails it closed — there is no longer a
 * handler-local opt-out. A flow that needs an optional selection must give it an explicit
 * "none" option instead of relying on an empty submission.
 *
 * Fails CLOSED: an empty submission, a menu absent from the message, or a menu carrying no
 * options authorises nothing. All-or-nothing — a partially valid submission is rejected
 * rather than filtered down to its good half, because a handler receiving a shortened
 * values array would act on a selection the player never made.
 */
export function submittedValuesAreOnMessage(i: MessageComponentInteraction & { values?: readonly string[] }): boolean {
  const values = i.values ?? [];
  if (values.length === 0) return false;
  if (typeof i.customId !== 'string' || i.customId.length === 0) return false;
  const rows = (i.message?.components ?? []) as readonly ComponentLike[];
  const find = (list: readonly ComponentLike[]): ComponentLike | undefined => {
    for (const c of list) {
      if (c.customId === i.customId) return c;
      if (c.components !== undefined) {
        const hit = find(c.components);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const menu = find(rows);
  if (!menu || !menu.options || menu.options.length === 0) return false;
  // A Set, never an object keyed by value: `__proto__` and `constructor` read back truthy
  // from a plain object, which is exactly the hole that makes buildLot's kind check
  // ineffective against a forged value.
  const offered = new Set(menu.options.map((o) => o.value));
  return values.every((v) => offered.has(v));
}
