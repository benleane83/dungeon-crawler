/**
 * @file constants.js
 * @description Shared constants for the dungeon crawler. Single source of truth
 * for all magic numbers, enumerations, and configuration values.
 * All other modules import from here — never hardcode these values.
 */

// ── Rendering ────────────────────────────────────────────────────────────────

/** Tile size in pixels for the 32×32 grid */
export const TILE_SIZE = 32;

/** Canvas dimensions in tiles */
export const VIEWPORT_WIDTH_TILES = 25;
export const VIEWPORT_HEIGHT_TILES = 19;

// ── Dungeon Generation ───────────────────────────────────────────────────────

/** Maximum number of dungeon floors */
export const MAX_FLOORS = 10;

/** Floor grid dimensions (in tiles) */
export const FLOOR_WIDTH = 80;
export const FLOOR_HEIGHT = 50;

/** BSP split constraints */
export const MIN_ROOM_SIZE = 5;
export const MAX_ROOM_SIZE = 15;
export const MIN_BSP_LEAF = 8;

// ── Tile Types ───────────────────────────────────────────────────────────────

/** @enum {number} */
export const TILE_TYPES = Object.freeze({
  WALL:       0,
  FLOOR:      1,
  CORRIDOR:   2,
  DOOR:       3,
  STAIRS_UP:  4,
  STAIRS_DOWN:5,
});

/** Tile colors for the renderer (keyed by TILE_TYPES value) */
export const TILE_COLORS = Object.freeze({
  [TILE_TYPES.WALL]:        '#333344',
  [TILE_TYPES.FLOOR]:       '#666677',
  [TILE_TYPES.CORRIDOR]:    '#555566',
  [TILE_TYPES.DOOR]:        '#886633',
  [TILE_TYPES.STAIRS_UP]:   '#33aa55',
  [TILE_TYPES.STAIRS_DOWN]: '#aa5533',
});

// ── Entity Types ─────────────────────────────────────────────────────────────

/** @enum {string} */
export const ENTITY_TYPES = Object.freeze({
  PLAYER:  'player',
  ENEMY:   'enemy',
});

/** @enum {string} — Enemy species / archetypes */
export const ENEMY_TYPES = Object.freeze({
  SKELETON:  'skeleton',
  GOBLIN:    'goblin',
  ORC:       'orc',
  WRAITH:    'wraith',
  DRAGON:    'dragon',
  RAT:       'rat',
  SLIME:     'slime',
  DARK_MAGE: 'dark_mage',
});

/** Entity render colors (keyed by ENTITY_TYPES or ENEMY_TYPES) */
export const ENTITY_COLORS = Object.freeze({
  player:    '#00ff88',
  skeleton:  '#cccccc',
  goblin:    '#66cc33',
  orc:       '#cc6633',
  wraith:    '#9966ff',
  dragon:    '#ff3333',
  rat:       '#aa8855',
  slime:     '#33cc99',
  dark_mage: '#cc33ff',
});

// ── Player Classes ───────────────────────────────────────────────────────────

/** @enum {string} */
export const CLASS_TYPES = Object.freeze({
  WARRIOR: 'warrior',
  MAGE:    'mage',
  ROGUE:   'rogue',
});

/**
 * Base stats per class: { hp, mp, stamina, attack, defense, speed }
 * These are starting values at level 1.
 */
export const CLASS_BASE_STATS = Object.freeze({
  [CLASS_TYPES.WARRIOR]: { hp: 120, mp: 20,  stamina: 40, attack: 14, defense: 12, speed: 8  },
  [CLASS_TYPES.MAGE]:    { hp: 70,  mp: 80,  stamina: 20, attack: 6,  defense: 6,  speed: 10 },
  [CLASS_TYPES.ROGUE]:   { hp: 90,  mp: 30,  stamina: 50, attack: 10, defense: 8,  speed: 14 },
});

/**
 * Class abilities — each class gets 3 unique abilities.
 * shape: 'single' | 'line' | 'aoe'
 * cost: { mp?, stamina? }
 * range: max tile distance (0 = self, 1 = adjacent, etc.)
 */
