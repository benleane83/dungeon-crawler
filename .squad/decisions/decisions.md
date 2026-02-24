# Decisions

## 1. Help Overlay Pattern

**Author:** Laurentius (Renderer Dev)  
**Date:** 2026-02-24  
**Status:** Implemented

### Context
The game log displayed "Press ? for help" but pressing ? did nothing.

### Decision
Added a help overlay in src/renderer.js using the same pattern as the inventory panel:
- helpOpen boolean toggled by ? key in handleRendererKey
- enderHelp() draws a centered modal with all keybindings
- Handled entirely in renderer.js — no game.js changes needed

### Impact
- All UI overlay toggles (I for inventory, ? for help) live in handleRendererKey in renderer.js
- Future overlays should follow this same pattern: state boolean + key handler + render function

---

## 2. Pickup Action Handler + Loot Table Integration

**Author:** Griggs (Items Dev)  
**Date:** 2025-07  
**Status:** Implemented

### Context
The player could press , or g to trigger a pickup action, but nothing happened. The action was dispatched by game.js but no hook handler existed to process it. Additionally, enemy loot drops bypassed the full loot table system.

### Changes

#### 1. Added playerAction hook in items.js
- New handlePlayerAction(gameState, action) handles 	ype: 'pickup'
- Iterates all 	ile.itemIds on the player's current tile
- Calls existing pickupItem() for each, respecting the 20-slot inventory cap
- Logs "Picked up {item name}" or "Inventory is full!" or "Nothing to pick up here."
- Registered via egisterHook('playerAction', handlePlayerAction)

#### 2. Added items.js to game.js module loader
- import('./items.js') added to the Promise.all specialist import block
- Without this, items.js never loads and its hooks never register

#### 3. Replaced hardcoded loot drops in combat.js
- dropEnemyLoot now calls generateLootDrop(floor, enemyType) from items.js
- This enables the full loot table system: rarity scaling by floor, enemy-type drop chances, double drops for strong enemies, guaranteed legendary from floor 10 bosses
- combat.js imports generateLootDrop from items.js

### Impact
- **Players:** Can now pick up items with ,/g keys. Enemy drops use the full variety of weapons, armor, potions, and scrolls instead of just health potions.
- **Patches (combat):** combat.js now has a dependency on items.js for generateLootDrop. No circular import issue since items.js imports from game.js (not combat.js).
- **All agents:** The pattern of "module must be in game.js Promise.all AND call registerHook" is now documented as a common pitfall.
