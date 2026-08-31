// Type declarations for conventions.mjs, so tests/conventions-hook.test.ts
// can import its pure helper functions under `tsc --noEmit -p
// tsconfig.test.json` without turning on `allowJs`. Same precedent as
// scripts/conventions-audit.d.mts (task 2): the .mjs file stays plain,
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

export function normalizeFilePath(rawPath: unknown, repoRoot: string): string | null;
export function matchDocs(manifest: Manifest, relPath: string): ManifestDoc[];
export function stateKey(sessionId: unknown, agentId: unknown): string;
export function loadState(stateDir: string): Record<string, string[]>;
export function saveState(stateDir: string, state: Record<string, string[]>): void;
export function renderDoc(doc: ManifestDoc, docsDir: string): string | null;
export function buildInjection(
  docs: ManifestDoc[],
  docsDir: string
): { text: string; injectedSlugs: string[] };
