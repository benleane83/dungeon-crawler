# Siegmeyer — History

## Context
- **Project:** Browser roguelike dungeon crawler (HTML5 Canvas, vanilla JS, LocalStorage)
- **User:** Ben Leane
- **Task:** Procedural dungeon generation with BSP, 10 floors, increasing difficulty

## Learnings
- BSP dungeon gen created in `src/dungeon.js` — uses Mulberry32 seeded RNG for deterministic floors.
- Floor scaling: `minLeaf` controls room density (larger = fewer rooms). Floors 1–10 scale from ~4-6 rooms to 10-15.
- Corridor width scales from 3 tiles (floor 1) to 1 tile (floor 10) — impacts difficulty feel significantly.
- Room types (regular/treasure/boss) assigned after BSP; boss rooms on floors 5 and 10 with DRAGON spawns.
- Spawn markers are stored as transient `_spawns` on DungeonFloor so spawnEnemies/spawnItems hooks can read them without polluting serialization.
### 2026-02-24 — Integration Summary

**From Solaire (data model):**
- All classes correctly use `toJSON()`/`fromJSON()` for serialization
- Hook registry (`registerHook`) fires in phase order: `generateFloor` → `spawnEnemies` → `spawnItems` → `playerAction` → `enemyAction` → `statusTick` → `computeFov` → `render` → `cleanup`
- Tile.entityId occupancy system prevents collisions; spawn markers work correctly

**Cross-agent dependencies:**
- Patches (combat) scales enemy stats via `FLOOR_DIFFICULTY` from constants
- Griggs (items) uses weighted pools from constants; rarity scales through floor 1→10
- Laurentius (FOV/render) uses tile visibility flags; doesn't modify them (FOV does)
- Sieglinde (tests) validates all contracts; 137 passing tests mean all systems integrate correctly

**Spawn marker protocol works:** Dungeon sets `_spawns` (transient), Combat/Items read `tile._enemySpawn`/`tile._itemSpawn` on those tiles to create Entity/Item instances with appropriate stats.
