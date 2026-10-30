# Hexlords

A turn-based fantasy strategy game in the spirit of Warlords (1990): capture cities, build armies, and send heroes into ruins. Built for the browser, phones first.

**Play:** https://ckloote.github.io/hexlords/

**Status:** milestone 3 in progress. The site now shows the test map: pan, zoom, and tap one of your stacks to see its reach and the enemy zone of control. Moving, the odds card, and attacking come next.

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
