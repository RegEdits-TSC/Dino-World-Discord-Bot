import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { routeInteraction } from '../src/core/router.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { makeCtx, fakeCommand, fakeButton, fakeAutocomplete } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

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

describe('autocomplete routing', () => {
  function acRegistry(handler?: (ctx: unknown, i: unknown) => Promise<void>) {
    return new ModuleRegistry([{
      name: 'm',
      commands: [{
        data: new SlashCommandBuilder().setName('ac').setDescription('d'),
        execute: async () => {},
        ...(handler ? { autocomplete: handler as never } : {}),
      }],
      components: [],
    }], { m: true });
  }

  it('dispatches autocomplete to the command handler', async () => {
    const ctx = makeCtx();
    let called = false;
    const registry = acRegistry(async (_ctx, i) => {
      called = true;
      await (i as { respond(c: unknown): Promise<void> }).respond([{ name: 'x', value: 1 }]);
    });
    const i = fakeAutocomplete({ name: 'ac', user: 'u1', focused: { name: 'egg', value: '' } });
    await routeInteraction(ctx, registry, i.asInteraction());
    expect(called).toBe(true);
    expect(i.replies[0]).toEqual([{ name: 'x', value: 1 }]);
  });

  it('responds [] when the command has no autocomplete handler', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'ac', user: 'u1', focused: { name: 'egg', value: '' } });
    await routeInteraction(ctx, acRegistry(), i.asInteraction());
    expect(i.replies[0]).toEqual([]);
  });

  it('responds [] when the provider throws, without crashing', async () => {
    const ctx = makeCtx();
    const registry = acRegistry(async () => { throw new Error('boom'); });
    const i = fakeAutocomplete({ name: 'ac', user: 'u1', focused: { name: 'egg', value: '' } });
    await routeInteraction(ctx, registry, i.asInteraction());
    expect(i.replies[0]).toEqual([]);
  });

  it('does not touch presence on autocomplete', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'ac', user: 'u1', guild: 'g1', focused: { name: 'egg', value: '' } });
    await routeInteraction(ctx, acRegistry(), i.asInteraction());
    const rows = ctx.db.select().from(schema.userGuilds).where(eq(schema.userGuilds.userId, 'u1')).all();
    expect(rows).toEqual([]);
  });
});
