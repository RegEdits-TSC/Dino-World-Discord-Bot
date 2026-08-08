import { describe, it, expect } from 'vitest';
import { alertPayload } from '../src/modules/park/alert-embeds.js';
import { validateMessagePayload } from './lib/discord-limits.js';

const esc = (over = {}) => ({ dinoId: 1, name: 'Rexy', escapeAt: 3_600_000, tier: 'last_call' as const, ...over });
// alertPayload returns null only for the "nothing to report" case (asserted below); every
// other test here supplies at least one condition, so a non-null assertion at the call site
// is safe and keeps the assertions below unchanged.
const json = (p: NonNullable<ReturnType<typeof alertPayload>>) => p.embeds[0].toJSON();

describe('alertPayload', () => {
  it('renders both conditions in one embed with one button row', () => {
    const p = alertPayload('u1', [esc()], { capAt: 0, pending: 1240, capHours: 8 }, 0)!;
    const d = json(p).description ?? '';
    expect(d).toContain('Rexy');
    expect(d).toContain('1,240');
    expect(p.components).toHaveLength(1);
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:feedall:u1', 'alert:collect:u1', 'alert:mute:u1']);
  });

  it('omits the Feed all button when there are no escapes', () => {
    const p = alertPayload('u1', [], { capAt: 0, pending: 500, capHours: 8 }, 0)!;
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:collect:u1', 'alert:mute:u1']);
  });

  it('omits the Collect button when income has not capped', () => {
    const p = alertPayload('u1', [esc()], null, 0)!;
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:feedall:u1', 'alert:mute:u1']);
  });

  it('carries NO attachments key — deliverNotification forwards one object to two sends', () => {
    // MessagePayload.resolveBody PUSHES into an explicit attachments array and create()
    // only shallow-copies it, so a shared array accumulates duplicate ids on the second
    // send. Notification payloads are safe precisely because they omit the key.
    const p = alertPayload('u1', [esc()], null, 0)! as Record<string, unknown>;
    expect('attachments' in p).toBe(false);
  });

  it('truncates a large roster and says how many were hidden', () => {
    // Ceiling is 10 lots x paddockCapacity(4)=8 = 80 dinos, well past the 4096-char
    // description limit.
    const many = Array.from({ length: 80 }, (_, n) =>
      esc({ dinoId: n + 1, name: `Dino${n}`, escapeAt: (n + 1) * 60_000 }));
    const p = alertPayload('u1', many, null, 0)!;
    const description = json(p).description ?? '';
    expect(description).toContain('+75 more');
    // Guards the truncation count itself, not just the presence of the word "more": exactly
    // MAX_LISTED (5) roster lines should actually render alongside the hidden-count marker.
    expect(description.match(/escapes in/g)).toHaveLength(5);
    validateMessagePayload(p, 'alert payload');       // throws if any Discord limit is blown
  });

  it('passes Discord limit validation in the everyday case', () => {
    const p = alertPayload('u1', [esc()], { capAt: 0, pending: 1240, capHours: 8 }, 0);
    expect(() => validateMessagePayload(p, 'alert payload')).not.toThrow();
  });

  it('returns null when there is nothing to report', () => {
    // An alert with no conditions is not an empty alert, it is no alert: setDescription('')
    // is rejected outright by @discordjs/builders' embed validator, so there must be no way
    // to reach that call with both escapes and income empty.
    expect(alertPayload('u1', [], null, 0)).toBeNull();
  });
});
