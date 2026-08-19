import { createDb, migrateDb } from '../src/core/db/index.js';
import { EconomyService } from '../src/core/economy.js';
import { Scheduler } from '../src/core/scheduler.js';
import { mulberry32 } from '../src/core/rolls.js';
import type { Ctx } from '../src/core/context.js';
import type { ChatInputCommandInteraction, Interaction, AutocompleteInteraction } from 'discord.js';
import { ApplicationCommandOptionType } from 'discord.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import { EMOJI_FALLBACK, setEmojiMap, clearEmojiMap } from '../src/core/emojis.js';
import { validateMessagePayload, validateAutocompleteChoices } from './lib/discord-limits.js';

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
    sleep: async () => {},
    setNow: (ms: number) => { nowMs = ms; },
    notify: async (userId: string, originGuildId: string | null, message: string) => { notifications.push({ userId, originGuildId, message }); },
    notifications,
    ...overrides,
  };
}

export const testRegistry = new ModuleRegistry(
  ALL_MODULES, Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])));

interface OptSpec { name: string; type: number; autocomplete: boolean }
interface BuilderSpec { hasSubs: boolean; options: Map<string, OptSpec> }
interface OptJson { type: number; name: string; autocomplete?: boolean; options?: OptJson[] }

// Resolve the real builder for a command; null → synthetic test command,
// which keeps the old permissive getters (router tests use stub commands).
function builderSpec(name: string, sub: string | null | undefined): BuilderSpec | null {
  const cmd = testRegistry.findCommand(name);
  if (!cmd) return null;
  const json = cmd.data.toJSON() as { options?: OptJson[] };
  const subs = (json.options ?? []).filter((o) => o.type === ApplicationCommandOptionType.Subcommand);
  let opts: OptJson[] | undefined;
  if (subs.length > 0) {
    if (!sub) throw new Error(`fakeCommand: /${name} requires a subcommand (${subs.map((s) => s.name).join(', ')})`);
    const s = subs.find((x) => x.name === sub);
    if (!s) throw new Error(`fakeCommand: /${name} has no subcommand '${sub}'`);
    opts = s.options;
  } else {
    if (sub) throw new Error(`fakeCommand: /${name} has no subcommands (got '${sub}')`);
    opts = json.options;
  }
  const map = new Map<string, OptSpec>();
  for (const o of opts ?? []) map.set(o.name, { name: o.name, type: o.type, autocomplete: o.autocomplete === true });
  return { hasSubs: subs.length > 0, options: map };
}

function requiredMissing(k: string): Error {
  const e = new Error(`Required option "${k}" not found.`);
  (e as Error & { code: string }).code = 'CommandInteractionOptionNotFound';
  return e;
}

