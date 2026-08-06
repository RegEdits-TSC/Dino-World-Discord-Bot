import type { Species, Rarity } from '../types.js';
import { triceratops } from './triceratops.js';
import { velociraptor } from './velociraptor.js';
import { gallimimus } from './gallimimus.js';
import { dryosaurus } from './dryosaurus.js';
import { compsognathus } from './compsognathus.js';
import { struthiomimus } from './struthiomimus.js';
import { othnielia } from './othnielia.js';
import { microceratus } from './microceratus.js';
import { nasutoceratops } from './nasutoceratops.js';
import { stegosaurus } from './stegosaurus.js';
import { parasaurolophus } from './parasaurolophus.js';
import { dilophosaurus } from './dilophosaurus.js';
import { iguanodon } from './iguanodon.js';
import { maiasaura } from './maiasaura.js';
import { pachycephalosaurus } from './pachycephalosaurus.js';
import { ouranosaurus } from './ouranosaurus.js';
import { carnotaurus } from './carnotaurus.js';
import { baryonyx } from './baryonyx.js';
import { allosaurus } from './allosaurus.js';
import { ankylosaurus } from './ankylosaurus.js';
import { ceratosaurus } from './ceratosaurus.js';
import { brachiosaurus } from './brachiosaurus.js';
import { spinosaurus } from './spinosaurus.js';
import { therizinosaurus } from './therizinosaurus.js';
import { giganotosaurus } from './giganotosaurus.js';
import { tyrannosaurus } from './tyrannosaurus.js';
import { mosasaurus } from './mosasaurus.js';
import { quetzalcoatlus } from './quetzalcoatlus.js';
import { indominus } from './indominus.js';
import { indoraptor } from './indoraptor.js';
import { archelon } from './archelon.js';
import { elasmosaurus } from './elasmosaurus.js';
import { tylosaurus } from './tylosaurus.js';
import { kronosaurus } from './kronosaurus.js';
import { ankylodocus } from './ankylodocus.js';
import { scorpiosRex } from './scorpios_rex.js';
import { stegoceratops } from './stegoceratops.js';
import { liopleurodon } from './liopleurodon.js';
import { spinoraptor } from './spinoraptor.js';
import { ultimasaurus } from './ultimasaurus.js';
import { cryolophosaurus } from './cryolophosaurus.js';
import { nanuqsaurus } from './nanuqsaurus.js';

const ALL: Species[] = [
  triceratops, gallimimus, dryosaurus, compsognathus, struthiomimus, othnielia, microceratus, nasutoceratops,
  stegosaurus, parasaurolophus, dilophosaurus, iguanodon, maiasaura, pachycephalosaurus, ouranosaurus,
  velociraptor, carnotaurus, baryonyx, allosaurus, ankylosaurus, ceratosaurus,
  archelon, elasmosaurus, tylosaurus,
  brachiosaurus, spinosaurus, therizinosaurus, giganotosaurus,
  kronosaurus, ankylodocus, scorpiosRex, stegoceratops,
  tyrannosaurus, mosasaurus, quetzalcoatlus,
  liopleurodon, spinoraptor,
  indominus, indoraptor, ultimasaurus,
  cryolophosaurus, nanuqsaurus,
];
const REGISTRY = new Map<string, Species>(ALL.map((s) => [s.id, s]));

export function getSpecies(id: string): Species {
  const s = REGISTRY.get(id);
  if (!s) throw new Error(`Unknown species: ${id}`);
  return s;
}
export function allSpecies(): Species[] { return [...REGISTRY.values()]; }
export function speciesByRarity(rarity: Rarity): Species[] {
  return ALL.filter((s) => s.rarity === rarity);
}
