import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Interaction } from 'discord.js';
import { routeInteraction } from '../src/core/router.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { makeCtx, fakeCommand, fakeButton, fakeAutocomplete, replyText } from './harness.js';
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
    expect(ctx.db.select().from(schema.users).all()[0].displayName).toBe('u1');
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

  it('falls back to followUp when the handler deferred before throwing', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const reg = new ModuleRegistry([{
      name: 'm', components: [],
      commands: [{
        data: new SlashCommandBuilder().setName('boom').setDescription('x'),
        async execute(_c, i) { await i.deferReply(); throw new Error('boom'); },
      }],
    }], { m: true });
    const fi = fakeCommand({ name: 'boom', user: 'u1' });
    await routeInteraction(ctx, reg, fi.asInteraction());
    // deferReply recorded nothing; the followUp fallback is the only reply.
    expect(fi.replies).toHaveLength(1);
    expect(replyText(fi.replies[0])).toContain('Something went wrong');
  });
  it('falls back to followUp when the handler replied before throwing', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const reg = new ModuleRegistry([{
      name: 'm', components: [],
      commands: [{
        data: new SlashCommandBuilder().setName('boom2').setDescription('x'),
        async execute(_c, i) { await i.reply({ content: 'partial' }); throw new Error('late'); },
      }],
    }], { m: true });
    const fi = fakeCommand({ name: 'boom2', user: 'u1' });
    await routeInteraction(ctx, reg, fi.asInteraction());
    expect(fi.replies).toHaveLength(2);
    expect(replyText(fi.replies[1])).toContain('Something went wrong');
  });
  it('unknown command is a silent no-op but presence still writes', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const reg = new ModuleRegistry([], {});
    const fi = fakeCommand({ name: 'ghost', user: 'u1', guild: 'g1' });
    await routeInteraction(ctx, reg, fi.asInteraction());
    expect(fi.replies).toHaveLength(0);
    expect(ctx.db.select().from(schema.userGuilds).all()).toHaveLength(1);
  });
  it('first-ever user (no users row) routes without crashing; displayName update no-ops', async () => {
    const ctx = makeCtx();
    const reg = new ModuleRegistry([], {});
    const fi = fakeCommand({ name: 'ghost', user: 'new-user', guild: 'g1' });
    await routeInteraction(ctx, reg, fi.asInteraction());
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(0);
    expect(ctx.db.select().from(schema.userGuilds).all()).toHaveLength(1);
  });
  it('unmatched button customId is a silent no-op', async () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    const reg = new ModuleRegistry([], {});
    const fb = fakeButton({ customId: 'nowhere:at:all', user: 'u1' });
    await routeInteraction(ctx, reg, fb.asInteraction());
    expect(fb.replies).toHaveLength(0);
  });
  it('non-command, non-button, non-autocomplete interactions return quietly with no presence write', async () => {
    const ctx = makeCtx();
    const reg = new ModuleRegistry([], {});
    const modalish = {
      isAutocomplete: () => false, isChatInputCommand: () => false, isButton: () => false,
      user: { id: 'u1', displayName: 'u1' }, guildId: 'g1',
    };
    await routeInteraction(ctx, reg, modalish as unknown as Interaction);
    expect(ctx.db.select().from(schema.userGuilds).all()).toHaveLength(0);
  });
  it('autocomplete double-fault (provider throws, recovery respond throws too) never rejects', async () => {
    const ctx = makeCtx();
    const reg = new ModuleRegistry([{
      name: 'm', components: [],
      commands: [{
        data: new SlashCommandBuilder().setName('ac').setDescription('x')
          .addStringOption((o) => o.setName('q').setDescription('q').setAutocomplete(true)),
        async execute() { /* unused */ },
        async autocomplete() { throw new Error('provider boom'); },
      }],
    }], { m: true });
    const hostile = {
      commandName: 'ac',
      isAutocomplete: () => true, isChatInputCommand: () => false, isButton: () => false,
      user: { id: 'u1', displayName: 'u1' }, guildId: null,
      respond: async () => { throw new Error('respond boom'); },
    };
    await expect(routeInteraction(ctx, reg, hostile as unknown as Interaction)).resolves.toBeUndefined();
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
