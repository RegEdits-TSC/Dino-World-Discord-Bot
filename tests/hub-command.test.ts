import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeCommand, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { schema } from '../src/core/db/index.js';
import { ALL_MODULES } from '../src/core/module-list.js';

let ctx: ReturnType<typeof makeCtx>;
// makeCtx's default config carries `modules: {}`, and hubView gates every control it mints
// for another module on that module's flag — so the default would render this end-to-end
// card with no Incubate button and the case below would stop being end-to-end. Derived from
// ALL_MODULES so a module added later is enabled here without anyone remembering to.
beforeEach(() => {
  ctx = makeCtx({
    config: {
      token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner',
      modules: Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])),
    },
  });
});

describe('/hub', () => {
  it('routes through the real registry and answers ephemerally', async () => {
    // routeInteraction, never hubModule.commands[0].execute: findCommand missing would
    // make the router fall through in SILENCE, and a direct call cannot see that.
    const i = fakeCommand({ name: 'hub', user: 'u1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    expect(i.replies, 'the /hub command answered nothing').toHaveLength(1);
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
  });

  it('mints the users row for a first-time caller rather than throwing', () => {
    // toClockDinos does `.get()!` on the users row, so every read the hub will grow in
    // later tasks throws a TypeError for a player with no row. getOrCreateUser first is
    // what makes those reads safe, and this is the case that pins the ordering.
    const i = fakeCommand({ name: 'hub', user: 'brand-new' });
    return routeInteraction(ctx, testRegistry, i.asInteraction()).then(() => {
      const row = ctx.db.select().from(schema.users).all()
        .find((u) => u.discordId === 'brand-new');
      expect(row, 'no users row was minted for a first-time /hub caller').toBeTruthy();
    });
  });

  it('renders the real card with service, ranking and rendering joined end-to-end', async () => {
    // Seed something visible: an un-incubated egg. The hub lists such eggs as 'eggs-idle'
    // with a text field, and offers an Incubate button.
    getOrCreateUser(ctx, 'u1', 'U1');
    ctx.db.insert(schema.eggs).values({
      userId: 'u1', rarity: 'common', source: 'shop', obtainedAt: 0,
    }).run();
    const i = fakeCommand({ name: 'hub', user: 'u1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    expect(i.replies).toHaveLength(1);
    const reply = i.replies[0] as {
      flags?: number;
      embeds?: Array<{ toJSON?: () => unknown; fields?: Array<{ value: string }> }>;
      components?: Array<{ toJSON?: () => unknown; components: Array<{ custom_id?: string; customId?: string; label: string }> }>;
    };
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    // Embeds and components may be EmbedBuilder/ActionRowBuilder objects with toJSON methods
    const embed = reply.embeds?.[0];
    const embedObj = (embed && typeof (embed as { toJSON?: unknown }).toJSON === 'function'
      ? (embed as { toJSON(): unknown }).toJSON()
      : embed) as { fields?: Array<{ value: string }> };
    const embedText = embedObj?.fields?.map((f) => f.value).join('\n') ?? '';
    expect(embedText, 'embed must contain egg-related text').toMatch(/egg/i);
    // Assert the components include the Refresh button — proof that service, ranking
    // and rendering are actually joined up
    const components = reply.components ?? [];
    let refreshButton: { custom_id?: string; customId?: string; label: string } | undefined;
    for (const row of components) {
      const rowObj = (row && typeof (row as { toJSON?: unknown }).toJSON === 'function'
        ? (row as { toJSON(): unknown }).toJSON()
        : row) as { components: Array<{ custom_id?: string; customId?: string; label: string }> };
      refreshButton = rowObj?.components?.find((c) =>
        (c.custom_id?.startsWith('hub:refresh:') || c.customId?.startsWith('hub:refresh:')));
      if (refreshButton) break;
    }
    expect(refreshButton, 'hub reply must have the Refresh button').toBeTruthy();
    expect(refreshButton!.label).toContain('Refresh');
    // And the cross-module control the seeded egg earns, which the Refresh button alone
    // would not prove: hub:refresh is minted unconditionally by hubCardPayload, so a card
    // whose ranked action row never rendered at all still carries it.
    const allButtons = components.flatMap((row) => {
      const rowObj = (row && typeof (row as { toJSON?: unknown }).toJSON === 'function'
        ? (row as { toJSON(): unknown }).toJSON()
        : row) as { components: Array<{ custom_id?: string; customId?: string; label: string }> };
      return rowObj?.components ?? [];
    });
    expect(
      allButtons.some((c) => (c.custom_id ?? c.customId ?? '').startsWith('hatch:inc:')),
      'the idle egg earned no Incubate button',
    ).toBe(true);
  });
});
