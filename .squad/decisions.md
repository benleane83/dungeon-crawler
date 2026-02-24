# Decisions

> Canonical decision ledger. Append-only. Managed by Scribe.

---

## Decision: Shared Data Model Architecture

**Author:** Solaire (Lead Architect)  
**Date:** 2025-02-24  
**Status:** Accepted  

### Context
Four developers will build simultaneously against shared interfaces. We need a data model that prevents conflicts, is serializable for save/load, and is simple enough for a vanilla JS project with no build tools.

### Decision

#### Module structure
- **Flat `src/` directory** — no nesting. Each specialist owns exactly one file.
- **ES6 modules** loaded via `<script type="module">`. No bundler.
- **Two shared files** that all modules import from:
  - `src/constants.js` — enums, config, ability definitions (frozen objects)
  - `src/data-model.js` — classes: GameState, DungeonFloor, Tile, Room, Entity, Item

#### Data flow
- `src/game.js` owns the single `GameState` instance.
- Specialist modules call `registerHook(event, fn)` to plug into the turn loop.
- Modules receive `state` by reference — they read and mutate it directly.
- Tile grid uses `tiles[y][x]` (row-major) with tile↔entity/item cross-references.

#### Serialization
- Every class implements `toJSON()` and `static fromJSON()`.
- Save = `JSON.stringify(state.toJSON())` → LocalStorage.
- Permadeath: save is consumed on load, deleted on death.

#### Key interfaces for specialists

**Siegmeyer (dungeon.js):** Register `generateFloor` hook. Receives `(state, floorNumber)`. Must populate `state.dungeonFloor` with rooms, corridors, stairs. Use `DungeonFloor.setTile()` to carve.

**Patches (combat.js):** Register `playerAction`, `enemyAction`, `statusTick`, `cleanup` hooks. Use `Entity` stats, abilities, statusEffects. Use `GameState.addEntity/removeEntity`.

**Griggs (items.js):** Register `spawnItems` hook. Create `Item` instances with identification flag. Use `GameState.addItem/removeItem`. Loot tables keyed by floor number × `FLOOR_DIFFICULTY`.

**Laurentius (renderer.js + fov.js):** Register `render` and `computeFov` hooks. Read `state.dungeonFloor.tiles` for visibility/explored flags. Use `TILE_COLORS` and `ENTITY_COLORS` from constants. Viewport is 25×19 tiles centered on player.

### Consequences
- All modules can be developed in parallel with zero merge conflicts (separate files).
- Adding new tile types, enemy types, or item types only requires updating `constants.js`.
- No runtime type checking — we rely on JSDoc and convention. Worth the tradeoff for simplicity.

---

## Decision: Dungeon Generation Architecture

**Author:** Siegmeyer  
**Date:** Auto  
**Status:** Implemented

### Context
Needed to design the BSP dungeon generator to integrate with Solaire's data model and the game.js hook system.

### Decisions

#### 1. Spawn markers via transient `_spawns` property
Enemy and item spawn positions are stored as a `_spawns` array on `DungeonFloor` — a non-serialized, transient property. This lets the `spawnEnemies` and `spawnItems` hooks read the markers without polluting the save format. Other modules (Laurentius for items, Griggs for combat/AI) should read `tile._enemySpawn` and `tile._itemSpawn` to create actual Entity/Item instances.

#### 2. Seeded RNG (Mulberry32)
`utils.js` only has `Math.random()`-based helpers. I added a `SeededRNG` class inside `dungeon.js` using Mulberry32 so generation is deterministic when given a seed. If the team wants shared seeded random, this class could be extracted to utils.js.

#### 3. Enemy pool per floor tier
Rather than spawning all enemy types everywhere, the pool expands with depth. This keeps early floors approachable and deep floors menacing. The pool is defined in `getEnemyPool()` — other modules should respect `tile._enemySpawn.enemyType` when creating entities.

#### 4. Boss rooms on floors 5 and 10 only
Boss rooms spawn a single DRAGON enemy. The room type is tagged so combat/AI modules can apply special behavior (e.g., boss health bars, locked doors).

### Impact
- **Laurentius (items):** Should read `tile._itemSpawn.roomType` to decide rarity — treasure rooms should yield better loot.
- **Griggs (combat/AI):** Should read `tile._enemySpawn` to create Entity instances with stats scaled by `FLOOR_DIFFICULTY`.
- **Sieglinde (renderer):** Room types could be rendered with different floor colors if desired.

---

## Decision: Combat System Decisions — Patches

**Date:** 2025-01-20  
**Module:** `src/combat.js`

### Key Decisions

