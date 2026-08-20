import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeButton } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { setMotto, setFeaturedDino } from '../src/modules/park/showcase.js';
import { tourRing, nextInRing, visitPayload } from '../src/modules/park/visit.js';
import { parkModule } from '../src/modules/park/index.js';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

const player = (id: string, rating: number) => {
  getOrCreateUser(ctx, id, id.toUpperCase());
  ctx.db.update(schema.users).set({ parkRating: rating }).where(eq(schema.users.discordId, id)).run();
};

describe('tourRing', () => {
  it('orders by rating desc with discordId as the tiebreak', () => {
    player('b', 500); player('a', 500); player('c', 900);
    expect(tourRing(ctx)).toEqual(['c', 'a', 'b']);
  });

  it('skips a park with no rating', () => {
    player('a', 100); player('empty', 0);
    expect(tourRing(ctx)).toEqual(['a']);
  });
});

describe('nextInRing', () => {
  it('wraps at the end', () => {
    player('a', 300); player('b', 200);
    expect(nextInRing(ctx, 'a')).toBe('b');
    expect(nextInRing(ctx, 'b')).toBe('a');
  });

  it('returns the same park when it is the only one', () => {
    player('a', 300);
    expect(nextInRing(ctx, 'a')).toBe('a');
  });

  it('is null when nobody qualifies', () => {
    player('empty', 0);
    expect(nextInRing(ctx, 'empty')).toBeNull();
  });

  it('restarts at the top for a park that has left the ring', () => {
    player('a', 300); player('gone', 0);
    // Reachable without forging anything: a rating can drop, or adminReset can zero it,
    // while a Next park button minted for that park is still live on an old message.
    expect(nextInRing(ctx, 'gone')).toBe('a');
  });
});

describe('visitPayload', () => {
  it('is null for a player with no park row', async () => {
    expect(await visitPayload(ctx, 'nobody')).toBeNull();
  });

  it('carries the target\'s showcase and no Collect button', async () => {
    player('a', 300);
    const d = ctx.db.insert(schema.dinos)
      .values({ userId: 'a', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 })
      .returning().get();
    setMotto(ctx, 'a', 'Where the big ones live');
    setFeaturedDino(ctx, 'a', d.id);
    const p = (await visitPayload(ctx, 'a'))!;
    expect(p.embeds[0].toJSON().description).toContain('Where the big ones live');
    // park:collect carries NO user id, so a viewer clicking it would collect their OWN
    // income from a message about someone else's park. It must never reach this payload.
    expect(JSON.stringify(p)).not.toContain('park:collect');
  });

  // visitPayload itself only ever renders the Park tab, which carries no Featured content —
  // Featured lives on the Animals tab. The equivalent assertion now lives in the
  // 'park:vtab animals tab' describe block below, driven through park:vtab:<target>:animals
  // rather than visitPayload directly.

  it('mints a Next park button for the next ring member', async () => {
    player('a', 300); player('b', 200);
    const p = (await visitPayload(ctx, 'a'))!;
    expect(JSON.stringify(p)).toContain('park:tour:b');
  });

  it('mints no Next park button when the ring is empty, but keeps the tab row', async () => {
    getOrCreateUser(ctx, 'a', 'A');   // rating 0 — has a row, not in the ring
    const p = (await visitPayload(ctx, 'a'))!;
    // components now come straight from dashboardPayload(visit: true), which always mints
    // the tab row — only the second row (Next park) is conditional on the ring having a
    // next member, so an empty ring leaves exactly one row, not zero.
    expect(p.components).toHaveLength(1);
    expect(JSON.stringify(p.components)).not.toContain('park:tour:');
    // dashboardPayload calls attach() for nothing at all any more (the featured dino's
    // thumbnail moved to the Animals tab), so `built.files` is undefined regardless of
    // whether a dino is featured — and renderPark also fails in this test environment (no
    // worker), so withParkImage never runs either. Either fact alone would leave `p.files`
    // unset; the forwarding line (`if (built.files) payload.files = built.files;` in
    // visit.ts) must still not turn an absent value into an empty array. attach()
    // deliberately never creates one (see the repo CLAUDE.md note on the three attachment
    // defects an empty-array substitution shipped); tests/hatchery.test.ts and
    // tests/notify-handlers.test.ts pin the same undefined-not-[] shape at their own
    // art-free payloads.
    expect(p.files).toBeUndefined();
  });
});

