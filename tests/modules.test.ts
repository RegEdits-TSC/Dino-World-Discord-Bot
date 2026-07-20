import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder } from 'discord.js';
import { ModuleRegistry, type ModuleManifest } from '../src/core/modules.js';

const mk = (name: string, cmd: string): ModuleManifest => ({
  name,
  commands: [{ data: new SlashCommandBuilder().setName(cmd).setDescription('x'), execute: async () => {} }],
  components: [{ prefix: `${name}-btn`, execute: async () => {} }],
});

describe('ModuleRegistry', () => {
  it('exposes only enabled modules', () => {
    const r = new ModuleRegistry([mk('park', 'park'), mk('shop', 'shop')], { park: true, shop: false });
    expect(r.commands().map(c => c.data.name)).toEqual(['park']);
    expect(r.findCommand('shop')).toBeUndefined();
    expect(r.findComponent('park-btn:collect')).toBeDefined();
    expect(r.findComponent('shop-btn:buy')).toBeUndefined();
  });
});
