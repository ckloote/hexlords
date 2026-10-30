import { describe, expect, it } from 'vitest';
import { fantasy } from '../content/fantasy';
import themeJson from '../content/fantasy/theme.json';
import { loadTheme } from './theme';

describe('theme', () => {
  it('colors every terrain, feature, and faction in the content pack', () => {
    const theme = loadTheme(themeJson, fantasy);
    for (const id of Object.keys(fantasy.terrain)) expect(theme.terrain[id]).toMatch(/^#[0-9A-F]{6}$/i);
    for (const id of Object.keys(fantasy.factions)) {
      expect(theme.factions[id]!.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(['rounded-square', 'diamond', 'circle', 'triangle']).toContain(theme.factions[id]!.shape);
    }
    expect(theme.features.ford).toBe('#7FA7C2');
  });

  it('rejects a theme missing a terrain or with a bad shape', () => {
    const bad = JSON.parse(JSON.stringify(themeJson)) as typeof themeJson;
    delete (bad.terrain as Record<string, string>).swamp;
    expect(() => loadTheme(bad, fantasy)).toThrow(/swamp/);
    const shape = JSON.parse(JSON.stringify(themeJson)) as { factions: Record<string, { shape: string }> };
    shape.factions.elves!.shape = 'star';
    expect(() => loadTheme(shape, fantasy)).toThrow(/star/);
  });
});
