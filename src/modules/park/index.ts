import { SlashCommandBuilder, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser, buildLot, upgradeLot, upgradeCostFor, collectIncome, pendingIncome, capHours, LotLimitError, UnknownKindError, DuplicateFacilityError, toClockDinos } from './service.js';
import { feedAll } from '../care/service.js';
import { settleEscapes } from './escapes.js';
import { earnedTierCount } from '../daily/service.js';
import { assignDino, unassignDino, decorateLot, listDinos, paddockCapacity, AssignError, DietMismatchError, renameDino } from './dinos.js';
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
import { emojiTag, foodEmoji } from '../../core/emojis.js';
import { traitDefs } from '../../data/traits.js';
import { FOODS, type FoodId } from '../../data/foods.js';
import type { Ctx } from '../../core/context.js';
import { assetImage, attach } from '../../core/images.js';
import type { AttachmentBuilder } from 'discord.js';

const kindChoices = [...Object.keys(PADDOCKS), ...Object.keys(FACILITIES)]
  .map((k) => ({ name: k.replaceAll('_', ' '), value: k }));

// emojiTag is resolved per call, never at module scope — the app-emoji map only
// loads after client ready.
function collectPayload(amount: number) {
  const embed = new EmbedBuilder().setColor(0x3ba55c)
    .setTitle(`${emojiTag('dw_cash')} Park income`)
    .setDescription(amount > 0
      ? `Collected **${amount.toLocaleString()}** cash.`
      : 'Nothing to collect yet — give your dinos time to earn.');
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[]; flags: MessageFlags.Ephemeral } =
    { embeds: [embed], flags: MessageFlags.Ephemeral };
  attach(embed, payload, 'image', assetImage('banners', 'collect'));
  return payload;
}

function dinoListPayload(ctx: Ctx, userId: string, page: number) {
  const all = listDinos(ctx, userId);
  const { items, page: p, pages } = paginate(all, page);
  const nowMs = ctx.now();
  const lines = items.length
    ? items.map((d) => {
        // Comfort is clamped for display only: the raw value drives income and the
        // escape instant, but "is this animal all right" is a 0-100% question, and
        // docs/gameplay.md states in writing that it does not exceed 100%. The rung
        // gets its own mark so the player can see what the decor bought.
        const comfortPct = Math.round(Math.min(1, d.comfort) * 100);
        const rung = d.enrichment > 1 ? ` · enriched +${Math.round((d.enrichment - 1) * 100)}%` : '';
        const status = d.dino.escapedAt !== null
          ? `${emojiTag('dw_alert')} ESCAPED — /rescue`
          : `${comfortPct}% comfort${rung}`;
        const warn = d.dino.escapedAt === null && d.escapeAt !== null && d.escapeAt - nowMs <= ESCAPE_WARN_MS
          ? ` — ${emojiTag('dw_hunger')} escapes <t:${Math.floor(d.escapeAt / 1000)}:R>` : '';
        const loc = d.dino.lotId ? `lot ${d.dino.lotId}` : 'unassigned';
        const habitat = d.mismatch ? ' — ⚠️ wrong habitat' : '';
        const title = d.dino.nickname ? `${d.dino.nickname} (${d.species.name})` : d.species.name;
        // Compact one-line inline form — never traitLines(): the list is paginated at 10 rows
        // and traitLines()'s one-line-per-trait-plus-blurb block would risk the embed limits
        // that a single trait mark per row stays comfortably under.
        const marks = traitDefs(d.dino.traits).map((t) => `${emojiTag(t.emoji) || t.fallback} ${t.name}`).join(' · ');
        const marksLine = marks ? ` — ${marks}` : '';
        return `#${d.dino.id} ${title} — ${status}${warn}${habitat} — ${loc}${marksLine}`;
      }).join('\n')
    : 'No dinos yet. Hatch one!';
  const embed = new EmbedBuilder().setTitle('🦕 Your dinos').setDescription(lines).setColor(0x3ba55c)
    .setFooter({ text: `Page ${p}/${pages}` });
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof pageRow>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: pages > 1 ? [pageRow('park', 'dinos', userId, p, pages)] : [] };
  attach(embed, payload, 'image', assetImage('banners', 'dino_roster'));
  return payload;
}

