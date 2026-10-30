# Hexlords

A turn-based fantasy strategy game in the spirit of Warlords (1990): capture cities, build armies, and send heroes into ruins. Built for the browser, phones first.

**Play:** https://ckloote.github.io/hexlords/

**Status:** milestone 4 done: cities and economy. Hot-seat games on the test map now have income, production, upkeep and desertion, healing, city capture with Occupy, Pillage, or Raze, secured cities, victory, and a turn summary. Next up is milestone 5, the AI opponent.

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