#### 1. Bump-to-Attack
Player 'move' actions double as melee attacks when targeting an occupied tile. This follows roguelike convention and keeps input handling in game.js simple.

#### 2. Auto-Targeting for Abilities
Abilities (keys 1-3) auto-target the nearest enemy. This avoids a mouse-targeting UI for the MVP. Future work: add directional targeting with shift+direction.

#### 3. AI Behavior as Data
Enemy behavior type (aggressive/flanker/cautious/ranged) is stored in `ENEMY_TEMPLATES` alongside stats, not as separate AI classes. This keeps everything in one module and makes floor scaling straightforward.

#### 4. Greedy Pathfinding
Used single-step greedy movement (pick the neighboring tile closest to target) instead of A*. Sufficient for small rooms and corridors; A* would be overkill and expensive for many enemies.

#### 5. Status Effect Stacking
Status effects refresh duration rather than stacking. This prevents poison/burn from being overpowered with repeated applications.

#### 6. Damage Formula
`(base_attack + weapon_bonus + ability_damage - target_armor) × variance(0.8–1.2)`, minimum 1. Simple, transparent, and easy to balance.

#### 7. War Cry vs Battle Cry Naming
Constants define it as `war_cry`; the task spec says "Battle Cry". Used `war_cry` ID to match constants.js but the log message says "Battle Cry" for player-facing text. Same for `poison_dagger` vs "Poison Dart" and `teleport` vs "Heal" — constants.js is the source of truth for ability definitions.

#### 8. Boss Enemies
Floor 5 gets an "Ogre King" (buffed Orc, ×2.5 HP, ×1.8 ATK). Floor 10 gets an "Ancient Dragon" using the dragon template. Both use the same factory pattern with multipliers.

#### 9. Loot Drops
Minimal loot system: 40% chance to drop a health potion on enemy death. Full loot tables are the Items Dev's responsibility.

### Open Questions
- Should abilities have cooldowns? The `cooldowns` field exists on Entity but isn't used yet.
- Ranged weapon attacks (bows) need integration with the items system.
- XP curve (×1.5 per level) may need tuning after playtesting.

---

## Decision: Items System Architecture — Griggs

**Date:** 2025-01-20  
**Author:** Griggs (Items Dev)  
**Status:** Implemented

### What was decided

Created `src/items.js` as the complete item, loot, and inventory system with the following architecture:

#### Item Definitions
- **5 weapons** (Sword, Axe, Staff, Dagger, Bow) with base damage, range, speed stats
- **4 armor pieces** (Helmet, Chestplate, Greaves, Shield) matching `ARMOR_SUBTYPES` and `EQUIPMENT_SLOTS`
- **4 potions** (Health, Mana, Strength buff, Speed buff) matching `POTION_SUBTYPES`
- **5 scrolls** (Fireball, Teleport, Identify, Map Reveal, Enchant) matching `SCROLL_SUBTYPES`

#### Rarity System
- 4 tiers: Common (1.0x), Uncommon (1.3x), Rare (1.7x), Legendary (2.5x)
- Multipliers apply to base damage/defense/effect values
- Display prefixes: Fine, Superior, Legendary

#### Loot Tables
- Floor-based weighted rarity rolls (e.g. floors 1-3 = 70% common, 25% uncommon, 5% rare)
- Floor 10 guaranteed rare+, boss enemies always drop legendary
- Enemy-type drop chances (rat 20% → dragon 90%)
- Strong enemies have 15% chance of double drops

#### Identification System
- Module-level `unidentifiedNameMap` randomized per session via `initIdentificationSystem()`
- Potions/scrolls start unidentified with randomized display names
- Using any unidentified consumable auto-identifies that subtype for the run
- Scroll of Identify reveals all unidentified items in inventory
- Weapons/armor always identified
- Serialize/restore functions for save compatibility

#### Inventory
- 20-slot cap (`MAX_INVENTORY_SLOTS`)
- Equip/unequip with automatic stat application/removal
- Slot swap when equipping over existing gear
- Use (consume), drop, pickup functions

### Why

Aligned entirely with the shared data model in `data-model.js` and constants in `constants.js`. No new constants or data model changes needed — the existing `Item` class and enum values were sufficient.

### Impact on other agents
- **Combat system** should call `generateLootDrop(floor, enemyType)` on enemy death and `getWeaponRange()` / `getTotalEquippedAttack()` / `getTotalEquippedDefense()` for combat calculations.
- **Dungeon generation** should call `generateItem(floor)` during `spawnItems` hook to scatter floor loot.
- **Game loop / input** should call `initIdentificationSystem()` at new game start, and wire pickup/use/equip/drop through player action handling.
- **Renderer** should call `getDisplayName(item)` for all item display to respect identification state.
- **Save/load** should call `serializeIdentificationState()` / `restoreIdentificationState()` alongside `GameState` serialization.

