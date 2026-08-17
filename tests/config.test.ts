import { describe, it, expect } from 'vitest';
import { loadConfig, parseModules } from '../src/core/config.js';

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
  it('loads modules.json validated as string->boolean (regression)', () => {
    const cfg = loadConfig(good);
    expect(cfg.modules).toEqual({ park: true, hatchery: true, expeditions: true, shop: true, settings: true, care: true, trading: true, leaderboards: true, admin: true, help: true, battles: true, genelab: true, daily: true, world: true, dex: true, duels: true, guests: true });
  });
});

describe('parseModules', () => {
  it('accepts an object of string->boolean', () => {
    expect(parseModules({ park: true, zoo: false })).toEqual({ park: true, zoo: false });
  });
  it('rejects a non-boolean module value', () => {
    expect(() => parseModules({ park: 'yes' })).toThrowError(/park/);
  });
});
