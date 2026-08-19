import { describe, it, expect } from 'vitest';
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Interaction } from 'discord.js';
import { routeInteraction } from '../src/core/router.js';
import { ModuleRegistry } from '../src/core/modules.js';
import type { ComponentDef } from '../src/core/modules.js';
import { makeCtx, fakeCommand, fakeButton, fakeAutocomplete, replyText } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';
import { track } from '../src/core/stats.js';
import { dayKeyUTC } from '../src/core/clock.js';
import { SEASON_DAYS } from '../src/core/world.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dailyRouterHooks } from '../src/modules/daily/hooks.js';
import { rollSeason, seasonView } from '../src/modules/daily/season.js';
import { rollDailyQuests } from '../src/modules/daily/service.js';
import { hubPayload } from '../src/modules/daily/embeds.js';
import { seasonPayload } from '../src/modules/daily/season-embeds.js';
import { dashboardPayload } from '../src/modules/park/embeds.js';
import { alertPayload } from '../src/modules/park/alert-embeds.js';
import { dexPageRow } from '../src/modules/dex/embeds.js';
import { chaptersPayload, type ChaptersView } from '../src/modules/battles/embeds.js';
import { eggListPayload } from '../src/modules/hatchery/embeds.js';
import { guestsPayload } from '../src/modules/guests/embeds.js';
import { leaderboardsModule } from '../src/modules/leaderboards/index.js';

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

