import { describe, it, expect } from 'vitest';
import { alertPayload } from '../src/modules/park/alert-embeds.js';
import { validateMessagePayload } from './lib/discord-limits.js';

const esc = (over = {}) => ({ dinoId: 1, name: 'Rexy', escapeAt: 3_600_000, tier: 'last_call' as const, ...over });
const json = (p: ReturnType<typeof alertPayload>) => p.embeds[0].toJSON();

describe('alertPayload', () => {
  it('renders both conditions in one embed with one button row', () => {
    const p = alertPayload('u1', [esc()], { capAt: 0, pending: 1240, capHours: 8 }, 0);
    const d = json(p).description ?? '';
    expect(d).toContain('Rexy');
    expect(d).toContain('1,240');
    expect(p.components).toHaveLength(1);
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:feedall:u1', 'alert:collect:u1', 'alert:mute:u1']);
  });

  it('omits the Feed all button when there are no escapes', () => {
    const p = alertPayload('u1', [], { capAt: 0, pending: 500, capHours: 8 }, 0);
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:collect:u1', 'alert:mute:u1']);
  });

  it('omits the Collect button when income has not capped', () => {
    const p = alertPayload('u1', [esc()], null, 0);
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:feedall:u1', 'alert:mute:u1']);
  });

  it('carries NO attachments key — deliverNotification forwards one object to two sends', () => {
    // MessagePayload.resolveBody PUSHES into an explicit attachments array and create()
    // only shallow-copies it, so a shared array accumulates duplicate ids on the second
    // send. Notification payloads are safe precisely because they omit the key.
    const p = alertPayload('u1', [esc()], null, 0) as Record<string, unknown>;
    expect('attachments' in p).toBe(false);
  });

  it('truncates a large roster and says how many were hidden', () => {
    // Ceiling is 10 lots x paddockCapacity(4)=8 = 80 dinos, well past the 4096-char
    // description limit.
    const many = Array.from({ length: 80 }, (_, n) =>
      esc({ dinoId: n + 1, name: `Dino${n}`, escapeAt: (n + 1) * 60_000 }));
    const p = alertPayload('u1', many, null, 0);
    expect(json(p).description).toContain('+75 more');
    validateMessagePayload(p, 'alert payload');       // throws if any Discord limit is blown
  });

  it('passes Discord limit validation in the everyday case', () => {
    const p = alertPayload('u1', [esc()], { capAt: 0, pending: 1240, capHours: 8 }, 0);
    expect(() => validateMessagePayload(p, 'alert payload')).not.toThrow();
  });
});
