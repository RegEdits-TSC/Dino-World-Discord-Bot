import type { PaddockDef } from './types.js';

// Null prototype, not a plain object literal: a client-supplied kind reaches this table
// through the Lots tab's Build select, and on a normal literal PADDOCKS['constructor']
// resolves up the chain to Object and reads back truthy. Nine raw index sites exist across
// src/; this kills the class at every one of them, and turns upgradeCostFor's silent NaN
// (`PADDOCKS[kind].buildCost` on a prototype key) into a loud TypeError at the read.
// The `as` and the `satisfies` are both required: Object.create(null) is `any`, so a bare
// Object.assign(Object.create(null), {...}) returns `any` and the literal silently loses
// its PaddockDef check — a typo in a buildCost would stop being a type error.
export const PADDOCKS: Record<string, PaddockDef> = Object.assign(
  Object.create(null) as Record<string, PaddockDef>,
  {
    herbivore_paddock: { kind: 'herbivore_paddock', name: 'Herbivore Paddock', diet: 'herbivore', buildCost: 2_000 },
    carnivore_paddock: { kind: 'carnivore_paddock', name: 'Carnivore Paddock', diet: 'carnivore', buildCost: 2_000 },
  } satisfies Record<string, PaddockDef>,
);
