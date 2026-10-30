# Hexlords

A turn-based fantasy strategy game in the spirit of Warlords (1990): capture cities, build armies, and send heroes into ruins. Built for the browser, phones first.

**Play:** https://ckloote.github.io/hexlords/

**Status:** milestone 2 done: hex map loaded from Tiled JSON, terrain and movement costs, zone of control, pathfinding, vision and fog, and battles on the map (retreat hexes, Evade, advancing). Next up is milestone 3, the playable slice.

- Design: [docs/DESIGN.md](docs/DESIGN.md)
- UI mockups: [docs/mockups/](docs/mockups/)
- Build notes for contributors and coding agents: [CLAUDE.md](CLAUDE.md)

## Development

```
npm install
npm run dev
npm test
npm run build
```

Every push to `main` builds, tests, and deploys to GitHub Pages.
