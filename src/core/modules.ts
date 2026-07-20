import type { SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder, SlashCommandOptionsOnlyBuilder,
  ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import type { Ctx } from './context.js';

export interface CommandDef {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
  execute(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void>;
}
export interface ComponentDef {
  prefix: string;
  execute(ctx: Ctx, i: ButtonInteraction): Promise<void>;
}
export interface ModuleManifest {
  name: string; commands: CommandDef[]; components: ComponentDef[];
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
  }
  commands(): CommandDef[] { return this.enabled.flatMap((m) => m.commands); }
  findCommand(name: string): CommandDef | undefined {
    return this.commands().find((c) => c.data.name === name);
  }
  findComponent(customId: string): ComponentDef | undefined {
    const prefix = customId.split(':')[0];
    return this.enabled.flatMap((m) => m.components).find((c) => c.prefix === prefix);
  }
}
