# UI mockups

Six portrait phone screens (390×844) covering one turn, exported from the design canvas. They're design-tool files: open them as HTML to read layout, copy, colors, and sizes. They won't render on their own because they rely on the design tool's runtime.

| File | Screen |
| --- | --- |
| `Summary.dc.html` | Turn summary ("while you were away") |
| `Main.dc.html` | Map with the danger overlay, Next stack and End turn buttons |
| `Move.dc.html` | Move preview: reachable hexes, zone of control, two-turn path |
| `Stack.dc.html` | Stack panel: fight order, hit pips, split, stance |
| `Attack.dc.html` | Attack odds card with win-chance withdraw threshold |
| `City.dc.html` | City panel: production, build list, rally point |
| `MapTerrain.dc.html` | The shared hex map layer, imported by the screens via `<dc-import name="MapTerrain">` |

## Design tokens used in the mockups

| Token | Value |
| --- | --- |
| Background | `#15171B` |
| Panel | `#1E2127` |
| Raised panel | `#272B33` |
| Borders | `#2C3038`, `#3A404B` |
| Text | `#ECE7DC` |
| Secondary text | `#B3AC9F` |
| Accent (brass) | `#D4A94F`, text on it `#1A1508` |
| Path highlight | `#F2C55C` |
| Good / danger | `#6CC28A` / `#EE7466` |
| Dwarves | `#5B9BE6`, rounded square |
| Orc Horde | `#E8873F`, diamond |
| Horse Clans | `#B48CE0`, circle |
| Elves | `#7FBF6A`, triangle |
| Terrain | plains `#A7AC78`, forest `#6F8A57`, hills `#B09A6A`, mountains `#8C8781`, swamp `#7E8763`, river `#5C8FB4`, ford `#7FA7C2`, road `#E6D39C` |
| Fonts | Cinzel (titles), Source Sans 3 (UI) |
| Hexes | pointy-top, radius 25 px (about 43 px wide) at default zoom |
| Touch targets | at least 44 px |
