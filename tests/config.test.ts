import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/core/config.js';

const good = {
  DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c',
  DATABASE_PATH: ':memory:', OWNER_ID: 'o',
};

describe('loadConfig', () => {
  it('returns typed config from env', () => {
    const cfg = loadConfig(good);
    expect(cfg.token).toBe('t');
    expect(cfg.databasePath).toBe(':memory:');
    expect(cfg.modules.park).toBe(true);
  });
  it('throws naming the missing variable', () => {
    expect(() => loadConfig({ ...good, DISCORD_TOKEN: undefined }))
      .toThrowError(/DISCORD_TOKEN/);
  });
});
