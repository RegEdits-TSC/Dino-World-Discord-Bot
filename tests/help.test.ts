import { describe, it, expect, beforeEach } from 'vitest';
import { ApplicationCommandOptionType } from 'discord.js';
import { makeCtx, fakeCommand } from './harness.js';
import { helpModule, HELP_TOPICS } from '../src/modules/help/index.js';
import { parkModule } from '../src/modules/park/index.js';
import { schema } from '../src/core/db/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

describe('/help', () => {
  it('overview embed lists every topic and includes the first-10-minutes walkthrough', async () => {
    const i = fakeCommand({ name: 'help', user: 'u1' });
    await helpModule.commands[0].execute(ctx, i.asChatInput());
    const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { description?: string; fields?: Array<{ name: string }> } }> }).embeds[0].toJSON();
    expect(embed.fields).toHaveLength(Object.keys(HELP_TOPICS).length);
    expect(embed.description).toContain('first 10 minutes');
  });
  it('every topic renders its own embed', async () => {
    for (const topic of Object.keys(HELP_TOPICS)) {
      const i = fakeCommand({ name: 'help', user: 'u1', options: { topic } });
      await helpModule.commands[0].execute(ctx, i.asChatInput());
      const embed = (i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> }).embeds[0].toJSON();
      expect(embed.title).toBe(HELP_TOPICS[topic].title);
    }
  });
  it('battles topic exists and explains energy, squads, stars, and bosses', () => {
    const t = HELP_TOPICS.battles;
    expect(t).toBeTruthy();
    expect(t.body).toContain('/battle chapters');
    expect(t.body).toContain('/battle fight');
    expect(t.body).toMatch(/energy/i);
    expect(t.body).toMatch(/star/i);
    expect(t.body).toMatch(/boss/i);
    expect(t.body).toMatch(/escaped/i);
  });
  // The topic art lookup is seeded on i.user.id ('u1' throughout this loop, same as
  // every other test in this file). Five of these twelve bases — eggs_incubator,
  // shop_food_market, care, gene_lab and daily — ship -vN variants and hash 'u1'
  // PAST index 0, so their real filename is a variant face, not the base; the other
  // seven (including expeditions' coastal_dig-banner, which does have variants but
  // happens to hash 'u1' to index 0) are unchanged. Every value below was resolved
  // against the real assetImage, never re-derived inside the assertion.
  const EXPECTED_ART_FOR_U1: Record<string, string> = {
    'getting-started': 'help.webp',
    eggs: 'eggs_incubator-v4.webp',
    expeditions: 'coastal_dig-banner.webp',
    shop: 'shop_food_market-v4.webp',
    care: 'care-v2.webp',
    trading: 'trading.webp',
    ranks: 'leaderboards.webp',
    battles: 'battles.webp',
    genelab: 'gene_lab-v2.webp',
    daily: 'daily-v3.webp',
    guests: 'guests.webp',
    duel: 'duel.webp',
  };
  it('every topic that declares art ships the image and its file together', async () => {
    const covered: string[] = [];
    for (const [topic, t] of Object.entries(HELP_TOPICS)) {
      if (!t.art) continue;
      const i = fakeCommand({ name: 'help', user: 'u1', options: { topic } });
      await helpModule.commands[0].execute(ctx, i.asChatInput());
      const payload = i.replies[0] as {
        embeds: Array<{ toJSON(): { image?: { url: string } } }>;
        files?: Array<{ name?: string | null }>;
      };
      expect(payload.embeds[0].toJSON().image?.url, topic).toBe(`attachment://${EXPECTED_ART_FOR_U1[topic]}`);
      expect(payload.files!.map((f) => f.name), topic).toContain(EXPECTED_ART_FOR_U1[topic]);
      covered.push(topic);
    }
    // Hard-coded list, deliberately NOT derived from HELP_TOPICS: the loop above
    // skips art-less topics, so a count computed from the same map it walks would
    // fall to 0 alongside it and this test would pass with zero assertions run.
    // Naming every topic also fails a PARTIAL regression (art dropped from one).
    expect([...covered].sort()).toEqual(
      ['battles', 'care', 'daily', 'duel', 'eggs', 'expeditions', 'genelab', 'getting-started', 'guests', 'ranks', 'shop', 'trading']);
  });
  it('/help topic:expeditions seeds the banner on the viewer, not fixed to the base face', async () => {
    // 'u1' above hashes coastal_dig-banner to index 0 (the base file), so that pin
    // cannot see this call site's seed argument go missing. 'u2' hashes it to -v2 —
    // this is the pin that actually goes red if the seed is removed.
    const i = fakeCommand({ name: 'help', user: 'u2', options: { topic: 'expeditions' } });
    await helpModule.commands[0].execute(ctx, i.asChatInput());
    const payload = i.replies[0] as {
      embeds: Array<{ toJSON(): { image?: { url: string } } }>;
      files?: Array<{ name?: string | null }>;
    };
    expect(payload.embeds[0].toJSON().image?.url).toBe('attachment://coastal_dig-banner-v2.webp');
    expect(payload.files!.map((f) => f.name)).toContain('coastal_dig-banner-v2.webp');
  });
  // The eggs topic borrowed eggs/rare — a single rarity's egg icon standing in for the
  // whole hatchery screen. banners/eggs_incubator is the picture /eggs itself already
  // uses. The daily topic shipped bare; banners/daily is what /daily itself uses.
  it('points the daily and eggs topics at the banners their own screens use', () => {
    expect(HELP_TOPICS.daily.art).toEqual({ kind: 'banners', name: 'daily' });
    expect(HELP_TOPICS.eggs.art).toEqual({ kind: 'banners', name: 'eggs_incubator' });
  });
  // /help topic:battles and /help topic:expeditions shared sites/coastal_dig-banner
  // VERBATIM — the whole campaign, seven chapters of it, illustrated with the picture
  // of the tutorial dig site. The generic per-topic art test above cannot see that: it
  // walks each topic in isolation and both borrows resolve fine.
  it('gives every art-bearing topic a picture no other topic uses', () => {
    expect(HELP_TOPICS.battles.art).toEqual({ kind: 'banners', name: 'battles' });
    expect(HELP_TOPICS.expeditions.art).toEqual({ kind: 'sites', name: 'coastal_dig-banner' });
    const keys = Object.values(HELP_TOPICS).flatMap((t) => (t.art ? [`${t.art.kind}/${t.art.name}`] : []));
    expect(keys.length, 'no art-bearing topics found — did the descriptor shape change?').toBeGreaterThan(0);
    expect(new Set(keys).size, `two topics share art: ${keys.join(', ')}`).toBe(keys.length);
  });
  it('carries a genelab topic', () => {
    expect(Object.keys(HELP_TOPICS)).toContain('genelab');
  });
  // /help is the surface players actually read, and it is the one that drifted: the
  // /park landmark branch shipped with docs/commands.md and docs/gameplay.md updated and
  // this topic left listing view/rename/alerts only. The subcommand list is scraped from
  // the real builder JSON rather than hand-typed, so the next /park subcommand fails here
  // instead of quietly going unmentioned. A topic BODY is not builder data — no redeploy.
  it('the park topic mentions every /park subcommand the builder defines', () => {
    const subs = (parkModule.commands.find((c) => c.data.name === 'park')!.data.toJSON().options ?? [])
      .filter((o) => o.type === ApplicationCommandOptionType.Subcommand)
      .map((o) => o.name);
    expect(subs.length, 'no subcommands scraped — wrong builder?').toBeGreaterThan(3);
    for (const sub of subs) expect(HELP_TOPICS.park.body, `/park ${sub}`).toContain(`/park ${sub}`);
  });
  it('the park topic defers and still renders one embed when the map render fails', async () => {
    // 'no-park' has no user row, so buildParkSnapshot throws inside the try —
    // /help must never create rows, and must never die on a render failure.
    const i = fakeCommand({ name: 'help', user: 'no-park', options: { topic: 'park' } });
    await helpModule.commands[0].execute(ctx, i.asChatInput());
    expect(i.deferOpts).toHaveLength(1);
    const reply = i.replies[0] as { embeds: Array<{ toJSON(): { title?: string } }> };
    expect(reply.embeds).toHaveLength(1);
    expect(reply.embeds[0].toJSON().title).toBe(HELP_TOPICS.park.title);
    expect(ctx.db.select().from(schema.users).all()).toHaveLength(0);
  });
  it('carries a duel topic naming every /duel subcommand', () => {
    const body = HELP_TOPICS.duel?.body ?? '';
    for (const sub of ['ghost', 'challenge', 'squad', 'record']) {
      expect(body, `HELP_TOPICS.duel should mention /duel ${sub}`).toContain(`/duel ${sub}`);
    }
    // The duel topic shipped art-less in 3b because that branch added no image files.
    // It has its own banner now, so it must also appear in the hard-coded sorted list
    // in the art test above — that list is what fails a PARTIAL regression.
    expect(HELP_TOPICS.duel?.art).toEqual({ kind: 'banners', name: 'duel' });
  });
});
