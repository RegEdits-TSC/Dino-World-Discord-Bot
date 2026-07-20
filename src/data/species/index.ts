import type { Species } from '../types.js';
import { triceratops } from './triceratops.js';
import { velociraptor } from './velociraptor.js';

const REGISTRY = new Map<string, Species>([triceratops, velociraptor].map(s => [s.id, s]));

export function getSpecies(id: string): Species {
  const s = REGISTRY.get(id);
  if (!s) throw new Error(`Unknown species: ${id}`);
  return s;
}
export function allSpecies(): Species[] { return [...REGISTRY.values()]; }
