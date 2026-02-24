/**
 * @file data-model.js
 * @description Core data structures for the dungeon crawler.
 * This is the SINGLE SOURCE OF TRUTH — every module imports from here.
 * All classes are plain data containers with serialization support.
 * Game logic lives in the specialist modules, not here.
 */

import {
  TILE_TYPES, FLOOR_WIDTH, FLOOR_HEIGHT,
  CLASS_BASE_STATS, CLASS_ABILITIES,
  ENTITY_TYPES, EQUIPMENT_SLOTS,
} from './constants.js';

// ── Position ─────────────────────────────────────────────────────────────────

/**
 * Grid coordinate pair.
 * @typedef {Object} Position
 * @property {number} x — Column index (0-based)
 * @property {number} y — Row index (0-based)
 */

/**
 * Create a position object.
 * @param {number} x
 * @param {number} y
 * @returns {Position}
 */
export function createPosition(x, y) {
  return { x, y };
}

// ── Tile ─────────────────────────────────────────────────────────────────────

/**
 * A single map cell.
 */
export class Tile {
  /**
   * @param {number} type — One of TILE_TYPES values
   */
  constructor(type = TILE_TYPES.WALL) {
    /** @type {number} TILE_TYPES enum value */
    this.type = type;

    /** @type {boolean} Can entities walk on this tile? */
    this.walkable = type !== TILE_TYPES.WALL;

    /** @type {boolean} Blocks line-of-sight? */
    this.opaque = type === TILE_TYPES.WALL || type === TILE_TYPES.DOOR;

    /** @type {boolean} Currently in player's field of view */
    this.visible = false;

    /** @type {boolean} Has the player ever seen this tile? */
    this.explored = false;

    /** @type {string|null} Entity ID occupying this tile, or null */
    this.entityId = null;

    /** @type {string[]} Item IDs lying on this tile */
    this.itemIds = [];
  }

  /** Serialize to a plain object for JSON save */
  toJSON() {
    return {
      type: this.type,
      walkable: this.walkable,
      opaque: this.opaque,
      visible: this.visible,
      explored: this.explored,
      entityId: this.entityId,
      itemIds: [...this.itemIds],
    };
  }

  /** Restore from a plain object */
  static fromJSON(data) {
    const t = new Tile(data.type);
    t.walkable = data.walkable;
    t.opaque = data.opaque;
    t.visible = data.visible;
    t.explored = data.explored;
    t.entityId = data.entityId;
    t.itemIds = data.itemIds ?? [];
    return t;
  }
}

// ── Room ─────────────────────────────────────────────────────────────────────

/**
 * A rectangular room produced by BSP dungeon generation.
 */
export class Room {
  /**
   * @param {number} x — Left column
   * @param {number} y — Top row
   * @param {number} width
   * @param {number} height
   */
  constructor(x, y, width, height) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  /** Center tile position of this room */
  get center() {
    return createPosition(
      Math.floor(this.x + this.width / 2),
      Math.floor(this.y + this.height / 2),
    );
  }

  /** Check if a position is inside this room */
  contains(pos) {
    return pos.x >= this.x && pos.x < this.x + this.width
        && pos.y >= this.y && pos.y < this.y + this.height;
  }

  toJSON() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  static fromJSON(d) {
    return new Room(d.x, d.y, d.width, d.height);
  }
}

// ── DungeonFloor ─────────────────────────────────────────────────────────────

/**
 * One level of the dungeon: a 2D tile grid plus metadata.
 */
