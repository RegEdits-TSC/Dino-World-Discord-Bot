import { describe, it, expect, beforeEach } from 'vitest';
import { makeCtx, fakeCommand } from './harness.js';
import { helpModule, HELP_TOPICS } from '../src/modules/help/index.js';

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
});
