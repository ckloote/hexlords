import { describe, expect, it } from 'vitest';
import stringsJson from '../content/fantasy/strings.json';
import { MODIFIER_SOURCES } from '../engine/modifiers';
import { loadStrings, OUTCOMES, percent, signedPct } from './strings';

describe('strings', () => {
  it('labels every modifier source, outcome, and stance', () => {
    const s = loadStrings(stringsJson);
    for (const m of MODIFIER_SOURCES) expect(s.modifiers[m]).toBeTruthy();
    for (const o of OUTCOMES) expect(s.outcomes[o]).toBeTruthy();
    expect(s.stances['fall-back']).toContain('{threshold}');
  });

  it('rejects missing labels', () => {
    const bad = JSON.parse(JSON.stringify(stringsJson)) as { modifiers: Record<string, string> };
    delete bad.modifiers.siege;
    expect(() => loadStrings(bad)).toThrow(/siege/);
  });

  it('formats percentages', () => {
    expect(signedPct(25)).toBe('+25%');
    expect(signedPct(-25)).toBe('−25%');
    expect(signedPct(0)).toBe('+0%');
    expect(percent(0.7891)).toBe('79%');
  });
});
