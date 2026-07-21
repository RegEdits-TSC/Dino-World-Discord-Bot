import { createDb, migrateDb } from '../src/core/db/index.js';
import { EconomyService } from '../src/core/economy.js';
import { Scheduler } from '../src/core/scheduler.js';
import { mulberry32 } from '../src/core/rolls.js';
import type { Ctx } from '../src/core/context.js';
import type { ChatInputCommandInteraction, Interaction } from 'discord.js';

export { mulberry32 } from '../src/core/rolls.js';

export function makeCtx(overrides: Partial<Ctx> & { nowMs?: number } = {}): Ctx & { setNow(ms: number): void } {
  const db = createDb(':memory:'); migrateDb(db);
  let nowMs = overrides.nowMs ?? 0;
  return {
    db, economy: new EconomyService(db),
    config: { token: 't', clientId: 'c', databasePath: ':memory:', ownerId: 'owner', modules: {} },
    scheduler: new Scheduler(db),
    now: () => nowMs,
    rng: mulberry32(42),
    setNow: (ms: number) => { nowMs = ms; },
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
    isChatInputCommand: () => true, isButton: () => false,
    options: {
      getSubcommand: () => opts.sub ?? null,
      getString: (k: string) => (opts.options?.[k] as string) ?? null,
      getInteger: (k: string) => (opts.options?.[k] as number) ?? null,
      getUser: () => null,
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

export function fakeButton(opts: { customId: string; user: string; guild?: string }): FakeInteraction {
  const replies: unknown[] = [];
  const record = async (payload: unknown) => { replies.push(payload); };
  const raw = {
    customId: opts.customId,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    deferred: false, replied: false,
    isChatInputCommand: () => false, isButton: () => true,
    reply: record, editReply: record, followUp: record,
    deferReply: async () => { (raw as { deferred: boolean }).deferred = true; },
  };
  return {
    replies,
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
  };
}
