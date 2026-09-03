import type { ButtonStyle } from 'discord.js';

/** Which block of the hub card a row renders under. */
export type HubSection = 'ready' | 'attention' | 'claim' | 'waiting' | 'goals';

export interface HubControl { customId: string; label: string; style: ButtonStyle }

/**
 * One line of the hub, and optionally the button that actions it.
 *
 * `lossAtMs` is the instant the player STARTS LOSING something by not acting — a season
 * rung's forfeit, a trade offer's expiry, a dino's escape instant, the moment idle income
 * capped. `null` means the row waits forever: a ready egg, an unclaimed achievement, a
 * finished dig. It is not a priority number and must never be used as one; rankSignals is
 * the only thing that reads it.
 *
 * A row with no `control` is text-only and deliberately never takes a button seat — the
 * escaped-dino row and the trade-offer row both ship that way.
 */
export interface HubSignal {
  id: string;
  section: HubSection;
  text: string;
  lossAtMs: number | null;
  control?: HubControl;
}
