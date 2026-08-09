import 'dotenv/config';
import { REST, Routes, MessageFlags } from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/core/config.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { setEmojiMap } from '../src/core/emojis.js';
import { FOODS } from '../src/data/foods.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { RARITY } from '../src/data/rarity.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino, decorateLot } from '../src/modules/park/dinos.js';
import { alertSweepHandler, ALERT_TIMER } from '../src/modules/park/alert-sweep.js';
import { incubateEgg } from '../src/modules/hatchery/service.js';
import { startExpedition } from '../src/modules/expeditions/service.js';
import { createTrade } from '../src/modules/trading/service.js';
import { locksFor } from '../src/core/locks.js';
import { TRADE_MIN_RATING } from '../src/data/trade.js';
import { ENERGY_CAP } from '../src/data/battle/constants.js';
import { rollDailyQuests } from '../src/modules/daily/service.js';
import { track } from '../src/core/stats.js';
import { dayKeyUTC } from '../src/core/clock.js';
import { QUESTS } from '../src/data/quests.js';
import { recordSpeciesSeen } from '../src/core/species-seen.js';
import { dexListPayload, dexViewPayload } from '../src/modules/dex/embeds.js';
import { makeCtx, fakeCommand, fakeButton } from '../tests/harness.js';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { Ctx } from '../src/core/context.js';
import type { Sender } from '../src/core/notify.js';

const DAY_MS = 86_400_000;

// ---- env -------------------------------------------------------------------
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DATABASE_PATH', 'OWNER_ID', 'DEV_GUILD_ID', 'TEST_CHANNEL_ID']) {
  if (!process.env[name]) { console.error(`test:live needs ${name} set in .env`); process.exit(1); }
}
const config = loadConfig();
const devGuildId = process.env.DEV_GUILD_ID!;
const testChannelId = process.env.TEST_CHANNEL_ID!;
const rest = new REST().setToken(config.token);

const failures: Array<{ step: string; error: string }> = [];
const passed: string[] = [];

// ---- 1. Discord validates every builder -------------------------------------
const registry = new ModuleRegistry(ALL_MODULES, Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])));
try {
  const body = registry.commands().map((c) => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.clientId, devGuildId), { body });
  passed.push(`deploy: ${body.length} builders accepted by Discord`);
} catch (e) {
  failures.push({ step: 'deploy builders', error: String(e) });
}

// ---- 2. Load the REAL emoji map so posted payloads use live tags -------------
try {
  const res = await rest.get(Routes.applicationEmojis(config.clientId)) as { items: Array<{ id: string; name: string; animated?: boolean }> };
  const entries: Record<string, string> = {};
  for (const e of res.items) entries[e.name] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
  setEmojiMap(entries);
  passed.push(`emoji map: ${res.items.length} live emojis loaded`);

  // Parity: every deployed-manifest name and FOODS emoji must exist remotely.
  const manifest = JSON.parse(readFileSync('assets/emojis/manifest.json', 'utf8')) as Record<string, string>;
  const remoteNames = new Set(res.items.map((i) => i.name));
  for (const name of Object.keys(manifest)) {
    if (!remoteNames.has(name)) failures.push({ step: 'emoji parity', error: `manifest emoji '${name}' missing on Discord` });
  }
  for (const f of Object.values(FOODS)) {
    if (!remoteNames.has(f.emoji)) failures.push({ step: 'emoji parity', error: `FOODS emoji '${f.emoji}' missing on Discord` });
  }
} catch (e) {
  failures.push({ step: 'emoji fetch', error: String(e) });
}

