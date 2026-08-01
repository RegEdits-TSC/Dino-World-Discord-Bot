import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ModuleManifest } from '../../core/modules.js';
import { schema } from '../../core/db/index.js';
import { getOrCreateUser } from '../park/service.js';
import { getSpecies } from '../../data/species/index.js';
import { locksFor } from '../../core/locks.js';
import { InsufficientFundsError } from '../../core/economy.js';
import { matches, respondRanked } from '../../core/autocomplete.js';
import { settleEscapes } from '../park/escapes.js';
import { traitDefs } from '../../data/traits.js';
import { BREED_FEE, BREED_UPGRADE_CHANCE, breedableRarity } from '../../data/breeding.js';
import {
  startBreeding, claimBreeding, activeBreedings, breedCooldowns, BreedError,
} from './service.js';
import { confirmPayload, statusPayload, claimPayload } from './embeds.js';

// Autocomplete labels use TraitDef.fallback, never emojiTag — Discord renders a
// custom tag as literal text in a suggestion list.
function parentLabel(id: number, speciesName: string, traits: string[], state: string): string {
  const marks = traitDefs(traits).map((t) => t.fallback).join('');
  return `🦖 #${id} ${speciesName}${marks ? ` ${marks}` : ''}${state}`;
}

export const geneLabModule: ModuleManifest = {
  name: 'genelab',
  commands: [
    {
      data: new SlashCommandBuilder().setName('breed').setDescription('Pair two dinos in the Gene Lab')
        .addSubcommand((s) => s.setName('start').setDescription('Pair two dinos')
          .addIntegerOption((o) => o.setName('parent-a').setDescription('First parent').setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName('parent-b').setDescription('Second parent').setRequired(true).setAutocomplete(true)))
        .addSubcommand((s) => s.setName('status').setDescription('Check your Gene Lab'))
        .addSubcommand((s) => s.setName('claim').setDescription('Claim a finished pairing')),

      async autocomplete(ctx, i) {
        if (i.options.getSubcommand() !== 'start') { await i.respond([]); return; }
        const userId = i.user.id;
        // Read-only: no getOrCreateUser. settleEscapes is the one permitted write,
        // and it crashes for an unknown user — so guard on the row existing first.
        const user = ctx.db.select().from(schema.users).where(eq(schema.users.discordId, userId)).get();
        if (!user) { await i.respond([]); return; }
        settleEscapes(ctx, userId);

        const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, userId)).all();
        const locks = locksFor(ctx, userId);
        const cooldowns = breedCooldowns(ctx, userId);
        const now = ctx.now();
        const focusedName = i.options.getFocused(true).name;
        const otherRaw = i.options.get(focusedName === 'parent-a' ? 'parent-b' : 'parent-a');
        const otherId = otherRaw ? Number(otherRaw.value) : 0;
        const other = dinos.find((d) => d.id === otherId);
        const otherSpecies = other ? getSpecies(other.speciesId) : null;
        const q = String(i.options.getFocused());

        // Absolute disqualifiers — states that make a dino unbreedable no matter
        // what the OTHER parent turns out to be — are excluded outright, not
        // merely marked invalid: mirrors tradeableDinos (src/modules/trading/
        // index.ts), which hard-filters locked, escaped AND mythic in one
        // .filter(), and battle fight's separate `taken` + escaped filters.
        // Rarity/diet mismatch against the other parent stays visible-but-invalid
        // below — that state is relative to what's already picked, not an
        // absolute property of the dino, so showing it tells the player why
        // THIS pick is greyed out.
        await respondRanked(i, dinos
          .map((d) => ({ d, s: getSpecies(d.speciesId) }))
          .filter(({ d, s }) => !locks.dinos.has(d.id) && (cooldowns.get(d.id) ?? 0) <= now
            && d.escapedAt === null && breedableRarity(s.rarity))
          .filter(({ d, s }) => matches(q, d.id, s.name, d.nickname))
          .map(({ d, s }) => {
            let state = '';
            let valid = true;
            if (d.id === otherId) { state = ' — already picked'; valid = false; }
            else if (d.lotId === null) { state = ' — needs a paddock'; valid = false; }
            else if (otherSpecies && (otherSpecies.rarity !== s.rarity || otherSpecies.diet !== s.diet)) {
              state = ' — does not match the other parent'; valid = false;
            }
            return { value: d.id, valid, label: parentLabel(d.id, s.name, d.traits, state) };
          }));
      },

      async execute(ctx, i) {
        getOrCreateUser(ctx, i.user.id, i.user.displayName);
        const sub = i.options.getSubcommand();
        try {
          if (sub === 'start') {
            const aId = i.options.getInteger('parent-a', true);
            const bId = i.options.getInteger('parent-b', true);
            const a = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, aId)).get();
            const b = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.id, bId)).get();
            if (!a || !b || a.userId !== i.user.id || b.userId !== i.user.id) {
              await i.reply({ content: 'You do not own both of those dinos.', flags: MessageFlags.Ephemeral });
              return;
            }
            // Dry-run every rule up front so the confirm button cannot fail on a
            // condition the preview already knew about. The displayed duration is
            // read straight off the dry run's own readyAt — never recomputed here
            // — so a future breedTime factor (a facility bonus, say) can't make
            // this embed silently diverge from what the real start will schedule.
            const now = ctx.now();
            const preview = startBreeding(ctx, i.user.id, aId, bId, i.guildId, { dryRun: true });
            const sa = getSpecies(a.speciesId), sb = getSpecies(b.speciesId);
            await i.reply(confirmPayload({
              aId, bId, aName: sa.name, bName: sb.name,
              aTraits: a.traits, bTraits: b.traits,
              rarity: sa.rarity, fee: BREED_FEE[sa.rarity],
              durationMs: preview.readyAt - now,
              upgradeChance: sa.rarity === 'legendary' ? 0 : BREED_UPGRADE_CHANCE,
            }));
          } else if (sub === 'status') {
            const rows = activeBreedings(ctx, i.user.id).map((b) => ({ ...b, ready: b.readyAt <= ctx.now() }));
            await i.reply(statusPayload(rows));
          } else {
            // One pairing per invocation, oldest first: claimPayload reveals a single
            // egg's traits, and that reveal is the point. A level-3 lab can have three
            // ready at once, so the reply says how many are still waiting.
            const readyRows = activeBreedings(ctx, i.user.id)
              .filter((b) => b.readyAt <= ctx.now())
              .sort((x, y) => x.readyAt - y.readyAt);
            if (!readyRows.length) {
              await i.reply({ content: 'Nothing to claim — no breeding has finished.', flags: MessageFlags.Ephemeral });
              return;
            }
            const { egg, upgraded } = claimBreeding(ctx, i.user.id, readyRows[0].id);
            await i.reply(claimPayload({
              rarity: egg.rarity, traits: egg.traits, upgraded,
              speciesName: egg.speciesId ? getSpecies(egg.speciesId).name : null,
              remaining: readyRows.length - 1,
            }));
          }
        } catch (e) {
          if (e instanceof BreedError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for that pairing.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
    },
  ],
  components: [
    {
      prefix: 'breed',
      async execute(ctx, i) {
        const [, action, aRaw, bRaw] = i.customId.split(':');
        if (action !== 'confirm') return;
        // The custom id is client-supplied: never trusted for ownership (startBreeding
        // re-validates that below), and not even trusted to parse — a malformed id
        // must not reach the DB lookup as NaN.
        const aId = Number(aRaw), bId = Number(bRaw);
        if (!Number.isFinite(aId) || !Number.isFinite(bId)) {
          await i.reply({ content: 'That pairing link is invalid — run /breed start again.', flags: MessageFlags.Ephemeral });
          return;
        }
        try {
          startBreeding(ctx, i.user.id, aId, bId, i.guildId);
          await i.update({ content: '🧬 Pairing started — check `/breed status`.', embeds: [], components: [] });
        } catch (e) {
          if (e instanceof BreedError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else if (e instanceof InsufficientFundsError) await i.reply({ content: 'Not enough cash for that pairing.', flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
    },
  ],
};
