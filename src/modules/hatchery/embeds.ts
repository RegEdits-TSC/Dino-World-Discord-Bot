import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, type AttachmentBuilder } from 'discord.js';
import type { Species } from '../../data/types.js';
import { RARITY } from '../../data/rarity.js';
import { assetImage, dinoImage, attach } from '../../core/images.js';
import { rarityEmoji } from '../../core/emojis.js';
import { paginate, pageRow } from '../../core/paginate.js';
import type { Egg } from './service.js';
import type { Locks } from '../../core/locks.js';

export const RARITY_COLOR: Record<string, number> = {
  common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xf1c40f, mythic: 0xe74c3c,
};

export function crackButton(eggId: number) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hatch:crack:${eggId}`).setLabel('🔨 Crack it open!').setStyle(ButtonStyle.Success),
  );
}

// The ONE Incubate button. Four surfaces mint it — /expedition claim and the exp:claim
// update, /shop egg, /breed claim and the breed:claim update, and mythic:confirm — so the id
// grammar and the label live here rather than being retyped at each one. Enumerate the call
// sites with `grep -rn "incubateRow(" src/`.
//
// Handled by the `hatch` component in src/modules/hatchery/index.ts. A minter needs no import
// into that module, because routeInteraction resolves a handler from the customId PREFIX
// alone — that is a reason not to import the HANDLER, never a reason to copy this BUILDER.
//
// The owner uid rides in the id because most of those replies are PUBLIC; see the handler's
// own owner check. Unicode 🥚 in the label, never emojiTag/setEmoji: the app-emoji map
// returns '' when unloaded and setEmoji throws on that rather than degrading.
export function incubateRow(userId: string, eggId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`hatch:inc:${userId}:${eggId}`)
      .setLabel(`🥚 Incubate #${eggId}`).setStyle(ButtonStyle.Primary));
}
export function preHatchEmbed(rarity: string) {
  return new EmbedBuilder().setColor(RARITY_COLOR[rarity] ?? 0x95a5a6)
    .setTitle(`🥚 A ${rarityEmoji(rarity)}${rarity} egg trembles…`).setDescription('Something stirs inside. Crack it open!');
}
export function preHatchPayload(rarity: string, eggId: number) {
  const embed = preHatchEmbed(rarity);
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof crackButton>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: [crackButton(eggId)] };
  attach(embed, payload, 'image', assetImage('eggs', rarity, String(eggId)));
  return payload;
}
// eggId seeds the crack art, so the shell that bursts is a face of the egg the
// player was looking at a second earlier. It is NOT the hatched dino's id: the
// egg is what cracks, and hatchEgg does not return the egg id anyway.
export function revealPayload(species: Species, eggId: number) {
  const stats = RARITY[species.rarity];
  const embed = new EmbedBuilder().setColor(RARITY_COLOR[species.rarity] ?? 0x95a5a6)
    .setTitle(`✨ ${rarityEmoji(species.rarity)}${species.rarity.toUpperCase()} — ${species.name}!`)
    .setDescription(species.flavor)
    .addFields(
      { name: 'Diet', value: species.diet, inline: true },
      { name: 'Biome', value: species.biomeTags.join(', '), inline: true },
      { name: 'Income/hr', value: String(stats.incomePerHr), inline: true },
    );
  // No footer here, deliberately. What the reveal should say next depends on which of the
  // three assign shapes was minted onto the same card, and this builder is pure — it never
  // sees ctx, the dino, or the player's paddocks. The hatch:crack handler sets it.
  // attachments is always empty: discord.js's InteractionUpdateOptions#attachments takes
  // existing-attachment descriptors to keep (Attachment | MessageEditAttachmentData), not
  // AttachmentBuilder — an empty tuple both satisfies that type and, passed to i.update(),
  // drops the pre-hatch egg upload so only the crack (via `files`) survives on the message.
  const payload: {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[];
    files: AttachmentBuilder[]; attachments: never[];
  } = { embeds: [embed], components: [], files: [], attachments: [] };
  attach(embed, payload, 'image', assetImage('hatch', `${species.rarity}-crack`, String(eggId)));
  // Two files on one payload, each degrading independently: the crack is the
  // "your egg burst open" beat, the species (or archetype) thumb is what came out of it.
  // attach appends, so neither call can clobber the other's file.
  attach(embed, payload, 'thumbnail', dinoImage(species.id, species.archetype, species.diet));
  return payload;
}

// The egg the player most likely acts on next: ready-to-hatch, else incubating, else newest.
function featuredEgg(eggs: Egg[], now: number): Egg | undefined {
  return eggs.find((e) => e.hatchesAt !== null && e.hatchesAt <= now)
    ?? eggs.find((e) => e.hatchesAt !== null && e.hatchesAt > now)
    ?? [...eggs].sort((a, b) => b.obtainedAt - a.obtainedAt)[0];
}

// `locks` is the caller's already-built egg lock map (locksFor, src/core/locks.ts): escrow is
// derived per user and this formatter has no ctx, so membership comes in rather than being
// re-queried per row. Defaults to empty — an unlocked render is always a valid one.
export function eggListPayload(eggs: Egg[], now: number, userId: string, page = 1, locks: Locks['eggs'] = new Map()) {
  const { items, page: p, pages } = paginate(eggs, page);
  const lines = items.length ? items.map((e) => {
    // Lock first: it outranks every timer state, because a locked egg cannot be acted on.
    const status = locks.has(e.id) ? '🔒 locked in a trade'
      : e.hatchesAt === null ? 'in inventory'
      : e.hatchesAt <= now ? 'READY — /hatch' : `hatching (ready <t:${Math.floor(e.hatchesAt / 1000)}:R>)`;
    return `#${e.id} — ${rarityEmoji(e.rarity)}${e.rarity} egg — ${status}`;
  }).join('\n') : 'No eggs. Run /expedition or /shop.';
  const embed = new EmbedBuilder().setTitle('🥚 Eggs').setDescription(lines).setColor(0x3ba55c)
    .setFooter({ text: `Page ${p}/${pages}` });
  const payload: { embeds: EmbedBuilder[]; components: ReturnType<typeof pageRow>[]; files?: AttachmentBuilder[] } =
    { embeds: [embed], components: pages > 1 ? [pageRow('hatch', 'eggs', userId, p, pages)] : [] };
  // Featured thumbnail is computed from ALL eggs, not just the current page, so the
  // "act on next" egg keeps showing even when it lives on a different page.
  const featured = featuredEgg(eggs, now);
  attach(embed, payload, 'thumbnail', featured ? assetImage('eggs', featured.rarity, String(featured.id)) : null);
  // Banner attaches on every branch, including the no-eggs one — mirrors the
  // two-file thumbnail+image pattern in src/modules/shop/index.ts. Its seed is the
  // VIEWER (this list has no single egg to key on, and it renders with none at all on
  // the empty branch), while the thumbnail above keys on the featured egg's own row id.
  // Two different seeds, two different things keyed, and the names stay distinct.
  attach(embed, payload, 'image', assetImage('banners', 'eggs_incubator', userId));
  return payload;
}
