import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser, buildLot, upgradeLot, collectIncome, pendingIncome, capHours, LotLimitError, UnknownKindError, toClockDinos } from './service.js';
import { settleEscapes } from './escapes.js';
import { assignDino, unassignDino, decorateLot, listDinos, paddockCapacity, AssignError } from './dinos.js';
import { dashboardPayload, withParkImage } from './embeds.js';
import { buildParkSnapshot } from './snapshot.js';
import { renderPark } from '../../core/render/client.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { escapeAt, ESCAPE_WARN_MS } from '../../core/clock.js';
import { PADDOCKS } from '../../data/paddocks.js';
import { FACILITIES } from '../../data/facilities.js';
import { DECOR } from '../../data/decor.js';
import { getSpecies } from '../../data/species/index.js';
import { matches, respondRanked, emptyRow, dinoLabel } from '../../core/autocomplete.js';
import { paginate, pageRow } from '../../core/paginate.js';
import { emojiTag } from '../../core/emojis.js';
import type { Ctx } from '../../core/context.js';

const kindChoices = [...Object.keys(PADDOCKS), ...Object.keys(FACILITIES)]
  .map((k) => ({ name: k.replaceAll('_', ' '), value: k }));

function dinoListPayload(ctx: Ctx, userId: string, page: number) {
  const all = listDinos(ctx, userId);
  const { items, page: p, pages } = paginate(all, page);
  const nowMs = ctx.now();
  const lines = items.length
    ? items.map((d) => {
        const status = d.dino.escapedAt !== null ? `${emojiTag('dw_alert')} ESCAPED — /rescue` : `${Math.round(d.comfort * 100)}% comfort`;
        const warn = d.dino.escapedAt === null && d.escapeAt !== null && d.escapeAt - nowMs <= ESCAPE_WARN_MS
          ? ` — ${emojiTag('dw_hunger')} escapes <t:${Math.floor(d.escapeAt / 1000)}:R>` : '';
        const loc = d.dino.lotId ? `lot ${d.dino.lotId}` : 'unassigned';
        return `#${d.dino.id} ${d.species.name} — ${status}${warn} — ${loc}`;
      }).join('\n')
    : 'No dinos yet. Hatch one!';
  const embed = new EmbedBuilder().setTitle('🦕 Your dinos').setDescription(lines).setColor(0x3ba55c)
    .setFooter({ text: `Page ${p}/${pages}` });
  return { embeds: [embed], components: pages > 1 ? [pageRow('park', 'dinos', userId, p, pages)] : [] };
}

