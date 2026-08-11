import { describe, it, expect, beforeEach } from 'vitest';
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

  it('keeps the featured dino\'s file — the drop the old branch made', async () => {
    player('a', 300);
    const d = ctx.db.insert(schema.dinos)
      .values({ userId: 'a', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0 })
      .returning().get();
    setFeaturedDino(ctx, 'a', d.id);
    const p = (await visitPayload(ctx, 'a'))!;
    // The embed points at attachment://<archetype>-<diet>.webp; without the file it is a
    // dangling URL, which renders as a broken image and throws nothing.
    expect(p.embeds[0].toJSON().thumbnail?.url).toBeDefined();
    expect(p.files!.some((f) => f.name === p.embeds[0].toJSON().thumbnail!.url.replace('attachment://', ''))).toBe(true);
  });

  it('mints a Next park button for the next ring member', async () => {
    player('a', 300); player('b', 200);
    const p = (await visitPayload(ctx, 'a'))!;
    expect(JSON.stringify(p)).toContain('park:tour:b');
  });

  it('mints no button when the ring is empty', async () => {
    getOrCreateUser(ctx, 'a', 'A');   // rating 0 — has a row, not in the ring
    const p = (await visitPayload(ctx, 'a'))!;
    expect(p.components).toEqual([]);
    // No featured dino here, so attach() never ran and dashboardPayload's `files` stayed
    // undefined — the forwarding line must not turn that into an empty array. attach()
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
  });
});
