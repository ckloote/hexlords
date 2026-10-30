# Hexlords

A turn-based fantasy strategy game in the spirit of Warlords (1990), built for the browser with phones (portrait) first. The proof of concept is single-player against AI; multiplayer and genre reskins come later, so the architecture has to allow them from day one.

- **Design (source of truth):** `docs/DESIGN.md` holds every rule and starting number. If the code needs a rule the doc doesn't cover, or a doc rule looks wrong, say so in your summary or PR instead of silently inventing or changing it. Numbers are starting values for tuning; rules are decisions.
- **UI mockups:** `docs/mockups/*.dc.html`, six portrait phone screens (390×844). They come from a design tool: read them as HTML for layout, copy, colors, and sizes. `<dc-import name="MapTerrain">` stands for the contents of `MapTerrain.dc.html`.
- **Combat oracle:** `docs/reference/combat_reference.py` reproduces every odds number in the design. The engine's tests must match it.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml` (install, test, build) and publishes `dist/` to GitHub Pages at https://ckloote.github.io/hexlords/. Pull requests run the same build and tests without deploying.

- Keep `main` deployable: run `npm test` and `npm run build` before pushing.
- Vite's `base` is `/hexlords/`; use relative or `import.meta.env.BASE_URL` paths for assets.
- The page footer shows the build's commit SHA (from `VITE_BUILD_SHA`), which is how to confirm what Pages is serving. Keep a build stamp somewhere unobtrusive as the UI grows.

## Commands

```
npm install
npm run dev        # local dev server
npm test           # vitest, once
npm run test:watch
npm run build      # type-check, then production build to dist/
```

## Architecture rules (non-negotiable)

1. **Pure engine.** `src/engine/` is plain TypeScript with no DOM, PixiJS, timers, `Date`, or `Math.random`. Its core is `applyCommand(state, command) → { state } | { error }`.
2. **Deterministic.** Randomness comes from a small seeded PRNG whose state lives inside the game state, so any game can be replayed from its seed and command log.
3. **Serializable state.** Game state is plain JSON-safe data (no classes, Maps, or functions). Commands are data too: Move, Attack, SetProduction, SetStance, Split, Merge, Explore, EndTurn, and so on.
4. **Theme-agnostic engine.** The engine uses neutral terms (commander, site, stack) and generic tags (`forest-native`, `mountain-walker`, `regenerates`, `leads-stack`, `flying`, `siege`). Names, stats, and art live in a content pack, `src/content/fantasy/`, as JSON. A reskin must need no engine changes.
5. **One exact odds function.** A memoized recursion over (attacker unit index, its hits, defender unit index, its hits) gives win probability and expected survivors. The odds preview, the AI, and in-battle retreat checks all use it. Actual battles sample the seeded RNG.
6. **The AI is just a player.** It issues the same commands as the UI and reads only `viewFor(state, playerId)`, the fog-filtered view a multiplayer server would send. It runs in a Web Worker.

Suggested layout: `src/engine/` (rules), `src/content/` (data packs), `src/ai/`, `src/ui/` (PixiJS map renderer plus HTML panels), `src/main.ts`. Tests sit next to the code as `*.test.ts`.

## Stack

- Vite, TypeScript (strict), Vitest, npm.
- PixiJS v8 for the map canvas (add it when the UI milestone starts).
- Panels are HTML. Plain DOM or Preact, whichever stays simplest; keep the bundle small for phones.
- PWA (manifest plus service worker) in a later milestone.

## Milestones

Each milestone should end with green tests, a working deploy, and a short summary of what changed and any design questions it raised.

1. **Engine core and combat.** Types, seeded PRNG, content loading for units and factions, modifiers (additive percentages, +50% cap per side, half-Strength floor), fight order, battle resolution, the exact odds function with expected survivors, win-chance retreat checks, and pursuit with clean breaks. Tests reproduce every value in "Reference values" below.
2. **Map and movement.** Pointy-top hex grid, terrain costs (doubled: road 1, plains 2, forest and hills 4, swamp 6), rivers with bridges and fords, faction movement traits, soft zone of control, pathfinding and reachable sets, vision and fog of war. Load a small handcrafted test map from JSON shaped so Tiled exports can feed it later.
3. **Playable slice.** Replace the splash page with the portrait UI from the mockups: map rendering, pan and zoom, top bar, bottom panel, select a stack, reach and zone-of-control overlays, two-tap move, the odds card, and attacking. Hot-seat or a do-nothing opponent is fine here.
4. **Cities and economy.** Income, production, upkeep and desertion, capture choices (occupy, pillage, raze), secured cities, victory conditions, last stand, elimination, and the turn summary.
5. **AI opponent.** Utility scoring in gold as described in DESIGN.md, running in a Web Worker, plus a headless AI-vs-AI runner (a Node script) for balance testing.
6. **Heroes and sites.** Leadership, ruins and guardians, fleeing, temples, items, allies, leveling, hiring.
7. **Polish.** PWA install, faction traits and unique units, desktop layout and keyboard shortcuts, battle animation.