export const parkModule: ModuleManifest = {
  name: 'park',
  commands: [
    {
      data: new SlashCommandBuilder().setName('park').setDescription('Your park')
        .addSubcommand((s) => s.setName('view').setDescription('Park dashboard')
          .addUserOption((o) => o.setName('user').setDescription('View another player\'s park').setRequired(false)))
        .addSubcommand((s) => s.setName('rename').setDescription('Rename your park')
          .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(60)))
        .addSubcommand((s) => s.setName('alerts').setDescription('Turn proactive park alerts on or off')
          .addStringOption((o) => o.setName('state').setDescription('On or off').setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }))),
      async execute(ctx, i) {
        const user = getOrCreateUser(ctx, i.user.id, i.user.displayName);
        if (i.options.getSubcommand() === 'rename') {
          const name = i.options.getString('name', true);
          ctx.db.update(schema.users).set({ parkName: name })
            .where(eq(schema.users.discordId, i.user.id)).run();
          await i.reply({ content: `Park renamed to **${name}**.` });
          return;
        }
        // Explicit branch, not an else-fallthrough: /park has no subcommand dispatch —
        // `rename` is the only named case and everything else IS the view path below.
        // A missing branch here renders the dashboard and reports success.
        if (i.options.getSubcommand() === 'alerts') {
          const on = i.options.getString('state', true) === 'on';
          ctx.db.update(schema.users).set({ alertsEnabled: on })
            .where(eq(schema.users.discordId, i.user.id)).run();
          await i.reply({
            content: on
              ? '🔔 Park alerts are **on** — you will get a DM before a dino escapes and when your park hits its income cap.'
              : '🔕 Park alerts are **off**. Egg, breeding, and expedition notifications are unaffected. Turn them back on with `/park alerts state:on`.',
            flags: MessageFlags.Ephemeral,
          });
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
          const tinv = ctx.economy.getFoodInventory(targetUser.id);
          const tfoodLine = (Object.entries(tinv) as Array<[FoodId, number]>)
            .map(([id, q]) => `${foodEmoji(id)}${FOODS[id].name} ×${q}`).join(' · ') || 'none — /shop food';
          const payload = dashboardPayload(fresh, tlots, tdinos.length, 0, tescaped, { foodLine: tfoodLine, earnedTiers: earnedTierCount(ctx, targetUser.id), now: ctx.now() });
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
        const mismatchCount = clockDinos.filter((c) =>
          c.paddock !== null && c.escapedAt === null && c.paddock.diet !== c.species.diet).length;
        const inv = ctx.economy.getFoodInventory(i.user.id);
        const foodLine = (Object.entries(inv) as Array<[FoodId, number]>)
          .map(([id, q]) => `${foodEmoji(id)}${FOODS[id].name} ×${q}`).join(' · ') || 'none — /shop food';
        const base = dashboardPayload(user, lots, dinos.length, pending, escapedCount, { atRiskCount, capped, mismatchCount, foodLine, earnedTiers: earnedTierCount(ctx, i.user.id), now: nowMs });
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
          if (e instanceof DuplicateFacilityError) await i.reply({ content: `You already have a ${e.message} — upgrade it instead.`, flags: MessageFlags.Ephemeral });
          else if (e instanceof LotLimitError) await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
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
        const lotId = i.options.getInteger('lot', true);
        // Hoisted so the InsufficientFundsError branch below can quote the price: upgradeLot
        // does the same lookup internally, so this is one cheap extra read, not a second
        // source of truth for the cost (upgradeCostFor stays the only place that computes it).
        const lotRow = ctx.db.select().from(schema.lots)
          .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, i.user.id))).get();
        try {
          const lot = upgradeLot(ctx, i.user.id, lotId);
          await i.reply({ content: `⬆️ **${lot.name}** is now level ${lot.level}.` });
        } catch (e) {
          if (e instanceof LotLimitError) await i.reply({ content: 'Already max level.', flags: MessageFlags.Ephemeral });
          else if (e instanceof UnknownKindError) await i.reply({ content: 'No such lot.', flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({
            content: `Not enough cash — that upgrade costs ${upgradeCostFor(lotRow!.kind, lotRow!.level).toLocaleString('en-US')}.`,
            flags: MessageFlags.Ephemeral,
          });
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
            const price = valid ? ` — ${upgradeCostFor(l.kind, l.level).toLocaleString('en-US')} cash` : '';
            return { value: l.id, valid, label: `🏗️ #${l.id} ${l.name} (lvl ${l.level})${valid ? price : ' — MAX LEVEL'}` };
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
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('rename').setDescription('Give a dino a nickname')
          .addIntegerOption((o) => o.setName('dino').setDescription('Dino — type to search').setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName('nickname').setDescription('New nickname — leave blank to clear it').setRequired(false).setMaxLength(32))),
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        settleEscapes(ctx, i.user.id);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'list') {
            await i.reply(dinoListPayload(ctx, i.user.id, 1));
          } else if (sub === 'assign') {
            const dinoId = i.options.getInteger('dino', true);
            const lotId = i.options.getInteger('lot', true);
            try {
              assignDino(ctx, i.user.id, dinoId, lotId);
              await i.reply({ content: '🦕 Assigned.' });
            } catch (e) {
              if (!(e instanceof DietMismatchError)) throw e;
              const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setCustomId(`park:assignyes:${i.user.id}:${dinoId}:${lotId}`)
                  .setLabel('Assign anyway').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`park:assignno:${i.user.id}`)
                  .setLabel('Cancel').setStyle(ButtonStyle.Secondary));
              await i.reply({ content: `⚠️ ${e.message}`, components: [row], flags: MessageFlags.Ephemeral });
            }
          } else if (sub === 'rename') {
            const nickname = i.options.getString('nickname');
            renameDino(ctx, i.user.id, i.options.getInteger('dino', true), nickname);
            const cleared = !nickname || !nickname.trim();
            await i.reply({ content: cleared ? '🦕 Nickname cleared.' : `🦕 Renamed to **${nickname!.trim()}**.` });
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
              // renameDino has no lot/escape restriction (ownership + length only), so an
              // escaped or unassigned dino is a fully valid rename target, unlike assign.
              valid: sub === 'unassign' ? d.lotId !== null : sub === 'rename' ? true : d.escapedAt === null,
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
        .addStringOption((o) => o.setName('item').setDescription('Decoration — type to search').setRequired(true).setAutocomplete(true)),
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
        const focused = i.options.getFocused(true);
        if (focused.name === 'item') {
          // Static data only — no DB read, no user row. Biomes and cost are in the
          // label because the purchase is permanent: there is no removal or refund
          // path short of adminReset, so the buying surface is the only place a
          // mistake can be prevented.
          await respondRanked(i, Object.values(DECOR)
            .filter((d) => matches(String(focused.value), d.name, d.kind, ...d.biomeTags))
            .map((d) => ({
              value: d.kind, valid: true,
              label: `${d.name} — ${d.biomeTags.join('/')} — ${d.cost} cash`,
            })));
          return;
        }
        const paddocks = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, i.user.id)).all()
          .filter((l) => l.type === 'paddock');
        if (!paddocks.length) { await respondRanked(i, [emptyRow('No paddocks — /build one first', 0)]); return; }
        const q = String(focused.value);
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
          await i.reply(collectPayload(amount));
          return;
        }
        const parts = i.customId.split(':');
        const [, action, uid, pageStr] = parts;
        if (action === 'assignyes' || action === 'assignno') {
          if (i.user.id !== uid) { await i.reply({ content: 'Not your assignment.', flags: MessageFlags.Ephemeral }); return; }
          if (action === 'assignno') { await i.update({ content: 'Assignment cancelled.', components: [] }); return; }
          settleEscapes(ctx, i.user.id);
          try {
            assignDino(ctx, i.user.id, Number(parts[3]), Number(parts[4]), { allowMismatch: true });
            await i.update({ content: '🦕 Assigned — wrong habitat, comfort halved.', components: [] });
          } catch (e) {
            if (e instanceof AssignError) await i.update({ content: e.message, components: [] });
            else throw e;
          }
          return;
        }
        if (action === 'dinos') {
          if (i.user.id !== uid) { await i.reply({ content: 'Not your list.', flags: MessageFlags.Ephemeral }); return; }
          settleEscapes(ctx, i.user.id);
          await i.update({ ...dinoListPayload(ctx, i.user.id, Number(pageStr)), attachments: [] });
        }
      },
    },
    {
      prefix: 'alert',
      async execute(ctx, i) {
        const [, action, uid] = i.customId.split(':');
        // deferUpdate BEFORE the owner check, copying daily/ach: a customId shape from an
        // older deploy must be absorbed rather than shown as "This interaction failed".
        if (action !== 'feedall' && action !== 'collect' && action !== 'mute') {
          await i.deferUpdate();
          return;
        }
        // Every alert button acts on the ALERTED user, so ownership is checked here — the
        // park:assignyes pattern, not the self-serve park:collect one.
        if (i.user.id !== uid) {
          await i.reply({ content: 'That is not your park.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === 'mute') {
          ctx.db.update(schema.users).set({ alertsEnabled: false })
            .where(eq(schema.users.discordId, i.user.id)).run();
          // attachments: [] sheds the alert's banner upload — this update carries no files.
          await i.update({
            content: '🔕 Park alerts muted. Turn them back on with `/park alerts state:on`.',
            embeds: [], components: [], attachments: [],
          });
          return;
        }
        if (action === 'collect') {
          settleEscapes(ctx, i.user.id);
          const { amount } = collectIncome(ctx, i.user.id);
          await i.update({
            content: amount > 0
              ? `💰 Collected **${amount.toLocaleString('en-US')}** cash.`
              : 'Nothing to collect yet — give your dinos time to earn.',
            embeds: [], components: [], attachments: [],
          });
          return;
        }
        // feedall
        settleEscapes(ctx, i.user.id);
        const { fed, skipped } = feedAll(ctx, i.user.id);
        const line = fed.length === 0
          ? (skipped.length > 0
              ? '🍖 No matching food — buy some with `/shop food`.'
              : '🍖 Nothing to feed — every dino is already full.')
          : `🍖 Fed **${fed.length}** ${fed.length === 1 ? 'dino' : 'dinos'}${skipped.length ? ` — ${skipped.length} skipped for lack of matching food.` : '.'}`;
        await i.update({ content: line, embeds: [], components: [], attachments: [] });
      },
    },
  ],
};
