// Type declarations for conventions-audit.mjs, so tests/conventions.test.ts
// can import its check functions under `tsc --noEmit -p tsconfig.test.json`
// without turning on `allowJs` (which would also pull every other .mjs
// script under scripts/ into typechecking). The .mjs file stays plain,
// untyped ESM and outside the build; this file describes it, it doesn't
// join it.

export interface ManifestRule {
  id: string;
  sourceLines: string;
  bodyRequired?: boolean;
}

export interface ManifestDoc {
  slug: string;
  title: string;
  triggerGlobs: string[];
  fallback?: boolean;
  rules: ManifestRule[];
  bodyFloorWaiver?: { ratio: number; reason: string };
}

export interface Manifest {
  version: number;
  claudeMdMaxLines: number;
  alwaysCore: string[];
  docs: ManifestDoc[];
}

export interface RuleMapRule {
  id: string;
  doc: string;
  sourceLines: string;
  summary: string;
  wordCount: number;
  compressible: string;
  duplicates?: string[];
}

export interface RuleMap {
  note: string;
  source: { file: string; commit: string; lines: number; ruleCount: number };
  docs: unknown[];
  alwaysCore: string[];
  rules: RuleMapRule[];
  knownWeaknesses?: string[];
}

export interface GlobEntry {
  doc: string;
  glob: string;
  re: RegExp;
}

export interface AuditDocContext {
  ruleWordCountById: Map<string, number>;
  migrationComplete: boolean;
  errors: string[];
  info: string[];
  docDir?: string;
}

export function escapeRegexChar(ch: string): string;
export function globToRegex(glob: string): RegExp;
export function wordCount(text: string): number;
export function lineCount(text: string): number;
export function splitDoc(content: string): {
  headlineText: string;
  bodyText: string;
  bodyHeadings: Set<string>;
};
export function docFilePath(slug: string, docDir?: string): string;
export function allGlobEntries(manifest: Manifest): GlobEntry[];
export function checkOrphans(files: string[], globEntries: GlobEntry[], errors: string[]): void;
export function checkDeadGlobs(files: string[], globEntries: GlobEntry[], errors: string[]): void;
export function checkUnfiledRules(manifest: Manifest, ruleMap: RuleMap, errors: string[]): void;
export function auditDoc(doc: ManifestDoc, ctx: AuditDocContext): void;
export function checkOverCap(
  hasMarker: boolean,
  lines: number,
  manifest: Manifest,
  ruleMapSourceLines: number,
  errors: string[]
): void;
export function main(): void;
