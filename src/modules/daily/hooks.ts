import { MessageFlags } from 'discord.js';
import type { RouterHooks } from '../../core/router.js';
import { eq } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { rollDailyQuests, questProgress } from './service.js';
import { rollSeason, stampSeasonBadge, seasonView, stampSeasonHint } from './season.js';

const EXEMPT_COMMANDS = new Set(['daily', 'achievements', 'season']);
// `alert` is exempt for the same reason daily/ach/season are: an alert is a DM, where an
// "ephemeral" followUp is just a second visible message — and a quest-complete hint
// immediately after clicking Mute is absurd.
const EXEMPT_PREFIXES = new Set(['daily', 'ach', 'alert', 'season']);

// Router-level hooks that wire the daily quest board into every command and button
// dispatch. Both preDispatch and postDispatch are called from routeInteraction inside
// their own try/logger.warn (src/core/router.ts) — a throw here must never surface as
// a command error, so this module never needs its own try/catch.
export const dailyRouterHooks: RouterHooks = {
  // Rolls BEFORE the command runs, so the day's first action counts toward its own
  // quest. rollDailyQuests no-ops when today's rows already exist or the user row
  // doesn't exist yet (brand-new player) — the latter case is covered below instead.
  preDispatch: (ctx, userId) => { rollDailyQuests(ctx, userId); rollSeason(ctx, userId); },
  postDispatch: async (ctx, i, source) => {
    // Covers the brand-new player whose users row was just created mid-dispatch
    // (preDispatch no-op'd on the missing row). Their first action does not count
    // toward its own quest — the baseline snapshots after it — which is accepted.
    rollDailyQuests(ctx, i.user.id);
    rollSeason(ctx, i.user.id);
    // The badge stamp runs BEFORE the exemption returns below. Those exemptions suppress
    // the daily-quest hint TEXT only, for a screen (/daily, /achievements, alert DMs) the
    // player is already looking at — they say nothing about the season track. A player who
    // crosses the capstone while dispatching one of those exempt commands must still have
    // it recorded; moving this call after the returns would silently drop that stamp, caught
    // only by tests/daily-hooks.test.ts's "still stamps the season badge ... hint-exempt" case.
    stampSeasonBadge(ctx, i.user.id);
    // No hint about the screen the user is already looking at.
    if (source.command && EXEMPT_COMMANDS.has(source.command)) return;
    if (source.prefix && EXEMPT_PREFIXES.has(source.prefix)) return;
    // The errored path already sent its own message; followUp on an unreplied
    // interaction throws.
    if (!i.deferred && !i.replied) return;
    const crossed = questProgress(ctx, i.user.id)
      .filter((v) => v.complete && v.row.claimedAt === null && v.row.notifiedAt === null);
    // The season rung hint is one-shot via a stored high-water mark (seasonProgress.
    // hintedRung), the same stamp-after-send discipline as the quest side's notifiedAt —
    // NOT a bare "unlocked && !claimed" existence check. A rung can sit unlocked-and-
    // unclaimed for up to 30 days, and an existence check would re-fire that hint on
    // nearly every dispatch for the whole window; hintedRung remembers the highest rung
    // idx already announced, so only a NEWLY unlocked rung (topReady climbing past it)
    // is worth mentioning again. Claiming a rung never lowers hintedRung — claimSeason
    // doesn't touch this column — so a claim silently retires the hint for that rung
    // without re-arming it; only a further rung unlocking climbs topReady again. A new
    // season's row starts fresh at -1 (the schema default), so the hint re-arms itself
    // once a season rolls over.
    const view = seasonView(ctx, i.user.id);
    const topReady = view
      ? view.rungs.reduce((top, r) => (r.unlocked && !r.claimed && r.idx > top ? r.idx : top), -1)
      : -1;
    const rungReady = view !== null && topReady > view.hintedRung;
    if (!crossed.length && !rungReady) return;
    // One combined followUp for everything that crossed this action — a single action
    // (e.g. a battle win) can complete two quests, or a quest AND a season rung, at once.
    const lines: string[] = [];
    if (crossed.length) lines.push('🎯 Quest complete — **/daily** to claim!');
    if (rungReady) lines.push('🎖️ Season reward ready — **/season** to claim!');
    await i.followUp({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
    // Stamped ONLY after the followUp above succeeds: an errored send must leave
    // the hint owed for the next command, never silently consumed. Same discipline as
    // the quest notifiedAt loop right below.
    if (rungReady) stampSeasonHint(ctx, i.user.id, view!.index, topReady);
    for (const v of crossed) {
      ctx.db.update(schema.dailyQuests).set({ notifiedAt: ctx.now() })
        .where(eq(schema.dailyQuests.id, v.row.id)).run();
    }
  },
};
