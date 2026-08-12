import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type AttachmentBuilder } from 'discord.js';
import { assetImage, attach } from '../../core/images.js';
import type { DuelOutcome, DuelRecord, DuelSquadMember } from './service.js';

// The component prefix AND the first segment of every customId this module mints.
// Component routing is exact equality on that first segment, so both must come from
// this one constant or a button dead-ends with "This interaction failed".
export const DUEL_PREFIX = 'duel';

export interface DuelPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
}

const WIN = 0x2ecc71, LOSS = 0xe74c3c, DRAW = 0x95a5a6, CHALLENGE = 0x5865F2;

function squadLine(squad: DuelSquadMember[]): string {
  return squad.map((m) => `Lv.${m.level} ${m.name}`).join(', ');
}

function ratingLine(name: string, before: number, after: number): string {
  const delta = after - before;
  const sign = delta > 0 ? `+${delta}` : String(delta);
  return `${name}: **${after}** (${sign}, was ${before})`;
}

/**
 * One embed, no cinematic. fightFrames cannot be reused at any level: it is bound to
 * a stageId, calls STAGES.get and throws on a miss, and its F1/F4 attachments
 * contract exists only because four sequential edits race a Skip button.
 */
export function duelResultPayload(outcome: DuelOutcome): DuelPayload {
  const { names, result, squads, survivors, ratingBefore, ratingAfter } = outcome;
  const headline = result === 'win' ? `⚔️ ${names.challenger} defeats ${names.defender}`
    : result === 'loss' ? `⚔️ ${names.defender} holds off ${names.challenger}`
    : `⚔️ ${names.challenger} and ${names.defender} fight to a draw`;
  const embed = new EmbedBuilder()
    .setColor(result === 'win' ? WIN : result === 'loss' ? LOSS : DRAW)
    .setTitle(headline)
    .setDescription([
      `${outcome.mode === 'ghost' ? 'Ghost duel' : 'Live duel'} — ${outcome.rounds} rounds.`,
      ratingLine(names.challenger, ratingBefore.challenger, ratingAfter.challenger),
      ratingLine(names.defender, ratingBefore.defender, ratingAfter.defender),
    ].join('\n'))
    .addFields(
      { name: `${names.challenger} — ${survivors.challenger}/${squads.challenger.length} standing`, value: squadLine(squads.challenger) },
      { name: `${names.defender} — ${survivors.defender}/${squads.defender.length} standing`, value: squadLine(squads.defender) },
      { name: outcome.beats[0].title, value: outcome.beats[0].lines.join('\n') },
      { name: outcome.beats[1].title, value: outcome.beats[1].lines.join('\n') },
    );
  // EXACTLY ONE ref. Attachment names are basenames with no kind prefix, so a second
  // ref would collide whenever both leads share an archetype×diet — attach appends
  // without deduping and one slot would render the other's picture.
  const lead = result === 'loss' ? squads.defender[0] : squads.challenger[0];
  const payload: DuelPayload = { embeds: [embed], components: [] };
  attach(embed, payload, 'thumbnail', assetImage('dinos', `${lead.archetype}-${lead.diet}`));
  return payload;
}

/**
 * The public challenge card. Nothing about it is stored: the pair and the expiry
 * instant ride in the customId, so a stale button rejects itself rather than
 * resolving a duel the poster no longer expects — the landmark stale-button lesson.
 */
export function challengePayload(
  challengerId: string, defenderId: string,
  challengerName: string, defenderName: string, expiresAtMs: number,
): DuelPayload {
  const embed = new EmbedBuilder().setColor(CHALLENGE)
    .setTitle('⚔️ Duel challenge')
    .setDescription([
      `**${challengerName}** challenges **${defenderName}** to an exhibition duel.`,
      'Nothing is staked but the record — no energy, no cash, no XP.',
      `Expires <t:${Math.floor(expiresAtMs / 1000)}:R>.`,
    ].join('\n'));
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${DUEL_PREFIX}:accept:${challengerId}:${defenderId}:${expiresAtMs}`)
      .setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${DUEL_PREFIX}:decline:${challengerId}:${defenderId}:${expiresAtMs}`)
      .setLabel('Decline').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

/**
 * The derived record: rating plus a win/loss/draw count and the most recent
 * duels, each already flipped to this reader's own perspective by duelRecord.
 * A showcase surface — public, like /top — so a DuelError reject stays
 * ephemeral at the command layer instead of reaching this payload at all.
 */
export function recordPayload(name: string, record: DuelRecord): DuelPayload {
  const history = record.recent.length
    ? record.recent.map((r) => {
        const mark = r.result === 'win' ? '✅' : r.result === 'loss' ? '❌' : '➖';
        const sign = r.eloDelta > 0 ? `+${r.eloDelta}` : String(r.eloDelta);
        return `${mark} vs ${r.opponentName} — ${sign} (${r.mode})`;
      }).join('\n')
    : 'No duels yet.';
  const embed = new EmbedBuilder().setColor(CHALLENGE)
    .setTitle(`⚔️ ${name} — duel record`)
    // Elo is a plain integer. Never divide it: only parkRating is stored ×100.
    .setDescription(`**${record.rating}** rating\n${record.wins}W / ${record.losses}L / ${record.draws}D`)
    .addFields({ name: 'Recent duels', value: history });
  return { embeds: [embed], components: [] };
}
