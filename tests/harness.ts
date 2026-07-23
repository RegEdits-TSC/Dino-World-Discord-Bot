import { createDb, migrateDb } from '../src/core/db/index.js';
import { EconomyService } from '../src/core/economy.js';
import { Scheduler } from '../src/core/scheduler.js';
import { mulberry32 } from '../src/core/rolls.js';
import type { Ctx } from '../src/core/context.js';
import type { ChatInputCommandInteraction, Interaction, AutocompleteInteraction } from 'discord.js';

export { mulberry32 } from '../src/core/rolls.js';

export function makeCtx(overrides: Partial<Ctx> & { nowMs?: number } = {}): Ctx & { setNow(ms: number): void; notifications: Array<{ userId: string; originGuildId: string | null; message: string }> } {
  const db = createDb(':memory:'); migrateDb(db);
  let nowMs = overrides.nowMs ?? 0;
  const notifications: Array<{ userId: string; originGuildId: string | null; message: string }> = [];
  return {
    db, economy: new EconomyService(db),
    config: { token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner', modules: {} },
    scheduler: new Scheduler(db),
    now: () => nowMs,
    rng: mulberry32(42),
    setNow: (ms: number) => { nowMs = ms; },
    notify: async (userId: string, originGuildId: string | null, message: string) => { notifications.push({ userId, originGuildId, message }); },
    notifications,
    ...overrides,
  };
}

export interface FakeInteraction {
  replies: unknown[];
  asChatInput(): ChatInputCommandInteraction;
  asInteraction(): Interaction;
}

export function fakeCommand(opts: {
  name: string; sub?: string; user: string; guild?: string;
  options?: Record<string, string | number>;
}): FakeInteraction {
  const replies: unknown[] = [];
  const record = async (payload: unknown) => { replies.push(payload); };
  const raw = {
    commandName: opts.name,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    deferred: false, replied: false,
    isChatInputCommand: () => true, isButton: () => false, isAutocomplete: () => false,
    options: {
      getSubcommand: () => opts.sub ?? null,
      getString: (k: string) => (opts.options?.[k] as string) ?? null,
      getInteger: (k: string) => (opts.options?.[k] as number) ?? null,
      getUser: (k: string) => {
        const id = opts.options?.[k];
        return id != null ? { id: String(id), displayName: String(id), bot: false } : null;
      },
    },
    reply: record, editReply: record, followUp: record,
    deferReply: async () => { (raw as { deferred: boolean }).deferred = true; },
  };
  return {
    replies,
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
  };
}

export function fakeAutocomplete(opts: {
  name: string; sub?: string; user: string; guild?: string;
  focused: { name: string; value: string };
  options?: Record<string, string | number>;
}): FakeInteraction & { asAutocomplete(): AutocompleteInteraction } {
  const replies: unknown[] = [];
  const raw = {
    commandName: opts.name,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    isChatInputCommand: () => false, isButton: () => false, isAutocomplete: () => true,
    options: {
      getSubcommand: () => opts.sub ?? null,
      getFocused: (full?: boolean) => (full ? opts.focused : opts.focused.value),
      get: (k: string) => (opts.options?.[k] != null ? { value: opts.options[k] } : null),
    },
    respond: async (choices: unknown) => { replies.push(choices); },
  };
  return {
    replies,
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
    asAutocomplete: () => raw as unknown as AutocompleteInteraction,
  };
}

export function fakeButton(opts: { customId: string; user: string; guild?: string }): FakeInteraction {
  const replies: unknown[] = [];
  const record = async (payload: unknown) => { replies.push(payload); };
  const raw = {
    customId: opts.customId,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    deferred: false, replied: false,
    isChatInputCommand: () => false, isButton: () => true, isAutocomplete: () => false,
    reply: record, editReply: record, followUp: record, update: record,
    deferReply: async () => { (raw as { deferred: boolean }).deferred = true; },
  };
  return {
    replies,
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
  };
}
