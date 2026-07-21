import { describe, it, expect } from 'vitest';
import { parseIdList, sideItemCount, TradeError } from '../src/modules/trading/validate.js';

describe('trade validate helpers', () => {
  it('parseIdList splits, dedups, rejects junk', () => {
    expect(parseIdList('1, 2  3,3')).toEqual([1, 2, 3]);
    expect(parseIdList('')).toEqual([]);
    expect(() => parseIdList('1,-2')).toThrow(TradeError);
    expect(() => parseIdList('a')).toThrow(TradeError);
  });
  it('sideItemCount counts dinos + eggs only', () => {
    expect(sideItemCount({ dinoIds: [1, 2], eggIds: [3], cash: 500, food: 5 })).toBe(3);
  });
});
