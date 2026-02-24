# Laurentius — History

## Context
- **Project:** Browser roguelike dungeon crawler (HTML5 Canvas, vanilla JS, LocalStorage)
- **User:** Ben Leane
- **Task:** Canvas rendering, tilemap, fog of war raycasting, UI

## Learnings
- Recursive shadowcasting works well for grid-based FOV — 8 octants with slope tracking gives clean symmetric results
- The data model uses `tile.visible` and `tile.explored` flags directly on Tile objects — FOV module clears/sets these each computation
- TILE_COLORS and ENTITY_COLORS are already defined in constants.js — renderer uses those as the source of truth, only adding PLAYER_COLORS for class-specific coloring and ITEM_DOT_COLORS for item types
- game.js fires `computeFov` before `render` in the game loop, so FOV is always fresh when drawing
- Camera viewport clamping prevents rendering out-of-bounds tiles; minimap uses 2px-per-tile scale for a compact overhead view
### 2026-02-24 — Integration Summary

**From Solaire (data model):**
- `Tile.visible` and `Tile.explored` flags work correctly through `computeFov` hook phase
- Viewport is 25×19 tiles (VIEWPORT_WIDTH_TILES × VIEWPORT_HEIGHT_TILES)
- All colors come from constants: TILE_COLORS, ENTITY_COLORS (no new constants needed)

**Cross-agent dependencies:**
- Dungeon (Siegmeyer) generates floors; Renderer reads `tile._enemySpawn`/`tile._itemSpawn` for icons if desired
- Combat (Patches) moves entities; Renderer reads Tile.entityId + Entity.hp for HP bars
- Items (Griggs) creates items; Renderer calls `getDisplayName(item)` to show identified names
- FOV (recursive shadowcasting) sets tile.visible/explored; Renderer uses these for fog of war
- Game loop fires `computeFov` before `render` so visibility is always fresh

**UI protocol:** Inventory panel toggles with 'I' key; message log shows last 5 messages; stat bars, minimap, floor indicator all on canvas overlays.