function makeGetter<T>(
  spec: BuilderSpec | null, fixtures: Record<string, unknown> | undefined,
  label: string, expected: number[], convert: (v: unknown) => T,
): (k: string, required?: boolean) => T | null {
  return (k, required = false) => {
    if (spec) {
      const o = spec.options.get(k);
      if (!o) throw new Error(`option '${k}' is not defined in the ${label} builder`);
      if (!expected.includes(o.type)) {
        throw new Error(`option '${k}' in ${label} is builder type ${o.type}, read with the wrong getter (expected one of ${expected.join('/')})`);
      }
    }
    const v = fixtures?.[k];
    if (v == null) {
      if (required) throw requiredMissing(k);
      return null;
    }
    return convert(v);
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
  options?: Record<string, string | number | boolean | { id: string; bot?: boolean }>;
}): FakeInteraction {
  const replies: unknown[] = [];
  const deferOpts: unknown[] = [];
  const label = `/${opts.name}${opts.sub ? ` ${opts.sub}` : ''}`;
  const spec = builderSpec(opts.name, opts.sub ?? null);
  if (spec) {
    for (const k of Object.keys(opts.options ?? {})) {
      if (!spec.options.has(k)) {
        throw new Error(`fakeCommand ${label}: fixture option '${k}' is not defined in the builder`);
      }
    }
  }
  const raw = {
    commandName: opts.name,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    deferred: false, replied: false,
    isChatInputCommand: () => true, isButton: () => false, isAutocomplete: () => false,
    options: {
      getSubcommand: () => opts.sub ?? null,
      getString: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.String], String),
      getInteger: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.Integer], Number),
      getBoolean: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.Boolean], Boolean),
      getUser: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.User], (v) =>
        typeof v === 'object' && v !== null
          ? { displayName: String((v as { id: string }).id), bot: false, ...(v as object) }
          : { id: String(v), displayName: String(v), bot: false }),
      getChannel: makeGetter(spec, opts.options, label, [ApplicationCommandOptionType.Channel], (v) =>
        ({ id: String(v), type: 0 })),   // 0 = ChannelType.GuildText
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
  const spec = builderSpec(opts.name, opts.sub ?? null);
  if (spec) {
    const o = spec.options.get(opts.focused.name);
    if (!o) throw new Error(`fakeAutocomplete /${opts.name}: focused option '${opts.focused.name}' is not in the builder`);
    if (!o.autocomplete) throw new Error(`fakeAutocomplete /${opts.name}: option '${opts.focused.name}' does not set autocomplete in the builder`);
  }
  let responded = false;
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
    respond: async (choices: unknown) => {
      if (responded) throw new Error(`/${opts.name} autocomplete already responded`);
      responded = true;
      validateAutocompleteChoices(choices, `/${opts.name} autocomplete`);
      replies.push(choices);
    },
  };
  return {
    replies, deferOpts: [] as unknown[],
    asChatInput: () => raw as unknown as ChatInputCommandInteraction,
    asInteraction: () => raw as unknown as Interaction,
    asAutocomplete: () => raw as unknown as AutocompleteInteraction,
  };
}

export function fakeButton(opts: {
  customId: string; user: string; guild?: string; posterId?: string; componentIds?: string[];
}): FakeInteraction {
  const replies: unknown[] = [];
  const deferOpts: unknown[] = [];
  const label = `button ${opts.customId}`;
  const raw = {
    customId: opts.customId,
    user: { id: opts.user, displayName: opts.user },
    guildId: opts.guild ?? null,
    // Two server-supplied facts about the message the button lives on, both of which
    // a client can observe but never forge.
    //
    // componentIds mirrors Message#components — the button set Discord itself stores
    // on the message. It DEFAULTS to the clicked id, because in a real client the only
    // button you can click is one the message actually carries; a fixture opts out
    // (`componentIds: []`, or somebody else's ids) to model a forged customId emitted
    // straight at the gateway against a message that carries no such button.
    //
    // posterId mirrors Message#interactionMetadata.user.id — who ran the slash command
    // that produced the message. No production code reads it any more (see
    // src/core/components.ts for why message authorship proves nothing about a
    // customId's contents); it survives so the S1 regression fixtures can anchor a
    // forged id on a message genuinely authored by the player it names, which is
    // exactly the shape the exploit used.
    message: {
      id: 'fake-message',
      interactionMetadata: opts.posterId ? { user: { id: opts.posterId } } : null,
      components: (opts.componentIds ?? [opts.customId])
        .map((id) => ({ type: 1, components: [{ type: 2, customId: id }] })),
    },
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

// Install a synthetic custom-emoji map covering every known emoji name, so
// tests can exercise the custom-tag arms that production hits after client
// ready. Returns the restore function; call it in finally/afterEach.
export function installTestEmojiMap(): () => void {
  const entries: Record<string, string> = {};
  let id = 900000;
  for (const name of Object.keys(EMOJI_FALLBACK)) entries[name] = `<:${name}:${id++}>`;
  setEmojiMap(entries);
  return clearEmojiMap;
}