// ---- 3. Seed a representative sim world --------------------------------------
const ctx = makeCtx();
ctx.setNow(Date.now());   // real wall time so <t:...> timestamps render sensibly in the gallery
const P1 = 'live-p1', P2 = 'live-p2';
getOrCreateUser(ctx, P1, 'LiveTester');
getOrCreateUser(ctx, P2, 'Counterparty');
ctx.db.update(schema.users).set({ cash: 500_000, parkRating: TRADE_MIN_RATING, ratingHighWater: 1000, shards: 600 }).run();
const herb = Object.keys(PADDOCKS).find((k) => PADDOCKS[k].diet === 'herbivore')!;
const lot = buildLot(ctx, P1, herb);
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'triceratops', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
const dino = ctx.db.select().from(schema.dinos).all()[0];
assignDino(ctx, P1, dino.id, lot.id);
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'velociraptor', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
const readyEgg = ctx.db.insert(schema.eggs).values({ userId: P1, rarity: 'rare', source: 'shop', obtainedAt: ctx.now() }).returning().get();
incubateEgg(ctx, P1, readyEgg.id, devGuildId);
ctx.db.update(schema.eggs).set({ hatchesAt: ctx.now() - 1 }).run();   // force-ready for /hatch
// Inserted AFTER the force-ready update above so this one stays un-incubated for
// the /incubate case, which runs after hatch:crack frees the single incubator slot.
const spareEgg = ctx.db.insert(schema.eggs).values({ userId: P1, rarity: 'epic', source: 'shop', obtainedAt: ctx.now() }).returning().get();
const spareDino = ctx.db.select().from(schema.dinos).all()[1];
// Gene Lab seed: build the facility, and a second Common/herbivore dino sharing
// `dino` (triceratops)'s paddock to pair with it — same rarity, same diet, both
// assigned, capacity 2 at level 1 so the pair fits without a second paddock. The
// pairing itself is only STARTED later, inside the /breed status case (section 4)
// — not here — so `dino` stays unlocked for every earlier case that touches it.
buildLot(ctx, P1, 'gene_lab');
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'dryosaurus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(), traits: ['hardy'] }).run();
const mate = ctx.db.select().from(schema.dinos).all().find((d) => d.speciesId === 'dryosaurus')!;
assignDino(ctx, P1, mate.id, lot.id);
// A separate, never-locked dino for /splice, seeded with a real trait so its
// preview shows something to re-roll instead of "_No traits_".
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'allosaurus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(), traits: ['savage'] }).run();
const spliceTarget = ctx.db.select().from(schema.dinos).all().find((d) => d.speciesId === 'allosaurus')!;
// buildLot/assignDino above ran recomputeRating, which unconditionally overwrote parkRating below TRADE_MIN_RATING — restore it so createTrade's rating gate passes.
ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
createTrade(ctx, P1, P2, { dinoIds: [spareDino.id], eggIds: [], cash: 0, foods: {} }, { dinoIds: [], eggIds: [], cash: 1000, foods: {} });
startExpedition(ctx, P1, 'coastal_dig', devGuildId);

