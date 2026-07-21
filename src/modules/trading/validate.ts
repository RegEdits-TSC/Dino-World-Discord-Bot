import type { TradeSide } from '../../core/db/schema.js';
export class TradeError extends Error {}
export function sideItemCount(side: TradeSide): number { return side.dinoIds.length + side.eggIds.length; }
export function parseIdList(raw: string): number[] {
  if (!raw.trim()) return [];
  const ids = raw.split(/[\s,]+/).filter(Boolean).map((s) => Number(s));
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new TradeError('Ids must be positive integers.');
  return [...new Set(ids)];
}
