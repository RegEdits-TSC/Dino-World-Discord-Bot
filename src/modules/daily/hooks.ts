import { MessageFlags } from 'discord.js';
import type { RouterHooks } from '../../core/router.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { rollDailyQuests, questProgress } from './service.js';

const EXEMPT_COMMANDS = new Set(['daily', 'achievements']);
// `alert` is exempt for the same reason daily/ach are: an alert is a DM, where an
// "ephemeral" followUp is just a second visible message — and a quest-complete hint
// immediately after clicking Mute is absurd.
const EXEMPT_PREFIXES = new Set(['daily', 'ach', 'alert']);

// Router-level hooks that wire the daily quest board into every command and button
// dispatch. Both preDispatch and postDispatch are called from routeInteraction inside
// their own try/logger.warn (src/core/router.ts) — a throw here must never surface as
// a command error, so this module never needs its own try/catch.
export const dailyRouterHooks: RouterHooks = {
  // Rolls BEFORE the command runs, so the day's first action counts toward its own
  // quest. rollDailyQuests no-ops when today's rows already exist or the user row
  // doesn't exist yet (brand-new player) — the latter case is covered below instead.
  preDispatch: (ctx, userId) => rollDailyQuests(ctx, userId),
  postDispatch: async (ctx, i, source) => {
    // Covers the brand-new player whose users row was just created mid-dispatch
    // (preDispatch no-op'd on the missing row). Their first action does not count
    // toward its own quest — the baseline snapshots after it — which is accepted.
    rollDailyQuests(ctx, i.user.id);
    // No hint about the screen the user is already looking at.
    if (source.command && EXEMPT_COMMANDS.has(source.command)) return;
    if (source.prefix && EXEMPT_PREFIXES.has(source.prefix)) return;
    // The errored path already sent its own message; followUp on an unreplied
    // interaction throws.
    if (!i.deferred && !i.replied) return;
    const crossed = questProgress(ctx, i.user.id)
      .filter((v) => v.complete && v.row.claimedAt === null && v.row.notifiedAt === null);
    if (!crossed.length) return;
    // One combined followUp for every quest that crossed this action, not one per
    // quest — a single action (e.g. a battle win) can complete two quests at once.
    await i.followUp({ content: '🎯 Quest complete — **/daily** to claim!', flags: MessageFlags.Ephemeral });
    // Stamped ONLY after the followUp above succeeds: an errored send must leave
    // the hint owed for the next command, never silently consumed.
    for (const v of crossed) {
      ctx.db.update(schema.dailyQuests).set({ notifiedAt: ctx.now() })
        .where(eq(schema.dailyQuests.id, v.row.id)).run();
    }
  },
};