// ---------------------------------------------------------------------------
// The router-level component guard (src/core/router.ts).
//
// A component interaction can be emitted straight at the gateway with any custom_id,
// anchored on any message the attacker can address, and routeInteraction dispatches on
// the customId PREFIX alone — so before this guard a forged id reached a real handler on
// a message that never carried the button, and 24 branches across 13 prefixes would
// happily i.update() somebody else's message with the attacker's content.
//
// These tests are the ONLY evidence the guard works. 92 fakeButton sites exist and only a
// handful route through routeInteraction; the other 87 call execute directly and
// scripts/test-live.ts bypasses the router by its own design, so both existing gates are
// blind to this change — a simulated version of it ran the whole suite green.
describe('router component guard', () => {
  const SEASON_1 = 690 * SEASON_DAYS * 86_400_000;   // season 1, day 1 (SEASON_EPOCH is 690)

  const guardCtx = () => {
    const ctx = makeCtx();
    ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
    return ctx;
  };
  const regWith = (execute: ComponentDef['execute']) =>
    new ModuleRegistry([{ name: 'm', commands: [], components: [{ prefix: 'm', execute }] }], { m: true });

  // One rejection case: route a button through a live handler and report what happened.
  async function route(customId: string, componentIds: string[]) {
    const ctx = guardCtx();
    let ran = false;
    const b = fakeButton({ customId, user: 'u1', componentIds });
    await routeInteraction(ctx, regWith(async () => { ran = true; }), b.asInteraction());
    return { ctx, ran, b };
  }

  it('dispatches a click whose id the message actually carries', async () => {
    // componentIds is STATED here, never left to the harness default it happens to equal:
    // this case must pin the passing side against a real button set.
    const { ran, b } = await route('m:go', ['m:go']);
    expect(ran).toBe(true);
    expect(b.deferOpts).toHaveLength(0);
    expect(b.replies).toHaveLength(0);
  });

  it('rejects — and acknowledges — a forged id on a message carrying no buttons at all', async () => {
    const { ran, b } = await route('m:go', []);
    expect(ran).toBe(false);
    // No distinct text reply: that would be an oracle telling an attacker the GUARD
    // stopped him rather than the handler, and would confuse a pager double-click.
    expect(b.replies).toHaveLength(0);
    // Acknowledged, never a bare return — a bare return paints "This interaction failed"
    // after 3 seconds on every rejected click, including an innocent double-click.
    expect(b.deferOpts).toHaveLength(1);
    // And acknowledged the right WAY: deferReply() also satisfies the length-1 check
    // above but posts a public "thinking…" placeholder that never resolves — exactly the
    // UX the rejection ruling exists to prevent on an innocent pager double-click. Only
    // deferUpdate() is a silent, correct no-op.
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
  });

  it('rejects when the message carries a DIFFERENT id — exact equality, never a prefix match', async () => {
    const cases: Array<[string, string]> = [
      ['m:go', 'm:other'],     // the attack shape: same prefix, an action the message never had
      ['m:go', 'm:go:1'],      // clicked id is a strict prefix of the minted one
      ['m:go:1', 'm:go'],      // minted id is a strict prefix of the clicked one
    ];
    for (const [clicked, minted] of cases) {
      const { ran, b } = await route(clicked, [minted]);
      expect(ran, `clicked ${clicked} against minted ${minted}`).toBe(false);
      expect(b.deferOpts, `clicked ${clicked} against minted ${minted}`).toHaveLength(1);
    }
  });

  it('rejects before the handler can write anything', async () => {
    const ctx = guardCtx();
    const reg = regWith(async (c, i) => {
      track(c, i.user.id, 'eggs_hatched', 1);
      await i.update({ content: 'x' });
    });
    const b = fakeButton({ customId: 'm:go', user: 'u1', componentIds: [] });
    await routeInteraction(ctx, reg, b.asInteraction());
    expect(ctx.db.select().from(schema.userStats).all()).toEqual([]);
    expect(b.replies).toHaveLength(0);
  });

  // The subtlest failure mode in the change. deferUpdate() sets i.deferred = true, and
  // daily/hooks.ts gates its hint on `!i.deferred && !i.replied` — so a guard that
  // rejected without RETURNING would let a forged click emit a real quest/season followUp
  // and, worse, burn the one-shot notifiedAt / hintedRung stamps for a message nobody
  // asked for. Nothing else in the suite can see this.
  it('rejects before postDispatch — no phantom hint, and both one-shot stamps stay owed', async () => {
    const ctx = makeCtx();
    ctx.setNow(SEASON_1);
    getOrCreateUser(ctx, 'u1', 'u1');
    const quest = ctx.db.insert(schema.dailyQuests)
      .values({ userId: 'u1', dayKey: dayKeyUTC(ctx.now()), slot: 0, questId: 'hatch_1', baseline: 0, target: 1 })
      .returning().get();
    track(ctx, 'u1', 'eggs_hatched', 1);            // quest complete, never notified
    rollSeason(ctx, 'u1');
    track(ctx, 'u1', 'expeditions_claimed', 10);    // 50 points = season rung 1, unlocked and unclaimed
    const reg = regWith(async (_c, i) => { await i.update({ content: 'x' }); });
    const b = fakeButton({ customId: 'm:go', user: 'u1', componentIds: [] });
    await routeInteraction(ctx, reg, b.asInteraction(), dailyRouterHooks);
    expect(b.replies).toHaveLength(0);
    expect(ctx.db.select().from(schema.dailyQuests)
      .where(eq(schema.dailyQuests.id, quest.id)).get()!.notifiedAt).toBeNull();
    expect(seasonView(ctx, 'u1')!.hintedRung).toBe(-1);
  });

  // Pins the guard INSIDE `if (comp)`. Hoisting it above findComponent would make the
  // router acknowledge every unclaimed customId prefix in existence — behaviour pinned
  // as a fully silent no-op since the router was written.
  it('leaves an unrouted prefix a fully silent no-op, with no acknowledgement', async () => {
    const ctx = guardCtx();
    const b = fakeButton({ customId: 'nowhere:at:all', user: 'u1', componentIds: [] });
    await routeInteraction(ctx, new ModuleRegistry([], {}), b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(0);
  });

  it('still writes presence on a rejected click', async () => {
    const ctx = guardCtx();
    let ran = false;
    const b = fakeButton({ customId: 'm:go', user: 'u1', guild: 'g1', componentIds: [] });
    await routeInteraction(ctx, regWith(async () => { ran = true; }), b.asInteraction());
    expect(ran).toBe(false);
    expect(ctx.db.select().from(schema.userGuilds).all()).toMatchObject([{ userId: 'u1', guildId: 'g1' }]);
    expect(b.deferOpts).toHaveLength(1);
  });
});

// Every id the game actually mints must survive the guard. Each id below is read back out
// of the REAL builder JSON of the payload that mints it (the
// `.toJSON().components.map(c => c.custom_id)` idiom already at tests/dex.test.ts), never
// hand-typed — a hand-typed id would prove only that the guard compares two strings
// someone wrote, not that the buttons the game ships pass it.
describe('router component guard — every live button surface still routes', () => {
  const SEASON_1 = 690 * SEASON_DAYS * 86_400_000;
  // One prefix per surface below; the handler only records, since what is under test is
  // the guard's verdict, not any module's logic.
  const PREFIXES = ['park', 'dex', 'battle', 'hatch', 'season', 'guests', 'daily', 'alert', 'top'];

  const idsOf = (rows: ReadonlyArray<{ toJSON(): unknown }> = []): string[] =>
    rows.flatMap((r) => ((r.toJSON() as { components?: Array<{ custom_id?: string }> }).components ?? [])
      .map((c) => c.custom_id).filter((id): id is string => typeof id === 'string'));

  it('routes every customId minted by every button-bearing payload in the game', async () => {
    const ctx = makeCtx();
    ctx.setNow(SEASON_1);
    const user = getOrCreateUser(ctx, 'u1', 'u1');
    rollDailyQuests(ctx, 'u1');
    rollSeason(ctx, 'u1');
    // Past the first attendance milestone (200), so /guests mints its claim button.
    ctx.db.update(schema.users).set({ attendanceHighWater: 200 })
      .where(eq(schema.users.discordId, 'u1')).run();
    // Eleven eggs: eggListPayload only mints a pager past one page.
    for (let n = 0; n < 11; n++) {
      ctx.db.insert(schema.eggs)
        .values({ userId: 'u1', rarity: 'common', source: 'expedition', obtainedAt: ctx.now() }).run();
    }
    const eggRows = ctx.db.select().from(schema.eggs).all();
    const chapters: ChaptersView = {
      progress: new Map(), ratingHighWater: 0, energy: 10, energyUpdatedAtMs: 0,
    };
    // The /top board's Visit row is built by a module-private helper, so its ids come from
    // the command's own recorded reply rather than from a direct builder call.
    const top = fakeCommand({ name: 'top', user: 'u1', options: { metric: 'cash', scope: 'global' } });
    await leaderboardsModule.commands[0].execute(ctx, top.asChatInput());
    const topRows = (top.replies[0] as { components: Array<{ toJSON(): unknown }> }).components;

    const surfaces: Array<[string, string[]]> = [
      ['/park view dashboard', idsOf(dashboardPayload(user, [], 0, 1234, 0, { now: ctx.now() }).components)],
      ['/dex list pager', idsOf([dexPageRow('u1', {}, 2, 5)])],
      ['/battle chapters', idsOf(chaptersPayload('u1', 0, chapters).components)],
      ['/hatch eggs pager', idsOf(eggListPayload(eggRows, ctx.now(), 'u1').components)],
      ['/season hub', idsOf(seasonPayload(seasonView(ctx, 'u1')!, 'u1').components)],
      ['/guests view', idsOf(guestsPayload(ctx, 'u1').components)],
      ['/daily hub', idsOf(hubPayload(ctx, 'u1').components)],
      ['park alert DM', idsOf(alertPayload(
        'u1',
        [{ dinoId: 1, name: 'Rexy', escapeAt: ctx.now() + 3_600_000, tier: 'last_call' }],
        { capAt: ctx.now(), pending: 1240, capHours: 8 },
        { endsAt: ctx.now() + 3 * 86_400_000, unclaimed: 2 },
        ctx.now(),
      )!.components)],
      ['/top board', idsOf(topRows)],
    ];

    const seen: string[] = [];
    const registry = new ModuleRegistry([{
      name: 'm', commands: [],
      components: PREFIXES.map((prefix): ComponentDef => ({
        prefix, execute: async (_c, i) => { seen.push(i.customId); },
      })),
    }], { m: true });

    for (const [label, ids] of surfaces) {
      expect(ids.length, `${label} minted no buttons — the case would be vacuous`).toBeGreaterThan(0);
      for (const id of ids) {
        const b = fakeButton({ customId: id, user: 'u1', componentIds: ids });
        await routeInteraction(ctx, registry, b.asInteraction());
        expect(seen, `${label}: ${id} was rejected by the guard`).toContain(id);
        expect(b.deferOpts, `${label}: ${id} was acknowledged instead of dispatched`).toHaveLength(0);
      }
    }
  });
});