// Battles seed: max-level squad + chapter 1 cleared to (not including) the boss,
// so one sweep shows the chapters overview, a normal 4-frame win, and a boss
// FIRST clear whose F4 carries the egg line. ratingHighWater 1000 (set above,
// above the top gate of 950) clears every site co-gate, including the two newest
// sites at 880 and 950 — MYTHIC_UNLOCK_RATING (800) alone would leave those two
// locked. ctx.sleep is makeCtx's instant stub, so the four
// editReply frames land immediately — the gallery posts them as four messages.
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'tyrannosaurus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'spinosaurus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
ctx.db.update(schema.dinos).set({ battleXp: 10_000 }).where(eq(schema.dinos.userId, P1)).run();
const p1Locks = locksFor(ctx, P1).dinos;   // spareDino is escrowed by the trade seeded above
const squad = ctx.db.select().from(schema.dinos).all().filter((d) => d.userId === P1 && !p1Locks.has(d.id));
const [b1, b2, b3] = [squad[0], squad[squad.length - 2], squad[squad.length - 1]];
// amber_ridge_1..4 are seeded so the amber boss case has a stage gate to pass;
// its CHAPTER gate (coastal_dig_boss first-cleared) is left to the coastal boss
// case that runs earlier in `cases` — that keeps /battle chapters posting the
// chapter-1 page with later chapters locked, which is what the overview should
// show in the gallery. coastal_dig_boss is deliberately NOT seeded: the case
// above it is a FIRST clear and needs the egg line on F4.
//
// frozen_cliffs, volcano_core, abyssal_trench and containment_site are seeded
// ALL FIVE stages each (including their own boss) — they exist purely as a
// chapter-gate bridge up to the two newest chapters, whose boss cases further
// down are what actually exercises the new portraits. The two new bosses are
// tuned to genuinely threaten a squad (tests/battle-balance.test.ts's win-rate
// bands), unlike the early bosses this mixed squad steamrolls — a first-clear
// dependency chained through a real, possibly-lost fight would make the
// Containment Site case's chapter gate flip on RNG. Pre-seeding both bosses'
// firstClearedAt sidesteps that: each new boss case below is a repeat clear
// (portrait still shows either way — F1's thumbnail doesn't depend on
// win/first-clear) instead of a chained dependency on the other's outcome.
for (const stageId of ['coastal_dig_1', 'coastal_dig_2', 'coastal_dig_3', 'coastal_dig_4',
  'amber_ridge_1', 'amber_ridge_2', 'amber_ridge_3', 'amber_ridge_4',
  'frozen_cliffs_1', 'frozen_cliffs_2', 'frozen_cliffs_3', 'frozen_cliffs_4', 'frozen_cliffs_boss',
  'volcano_core_1', 'volcano_core_2', 'volcano_core_3', 'volcano_core_4', 'volcano_core_boss',
  'abyssal_trench_1', 'abyssal_trench_2', 'abyssal_trench_3', 'abyssal_trench_4', 'abyssal_trench_boss',
  'containment_site_1', 'containment_site_2', 'containment_site_3', 'containment_site_4']) {
  ctx.db.insert(schema.battleProgress).values({ userId: P1, stageId, stars: 3, firstClearedAt: ctx.now(), attempts: 1 }).run();
}

// Two extra dinos seeded AFTER the squad picks above so b1/b2/b3 keep their
// identities: one already escaped (for /rescue), one Lv.1 weakling that loses
// to the coastal boss (for the defeat banner).
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'stegosaurus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now(), escapedAt: ctx.now() - 3_600_000 }).run();
const escapedDino = ctx.db.select().from(schema.dinos).all().at(-1)!;
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'compsognathus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
const weakDino = ctx.db.select().from(schema.dinos).all().at(-1)!;

// Daily loop seed: roll P1's board LAST, after every other eligibility precondition
// above is already true (income lot assigned, gene lab built, battle progress rows
// exist, ratingHighWater raised for trading) so the roll draws from the full 17-quest
// pool rather than a requirement-filtered subset. track() one of the three quests up
// to its target so the hub case shows one checkmark line and two still in progress;
// the claim-reply case then claims that single quest.
rollDailyQuests(ctx, P1);
const dailyRows = ctx.db.select().from(schema.dailyQuests)
  .where(and(eq(schema.dailyQuests.userId, P1), eq(schema.dailyQuests.dayKey, dayKeyUTC(ctx.now())))).all();
const firstQuestDef = QUESTS.find((q) => q.id === dailyRows[0].questId)!;
track(ctx, P1, firstQuestDef.stat, dailyRows[0].target);

// Dex fixture: its own player, credited via recordSpeciesSeen — never via the raw
// dino/egg inserts P1 gets above. species_seen is a distinct side-effect record
// (src/core/species-seen.ts), not derived from ownership, so crediting it is the
// only way any of these marks show up as seen. Half of the six sit in allSpecies()'s
// first 10 (dex list's page 1 at PAGE_SIZE 10), so the ✅/▫️ split is visible on that
// page; the rest just deepen the progress footer. nanuqsaurus doubles as the /dex
// view case below, so that case's "Your record" field shows a real first-owned date
// instead of "Never owned".
const P3 = 'live-p3';
getOrCreateUser(ctx, P3, 'DexScout');
for (const speciesId of ['triceratops', 'dryosaurus', 'stegosaurus', 'tyrannosaurus', 'indominus', 'nanuqsaurus']) {
  recordSpeciesSeen(ctx, P3, speciesId);
}

