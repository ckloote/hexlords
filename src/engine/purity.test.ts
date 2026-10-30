import { describe, expect, it } from 'vitest';

// CLAUDE.md rule 1: the engine has no DOM, rendering, timers, Date, or Math.random.
const forbidden = [/Math\.random/, /\bDate\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bdocument\b/, /\bwindow\b/, /pixi/i, /\bperformance\b/];

const sources = import.meta.glob<string>(['./*.ts', '!./*.test.ts', '!./test-fixtures.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('engine purity', () => {
  it('finds the engine sources', () => {
    expect(Object.keys(sources)).toContain('./engine.ts');
  });
  for (const [file, src] of Object.entries(sources)) {
    it(`${file} uses no impure APIs`, () => {
      for (const re of forbidden) expect(src, `${file} matches ${re}`).not.toMatch(re);
    });
  }
});