export class DungeonFloor {
  /**
   * @param {number} floorNumber — 1-based floor index
   * @param {number} [width]
   * @param {number} [height]
   */
  constructor(floorNumber, width = FLOOR_WIDTH, height = FLOOR_HEIGHT) {
    /** @type {number} 1-based */
    this.floorNumber = floorNumber;

    /** @type {number} */
    this.width = width;

    /** @type {number} */
    this.height = height;

    /** @type {Tile[][]} tiles[y][x] — row-major 2D grid */
    this.tiles = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => new Tile(TILE_TYPES.WALL)),
    );

    /** @type {Room[]} Generated rooms */
    this.rooms = [];

    /**
     * Corridors stored as arrays of positions for debug / render.
     * @type {Position[][]}
     */
    this.corridors = [];

    /** @type {Position|null} Upstairs position (null on floor 1) */
    this.stairsUp = null;

    /** @type {Position|null} Downstairs position (null on floor 10) */
    this.stairsDown = null;
  }

  /**
   * Get tile at (x, y). Returns null if out of bounds.
   * @param {number} x
   * @param {number} y
   * @returns {Tile|null}
   */
  getTile(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
    return this.tiles[y][x];
  }

  /**
   * Set tile type at (x, y) and update derived flags.
   * @param {number} x
   * @param {number} y
   * @param {number} type — TILE_TYPES value
   */
  setTile(x, y, type) {
    const tile = this.getTile(x, y);
    if (!tile) return;
    tile.type = type;
    tile.walkable = type !== TILE_TYPES.WALL;
    tile.opaque = type === TILE_TYPES.WALL || type === TILE_TYPES.DOOR;
  }

  /**
   * Check if (x, y) is in bounds.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  inBounds(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  toJSON() {
    return {
      floorNumber: this.floorNumber,
      width: this.width,
      height: this.height,
      tiles: this.tiles.map(row => row.map(t => t.toJSON())),
      rooms: this.rooms.map(r => r.toJSON()),
      corridors: this.corridors,
      stairsUp: this.stairsUp,
      stairsDown: this.stairsDown,
    };
  }

  static fromJSON(d) {
    const floor = new DungeonFloor(d.floorNumber, d.width, d.height);
    floor.tiles = d.tiles.map(row => row.map(t => Tile.fromJSON(t)));
    floor.rooms = d.rooms.map(r => Room.fromJSON(r));
    floor.corridors = d.corridors;
    floor.stairsUp = d.stairsUp;
    floor.stairsDown = d.stairsDown;
    return floor;
  }
}

// ── Item ─────────────────────────────────────────────────────────────────────

let _nextItemId = 1;

/**
 * Any item in the game: weapon, armor, potion, scroll.
 */
export class Item {
  /**
   * @param {Object} opts
   * @param {string} opts.type       — ITEM_TYPES value ('weapon', 'armor', 'potion', 'scroll')
   * @param {string} opts.subtype    — Specific subtype from *_SUBTYPES constants
   * @param {string} opts.name       — Display name
   * @param {string} [opts.rarity]   — ITEM_RARITY value
   * @param {Object} [opts.stats]    — Stat modifiers: { attack?, defense?, hp?, mp?, speed? }
   * @param {boolean} [opts.identified] — Potions/scrolls start unidentified
   * @param {string} [opts.unidentifiedName] — Name shown when not yet identified
   * @param {number} [opts.value]    — Score/gold value
   */
  constructor(opts) {
    /** @type {string} Unique item instance ID */
    this.id = `item_${_nextItemId++}`;

    /** @type {string} */
    this.type = opts.type;

    /** @type {string} */
    this.subtype = opts.subtype;

    /** @type {string} */
    this.name = opts.name;

    /** @type {string} */
    this.rarity = opts.rarity ?? 'common';

    /** @type {Object} Stat modifiers applied when equipped or consumed */
    this.stats = opts.stats ?? {};

    /** @type {boolean} Whether the player knows what this item is */
    this.identified = opts.identified ?? true;

    /** @type {string} Shown in UI when identified === false */
    this.unidentifiedName = opts.unidentifiedName ?? 'Unknown Item';

    /** @type {number} */
    this.value = opts.value ?? 0;
  }

  toJSON() {
    return { ...this };
  }

  static fromJSON(d) {
    const item = Object.assign(new Item({
      type: d.type, subtype: d.subtype, name: d.name,
    }), d);
    return item;
  }

  /** Reset the auto-increment counter (useful after loading a save) */
  static resetIdCounter(val = 1) {
    _nextItemId = val;
  }
}

// ── Entity ───────────────────────────────────────────────────────────────────

let _nextEntityId = 1;

/**
 * Any creature on the map — player or enemy.
 */
