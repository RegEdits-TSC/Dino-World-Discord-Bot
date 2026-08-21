import type { SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder, SlashCommandOptionsOnlyBuilder,
  ChatInputCommandInteraction, ButtonInteraction, AutocompleteInteraction,
  StringSelectMenuInteraction } from 'discord.js';
import type { Ctx } from './context.js';

export interface CommandDef {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
  execute(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void>;
  // Providers only respond(); they never reply, defer, or create user rows.
  autocomplete?(ctx: Ctx, i: AutocompleteInteraction): Promise<void>;
}
export interface ComponentDef {
  prefix: string;
  execute(ctx: Ctx, i: ButtonInteraction): Promise<void>;
}
/**
 * A string select menu handler. Deliberately a SEPARATE type from ComponentDef rather than
 * a widened one.
 *
 * ComponentDef.execute is declared with METHOD syntax, so its parameter is bivariant:
 * widening it to accept a select compiles across all seventeen modules while letting a
 * select menu reach handlers written for buttons only. This was measured, not assumed —
 * widening it breaks exactly ONE call site under `tsc --noEmit -p tsconfig.test.json`, an
 * unrelated helper, and everything else goes green. Every button handler opens with
 * `i.customId.split(':')` and none reads `i.values`, so a select dispatched into one would
 * silently run the button path against the wrong payload shape. The near-silence is the
 * hazard, not the good news.
 */
export interface SelectDef {
  prefix: string;
  execute(ctx: Ctx, i: StringSelectMenuInteraction): Promise<void>;
}
export interface ModuleManifest {
  name: string; commands: CommandDef[]; components: ComponentDef[];
  // Optional so the seventeen manifests that mint no select menu are untouched.
  selects?: SelectDef[];
}

export class ModuleRegistry {
  private enabled: ModuleManifest[];
  constructor(manifests: ModuleManifest[], flags: Record<string, boolean>) {
    this.enabled = manifests.filter((m) => flags[m.name] === true);
    const names = this.enabled.flatMap((m) => m.commands).map((c) => c.data.name);
    const dupName = names.find((n, idx) => names.indexOf(n) !== idx);
    if (dupName) throw new Error(`Duplicate command name across modules: ${dupName}`);
    const prefixes = this.enabled.flatMap((m) => m.components).map((c) => c.prefix);
    const dupPrefix = prefixes.find((p, idx) => prefixes.indexOf(p) !== idx);
    if (dupPrefix) throw new Error(`Duplicate component prefix across modules: ${dupPrefix}`);
    // Selects get their own namespace and their own duplicate check. A select and a button
    // may share a prefix — they are resolved through different maps — but two selects may
    // not, for the same boot-time reason two components may not.
    const selectPrefixes = this.enabled.flatMap((m) => m.selects ?? []).map((s) => s.prefix);
    const dupSelect = selectPrefixes.find((p, idx) => selectPrefixes.indexOf(p) !== idx);
    if (dupSelect) throw new Error(`Duplicate select prefix across modules: ${dupSelect}`);
  }
  commands(): CommandDef[] { return this.enabled.flatMap((m) => m.commands); }
  findCommand(name: string): CommandDef | undefined {
    return this.commands().find((c) => c.data.name === name);
  }
  findComponent(customId: string): ComponentDef | undefined {
    const prefix = customId.split(':')[0];
    return this.enabled.flatMap((m) => m.components).find((c) => c.prefix === prefix);
  }
  findSelect(customId: string): SelectDef | undefined {
    const prefix = customId.split(':')[0];
    return this.enabled.flatMap((m) => m.selects ?? []).find((s) => s.prefix === prefix);
  }
}