describe('park:tour', () => {
  const click = async (customId: string, user = 'viewer') => {
    const i = fakeButton({ customId, user });
    await parkModule.components.find((c) => c.prefix === 'park')!.execute(ctx, i.asInteraction() as never);
    return i;
  };

  it('renders the target park and advances the button', async () => {
    player('a', 300); player('b', 200);
    const i = await click('park:tour:b');
    expect(JSON.stringify(i.replies[0])).toContain('park:tour:a');   // wrapped
  });

  it('acknowledges BEFORE rendering, and still lands the park', async () => {
    player('a', 300); player('b', 200);
    const i = await click('park:tour:b');
    // Rendering first cost the interaction: renderPark's own RENDER_TIMEOUT_MS is 3000 —
    // Discord's whole initial-response window — and renders serialize process-wide, so a
    // slow one lost the i.update to 10062 and showed "This interaction failed" with no
    // park. fakeButton records deferUpdate and deferReply alike into deferOpts.
    expect(i.deferOpts).toHaveLength(1);
    expect((i.replies[0] as { embeds?: unknown[] }).embeds).toHaveLength(1);
  });

  it('creates no user row for the clicker', async () => {
    player('a', 300);
    await click('park:tour:a', 'stranger');
    // A public button must never mint an account for a passer-by. The router's own
    // touchPresence is the only writer on this path, and it updates existing rows only.
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'stranger')).get())
      .toBeUndefined();
  });

  it('answers ephemerally for a target with no park', async () => {
    player('a', 300);
    const i = await click('park:tour:ghost');
    expect(JSON.stringify(i.replies[0])).toContain('no park yet');
    expect((i.replies[0] as { flags?: number }).flags).toBe(MessageFlags.Ephemeral);
    // The existence check runs ahead of the acknowledgement precisely so this answer can
    // stay ephemeral — deferUpdate first would have committed it to the public message.
    expect(i.deferOpts).toHaveLength(0);
  });
});

describe('park:vtab animals tab', () => {
  const click = async (customId: string, user = 'viewer') => {
    const i = fakeButton({ customId, user });
    await parkModule.components.find((c) => c.prefix === 'park')!.execute(ctx, i.asInteraction() as never);
    return i;
  };

  // Moved from visitPayload's own (formerly skipped) test above: visitPayload only ever
  // renders the Park tab, which carries no Featured content — Featured lives on the
  // Animals tab, reached via park:vtab:<target>:animals.
  it('keeps the featured dino\'s file — the drop the old branch made', async () => {
    player('a', 300);
    const d = ctx.db.insert(schema.dinos)
      .values({ userId: 'a', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 })
      .returning().get();
    setFeaturedDino(ctx, 'a', d.id);
    const i = await click('park:vtab:a:animals');
    const sent = i.replies[0] as {
      embeds: Array<{ toJSON(): { thumbnail?: { url: string } } }>;
      files?: Array<{ name: string }>;
    };
    // The embed points at attachment://<archetype>-<diet>.webp; without the file it is a
    // dangling URL, which renders as a broken image and throws nothing.
    expect(sent.embeds[0].toJSON().thumbnail?.url).toBeDefined();
    expect(sent.files!.some((f) => f.name === sent.embeds[0].toJSON().thumbnail!.url.replace('attachment://', ''))).toBe(true);
  });

  // Fix-round regression test: dashboardPayload's Next park row only ever gets appended by
  // visitPayload, at the initial park:tour hop. renderTab replaces `components` wholesale
  // on every branch and, before nextParkRow was threaded through it, never re-minted this
  // row — so a tour that navigated to any tab dead-ended there, with no way to advance
  // short of re-running a command. Animals is the tab named in the fix request; the same
  // row is re-minted on Park/Lots/Prestige too, via the shared `tourRow` computed once at
  // the top of renderTab.
  it('keeps the Next park button after switching tabs, not just on the initial park:tour render', async () => {
    player('a', 300); player('b', 200);
    const i = await click('park:vtab:a:animals');
    expect(JSON.stringify(i.replies[0])).toContain('park:tour:b');
  });
});

describe('visited card attention consistency', () => {
  // Fix-round regression test: visitPayload used to pass `attention: escaped` (escaped
  // dinos only) while renderTab's Park tab passed `escaped + needsAttentionCount(...)` —
  // two different numbers for the same screen depending on which entry point rendered it.
  // A carnivore dropped into an herbivore paddock is wrong-habitat but NOT escaped, so it
  // trips needsAttentionCount without moving the escaped count at all — exactly the case
  // that would have made the two entry points disagree (0 vs 1) before the fix.
  it('renders the same attention number from visitPayload and park:vtab:<target>:park', async () => {
    player('a', 300);
    const lot = ctx.db.insert(schema.lots).values({
      userId: 'a', type: 'paddock', kind: 'herbivore_paddock', name: 'Herbivore Paddock', level: 1,
    }).returning().get();
    ctx.db.insert(schema.dinos).values({
      userId: 'a', lotId: lot.id, speciesId: 'velociraptor', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();

    const dinosField = (fields: Array<{ name: string; value: string }>) =>
      fields.find((f) => f.name.includes('Dinos'))!.value;

    const viaTour = (await visitPayload(ctx, 'a'))!;
    const tourValue = dinosField(viaTour.embeds[0].toJSON().fields!);
    expect(tourValue).toContain('need attention');   // sanity: the case actually trips the marker

    const b = fakeButton({ customId: 'park:vtab:a:park', user: 'viewer' });
    await parkModule.components.find((c) => c.prefix === 'park')!.execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const vtabValue = dinosField(sent.embeds[0].toJSON().fields!);

    expect(vtabValue).toBe(tourValue);
  });
});
