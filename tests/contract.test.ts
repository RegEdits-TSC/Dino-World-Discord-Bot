import { describe, it, expect } from 'vitest';
import { ApplicationCommandOptionType } from 'discord.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { ALL_MODULES } from '../src/core/module-list.js';

const registry = new ModuleRegistry(ALL_MODULES, Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])));

interface OptJson { type: number; name: string; autocomplete?: boolean; options?: OptJson[] }

// Every option below is served by an autocomplete provider; every flagged
// builder option must appear here. Keyed 'command' or 'command sub'.
const AUTOCOMPLETE_OPTIONS: Record<string, string[]> = {
  'incubate': ['egg'],
  'hatch': ['egg'],
  'expedition start': ['site'],
  'shop egg': ['rarity'],
  'shop food': ['item'],
  'sell': ['dino'],
  'feed one': ['dino', 'food'],
  'rescue': ['dino'],
  'upgrade': ['lot'],
  'dino assign': ['dino', 'lot'],
  'dino unassign': ['dino'],
  'decorate': ['lot'],
  'trade offer': ['give-dinos', 'give-eggs', 'give-food', 'want-dinos', 'want-eggs', 'want-food'],
  'trade accept': ['id'],
  'trade decline': ['id'],
  'trade cancel': ['id'],
  'admin give': ['dino-species'],
  'battle fight': ['stage', 'dino1', 'dino2', 'dino3'],
};

function collect(name: string, opts: OptJson[] | undefined, out: Map<string, boolean>): void {
  for (const o of opts ?? []) {
    if (o.type === ApplicationCommandOptionType.Subcommand) {
      collect(`${name} ${o.name}`, o.options, out);
    } else {
      out.set(`${name} :: ${o.name}`, o.autocomplete === true);
    }
  }
}

describe('builder contract', () => {
  it('every builder serializes (Discord would accept the deploy body)', () => {
    const body = registry.commands().map((c) => c.data.toJSON());
    expect(body).toHaveLength(20);
    for (const b of body) expect(b.name).toMatch(/^[a-z-]+$/);
  });

  it('autocomplete flags match the providers exactly, both directions', () => {
    const flagged = new Map<string, boolean>();
    for (const c of registry.commands()) {
      collect(c.data.name, (c.data.toJSON() as { options?: OptJson[] }).options, flagged);
    }
    for (const [key, names] of Object.entries(AUTOCOMPLETE_OPTIONS)) {
      for (const n of names) {
        expect(flagged.get(`${key} :: ${n}`), `${key} option '${n}' should set .setAutocomplete(true)`).toBe(true);
      }
    }
    const expected = new Set(Object.entries(AUTOCOMPLETE_OPTIONS)
      .flatMap(([key, names]) => names.map((n) => `${key} :: ${n}`)));
    for (const [id, isFlagged] of flagged) {
      if (isFlagged) expect(expected.has(id), `flagged option ${id} missing from AUTOCOMPLETE_OPTIONS manifest`).toBe(true);
    }
  });

  it('every command with an autocomplete handler has at least one flagged option', () => {
    for (const c of registry.commands()) {
      if (!c.autocomplete) continue;
      const flagged = new Map<string, boolean>();
      collect(c.data.name, (c.data.toJSON() as { options?: OptJson[] }).options, flagged);
      expect([...flagged.values()].some(Boolean), `/${c.data.name} defines autocomplete() but no option is flagged`).toBe(true);
    }
  });
});