export class Entity {
  /**
   * @param {Object} opts
   * @param {string} opts.entityType     — ENTITY_TYPES value ('player' | 'enemy')
   * @param {string} [opts.classType]    — CLASS_TYPES value (for player) or ENEMY_TYPES value (for enemies)
   * @param {string} opts.name           — Display name
   * @param {Position} opts.pos          — Starting grid position
   * @param {number} [opts.level]        — Current level (default 1)
   */
  constructor(opts) {
    /** @type {string} Unique entity ID */
    this.id = opts.entityType === ENTITY_TYPES.PLAYER
      ? 'player'
      : `entity_${_nextEntityId++}`;

    /** @type {string} ENTITY_TYPES value */
    this.entityType = opts.entityType;

    /** @type {string} CLASS_TYPES or ENEMY_TYPES value */
    this.classType = opts.classType ?? '';

    /** @type {string} */
    this.name = opts.name;

    /** @type {Position} Current grid position */
    this.pos = { ...opts.pos };

    /** @type {number} */
    this.level = opts.level ?? 1;

    // ── Stats ──
    const base = CLASS_BASE_STATS[opts.classType] ?? {
      hp: 50, mp: 0, stamina: 20, attack: 8, defense: 6, speed: 8,
    };

    /** @type {number} */
    this.maxHp = base.hp;
    /** @type {number} */
    this.hp = base.hp;
    /** @type {number} */
    this.maxMp = base.mp;
    /** @type {number} */
    this.mp = base.mp;
    /** @type {number} */
    this.maxStamina = base.stamina;
    /** @type {number} */
    this.stamina = base.stamina;
    /** @type {number} Base attack power */
    this.attack = base.attack;
    /** @type {number} Base defense */
    this.defense = base.defense;
    /** @type {number} Determines turn order / movement range */
    this.speed = base.speed;

    // ── Abilities ──
    /** @type {Object[]} Ability definitions from CLASS_ABILITIES */
    this.abilities = CLASS_ABILITIES[opts.classType]
      ? [...CLASS_ABILITIES[opts.classType]]
      : [];

    // ── Cooldowns for abilities (keyed by ability id) ──
    /** @type {Object<string, number>} ability id → turns remaining */
    this.cooldowns = {};

    // ── Status effects ──
    /** @type {Array<{type: string, turnsLeft: number, potency: number}>} */
    this.statusEffects = [];

    // ── Inventory & Equipment ──
    /** @type {Item[]} Items carried */
    this.inventory = [];

    /**
     * Equipped items, keyed by EQUIPMENT_SLOTS.
     * @type {Object<string, Item|null>}
     */
    this.equipment = {
      [EQUIPMENT_SLOTS.WEAPON]: null,
      [EQUIPMENT_SLOTS.HELMET]: null,
      [EQUIPMENT_SLOTS.CHEST]:  null,
      [EQUIPMENT_SLOTS.LEGS]:   null,
      [EQUIPMENT_SLOTS.SHIELD]: null,
    };

    // ── AI state (enemies only) ──
    /** @type {string} Current AI behavior: 'idle'|'patrol'|'chase'|'flee'|'use_ability' */
    this.aiState = 'idle';

    /** @type {Position|null} Last known player position (for AI) */
    this.lastKnownPlayerPos = null;

    /** @type {boolean} Is this entity alive? */
    this.alive = true;

    /** @type {number} Experience points (player only) */
    this.xp = 0;

    /** @type {number} XP needed for next level */
    this.xpToNext = 100;

    /** @type {number} Accumulated score (player only) */
    this.score = 0;
  }

  /** Check if entity is the player */
  get isPlayer() {
    return this.entityType === ENTITY_TYPES.PLAYER;
  }

  toJSON() {
    return {
      id: this.id,
      entityType: this.entityType,
      classType: this.classType,
      name: this.name,
      pos: { ...this.pos },
      level: this.level,
      maxHp: this.maxHp, hp: this.hp,
      maxMp: this.maxMp, mp: this.mp,
      maxStamina: this.maxStamina, stamina: this.stamina,
      attack: this.attack, defense: this.defense, speed: this.speed,
      abilities: this.abilities,
      cooldowns: { ...this.cooldowns },
      statusEffects: this.statusEffects.map(e => ({ ...e })),
      inventory: this.inventory.map(i => i.toJSON()),
      equipment: Object.fromEntries(
        Object.entries(this.equipment).map(([k, v]) => [k, v ? v.toJSON() : null]),
      ),
      aiState: this.aiState,
      lastKnownPlayerPos: this.lastKnownPlayerPos,
      alive: this.alive,
      xp: this.xp,
      xpToNext: this.xpToNext,
      score: this.score,
    };
  }

  static fromJSON(d) {
    const e = new Entity({
      entityType: d.entityType,
      classType: d.classType,
      name: d.name,
      pos: d.pos,
      level: d.level,
    });
    // Overwrite all serialized fields
    Object.assign(e, {
      id: d.id,
      maxHp: d.maxHp, hp: d.hp,
      maxMp: d.maxMp, mp: d.mp,
      maxStamina: d.maxStamina, stamina: d.stamina,
      attack: d.attack, defense: d.defense, speed: d.speed,
      abilities: d.abilities,
      cooldowns: d.cooldowns,
      statusEffects: d.statusEffects,
      aiState: d.aiState,
      lastKnownPlayerPos: d.lastKnownPlayerPos,
      alive: d.alive,
      xp: d.xp,
      xpToNext: d.xpToNext,
      score: d.score,
    });
    e.inventory = (d.inventory ?? []).map(i => Item.fromJSON(i));
    e.equipment = Object.fromEntries(
      Object.entries(d.equipment).map(([k, v]) => [k, v ? Item.fromJSON(v) : null]),
    );
    return e;
  }

