import { describe, it, expect } from 'vitest';
import { assetImage } from '../src/core/images.js';

describe('assetImage', () => {
  it('returns an attachment ref for a present file', () => {
    const img = assetImage('eggs', 'common');
    expect(img).not.toBeNull();
    expect(img!.url).toBe('attachment://common.png');
    expect(img!.file.name).toBe('common.png');
  });
  it('returns null for a missing file', () => {
    expect(assetImage('eggs', 'no-such-rarity')).toBeNull();
    expect(assetImage('sites', 'no-such-site-banner')).toBeNull();
  });
  it('caches existence checks (same answer on repeat calls)', () => {
    expect(assetImage('eggs', 'mythic')).not.toBeNull();
    expect(assetImage('eggs', 'mythic')).not.toBeNull();
  });
  it('accepts the banners kind and null-degrades when absent', () => {
    expect(assetImage('banners', 'no-such-banner')).toBeNull();
  });
});