// Enriched-roster fixture: its own player and paddock, deliberately never `lot` —
// that paddock is calibrated below (sweepCapture) for the escape alert at fit 0.75
// with NO decor, and placing any here would move that timing. Ankylosaurus is
// forest-tagged; Palm Tree and Fern Cluster both match, so matchedKindCount is 2
// and paddockFit resolves to enrichmentMult(2) = 1.05 — /dino list renders that as
// the clamped "100% comfort · enriched +5%" row.
const P4 = 'live-p4';
getOrCreateUser(ctx, P4, 'Groundskeeper');
ctx.db.update(schema.users).set({ cash: 10_000 }).where(eq(schema.users.discordId, P4)).run();
const enrichedLot = buildLot(ctx, P4, 'herbivore_paddock');
decorateLot(ctx, P4, enrichedLot.id, 'palm_tree');
decorateLot(ctx, P4, enrichedLot.id, 'fern');
ctx.db.insert(schema.dinos).values({ userId: P4, speciesId: 'ankylosaurus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
const enrichedDino = ctx.db.select().from(schema.dinos).all().find((d) => d.userId === P4)!;
assignDino(ctx, P4, enrichedDino.id, enrichedLot.id);

// If any service signature above disagrees with the source, match the source —
// tests/*.test.ts show every call shape.

// ---- 4. Run cases and post their real payloads --------------------------------
// A case yields captured payloads. Most produce them via a FakeInteraction; the alert
// sweep produces them via a Sender fake, which has no interaction at all. FakeInteraction
// already structurally satisfies Capture (it has `replies: unknown[]` and more), so every
// existing case below compiles unchanged.
interface Capture { replies: unknown[] }
interface Case { title: string; run(): Promise<Capture> }
const mod = (name: string) => ALL_MODULES.find((m) => m.name === name)!;
const cmdOf = (m: string, c: string) => mod(m).commands.find((x) => x.data.name === c)!;
const compOf = (m: string, p: string) => mod(m).components.find((x) => x.prefix === p)!;
const slash = async (m: string, c: string, opts: Parameters<typeof fakeCommand>[0]) => {
  const i = fakeCommand(opts);
  await cmdOf(m, c).execute(ctx as Ctx, i.asChatInput() as ChatInputCommandInteraction);
  return i;
};
const button = async (m: string, customId: string, user: string) => {
  const b = fakeButton({ customId, user });
  await compOf(m, customId.split(':')[0]).execute(ctx as Ctx, b.asInteraction() as unknown as ButtonInteraction);
  return b;
};

// The alert sweep has no interaction — it fans out over every alerts-enabled user and
// DMs a Sender directly (src/modules/park/alert-sweep.ts). Captured the same way the
// harness's other Sender-backed tests do: a hand-rolled fake, not a FakeInteraction.
const sweepCapture = async (): Promise<Capture> => {
  const replies: unknown[] = [];
  const sender: Sender = {
    // Alerts are DM-only: alertSweepHandler passes originGuildId: null, so
    // deliverNotification never reaches the channel branch. Throwing here makes a
    // routing regression fail loudly instead of silently posting to the wrong place.
    channelSend: async () => { throw new Error('alerts are DM-only — routing regression'); },
    dmSend: async (_userId, payload) => { replies.push(payload); },
  };
  // Drive P1's park into BOTH alert conditions off the paddock (`lot`) that `dino`
  // (triceratops, no traits) and `mate` (dryosaurus, hardy) already share.
  //
  // Escape: for this paddock's fit (0.75 — no decor was ever placed on `lot`, so
  // paddockFit's biome-match branch never applies) and a no-trait dino, escapeAt works
  // out to lastFedAt + 40h EXACTLY (32h for comfort to cross ESCAPE_COMFORT + GRACE_MS's
  // 8h, both from src/core/clock.ts). Offsetting lastFedAt by exactly 40h therefore lands
  // escapeAt AT `now`, which fails escapeAlertsFor's `esc > now` guard (alert-detect.ts)
  // — no alert. 34h instead leaves a clean 6h of runway: inside ESCAPE_WARN_MS (12h), so
  // the tier lookup matches 'heads_up' with margin on both sides. This blanket update
  // touches every P1 dino, but only paddock-assigned ones have a non-null
  // comfortCrossing — every other seeded dino (unassigned) reads back escapeAt === null
  // and is skipped, so nothing else seeded above is affected.
  ctx.db.update(schema.dinos)
    .set({ lastFedAt: ctx.now() - 34 * 3_600_000 })
    .where(eq(schema.dinos.userId, P1)).run();
  // Income cap: capHours defaults to 8 (P1 never built a visitor_center). Pushing
  // lastCollectAt back 12h puts `now` 4h past that cap — incomeCapAlertFor's
  // `now < capAt` guard fails, so the alert proceeds — and the assigned dinos are still
  // comfortably fed (comfort > ESCAPE_COMFORT) across the whole 8h earning window, so
  // accruedIncome's `pending` comes back positive rather than 0.
  ctx.db.update(schema.users)
    .set({ lastCollectAt: ctx.now() - 12 * 3_600_000 })
    .where(eq(schema.users.discordId, P1)).run();
  await alertSweepHandler(sender, ctx as Ctx)({
    id: 1, kind: ALERT_TIMER, userId: '0', refId: 0, originGuildId: null,
    firesAt: ctx.now(), handledAt: null,
  });
  return { replies };
};

const cases: Case[] = [
  { title: '/help — overview', run: () => slash('help', 'help', { name: 'help', user: P1 }) },
  { title: '/help topic:park — own-park canvas render', run: () => slash('help', 'help', { name: 'help', user: P1, options: { topic: 'park' } }) },
  { title: '/help topic:eggs — egg art', run: () => slash('help', 'help', { name: 'help', user: P1, options: { topic: 'eggs' } }) },
  { title: '/help topic:battles — chapter banner', run: () => slash('help', 'help', { name: 'help', user: P1, options: { topic: 'battles' } }) },
  { title: '/daily — hub, one quest complete', run: () => slash('daily', 'daily', { name: 'daily', user: P1 }) },
  { title: 'daily:claim — claim reply (ephemeral in production)', run: () => button('daily', `daily:claim:${P1}`, P1) },
  { title: '/park view — dashboard + render', run: () => slash('park', 'park', { name: 'park', sub: 'view', user: P1 }) },
  { title: '/eggs — list', run: () => slash('hatchery', 'eggs', { name: 'eggs', user: P1 }) },
  { title: '/hatch — pre-hatch embed', run: () => slash('hatchery', 'hatch', { name: 'hatch', user: P1, options: { egg: readyEgg.id } }) },
  { title: 'hatch:crack — reveal', run: () => button('hatchery', `hatch:crack:${readyEgg.id}`, P1) },
  { title: '/incubate — timer started', run: () => slash('hatchery', 'incubate', { name: 'incubate', user: P1, options: { egg: spareEgg.id } }) },
  { title: '/shop view — storefront', run: () => slash('shop', 'shop', { name: 'shop', sub: 'view', user: P1 }) },
  { title: '/shop food — purchase', run: () => slash('shop', 'shop', { name: 'shop', sub: 'food', user: P1, options: { item: 'ferns', units: 10 } }) },
  { title: '/sell — confirm prompt (ephemeral in production)', run: () => slash('shop', 'sell', { name: 'sell', user: P1, options: { dino: dino.id } }) },
  { title: '/mythic — confirm prompt (ephemeral in production)', run: () => slash('hatchery', 'mythic', { name: 'mythic', user: P1, options: { species: 'indominus' } }) },
  { title: '/expedition status — digging', run: () => slash('expeditions', 'expedition', { name: 'expedition', sub: 'status', user: P1 }) },
  { title: '/expedition claim — returned loot', run: () => {
      ctx.db.update(schema.expeditions).set({ returnsAt: ctx.now() - 1 }).run();   // force the seeded dig home
      return slash('expeditions', 'expedition', { name: 'expedition', sub: 'claim', user: P1 });
    } },
  { title: '/expedition start — Abyssal Trench: new site thumb', run: () => {
      // Only one expedition can be out at a time (service.ts's activeExpedition
      // check) — legal here because the claim case just above cleared the
      // seeded coastal_dig dig. ratingHighWater 1000 (set above) clears this
      // site's 880 gate.
      return slash('expeditions', 'expedition', { name: 'expedition', sub: 'start', user: P1, options: { site: 'abyssal_trench' } });
    } },
  { title: '/expedition claim — Abyssal Trench: new site banner', run: () => {
      ctx.db.update(schema.expeditions).set({ returnsAt: ctx.now() - 1 }).run();   // force the trench dig home
      return slash('expeditions', 'expedition', { name: 'expedition', sub: 'claim', user: P1 });
    } },
  { title: '/feed all — care banner', run: () => slash('care', 'feed', { name: 'feed', sub: 'all', user: P1 }) },
  { title: '/dino list — roster', run: () => slash('park', 'dino', { name: 'dino', sub: 'list', user: P1 }) },
  { title: '/dino list — enriched paddock: clamped "100% comfort · enriched +5%" row', run: () => slash('park', 'dino', { name: 'dino', sub: 'list', user: P4 }) },
  { title: '/dex list — page 1, no filter: seen marks + progress footer + page row', run: async () => ({ replies: [dexListPayload(ctx, P3, {}, 1)] }) },
  { title: '/dex view — nanuqsaurus: three enriching kinds + archetype thumb', run: async () => ({ replies: [dexViewPayload(ctx, P3, 'nanuqsaurus')] }) },
  { title: '/trade list — pending trades', run: () => slash('trading', 'trade', { name: 'trade', sub: 'list', user: P1 }) },
  { title: '/trade offer — new offer', run: () => {
      // hatchEgg/claimExpedition above run recomputeRating, which can drop parkRating
      // below TRADE_MIN_RATING — same restore the seed does at the top of this file.
      ctx.db.update(schema.users).set({ parkRating: TRADE_MIN_RATING }).run();
      return slash('trading', 'trade', { name: 'trade', sub: 'offer', user: P1, options: { user: P2, 'give-cash': 250, 'want-cash': 100 } });
    } },
  { title: '/trade accept — completed', run: () => {
      const pending = ctx.db.select().from(schema.trades).all()
        .filter((t) => t.toUser === P2 && t.status === 'pending').sort((x, y) => y.id - x.id);
      return slash('trading', 'trade', { name: 'trade', sub: 'accept', user: P2, options: { id: pending[0].id } });
    } },
  { title: '/top — leaderboard', run: () => slash('leaderboards', 'top', { name: 'top', user: P1, guild: devGuildId, options: { metric: 'rating' } }) },
  { title: '/world — Blood Moon: header + banner, three effect lines', run: async () => {
      // makeCtx's day 0 is deliberately calm (src/core/world.ts's comment on
      // WORLD_SALT) and `ctx` above sits on real wall time, so a bare /world
      // here would render "Clear Skies — no effect here today" and never
      // exercise an event banner. Day 7 is blood_moon — pinned by
      // tests/world.test.ts and tests/world-effects.test.ts's DAY_OF fixture
      // — the busiest event, with three effect lines. Swap ctx.now() just for
      // this one case and restore it immediately after: /world reads
      // ctx.now() directly, and every other case relies on the shared ctx
      // staying on real wall time (for sensible <t:...> timestamps and for
      // seeded timer comparisons like "returnsAt <= ctx.now()" elsewhere).
      const real = ctx.now();
      ctx.setNow(7 * DAY_MS + 12 * 3_600_000);
      try {
        return await slash('world', 'world', { name: 'world', user: P1 });
      } finally {
        ctx.setNow(real);
      }
    } },
  { title: '/admin inspect — (ephemeral in production)', run: () => slash('admin', 'admin', { name: 'admin', sub: 'inspect', user: 'owner', options: { user: P1 } }) },
  { title: '/battle chapters — campaign overview', run: () => slash('battles', 'battle', { name: 'battle', sub: 'chapters', user: P1 }) },
  { title: '/battle fight — coastal_dig_1 win: swift-carnivore archetype thumb on all 4 frames', run: () => slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'coastal_dig_1', dino1: b1.id, dino2: b2.id } }) },
  { title: '/battle fight — coastal_dig_3: a DIFFERENT archetype thumb (support-herbivore)', run: () => {
      // Five fights cost 11 energy against a cap of 10, and the DEFEAT case at the
      // bottom needs 3 of them — top up in place, same precedent as /trade offer's
      // parkRating restore. coastal_dig_3 is already 3-starred by the seed, so this
      // is a repeat clear (no first-clear egg) and its roster leads with
      // microceratus -> support-herbivore.
      ctx.db.update(schema.users).set({ energy: ENERGY_CAP, energyUpdatedAt: ctx.now() })
        .where(eq(schema.users.discordId, P1)).run();
      return slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'coastal_dig_3', dino1: b1.id, dino2: b2.id } });
    } },
  { title: '/battle fight — boss FIRST clear: portrait thumb + egg line on F4', run: () => slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'coastal_dig_boss', dino1: b1.id, dino2: b2.id, dino3: b3.id } }) },
  { title: '/battle fight — amber_ridge boss: second portrait (edit off the coastal reference)', run: () => slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'amber_ridge_boss', dino1: b1.id, dino2: b2.id, dino3: b3.id } }) },
  { title: '/battle fight — Abyssal Trench boss: new boss portrait', run: () => {
      // Every chapter/stage gate up to and including this one is satisfied by
      // the direct seed rows above, so this and the case below are both repeat
      // clears (no chained win dependency between them — see the seed comment).
      // This boss is genuinely contested at this squad's power level, unlike
      // the early chapters above, so it may win or lose here; F1's thumbnail
      // is the boss portrait either way. Top up energy — this and the
      // Containment Site case below cost 3 each, and only 3 is left after
      // coastal_dig_boss + amber_ridge_boss (both above) drained the earlier
      // top-up.
      ctx.db.update(schema.users).set({ energy: ENERGY_CAP, energyUpdatedAt: ctx.now() })
        .where(eq(schema.users.discordId, P1)).run();
      return slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'abyssal_trench_boss', dino1: b1.id, dino2: b2.id, dino3: b3.id } });
    } },
  { title: '/battle fight — Containment Site boss: new boss portrait', run: () => {
      // Same seeded bridge as the case above — independent of whether that
      // fight won or lost.
      return slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'containment_site_boss', dino1: b1.id, dino2: b2.id, dino3: b3.id } });
    } },
  { title: 'park:collect — income embed (ephemeral in production)', run: () => button('park', 'park:collect', P1) },
  { title: '/rescue — recapture embed', run: () => slash('care', 'rescue', { name: 'rescue', user: P1, options: { dino: escapedDino.id } }) },
  { title: '/breed start — confirm pairing', run: () => slash('genelab', 'breed', { name: 'breed', sub: 'start', user: P1, options: { 'parent-a': dino.id, 'parent-b': mate.id } }) },
  { title: '/breed status — pairing in progress', run: async () => {
      // The confirm case above is a dry run and locks nothing; clicking the real
      // button is what charges the fee, locks both parents, and occupies the Gene
      // Lab slot — mirrors how hatch:crack/battle:again exercise the button layer
      // rather than calling the service directly.
      await button('genelab', `breed:confirm:${dino.id}:${mate.id}`, P1);
      return slash('genelab', 'breed', { name: 'breed', sub: 'status', user: P1 });
    } },
  { title: '/breed claim — reveal egg', run: () => {
      // Same force-ready pattern as /expedition claim above: push the just-started
      // pairing's timer into the past so there is something to collect.
      ctx.db.update(schema.breedings).set({ readyAt: ctx.now() - 1 }).where(eq(schema.breedings.userId, P1)).run();
      return slash('genelab', 'breed', { name: 'breed', sub: 'claim', user: P1 });
    } },
  { title: '/splice — confirm re-roll', run: () => slash('genelab', 'splice', { name: 'splice', user: P1, options: { dino: spliceTarget.id, slot: 1 } }) },
  { title: '/battle fight — DEFEAT: lone Lv.1 squad vs the coastal boss', run: () => slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'coastal_dig_boss', dino1: weakDino.id } }) },
  // Run last so every stat this sweep can move (hatch, expedition claim, trade,
  // battles, breeding claim) has already been tracked by the real service calls
  // above — page 1 shows real, non-zero progress on several tracks rather than a
  // freshly-seeded zero board.
  { title: '/achievements — page 1', run: () => slash('daily', 'achievements', { name: 'achievements', user: P1 }) },
  // Run last of all: sweepCapture mutates lastFedAt (every P1 dino) and lastCollectAt,
  // which several cases above read or rely on staying untouched (feed all, the breed
  // hunger gate, park:collect, every battle case's squad). Nothing below this point
  // reads either column again, so placing the sweep here — after even the achievements
  // case — is what keeps every earlier case's seeded numbers intact.
  { title: 'alert sweep — combined escape + income cap DM', run: sweepCapture },
  { title: 'alert:mute — muted confirmation', run: () => button('park', `alert:mute:${P1}`, P1) },
];

