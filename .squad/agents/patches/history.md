# Patches — History

## Context
- **Project:** Browser roguelike dungeon crawler (HTML5 Canvas, vanilla JS, LocalStorage)
- **User:** Ben Leane
- **Task:** Turn-based combat, 3 classes with abilities, enemy AI with flanking/retreat behavior

## Learnings
- The shared data model uses `Entity` with `CLASS_BASE_STATS` and `CLASS_ABILITIES` from constants — no need to redefine class stats, just import them. Entity constructor auto-applies base stats from `classType`.
- `registerHook` is the integration point; game.js fires hooks in phase order: `playerAction → enemyAction → statusTick → cleanup`. Each hook receives `(gameState, ...)` by reference.
- Enemy stats scale via `FLOOR_DIFFICULTY` (1.0 to 3.25 across 10 floors). Boss enemies are built from the same `createEnemy` factory with stat multipliers on top.
### 2026-02-24 — Integration Summary

**From Solaire (data model):**
- Entity base stats initialized from `CLASS_BASE_STATS[classType]`
- Entity abilities come from `CLASS_ABILITIES[classType]` (3 per class, all fully specified)
- Status effects work correctly through `statusTick` hook phase

**Cross-agent dependencies:**
- Dungeon (Siegmeyer) reads enemy pool from `ENEMY_TEMPLATES`; Patches creates Entity instances with these templates + `FLOOR_DIFFICULTY` scaling
- Items (Griggs) mutates Entity.attack/defense on equip/unequip; Patches uses `getTotalEquippedAttack()` for damage formulas
- Griggs calls `generateLootDrop()` on enemy death (40% health potion base rate)
- Laurentius (renderer) displays HP bars for damaged enemies via Entity.hp < Entity.maxHp

**Turn order:** Game loop fires `playerAction` → `enemyAction` → `statusTick` → `computeFov` → `render`. This ensures all state mutations complete before visibility/UI update.
