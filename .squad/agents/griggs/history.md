# Griggs — History

## Context
- **Project:** Browser roguelike dungeon crawler (HTML5 Canvas, vanilla JS, LocalStorage)
- **User:** Ben Leane
- **Task:** Items, loot tables, identification system, inventory management

## Learnings
- **Data model alignment**: `Item` class in `data-model.js` already has `id`, `type`, `subtype`, `name`, `rarity`, `stats`, `identified`, `unidentifiedName`, and `value` fields — used them directly without extending the class.
- **Constants coverage**: `ARMOR_SUBTYPES` has helmet/chest/legs/shield (no boots). `EQUIPMENT_SLOTS` has weapon/helmet/chest/legs/shield (no feet/offhand). Implemented against what's defined rather than adding new constants — that's another agent's territory.
- **Potion subtypes**: `POTION_SUBTYPES` has health/mana/strength/speed (4 types). No stamina potion constant exists, so I matched what constants.js provides.
- **Entity stat mutation**: `Entity` stores base stats directly (attack, defense, speed). Equipment bonuses are applied/unapplied on equip/unequip by mutating these values. Buff potions push to `statusEffects` array so they can be ticked down by the combat system.
- **Identification architecture**: Session-level maps (`unidentifiedNameMap`, `identifiedSubtypes`) live in module scope. Serialize/restore functions provided for save/load integration. `initIdentificationSystem()` must be called at game start.
### 2026-02-24 — Integration Summary

**From Solaire (data model):**
- `Item` class already has all needed fields: id, type, subtype, rarity, stats, identified, unidentifiedName
- Equipment slots work: `EQUIPMENT_SLOTS` is weapon/helmet/chest/legs/shield (no boots/offhand)
- Rarity multipliers apply to item.stats[stat] directly

**Cross-agent dependencies:**
- Combat (Patches) calls `generateLootDrop(floor, enemyType)` on enemy death (40% base rate)
- Combat calls `getTotalEquippedAttack(entity)` / `getTotalEquippedDefense(entity)` for damage formulas
- Dungeon (Siegmeyer) calls `generateItem(floor)` during `spawnItems` hook phase
- Renderer (Laurentius) calls `getDisplayName(item)` for all item display to respect identification
- Game loop calls `initIdentificationSystem()` at new game start and `serializeIdentificationState()` / `restoreIdentificationState()` for saves

**Identification protocol:** Module-scoped `unidentifiedNameMap` persists across session. Consumables auto-identify on use; Scroll of Identify reveals all in inventory.

### 2025-07 — Pickup Action Handler Fix

**Problem:** The `,`/`g` key binding in game.js dispatched `{ type: 'pickup' }` but no hook handler existed to process it. items.js was never imported by game.js, so even its exports were unreachable at runtime.

**Root causes fixed:**
1. `src/items.js` had no `registerHook('playerAction', ...)` — added `handlePlayerAction` that checks the player's tile for items, picks them all up (respecting 20-slot cap), and logs messages.
2. `src/game.js` did not import `items.js` in its specialist module loader — added `import('./items.js')` to the `Promise.all` block.
3. `src/combat.js` `dropEnemyLoot` was hardcoded to a 40% health potion instead of using the full loot table system — replaced with `generateLootDrop(floor, enemyType)` from items.js.

**Key pattern:** The hook system requires both (a) the module being dynamically imported by game.js AND (b) the module calling `registerHook()` at module scope. Missing either side breaks the chain silently.

**Files modified:** `src/items.js`, `src/game.js`, `src/combat.js`
