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
- Griggs calls `generateLootDrop()` on enemy death with full loot table (rarity scaling, enemy-type drop chances, guaranteed legendaries from floor 10 bosses)
- Laurentius (renderer) displays HP bars for damaged enemies via Entity.hp < Entity.maxHp

**Turn order:** Game loop fires `playerAction` → `enemyAction` → `statusTick` → `computeFov` → `render`. This ensures all state mutations complete before visibility/UI update.

### 2026-02-24 — Loot Table Integration

**From Griggs (items):**
- `combat.js` now calls `generateLootDrop(floor, enemyType)` from items.js instead of hardcoded loot
- Enemy drops now scale by floor, include rarity tiers, and vary by enemy type
- Strong enemies drop double loot; floor 10 bosses drop guaranteed legendary
- No breaking changes to combat calculations or turn order

### 2026-02-24 — Pixel-Art Sprite System Integration

**From Laurentius (renderer):**
- All entity rendering now uses procedural pixel-art sprites instead of colored squares
- Each entity type has a unique visual signature (3 player classes, 8 enemy types)
- Sprites use Canvas 2D primitives and existing PLAYER_COLORS/ENTITY_COLORS palettes
- HP bars and damage flash remain compatible with new sprite system
- No breaking changes to combat system — sprite rendering is transparent to combat calculations

