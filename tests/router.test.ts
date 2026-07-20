import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { routeInteraction } from '../src/core/router.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { makeCtx, fakeCommand, fakeButton } from './harness.js';
import { schema } from '../src/core/db/index.js';

describe('routeInteraction', () => {
  it('dispatches a command to the owning module and upserts user_guilds', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    let ran = false;
    const registry = new ModuleRegistry([{
      name: 'm', components: [],
      commands: [{ data: new SlashCommandBuilder().setName('ping').setDescription('x'),
        execute: async () => { ran = true; } }],
    }], { m: true });
    const i = fakeCommand({ name: 'ping', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, registry, i.asInteraction());
    expect(ran).toBe(true);
    expect(ctx.db.select().from(schema.userGuilds).all()).toMatchObject([{ userId: 'u1', guildId: 'g1' }]);
  });

  it('dispatches a button to the owning component', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    let got = '';
    const registry = new ModuleRegistry([{
      name: 'm', commands: [],
      components: [{ prefix: 'm', execute: async (_c, b) => { got = b.customId; } }],
    }], { m: true });
    const b = fakeButton({ customId: 'm:go', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, registry, b.asInteraction());
    expect(got).toBe('m:go');
  });

  it('replies with an ephemeral error when a handler throws', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const registry = new ModuleRegistry([{
      name: 'm', components: [],
      commands: [{ data: new SlashCommandBuilder().setName('boom').setDescription('x'),
        execute: async () => { throw new Error('kaboom'); } }],
    }], { m: true });
    const i = fakeCommand({ name: 'boom', user: 'u1' });
    await routeInteraction(ctx, registry, i.asInteraction());
    const payload = i.replies[0] as { flags?: unknown };
    expect(payload.flags).toBe(MessageFlags.Ephemeral);
  });

  it('upserts user_guilds on repeated interactions from the same user+guild (update path)', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const registry = new ModuleRegistry([{
      name: 'm', components: [],
      commands: [{ data: new SlashCommandBuilder().setName('ping').setDescription('x'),
        execute: async () => {} }],
    }], { m: true });

    ctx.setNow(1000);
    await routeInteraction(ctx, registry, fakeCommand({ name: 'ping', user: 'u1', guild: 'g1' }).asInteraction());
    ctx.setNow(2000);
    await routeInteraction(ctx, registry, fakeCommand({ name: 'ping', user: 'u1', guild: 'g1' }).asInteraction());

    const rows = ctx.db.select().from(schema.userGuilds).all();
    expect(rows).toMatchObject([{ userId: 'u1', guildId: 'g1', lastSeenAt: 2000 }]);
  });

  it('throws on duplicate command names across enabled modules', () => {
    const mk = (name: string) => ({
      name, components: [],
      commands: [{ data: new SlashCommandBuilder().setName('dup').setDescription('x'), execute: async () => {} }],
    });
    expect(() => new ModuleRegistry([mk('a'), mk('b')], { a: true, b: true })).toThrow(/Duplicate command/);
  });

  it('throws on duplicate component prefixes across enabled modules', () => {
    const mk = (name: string, cmdName: string) => ({
      name,
      commands: [{ data: new SlashCommandBuilder().setName(cmdName).setDescription('x'), execute: async () => {} }],
      components: [{ prefix: 'shared', execute: async () => {} }],
    });
    expect(() => new ModuleRegistry([mk('a', 'cmda'), mk('b', 'cmdb')], { a: true, b: true }))
      .toThrow(/Duplicate component prefix/);
  });
});
