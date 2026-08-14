import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { assetImage, attach } from '../../core/images.js';
import type { NotifyPayload } from '../../core/notify.js';
import type { EscapeAlert, IncomeCapAlert, SeasonEndAlert } from './alert-detect.js';

const MAX_LISTED = 5;

function fmtRemaining(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `~${mins}m`;
  return `~${Math.round(mins / 60)}h`;
}

/**
 * One combined alert for one player.
 *
 * MUST be built fresh per user inside the sweep's fan-out, never once outside it: this
 * object reaches deliverNotification, which hands the SAME object to channelSend and
 * then dmSend. For the same reason it carries no `attachments` key — MessagePayload
 * pushes into an explicit array in place and only shallow-copies it.
 */
export function alertPayload(
  userId: string, escapes: EscapeAlert[], income: IncomeCapAlert | null,
  season: SeasonEndAlert | null, now: number,
): (NotifyPayload & { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] }) | null {
  // An alert with no conditions is not an empty alert, it is no alert. Returning null here
  // means no caller can coerce this function into building `setDescription('')`, which
  // @discordjs/builders' embed validator rejects outright — the crash is removed by
  // construction rather than defended against at every call site.
  if (escapes.length === 0 && !income && !season) return null;

  const lines: string[] = [];

  if (escapes.length > 0) {
    const shown = escapes.slice(0, MAX_LISTED)
      .map((e) => `**${e.name}** escapes in ${fmtRemaining(e.escapeAt - now)}`)
      .join(' · ');
    const hidden = escapes.length - MAX_LISTED;
    lines.push(`**🦖 Unsettled dinos** — ${shown}${hidden > 0 ? ` · **+${hidden} more**` : ''}`);
  }
  if (income) {
    // Never quote a precise "stopped earning at" instant: capAt is an upper bound, and a
    // starving park stops earlier (accruedIncome clamps per dino at escapeAt/hungerZero).
    lines.push(`**💰 Income capped** — **${income.pending.toLocaleString('en-US')}** cash pending at your ${income.capHours}-hour cap, no longer growing`);
  }
  if (season) {
    const days = Math.max(1, Math.ceil((season.endsAt - now) / 86_400_000));
    lines.push(`**🎖️ Season ends in ${days}d** — ${season.unclaimed} reward(s) unclaimed. **/season** to claim.`);
  }

  const embed = new EmbedBuilder().setColor(0xe67e22)
    .setTitle('🚨 Your park needs you')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Turn these off any time with /park alerts state:off' });

  const payload: NotifyPayload & {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[];
  } = { embeds: [embed], components: [] };

  // Domain-data ternary, deliberately OUTSIDE attach(): a park with no escapes is not
  // a missing asset, it is a different banner.
  attach(embed, payload, 'image',
    assetImage('banners', escapes.length > 0 ? 'care_neglect' : 'collect'));

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (escapes.length > 0) {
    row.addComponents(new ButtonBuilder().setCustomId(`alert:feedall:${userId}`)
      .setLabel('🍖 Feed all').setStyle(ButtonStyle.Primary));
  }
  if (income) {
    row.addComponents(new ButtonBuilder().setCustomId(`alert:collect:${userId}`)
      .setLabel('💰 Collect').setStyle(ButtonStyle.Success));
  }
  row.addComponents(new ButtonBuilder().setCustomId(`alert:mute:${userId}`)
    .setLabel('🔕 Mute alerts').setStyle(ButtonStyle.Secondary));
  payload.components.push(row);

  return payload;
}