## Reference values

Win probability for the attacker, fighting to the end; every unit has 2 hits unless noted. Units are written Strength/Hits.

| Case | Expected |
| --- | --- |
| Duel 5 vs 4 | 0.5830 |
| Duel 6 vs 4 | 0.6480 |
| Duel 9 vs 3 | 0.8438 |
| Duel 6 vs 4, 1 hit each | 0.6000 |
| Duel 6 vs 4, 3 hits each | 0.6826 |
| 8 × Str 4 vs 4 × Str 8 | 0.5193 |
| 8 × Str 3 vs 3 × Str 6 | 0.7514 |
| 4 × Str 4 vs 4 × Str 4 with defender +25% (Str 5) | 0.3304 |
| 4 × Str 4 vs 4 × Str 4 with defender +50% (Str 6) | 0.2131 |
| Hero 5/3 vs guardian 4/2 | 0.7659 |
| Hero 5/3 vs guardian 6/3 | 0.4152 |
| Hero 5/3 vs guardian 8/3 | 0.2912 |
| Hero 6/4 vs guardian 4/2 | 0.9130 |
| Hero 6/4 vs guardian 6/3 | 0.6562 |
| Hero 6/4 vs guardian 8/3 | 0.5148 |

**Gravelmaw attack** (the mockups' example). Attackers carry +25% hero leadership; the defenders' +25% city walls are cancelled by the attacker's siege engine.

- Attackers (effective Strength/Hits, Move): Siege engine 2.5/2 M6, Infantry 5/2 M8, Infantry 5/1 M8 (wounded), Ironguard 6.25/3 M6, hero 6.25/3 M10.
- Defenders: Militia 2/2, Militia 2/2, Infantry 4/2, Infantry 4/2, Troll 5/3, all M8.

| Retreat setting | Win | Withdraw | Destroyed | Attackers alive (expected) | Defenders alive (expected) |
| --- | --- | --- | --- | --- | --- |
| Hold | 0.8062 | 0 | 0.1938 | | |
| Withdraw below 30% | 0.7891 | 0.0738 | 0.1371 | 1.494 | 0.345 |

**Field battles with a defender on Fall back** (thresholds are win chances; the attacker's check runs first).

| Battle | Win | Defender withdraws | Attacker withdraws | Destroyed | Attackers alive | Defenders alive |
| --- | --- | --- | --- | --- | --- | --- |
| 3 × 4/2 M12 + 2 × 4/2 M8 (Hold) vs 5 × 5/2 M8, Fall back 30% | 0.0931 | 0.2832 | 0 | 0.6237 | 1.122 | 1.985 |
| 4 × 4/2 M8 (Hold) vs 4 × 4/2 M12, Fall back 30% (clean break) | 0.0978 | 0.5330 | 0 | 0.3693 | 1.929 | 1.955 |
| 4 × 4/2 vs 4 × 4/2, attacker 30%, Fall back 30% | 0.0264 | 0.4736 | 0.4736 | 0.0264 | 2.846 | 2.846 |

**Pursuit strikes** (all M8 unless noted; cavalry 4/2 M12; Horse Archers 3/2 M12 with 2 pursuit strikes). Pursuit that kills every withdrawing unit counts as Destroyed (or Win, when the defender withdrew).

| Battle | Win | Defender withdraws | Attacker withdraws | Destroyed | Attackers alive | Defenders alive |
| --- | --- | --- | --- | --- | --- | --- |
| 4 × 4/2, withdraw below 50%, vs 3 × 4/2 + 2 cavalry | 0.0684 | 0 | 0.9219 | 0.0098 | 2.978 | 4.135 |
| Same, but the cavalry strike twice | 0.0684 | 0 | 0.9180 | 0.0137 | 2.748 | 4.135 |
| 4 × 4/2, withdraw below 50%, vs 3 × 4/2 + 2 Horse Archers | 0.1093 | 0 | 0.8752 | 0.0155 | 2.764 | 3.812 |
| 3 Horse Archers + 2 × 4/2 (Hold) vs 4 × 4/2, Fall back 50% | 0.0168 | 0.8590 | 0 | 0.1242 | 3.764 | 2.762 |

The exact retreat and pursuit semantics behind these numbers are in the docstring of `docs/reference/combat_reference.py`; match them. Not modelled there yet: retreat-hex availability (a side with no legal retreat hex skips its check; milestone 2).

## Working style

- Small, focused commits with clear messages.
- Prefer tests over manual checks, especially for the engine; the reference values above are the first tests to write.
- Don't add dependencies the milestone doesn't need.
- When finishing a milestone, update the README's status line.
