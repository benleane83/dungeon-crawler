# Solaire — History

## Context
- **Project:** Browser roguelike dungeon crawler (HTML5 Canvas, vanilla JS, LocalStorage)
- **User:** Ben Leane
- **Stack:** Vanilla JavaScript, HTML5 Canvas, no frameworks
- **Key features:** 10 floors, 3 classes, permadeath, turn-based combat, fog of war, item identification

## Learnings

### 2025-02-24 — Data Model & Project Structure Established

**Architecture decisions:**
- **Single source of truth**: `src/constants.js` holds all enums/config, `src/data-model.js` holds all shared classes. Every specialist module imports from these — never duplicates definitions.
- **ES6 modules** with flat `src/` directory: no nested folders, no bundler required. `index.html` loads `src/game.js` as `type="module"`.
- **Row-major tile grid**: `tiles[y][x]` for cache-friendly row iteration during rendering and FOV.
- **Hook-based game loop**: `src/game.js` owns the `GameState` singleton and provides `registerHook(event, fn)`. Specialist modules register callbacks for lifecycle events (`generateFloor`, `render`, `computeFov`, `playerAction`, `enemyAction`, `statusTick`, `cleanup`). This avoids circular imports.
- **Full JSON serialization**: Every data class has `toJSON()` / `static fromJSON()`. GameState serializes the entire world for LocalStorage save-on-exit.
- **Tile-entity link**: Tiles hold `entityId` and `itemIds[]` references for O(1) lookup. GameState provides `addEntity/removeEntity/addItem/removeItem` to keep these in sync.
- **Permadeath**: Save is consumed on load; cleared on death. High score table persists separately.
- **Item identification**: `Item.identified` flag + `unidentifiedName` field. Potions/scrolls start unidentified.

**Key file paths:**
- `index.html` — Entry point, canvas + HUD + sidebar + log
- `src/constants.js` — All enums, config values, class stats, ability definitions
- `src/data-model.js` — GameState, DungeonFloor, Tile, Room, Entity, Item, Position
- `src/game.js` — Game loop, input, save/load, hook registry, turn processing
- `src/utils.js` — Random, distance, geometry, cloning helpers

### 2026-02-24 — Sprint Integration Complete

All modules now depend on shared data model from Solaire:
- **Combat system** (Patches) calls items.js for loot drops
- **Dungeon generator** (Siegmeyer) reads spawn markers, other modules create entities from them
- **Items system** (Griggs) equipment bonuses mutate Entity stats directly; identification persists module-scoped
- **Renderer** (Laurentius) reads tile visibility/explored flags set by FOV, displays identified names via items.js
- **Test suite** (Sieglinde) validates contracts across all systems; all 137 tests passing

### 2026-02-24 — Integration Summary

All modules now depend on shared data model from Solaire:
- **Combat system** (Patches) calls items.js for loot drops
- **Dungeon generator** (Siegmeyer) reads spawn markers, other modules create entities from them
- **Items system** (Griggs) equipment bonuses mutate Entity stats directly; identification persists module-scoped
- **Renderer** (Laurentius) reads tile visibility/explored flags set by FOV, displays identified names via items.js
- **Test suite** (Sieglinde) validates contracts across all systems; all 137 tests passing

**Cross-module integration points:**
- Dungeon sets `tile._spawns` → Combat/Items read `tile._enemySpawn`/`tile._itemSpawn` to create instances
- Combat calls `generateLootDrop()` from Items on enemy death with full loot table
- Renderer calls `getDisplayName()` from Items to respect identification state
- All modules use `registerHook()` from game.js to fire in deterministic phase order
- Items module must be loaded in game.js Promise.all and call `registerHook('playerAction', ...)` to register pickup handler

### 2026-02-24 — Pickup and Items Integration

**From Griggs (items):**
- items.js now loaded in game.js `Promise.all` specialist imports
- `playerAction` hook handles pickup dispatch — iterates tile.itemIds and calls pickupItem()
- Combat loot drops now use full `generateLootDrop()` system instead of hardcoded pools
- Common pitfall documented: module must be in game.js Promise.all AND call registerHook

### 2026-02-24 — Pixel-Art Sprite System Integration

**From Laurentius (renderer):**
- All entity rendering now uses procedural pixel-art sprites instead of colored squares
- Each entity type has a unique visual signature (3 player classes, 8 enemy types)
- Sprites use Canvas 2D primitives and existing PLAYER_COLORS/ENTITY_COLORS palettes
- HP bars and damage flash remain compatible with new sprite system
- No changes needed to data model or integration points — rendering layer only

