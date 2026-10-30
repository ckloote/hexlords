import { type ContentPack, loadContent } from '../../engine/content';
import factions from './factions.json';
import testMap from './maps/test-map.json';
import terrain from './terrain.json';
import units from './units.json';

export const fantasy: ContentPack = loadContent({
  id: 'fantasy',
  name: 'Fantasy',
  units,
  factions,
  terrain: terrain.terrain,
  features: terrain.features,
});

/** Raw Tiled JSON of the handcrafted test map; load it with loadTiledMap. */
export const testMapJson: unknown = testMap;