type RawFilePayload = { data: Buffer; name: string };
function toPost(payload: unknown): { body: Record<string, unknown>; files: RawFilePayload[] } {
  const p: Record<string, unknown> = typeof payload === 'string' ? { content: payload } : { ...(payload as Record<string, unknown>) };
  delete p.flags;   // ephemeral flag is invalid on channel messages
  const files: RawFilePayload[] = [];
  // AttachmentBuilder.attachment is BufferResolvable (Buffer | string): assetImage() gives a file
  // path string, but withParkImage() (park render) gives an in-memory Buffer directly — reading
  // a Buffer as if it were a path would throw, so branch on which one we got.
  for (const f of (p.files as Array<{ attachment: Buffer | string; name: string }> | undefined) ?? []) {
    files.push({ data: Buffer.isBuffer(f.attachment) ? f.attachment : readFileSync(f.attachment), name: f.name });
  }
  delete p.files;
  // `attachments` is an EDIT-only field: on a channel POST Discord either rejects
  // it or treats the empty array as "keep nothing", silently dropping the upload
  // we just read above. Payloads that carry BOTH files and an explicit
  // attachments: [] (revealPayload, battle F4) are exactly the gallery cases that
  // exist to review the hatch cracks and the outcome banners/boss portraits.
  delete p.attachments;
  p.embeds = ((p.embeds as Array<{ toJSON?: () => unknown }> | undefined) ?? []).map((e) => e.toJSON ? e.toJSON() : e);
  p.components = ((p.components as Array<{ toJSON?: () => unknown }> | undefined) ?? []).map((c) => c.toJSON ? c.toJSON() : c);
  return { body: p, files };
}

async function post(body: Record<string, unknown>, files: RawFilePayload[]): Promise<void> {
  await rest.post(Routes.channelMessages(testChannelId), { body, files });
}

await post({ content: `## Live sweep — ${new Date().toISOString()}` }, []);
for (const c of cases) {
  try {
    const i = await c.run();
    if (i.replies.length === 0) throw new Error('no reply captured');
    await post({ content: `**${c.title}**` }, []);
    for (const r of i.replies) {
      const { body, files } = toPost(r);
      await post(body, files);
    }
    passed.push(c.title);
  } catch (e) {
    failures.push({ step: c.title, error: String(e) });
  }
}

// ---- 5. Summary ----------------------------------------------------------------
console.log(`\n=== test:live summary ===`);
for (const p of passed) console.log(`  ok   ${p}`);
for (const f of failures) console.log(`  FAIL ${f.step}\n       ${f.error}`);
console.log(`${passed.length} ok, ${failures.length} failed. Cosmetic review: check <#${testChannelId}> in the dev guild.`);
process.exit(failures.length ? 1 : 0);
