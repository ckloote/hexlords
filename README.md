# Hexlords

A turn-based fantasy strategy game in the spirit of Warlords (1990): capture cities, build armies, and send heroes into ruins. Built for the browser, phones first.

**Play:** https://ckloote.github.io/hexlords/

**Status:** milestone 1 done: rules engine core (seeded RNG, content pack, modifiers, exact combat odds, battles with retreat and pursuit). Next up is milestone 2, map and movement.

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
