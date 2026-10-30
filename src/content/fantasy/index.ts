import { type ContentPack, loadContent } from '../../engine/content';
import factions from './factions.json';
import units from './units.json';

export const fantasy: ContentPack = loadContent({ id: 'fantasy', name: 'Fantasy', units, factions });