export const CLASS_ABILITIES = Object.freeze({
  [CLASS_TYPES.WARRIOR]: [
    { id: 'shield_bash',   name: 'Shield Bash',   shape: 'single', range: 1, damage: 8,  cost: { stamina: 10 }, effect: 'stun'   },
    { id: 'cleave',        name: 'Cleave',        shape: 'aoe',    range: 1, damage: 12, cost: { stamina: 15 }, effect: null     },
    { id: 'war_cry',       name: 'War Cry',       shape: 'aoe',    range: 3, damage: 0,  cost: { stamina: 20 }, effect: 'debuff' },
  ],
  [CLASS_TYPES.MAGE]: [
    { id: 'fireball',      name: 'Fireball',      shape: 'aoe',    range: 6, damage: 20, cost: { mp: 15 }, effect: 'burn'    },
    { id: 'ice_shard',     name: 'Ice Shard',     shape: 'line',   range: 5, damage: 14, cost: { mp: 10 }, effect: 'slow'    },
    { id: 'teleport',      name: 'Teleport',      shape: 'single', range: 8, damage: 0,  cost: { mp: 20 }, effect: 'teleport'},
  ],
  [CLASS_TYPES.ROGUE]: [
    { id: 'backstab',      name: 'Backstab',      shape: 'single', range: 1, damage: 22, cost: { stamina: 12 }, effect: 'crit_bonus' },
    { id: 'smoke_bomb',    name: 'Smoke Bomb',    shape: 'aoe',    range: 2, damage: 0,  cost: { stamina: 15 }, effect: 'blind'      },
    { id: 'poison_dagger', name: 'Poison Dagger', shape: 'single', range: 1, damage: 8,  cost: { stamina: 8  }, effect: 'poison'     },
  ],
});

// ── Items ────────────────────────────────────────────────────────────────────

/** @enum {string} — Top-level item categories */
export const ITEM_TYPES = Object.freeze({
  WEAPON:  'weapon',
  ARMOR:   'armor',
  POTION:  'potion',
  SCROLL:  'scroll',
});

/** @enum {string} */
export const WEAPON_SUBTYPES = Object.freeze({
  SWORD:     'sword',
  AXE:       'axe',
  DAGGER:    'dagger',
  STAFF:     'staff',
  BOW:       'bow',
});

/** @enum {string} */
export const ARMOR_SUBTYPES = Object.freeze({
  HELMET:    'helmet',
  CHEST:     'chest',
  LEGS:      'legs',
  SHIELD:    'shield',
});

/** @enum {string} */
export const POTION_SUBTYPES = Object.freeze({
  HEALTH:    'health',
  MANA:      'mana',
  STRENGTH:  'strength',
  SPEED:     'speed',
});

/** @enum {string} */
export const SCROLL_SUBTYPES = Object.freeze({
  FIREBALL:     'fireball',
  TELEPORT:     'teleport',
  IDENTIFY:     'identify',
  ENCHANT:      'enchant',
  MAP_REVEAL:   'map_reveal',
});

/** Equipment slot names (used as keys on Entity.equipment) */
export const EQUIPMENT_SLOTS = Object.freeze({
  WEAPON: 'weapon',
  HELMET: 'helmet',
  CHEST:  'chest',
  LEGS:   'legs',
  SHIELD: 'shield',
});

/** Item rarity tiers — affects stat rolls and drop weights */
export const ITEM_RARITY = Object.freeze({
  COMMON:    'common',
  UNCOMMON:  'uncommon',
  RARE:      'rare',
  LEGENDARY: 'legendary',
});

// ── Combat ───────────────────────────────────────────────────────────────────

/** @enum {string} */
export const ATTACK_TYPES = Object.freeze({
  MELEE:  'melee',
  RANGED: 'ranged',
  AOE:    'aoe',
});

/** @enum {string} — Status effects that can be applied during combat */
export const STATUS_EFFECTS = Object.freeze({
  POISON: 'poison',
  BURN:   'burn',
  STUN:   'stun',
  SLOW:   'slow',
  BLIND:  'blind',
});

/** Turn phases — the game processes each phase in order per turn */
export const TURN_PHASES = Object.freeze({
  PLAYER_INPUT:   'player_input',
  PLAYER_ACTION:  'player_action',
  ENEMY_ACTION:   'enemy_action',
  STATUS_TICK:    'status_tick',
  CLEANUP:        'cleanup',
});

// ── FOV / Visibility ─────────────────────────────────────────────────────────

/** Default player sight radius in tiles */
export const FOV_RADIUS = 8;

// ── Difficulty Scaling ───────────────────────────────────────────────────────

/**
 * Per-floor difficulty multiplier. Applied to enemy stats and loot quality.
 * Index 0 = floor 1, index 9 = floor 10.
 */
export const FLOOR_DIFFICULTY = Object.freeze(
  Array.from({ length: MAX_FLOORS }, (_, i) => 1 + i * 0.25)
);

// ── Save / Score ─────────────────────────────────────────────────────────────

export const SAVE_KEY = 'dungeon_crawler_save';
export const HIGH_SCORE_KEY = 'dungeon_crawler_scores';
export const MAX_HIGH_SCORES = 10;