  /** Reset the auto-increment counter (useful after loading a save) */
  static resetIdCounter(val = 1) {
    _nextEntityId = val;
  }
}

// ── GameState ────────────────────────────────────────────────────────────────

/**
 * Master game state. This object contains everything needed to save/restore a game.
 * Only ONE instance should exist at runtime — modules receive it by reference.
 */
export class GameState {
  constructor() {
    /** @type {number} 1-based current floor number */
    this.currentFloor = 1;

    /** @type {Entity|null} The player entity */
    this.player = null;

    /** @type {Map<string, Entity>} All entities on the current floor, keyed by id */
    this.entities = new Map();

    /** @type {Map<string, Item>} All items on the current floor, keyed by id */
    this.items = new Map();

    /** @type {DungeonFloor|null} Current dungeon floor */
    this.dungeonFloor = null;

    /**
     * Cache of generated floors so the player can go back upstairs.
     * @type {Map<number, DungeonFloor>}
     */
    this.floorCache = new Map();

    /** @type {string} Current turn phase (TURN_PHASES value) */
    this.turnPhase = 'player_input';

    /** @type {number} Global turn counter */
    this.turnCount = 0;

    /** @type {boolean} True when the game is over (permadeath) */
    this.gameOver = false;

    /** @type {string[]} Message log for the UI */
    this.log = [];
  }

  /**
   * Add a message to the game log.
   * @param {string} msg
   */
  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 200) this.log.shift();
  }

  /**
   * Register an entity on the current floor.
   * @param {Entity} entity
   */
  addEntity(entity) {
    this.entities.set(entity.id, entity);
    const tile = this.dungeonFloor?.getTile(entity.pos.x, entity.pos.y);
    if (tile) tile.entityId = entity.id;
  }

  /**
   * Remove an entity from the current floor.
   * @param {string} entityId
   */
  removeEntity(entityId) {
    const entity = this.entities.get(entityId);
    if (entity) {
      const tile = this.dungeonFloor?.getTile(entity.pos.x, entity.pos.y);
      if (tile && tile.entityId === entityId) tile.entityId = null;
      this.entities.delete(entityId);
    }
  }

  /**
   * Place an item on the floor at a position.
   * @param {Item} item
   * @param {Position} pos
   */
  addItem(item, pos) {
    this.items.set(item.id, item);
    const tile = this.dungeonFloor?.getTile(pos.x, pos.y);
    if (tile) tile.itemIds.push(item.id);
  }

  /**
   * Remove an item from the floor.
   * @param {string} itemId
   */
  removeItem(itemId) {
    this.items.delete(itemId);
    // Clean up tile references
    if (this.dungeonFloor) {
      for (const row of this.dungeonFloor.tiles) {
        for (const tile of row) {
          tile.itemIds = tile.itemIds.filter(id => id !== itemId);
        }
      }
    }
  }

  toJSON() {
    return {
      currentFloor: this.currentFloor,
      player: this.player?.toJSON() ?? null,
      entities: [...this.entities.values()].map(e => e.toJSON()),
      items: [...this.items.values()].map(i => i.toJSON()),
      dungeonFloor: this.dungeonFloor?.toJSON() ?? null,
      floorCache: [...this.floorCache.entries()].map(([k, v]) => [k, v.toJSON()]),
      turnPhase: this.turnPhase,
      turnCount: this.turnCount,
      gameOver: this.gameOver,
      log: [...this.log],
    };
  }

  static fromJSON(d) {
    const gs = new GameState();
    gs.currentFloor = d.currentFloor;
    gs.turnPhase = d.turnPhase;
    gs.turnCount = d.turnCount;
    gs.gameOver = d.gameOver;
    gs.log = d.log ?? [];

    gs.dungeonFloor = d.dungeonFloor ? DungeonFloor.fromJSON(d.dungeonFloor) : null;
    gs.floorCache = new Map(
      (d.floorCache ?? []).map(([k, v]) => [k, DungeonFloor.fromJSON(v)]),
    );

    // Restore entities
    for (const ed of (d.entities ?? [])) {
      const entity = Entity.fromJSON(ed);
      gs.entities.set(entity.id, entity);
      if (entity.isPlayer) gs.player = entity;
    }

    // Restore items
    for (const id of (d.items ?? [])) {
      gs.items.set(id.id, Item.fromJSON(id));
    }

    return gs;
  }
}