export const parkModule: ModuleManifest = {
  name: 'park',
  commands: [
    {
      data: new SlashCommandBuilder().setName('park').setDescription('Your park')
        .addSubcommand((s) => s.setName('view').setDescription('Park dashboard')
          .addUserOption((o) => o.setName('user').setDescription('View another player\'s park').setRequired(false)))
        .addSubcommand((s) => s.setName('rename').setDescription('Rename your park')
          .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(60))),
      async execute(ctx, i) {
        const user = getOrCreateUser(ctx, i.user.id, i.user.displayName);
        if (i.options.getSubcommand() === 'rename') {
          const name = i.options.getString('name', true);
          ctx.db.update(schema.users).set({ parkName: name })
            .where(eq(schema.users.discordId, i.user.id)).run();
          await i.reply({ content: `Park renamed to **${name}**.` });
          return;
        }
        const targetUser = i.options.getUser('user');
        if (targetUser && targetUser.id !== i.user.id) {
          const targetRow = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, targetUser.id)).get();
          if (!targetRow) { await i.reply({ content: 'That player has no park yet.', flags: MessageFlags.Ephemeral }); return; }
          await i.deferReply();
          settleEscapes(ctx, targetUser.id);
          const fresh = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, targetUser.id)).get()!;
          const tlots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, targetUser.id)).all();
          const tdinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, targetUser.id)).all();
          const tescaped = tdinos.filter((d) => d.escapedAt !== null).length;
          const payload = dashboardPayload(fresh, tlots, tdinos.length, 0, tescaped);
          const base = { embeds: payload.embeds };
          let png: Buffer | undefined;
          try { png = await renderPark(buildParkSnapshot(ctx, targetUser.id)); } catch { png = undefined; }
          await i.editReply(png ? withParkImage(base, png) : base);   // read-only: no Collect button
          return;
        }
        await i.deferReply();
        settleEscapes(ctx, i.user.id);
        const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all();
        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        const escapedCount = dinos.filter((d) => d.escapedAt !== null).length;
        const { clockDinos } = toClockDinos(ctx, i.user.id);
        const nowMs = ctx.now();
        const atRiskCount = clockDinos.filter((c) => {
          if (c.escapedAt !== null) return false;
          const e = escapeAt(c);
          return e !== null && e - nowMs <= ESCAPE_WARN_MS;
        }).length;
        const pending = pendingIncome(ctx, i.user.id);
        const capped = pending > 0 && ctx.now() - user.lastCollectAt >= capHours(lots) * 3_600_000;
        const base = dashboardPayload(user, lots, dinos.length, pending, escapedCount, { atRiskCount, capped });
        let png: Buffer | undefined;
        try { png = await renderPark(buildParkSnapshot(ctx, i.user.id)); } catch { png = undefined; }
        await i.editReply(png ? withParkImage(base, png) : base);
      },
    },
    {
      data: new SlashCommandBuilder().setName('build').setDescription('Build on an empty lot')
        .addStringOption((o) => o.setName('kind').setDescription('What to build').setRequired(true)
          .addChoices(...kindChoices)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const lot = buildLot(ctx, i.user.id, i.options.getString('kind', true));
          const hint = lot.type === 'paddock' ? ' Assign a dino with /dino assign to start earning.' : '';
          await i.reply({ content: `🏗️ Built **${lot.name}** (lot #${lot.id}).${hint}` });
        } catch (e) {
          if (e instanceof LotLimitError) await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
    },
    {
      data: new SlashCommandBuilder().setName('upgrade').setDescription('Upgrade a lot')
        .addIntegerOption((o) => o.setName('lot').setDescription('Lot — type to search').setRequired(true).setAutocomplete(true)),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          const lot = upgradeLot(ctx, i.user.id, i.options.getInteger('lot', true));
          await i.reply({ content: `⬆️ **${lot.name}** is now level ${lot.level}.` });
        } catch (e) {
          if (e instanceof LotLimitError) await i.reply({ content: 'Already max level.', flags: MessageFlags.Ephemeral });
          else if (e instanceof UnknownKindError) await i.reply({ content: 'No such lot.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
      async autocomplete(ctx, i) {
        const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all();
        if (!lots.length) { await respondRanked(i, [emptyRow('No lots — /build one first', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, lots
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => {
            const maxLevel = FACILITIES[l.kind]?.maxLevel ?? 4;
            const valid = l.level < maxLevel;
            return { value: l.id, valid, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level})${valid ? '' : ' — MAX LEVEL'}` };
          }));
      },
    },
    {
      data: new SlashCommandBuilder().setName('dino').setDescription('Manage your dinos')
        .addSubcommand((s) => s.setName('list').setDescription('List your dinos'))
        .addSubcommand((s) => s.setName('assign').setDescription('Assign a dino to a paddock')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('lot').setDescription('Paddock — type to search').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('unassign').setDescription('Remove a dino from its paddock')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'list') {
            await i.reply(dinoListPayload(ctx, i.user.id, 1));
          } else if (sub === 'assign') {
            assignDino(ctx, i.user.id, i.options.getInteger('dino', true), i.options.getInteger('lot', true));
            await i.reply({ content: '🦕 Assigned.' });
          } else {
            unassignDino(ctx, i.user.id, i.options.getInteger('dino', true));
            await i.reply({ content: '🦕 Unassigned.' });
          }
        } catch (e) { if (e instanceof AssignError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral }); else throw e; }
      },
      async autocomplete(ctx, i) {
        const focused = i.options.getFocused(true);
        const q = String(focused.value);
        const now = ctx.now();
        if (focused.name === 'dino') {
          const sub = i.options.getSubcommand();
          const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
          if (!dinos.length) { await respondRanked(i, [emptyRow('No dinos — hatch an egg first', 0)]); return; }
          await respondRanked(i, dinos
            .map((d) => ({ d, species: getSpecies(d.speciesId) }))
            .filter(({ d, species }) => matches(q, d.id, species.name, species.rarity))
            .map(({ d, species }) => ({
              value: d.id, label: dinoLabel(d, species, now),
              valid: sub === 'unassign' ? d.lotId !== null : d.escapedAt === null,
            })));
          return;
        }
        // focused.name === 'lot' (assign target) — paddocks only, FULL tagged
        const paddocks = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all()
          .filter((l) => l.type === 'paddock');
        if (!paddocks.length) { await respondRanked(i, [emptyRow('No paddocks — /build one first', 0)]); return; }
        const occupants = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, i.user.id)).all();
        await respondRanked(i, paddocks
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => {
            const occ = occupants.filter((d) => d.lotId === l.id).length;
            const cap = paddockCapacity(l.level);
            const valid = occ < cap;
            return { value: l.id, valid, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level}, ${occ}/${cap})${valid ? '' : ' — FULL'}` };
          }));
      },
    },
    {
      data: new SlashCommandBuilder().setName('decorate').setDescription('Add decor to a paddock')
        .addIntegerOption((o) => o.setName('lot').setDescription('Paddock — type to search').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('item').setDescription('Decoration').setRequired(true).addChoices(...Object.values(DECOR).map((d) => ({ name: d.name, value: d.kind })))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        try {
          decorateLot(ctx, i.user.id, i.options.getInteger('lot', true), i.options.getString('item', true));
          await i.reply({ content: '🌴 Decoration added.' });
        } catch (e) {
          if (e instanceof AssignError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
      async autocomplete(ctx, i) {
        const paddocks = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all()
          .filter((l) => l.type === 'paddock');
        if (!paddocks.length) { await respondRanked(i, [emptyRow('No paddocks — /build one first', 0)]); return; }
        const q = String(i.options.getFocused());
        await respondRanked(i, paddocks
          .filter((l) => matches(q, l.id, l.name))
          .map((l) => ({ value: l.id, valid: true, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level})` })));
      },
    },
  ],
  components: [
    {
      prefix: 'park',
      async execute(ctx, i) {
        if (i.customId === 'park:collect') {
          settleEscapes(ctx, i.user.id);
          const { amount } = collectIncome(ctx, i.user.id);
          await i.reply({ content: amount > 0 ? `${emojiTag('dw_cash')} Collected **${amount.toLocaleString()}** cash.` : 'Nothing to collect yet.', flags: MessageFlags.Ephemeral });
          return;
        }
        const [, action, uid, pageStr] = i.customId.split(':');
        if (action === 'dinos') {
          if (i.user.id !== uid) { await i.reply({ content: 'Not your list.', flags: MessageFlags.Ephemeral }); return; }
          settleEscapes(ctx, i.user.id);
          await i.update(dinoListPayload(ctx, i.user.id, Number(pageStr)));
        }
      },
    },
  ],
};
