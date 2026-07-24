import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import type { AttachmentBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { getOrCreateUser } from '../park/service.js';
import { startExpedition, claimExpedition, activeExpedition, ExpeditionError } from './service.js';
import { EXPEDITION_SITES } from '../../data/sites.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { schema } from '../../core/db/index.js';
import { siteUnlocked } from '../park/rating.js';
import { FOODS } from '../../data/foods.js';
import { matches, respondRanked, fmtDuration } from '../../core/autocomplete.js';
import { assetImage } from '../../core/images.js';
import { emojiTag, rarityEmoji } from '../../core/emojis.js';

// '🌋 ' when the site marker resolves, '' when it doesn't — keeps titles clean either way.
function siteMarker(siteId: string): string {
  const t = emojiTag(`dw_site_${siteId}`);
  return t ? `${t} ` : '';
}

function sitePayload(siteId: string, description: string) {
  const embed = new EmbedBuilder().setColor(0xe8590c)
    .setTitle(`🧭 ${siteMarker(siteId)}${EXPEDITION_SITES[siteId].name}`).setDescription(description);
  const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
  const img = assetImage('sites', `${siteId}-thumb`);
  if (img) { embed.setThumbnail(img.url); payload.files = [img.file]; }
  return payload;
}

export const expeditionsModule: ModuleManifest = {
  name: 'expeditions',
  commands: [
    { data: new SlashCommandBuilder().setName('expedition').setDescription('Send a dig crew out')
        .addSubcommand((s) => s.setName('start').setDescription('Start an expedition')
          .addStringOption((o) => o.setName('site').setDescription('Dig site — locked ones show their star requirement').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('status').setDescription('Check your active expedition'))
        .addSubcommand((s) => s.setName('claim').setDescription('Claim a returned expedition')),
      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'start') { await i.respond([]); return; }
        const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, i.user.id)).get();
        const hw = user?.ratingHighWater ?? 0;
        const q = String(i.options.getFocused());
        await respondRanked(i, Object.values(EXPEDITION_SITES)
          .filter((s) => matches(q, s.id, s.name))
          .map((s) => {
            const unlocked = siteUnlocked(s.unlockRating, hw);
            return {
              value: s.id, valid: unlocked,
              label: unlocked
                // 'en-US' pinned: labels are asserted verbatim in tests.
                ? `🧭 ${s.name} — ${s.cost.toLocaleString('en-US')} cash, ${fmtDuration(s.durationMs)}`
                : `🧭 ${s.name} — LOCKED, needs ★${(s.unlockRating / 100).toFixed(1)}`,
            };
          }));
      },
      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'start') {
            const exp = startExpedition(ctx, i.user.id, i.options.getString('site', true), i.guildId);
            await i.reply(sitePayload(exp.siteId, `Crew dispatched — back <t:${Math.floor(exp.returnsAt / 1000)}:R>.`));
          } else if (sub === 'status') {
            const exp = activeExpedition(ctx, i.user.id);
            if (!exp) { await i.reply({ content: 'No active expedition. Start one with /expedition start.', flags: MessageFlags.Ephemeral }); return; }
            await i.reply(sitePayload(exp.siteId, exp.returnsAt <= ctx.now()
              ? '✅ Back! Use /expedition claim.'
              : `⏳ Digging — back <t:${Math.floor(exp.returnsAt / 1000)}:R>.`));
          } else {
            const { loot, site } = claimExpedition(ctx, i.user.id);
            const embed = new EmbedBuilder().setColor(0xe8590c).setTitle(`🧭 ${siteMarker(site.id)}${site.name} — returned!`)
              .setDescription(`Found a **${rarityEmoji(loot.eggRarity)}${loot.eggRarity}** egg!`)
              .addFields(
                { name: `${emojiTag('dw_cash')} Cash`, value: `+${loot.cash}`, inline: true },
                { name: `${emojiTag(FOODS[loot.food.foodId].emoji)} ${FOODS[loot.food.foodId].name}`, value: `+${loot.food.qty}`, inline: true });
            const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
            const banner = assetImage('sites', `${site.id}-banner`);
            if (banner) { embed.setImage(banner.url); payload.files = [banner.file]; }
            await i.reply(payload);
          }
        } catch (e) {
          if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for that expedition.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      } },
  ],
  components: [],
};
