import { createDb, migrateDb } from '../src/core/db/index.js';
import { EconomyService } from '../src/core/economy.js';
import { Scheduler } from '../src/core/scheduler.js';
import { mulberry32 } from '../src/core/rolls.js';
import type { Ctx } from '../src/core/context.js';
import type { ChatInputCommandInteraction, Interaction, AutocompleteInteraction } from 'discord.js';
import { validateMessagePayload } from './lib/discord-limits.js';

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

function djsError(code: 'InteractionAlreadyReplied' | 'InteractionNotReplied'): Error {
  const e = new Error(code === 'InteractionAlreadyReplied'
    ? 'The reply to this interaction has already been sent or deferred.'
    : 'The reply to this interaction has not been sent or deferred.');
  (e as Error & { code: string }).code = code;
  return e;
}

/** Extract the text content from a reply payload (string or options object). */
export function replyText(r: unknown): string {
  if (typeof r === 'string') return r;
  return (r as { content?: string })?.content ?? '';
}

export interface FakeInteraction {
  replies: unknown[];
  deferOpts: unknown[];
  asChatInput(): ChatInputCommandInteraction;
  asInteraction(): Interaction;
}

export function fakeCommand(opts: {
  name: string; sub?: string; user: string; guild?: string;
  options?: Record<string, string | number>;
}): FakeInteraction {
  const replies: unknown[] = [];
  const deferOpts: unknown[] = [];
  const label = `/${opts.name}${opts.sub ? ` ${opts.sub}` : ''}`;
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
    reply: async (payload: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      validateMessagePayload(payload, `${label} reply`);
      raw.replied = true; replies.push(payload);
    },
    editReply: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} editReply`);
      raw.replied = true; replies.push(payload);
    },
    followUp: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} followUp`);
      replies.push(payload);
    },
    deferReply: async (o?: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      raw.deferred = true; deferOpts.push(o ?? {});
    },
  };
  return {
    replies, deferOpts,
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
    replies, deferOpts: [] as unknown[],
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
    asAutocomplete: () => raw as unknown as AutocompleteInteraction,
  };
}

export function fakeButton(opts: { customId: string; user: string; guild?: string }): FakeInteraction {
  const replies: unknown[] = [];
  const deferOpts: unknown[] = [];
  const label = `button ${opts.customId}`;
  const raw = {
    customId: opts.customId,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    message: { id: 'fake-message' },
    deferred: false, replied: false,
    isChatInputCommand: () => false, isButton: () => true, isAutocomplete: () => false,
    reply: async (payload: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      validateMessagePayload(payload, `${label} reply`);
      raw.replied = true; replies.push(payload);
    },
    editReply: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} editReply`);
      raw.replied = true; replies.push(payload);
    },
    followUp: async (payload: unknown) => {
      if (!raw.deferred && !raw.replied) throw djsError('InteractionNotReplied');
      validateMessagePayload(payload, `${label} followUp`);
      replies.push(payload);
    },
    update: async (payload: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      validateMessagePayload(payload, `${label} update`);
      raw.replied = true; replies.push(payload);
    },
    deferUpdate: async (o?: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      raw.deferred = true; deferOpts.push(o ?? {});
    },
    deferReply: async (o?: unknown) => {
      if (raw.deferred || raw.replied) throw djsError('InteractionAlreadyReplied');
      raw.deferred = true; deferOpts.push(o ?? {});
    },
  };
  return {
    replies, deferOpts,
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
  };
}