---

## Decision: Renderer & FOV Architecture

**Author:** Laurentius (Renderer Dev)  
**Date:** 2025-01-20  
**Status:** Implemented

### Context
Needed a complete FOV system and Canvas rendering engine for the dungeon crawler.

### Decisions

#### FOV (src/fov.js)
- **Algorithm:** Recursive shadowcasting with 8 octant transforms. Chosen for clean symmetric results and good performance on 80×50 grids.
- **Vision radius:** Configurable per class via CLASS_VISION_RADIUS map. Rogues get +2 tiles (10 vs 8). Warriors and Mages get the default FOV_RADIUS (8).
- **Visibility states:** Three-state model using existing Tile flags (`visible`, `explored`). Unexplored = never seen, explored = previously seen, visible = currently in FOV.
- **Hook:** Registers on `computeFov` — called by game loop before render.

#### Renderer (src/renderer.js)
- **Viewport:** Uses VIEWPORT_WIDTH_TILES × VIEWPORT_HEIGHT_TILES from constants (25×19). Camera centers on player, clamped to map edges.
- **Scrolling:** Instant snap (no lerp smoothing) — simpler and appropriate for turn-based gameplay.
- **Fog of war:** Unexplored = solid black, explored = full tile color with 50% black overlay, visible = full color.
- **Entity rendering:** Inset squares (4px margin) with class-based colors for player, ENTITY_COLORS for enemies. Enemies show a thin HP bar when damaged.
- **Items:** Rendered as small colored dots on visible tiles (max 3 per tile). Colors keyed by ITEM_TYPES.
- **UI overlays on canvas:** Stat bars (HP/MP/SP bottom-left), floor indicator (top-right), minimap (2px/tile, explored areas only), message log (top, last 5 messages), inventory panel (centered modal, toggled with 'I').
- **Damage flash:** Simple red flash effect via `flashTile()` export — alpha fades out over frames.
- **Hook:** Registers on `render` (main draw) and `cleanup` (syncs game log to message overlay).

### Integration
- Both modules imported in game.js via side-effect imports at the bottom of the file (`import './fov.js'` and `import './renderer.js'`).
- No changes to index.html needed — game.js is already the entry point.

### Dependencies
- Reads from: constants.js (TILE_COLORS, ENTITY_COLORS, FOV_RADIUS, TILE_SIZE, etc.), data-model.js (Tile, DungeonFloor, Entity, GameState)
- Does NOT implement: dungeon generation, combat, items

---

## Decision: Test Suite Architecture

**Author:** Sieglinde (Tester)  
**Date:** 2025-01-20  
**Status:** Implemented

### Context
The project is a vanilla JS browser game with ES module source files. We need a test suite that runs in Node.js without a build step or external dependencies.

### Decisions

#### 1. Custom test runner over external framework
Used a zero-dependency `tests/test-runner.js` with describe/it/assert pattern. Keeps the project dependency-free and avoids version conflicts. Tradeoff: no watch mode, no coverage, no parallel execution — acceptable for this project size.

#### 2. ESM-to-CJS loader shim
Built `tests/loader.js` that transpiles ES module syntax to CommonJS at load time using regex rewrites and `new Function()` evaluation. Constants are injected into data-model scope as function parameters. This avoids needing `--experimental-vm-modules` or a bundler.

#### 3. Contract testing for unimplemented modules
Dungeon generation, combat, items, and FOV modules aren't fully implemented yet. Tests validate the *expected interface and invariants* (e.g., "stairs must be on walkable tiles", "each class has 3 abilities") using the data model and simulation helpers. When real modules land, these tests catch violations immediately.

#### 4. Test file structure
- `data-model.test.js` — Core data classes (137 assertions covering serialization round-trips)
- `dungeon.test.js` — Generation contracts (dimensions, bounds, connectivity, stairs, scaling)
- `combat.test.js` — Damage formulas, abilities, AI retreat behavior, permadeath, turn order
- `items.test.js` — Loot tables, identification system, inventory limits, equipment slots, rarity
- `fov.test.js` — Visibility, wall blocking, explored state persistence, radius enforcement

#### 5. No mocking framework
Helper functions simulate game logic (damage calculation, FOV raycasting, loot generation) to test contracts. When real implementations arrive, tests should switch to importing actual modules — the loader already supports this.

### Risks
- Regex-based ESM rewriting is fragile; complex export patterns (re-exports, default exports) may break it. Mitigated by keeping source files simple.
- Contract tests may drift from actual implementations. Mitigated by testing against the shared data model constants.

---
