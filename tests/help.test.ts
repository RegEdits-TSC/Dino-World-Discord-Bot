import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { helpModule, HELP_TOPICS } from '../src/modules/help/index.js';
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
      expect(payload.embeds[0].toJSON().image?.url, topic).toBe(`attachment://${t.art.name}.webp`);
      expect(payload.files!.map((f) => f.name), topic).toContain(`${t.art.name}.webp`);
      covered.push(topic);
    }
    // Hard-coded list, deliberately NOT derived from HELP_TOPICS: the loop above
    // skips art-less topics, so a count computed from the same map it walks would
    // fall to 0 alongside it and this test would pass with zero assertions run.
    // Naming every topic also fails a PARTIAL regression (art dropped from one).
    expect([...covered].sort()).toEqual(
      ['battles', 'care', 'eggs', 'expeditions', 'genelab', 'getting-started', 'ranks', 'shop', 'trading']);
  });
  it('carries a genelab topic', () => {
    expect(Object.keys(HELP_TOPICS)).toContain('genelab');
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
});
