# Siegmeyer Orchestration — 2026-02-24T07:27:28Z

**Status:** Complete  
**Deliverables:** BSP dungeon generator with 10 floors, seeded RNG, room types, spawn markers

## What was done
- Created `src/dungeon.js` with BSP algorithm using Mulberry32 seeded RNG
- Implemented floor scaling: minLeaf 12→6 (floors 1→10), corridor width 3→1
- Room types: regular, treasure, boss (floors 5 and 10 only)
- Spawn markers stored as transient `_spawns` on DungeonFloor (not serialized)
- Enemy pool expands by floor: rats/slimes early → wraiths/dark_mages/dragons deep
- Doors placed at corridor-room boundaries

## Integration points
- Registers `generateFloor` hook with game.js
- `spawnEnemies` and `spawnItems` hooks read `tile._spawns` to place entities
- Other modules read `tile._enemySpawn` and `tile._itemSpawn` to create instances

## Impact
Enemies and items scale seamlessly with floor difficulty via spawn marker templates.
