import { describe, it, expect } from 'vitest';
import { paginate, pageRow } from '../src/core/paginate.js';

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, n) => n);
  it('slices 10 per page and reports pages', () => {
    expect(paginate(items, 1)).toEqual({ items: items.slice(0, 10), page: 1, pages: 3 });
    expect(paginate(items, 3).items).toHaveLength(5);
  });
  it('clamps out-of-range pages', () => {
    expect(paginate(items, 0).page).toBe(1);
    expect(paginate(items, 99).page).toBe(3);
  });
  it('empty list is one empty page', () => {
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pages: 1 });
  });
  it('exactly 10 rows is a single page', () => {
    expect(paginate(items.slice(0, 10), 1).pages).toBe(1);
  });
});

describe('pageRow', () => {
  it('encodes owner + target pages and disables at bounds', () => {
    type Row = { components: Array<{ custom_id: string; disabled: boolean }> };
    const row = pageRow('park', 'dinos', 'u1', 1, 3).toJSON() as Row;
    expect(row.components[0].custom_id).toBe('park:dinos:u1:0');
    expect(row.components[0].disabled).toBe(true);   // Prev on page 1
    expect(row.components[1].custom_id).toBe('park:dinos:u1:2');
    expect(row.components[1].disabled).toBe(false);
    const last = pageRow('park', 'dinos', 'u1', 3, 3).toJSON() as Row;
    expect(last.components[1].disabled).toBe(true);  // Next on last page
  });
});
