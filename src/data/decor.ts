export interface DecorDef { kind: string; name: string; biomeTags: string[]; cost: number }
export const DECOR: Record<string, DecorDef> = {
  palm_tree:  { kind: 'palm_tree', name: 'Palm Tree', biomeTags: ['forest'], cost: 500 },
  fern:       { kind: 'fern', name: 'Fern Cluster', biomeTags: ['forest', 'swamp'], cost: 500 },
  boulder:    { kind: 'boulder', name: 'Boulder', biomeTags: ['plains'], cost: 500 },
  grass_tuft: { kind: 'grass_tuft', name: 'Grass Tuft', biomeTags: ['plains'], cost: 400 },
  tide_pool:  { kind: 'tide_pool', name: 'Tide Pool', biomeTags: ['coast'], cost: 700 },
  ice_block:  { kind: 'ice_block', name: 'Ice Block', biomeTags: ['tundra'], cost: 700 },
  lava_rock:  { kind: 'lava_rock', name: 'Lava Rock', biomeTags: ['volcanic'], cost: 800 },
  reed_bed:   { kind: 'reed_bed', name: 'Reed Bed', biomeTags: ['swamp'], cost: 600 },
  kelp_bed:          { kind: 'kelp_bed', name: 'Kelp Bed', biomeTags: ['marine'], cost: 900 },
  hydrothermal_vent: { kind: 'hydrothermal_vent', name: 'Hydrothermal Vent', biomeTags: ['marine'], cost: 1_100 },
  containment_fence: { kind: 'containment_fence', name: 'Containment Fence', biomeTags: ['containment'], cost: 1_000 },
  floodlight_rig:    { kind: 'floodlight_rig', name: 'Floodlight Rig', biomeTags: ['containment'], cost: 1_200 },
};
