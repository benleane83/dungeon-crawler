/**
 * @file dungeon.js
 * @description Procedural dungeon generation using Binary Space Partition (BSP).
 * Generates 10 floors with increasing difficulty — more rooms, tighter corridors,
 * denser enemy spawns, and rarer loot on deeper floors.
 *
 * Deterministic when given a seed via the SeededRNG class.
 */

import {
  TILE_TYPES, FLOOR_WIDTH, FLOOR_HEIGHT,
  MIN_ROOM_SIZE, MAX_ROOM_SIZE, MIN_BSP_LEAF,
  MAX_FLOORS, FLOOR_DIFFICULTY,
  ENEMY_TYPES, ENTITY_TYPES,
} from './constants.js';

import {
  DungeonFloor, Room, Tile, createPosition,
} from './data-model.js';

import { registerHook } from './game.js';

// ── Seeded RNG ───────────────────────────────────────────────────────────────

/**
 * Mulberry32-based seeded PRNG for deterministic generation.
 */
class SeededRNG {
  /** @param {number} seed */
  constructor(seed) {
    this._state = seed | 0;
  }

  /** Returns a float in [0, 1) */
  next() {
    let t = (this._state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive */
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Pick a random element from an array */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Shuffle array in-place (Fisher–Yates) */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// ── BSP Tree ─────────────────────────────────────────────────────────────────

/**
 * A node in the BSP tree. Each leaf will contain exactly one room.
 */
class BSPNode {
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   */
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    /** @type {BSPNode|null} */
    this.left = null;
    /** @type {BSPNode|null} */
    this.right = null;
    /** @type {Room|null} */
    this.room = null;
  }

  get isLeaf() {
    return !this.left && !this.right;
  }

  /**
   * Recursively split this node.
   * @param {SeededRNG} rng
   * @param {number} minLeaf — Minimum partition size
   */
  split(rng, minLeaf) {
    if (this.left || this.right) return;

    // Determine split direction
    let splitH;
    if (this.w > this.h && this.w / this.h >= 1.25) {
      splitH = false; // split vertically
    } else if (this.h > this.w && this.h / this.w >= 1.25) {
      splitH = true; // split horizontally
    } else {
      splitH = rng.next() > 0.5;
    }

    const max = (splitH ? this.h : this.w) - minLeaf;
    if (max < minLeaf) return; // too small to split

    const splitPos = rng.nextInt(minLeaf, max);

    if (splitH) {
      this.left  = new BSPNode(this.x, this.y, this.w, splitPos);
      this.right = new BSPNode(this.x, this.y + splitPos, this.w, this.h - splitPos);
    } else {
      this.left  = new BSPNode(this.x, this.y, splitPos, this.h);
      this.right = new BSPNode(this.x + splitPos, this.y, this.w - splitPos, this.h);
    }

    this.left.split(rng, minLeaf);
    this.right.split(rng, minLeaf);
  }

  /**
   * Place rooms inside every leaf node.
   * @param {SeededRNG} rng
   * @param {number} padding — Minimum wall padding inside the partition
   */
  createRooms(rng, padding) {
    if (this.left) this.left.createRooms(rng, padding);
    if (this.right) this.right.createRooms(rng, padding);

    if (!this.isLeaf) return;

    const maxW = Math.min(this.w - padding * 2, MAX_ROOM_SIZE);
    const maxH = Math.min(this.h - padding * 2, MAX_ROOM_SIZE);
    if (maxW < MIN_ROOM_SIZE || maxH < MIN_ROOM_SIZE) return;

    const roomW = rng.nextInt(MIN_ROOM_SIZE, maxW);
    const roomH = rng.nextInt(MIN_ROOM_SIZE, maxH);
    const roomX = rng.nextInt(this.x + padding, this.x + this.w - roomW - padding);
    const roomY = rng.nextInt(this.y + padding, this.y + this.h - roomH - padding);

    this.room = new Room(roomX, roomY, roomW, roomH);
  }

  /** Collect all rooms from leaves. */
  getRooms() {
    const rooms = [];
    if (this.isLeaf && this.room) {
      rooms.push(this.room);
    }
    if (this.left) rooms.push(...this.left.getRooms());
    if (this.right) rooms.push(...this.right.getRooms());
    return rooms;
  }

  /** Get a room from this subtree (for corridor connection). */
  getRoom() {
    if (this.room) return this.room;
    if (this.left) {
      const r = this.left.getRoom();
      if (r) return r;
    }
    if (this.right) {
      const r = this.right.getRoom();
      if (r) return r;
    }
    return null;
  }
}

// ── Room Types ───────────────────────────────────────────────────────────────

/** @enum {string} */
const ROOM_TYPE = Object.freeze({
  REGULAR:  'regular',
  TREASURE: 'treasure',
  BOSS:     'boss',
});

// ── Floor Scaling ────────────────────────────────────────────────────────────

/**
 * Returns generation parameters that scale with floor depth.
 * @param {number} floor — 1-based floor number
 */
function getFloorParams(floor) {
  const t = (floor - 1) / (MAX_FLOORS - 1); // 0 on floor 1, 1 on floor 10
  return {
    // Room count targets (BSP produces variable counts; minLeaf controls density)
    minLeaf:          Math.round(lerp(12, 7, t)),  // larger partitions = fewer rooms early
    roomPadding:      Math.round(lerp(2, 1, t)),
    corridorWidth:    Math.round(lerp(3, 1, t)),    // wider corridors on early floors

    // Spawn densities (per-room averages)
    enemyDensity:     lerp(1.0, 3.5, t),
    itemDensity:      lerp(0.8, 1.5, t),

    // Enemy type pool expands on deeper floors
    enemyPool:        getEnemyPool(floor),

    // Boss floors
    hasBoss:          floor === 5 || floor === 10,

    // Difficulty multiplier from constants
    difficulty:       FLOOR_DIFFICULTY[floor - 1],
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Enemy types available per floor tier.
 */
function getEnemyPool(floor) {
  if (floor <= 2)  return [ENEMY_TYPES.RAT, ENEMY_TYPES.SLIME];
  if (floor <= 4)  return [ENEMY_TYPES.RAT, ENEMY_TYPES.SLIME, ENEMY_TYPES.SKELETON, ENEMY_TYPES.GOBLIN];
  if (floor <= 6)  return [ENEMY_TYPES.SKELETON, ENEMY_TYPES.GOBLIN, ENEMY_TYPES.ORC];
  if (floor <= 8)  return [ENEMY_TYPES.ORC, ENEMY_TYPES.WRAITH, ENEMY_TYPES.DARK_MAGE];
  return [ENEMY_TYPES.WRAITH, ENEMY_TYPES.DARK_MAGE, ENEMY_TYPES.DRAGON];
}

// ── Corridor Carving ─────────────────────────────────────────────────────────

/**
 * Carve an L-shaped corridor between two room centers.
 * @param {DungeonFloor} dungeonFloor
 * @param {Room} roomA
 * @param {Room} roomB
 * @param {number} width — Corridor width in tiles
 * @param {SeededRNG} rng
 * @returns {import('./data-model.js').Position[]} positions carved
 */
function carveCorridor(dungeonFloor, roomA, roomB, width, rng) {
  const a = roomA.center;
  const b = roomB.center;
  const positions = [];
  const half = Math.floor(width / 2);

  // Choose L-bend direction randomly
  const horizontalFirst = rng.next() > 0.5;

  if (horizontalFirst) {
    // Horizontal then vertical
    carveHLine(dungeonFloor, a.x, b.x, a.y, half, positions);
    carveVLine(dungeonFloor, a.y, b.y, b.x, half, positions);
  } else {
    // Vertical then horizontal
    carveVLine(dungeonFloor, a.y, b.y, a.x, half, positions);
    carveHLine(dungeonFloor, a.x, b.x, b.y, half, positions);
  }

  return positions;
}

function carveHLine(floor, x1, x2, y, half, positions) {
  const startX = Math.min(x1, x2);
  const endX = Math.max(x1, x2);
  for (let x = startX; x <= endX; x++) {
    for (let dy = -half; dy <= half; dy++) {
      if (floor.inBounds(x, y + dy)) {
        const tile = floor.getTile(x, y + dy);
        if (tile && tile.type === TILE_TYPES.WALL) {
          floor.setTile(x, y + dy, TILE_TYPES.CORRIDOR);
          positions.push(createPosition(x, y + dy));
        }
      }
    }
  }
}

function carveVLine(floor, y1, y2, x, half, positions) {
  const startY = Math.min(y1, y2);
  const endY = Math.max(y1, y2);
  for (let y = startY; y <= endY; y++) {
    for (let dx = -half; dx <= half; dx++) {
      if (floor.inBounds(x + dx, y)) {
        const tile = floor.getTile(x + dx, y);
        if (tile && tile.type === TILE_TYPES.WALL) {
          floor.setTile(x + dx, y, TILE_TYPES.CORRIDOR);
          positions.push(createPosition(x + dx, y));
        }
      }
    }
  }
}

// ── Connect BSP siblings ─────────────────────────────────────────────────────

/**
 * Recursively connect rooms through the BSP tree so every room is reachable.
 */
function connectBSP(node, dungeonFloor, width, rng) {
  if (!node.left || !node.right) return;

  connectBSP(node.left, dungeonFloor, width, rng);
  connectBSP(node.right, dungeonFloor, width, rng);

  const roomA = node.left.getRoom();
  const roomB = node.right.getRoom();
  if (roomA && roomB) {
    const path = carveCorridor(dungeonFloor, roomA, roomB, width, rng);
    dungeonFloor.corridors.push(path);
  }
}

// ── Door Placement ───────────────────────────────────────────────────────────

/**
 * Place doors at room entrances (where corridors meet room edges).
 */
function placeDoors(dungeonFloor) {
  for (const room of dungeonFloor.rooms) {
    // Check perimeter tiles of the room
    for (let x = room.x; x < room.x + room.width; x++) {
      checkDoor(dungeonFloor, x, room.y - 1, x, room.y);
      checkDoor(dungeonFloor, x, room.y + room.height, x, room.y + room.height - 1);
    }
    for (let y = room.y; y < room.y + room.height; y++) {
      checkDoor(dungeonFloor, room.x - 1, y, room.x, y);
      checkDoor(dungeonFloor, room.x + room.width, y, room.x + room.width - 1, y);
    }
  }
}

function checkDoor(floor, outerX, outerY, innerX, innerY) {
  const outer = floor.getTile(outerX, outerY);
  const inner = floor.getTile(innerX, innerY);
  if (outer && inner && outer.type === TILE_TYPES.CORRIDOR && inner.type === TILE_TYPES.FLOOR) {
    floor.setTile(outerX, outerY, TILE_TYPES.DOOR);
  }
}

// ── Spawn Markers ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SpawnMarker
 * @property {string} type — 'enemy' | 'item' | 'player_start'
 * @property {import('./data-model.js').Position} pos
 * @property {string} [enemyType] — ENEMY_TYPES value (for enemy spawns)
 * @property {string} [roomType] — ROOM_TYPE value of the containing room
 */

/**
 * Get walkable floor tiles inside a room.
 */
function getRoomFloorTiles(dungeonFloor, room) {
  const tiles = [];
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      const tile = dungeonFloor.getTile(x, y);
      if (tile && tile.type === TILE_TYPES.FLOOR) {
        tiles.push(createPosition(x, y));
      }
    }
  }
  return tiles;
}

/**
 * Find the room farthest from a given position (Manhattan distance between centers).
 */
function farthestRoom(rooms, from) {
  let best = rooms[0];
  let bestDist = 0;
  for (const room of rooms) {
    const c = room.center;
    const dist = Math.abs(c.x - from.x) + Math.abs(c.y - from.y);
    if (dist > bestDist) {
      bestDist = dist;
      best = room;
    }
  }
  return best;
}

// ── Main Generation ──────────────────────────────────────────────────────────

/**
 * Generate a fully populated DungeonFloor for the given floor number.
 *
 * @param {number} floorNumber — 1-based (1..10)
 * @param {number} [seed] — Optional seed for deterministic generation
 * @returns {{ floor: DungeonFloor, spawns: SpawnMarker[] }}
 */
export function generateDungeon(floorNumber, seed) {
  const effectiveSeed = seed ?? (Date.now() ^ (floorNumber * 7919));
  const rng = new SeededRNG(effectiveSeed);
  const params = getFloorParams(floorNumber);

  // 1. Create empty floor
  const dungeonFloor = new DungeonFloor(floorNumber);

  // 2. Build BSP tree
  const root = new BSPNode(1, 1, FLOOR_WIDTH - 2, FLOOR_HEIGHT - 2);
  root.split(rng, params.minLeaf);
  root.createRooms(rng, params.roomPadding);

  // 3. Collect rooms and carve them into the tile grid
  const rooms = root.getRooms();
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        dungeonFloor.setTile(x, y, TILE_TYPES.FLOOR);
      }
    }
  }
  dungeonFloor.rooms = rooms;

  // 4. Connect rooms via BSP sibling corridors
  connectBSP(root, dungeonFloor, params.corridorWidth, rng);

  // 5. Place doors
  placeDoors(dungeonFloor);

  // 6. Assign room types
  const roomTypes = assignRoomTypes(rooms, floorNumber, rng);

  // 7. Place stairs
  const startRoom = rooms[0];
  const startCenter = startRoom.center;

  // Up stairs at entry (not on floor 1)
  if (floorNumber > 1) {
    dungeonFloor.setTile(startCenter.x, startCenter.y, TILE_TYPES.STAIRS_UP);
    dungeonFloor.stairsUp = createPosition(startCenter.x, startCenter.y);
  }

  // Down stairs in farthest room (not on floor 10)
  if (floorNumber < MAX_FLOORS) {
    const exitRoom = farthestRoom(rooms, startCenter);
    const exitCenter = exitRoom.center;
    dungeonFloor.setTile(exitCenter.x, exitCenter.y, TILE_TYPES.STAIRS_DOWN);
    dungeonFloor.stairsDown = createPosition(exitCenter.x, exitCenter.y);
  }

  // 8. Generate spawn markers
  const spawns = generateSpawns(dungeonFloor, rooms, roomTypes, params, rng, startRoom);

  return { floor: dungeonFloor, spawns };
}

// ── Room Type Assignment ─────────────────────────────────────────────────────

/**
 * Assign types (regular / treasure / boss) to each room.
 * @returns {Map<Room, string>}
 */
function assignRoomTypes(rooms, floorNumber, rng) {
  /** @type {Map<Room, string>} */
  const types = new Map();

  for (const room of rooms) {
    types.set(room, ROOM_TYPE.REGULAR);
  }

  // Designate boss room on boss floors (floor 5 and 10)
  if ((floorNumber === 5 || floorNumber === 10) && rooms.length > 1) {
    // Boss room is the last room (farthest from start via array order after BSP)
    const bossRoom = rooms[rooms.length - 1];
    types.set(bossRoom, ROOM_TYPE.BOSS);
  }

  // Designate 1-2 treasure rooms (not the first room or boss room)
  const treasureCount = floorNumber >= 7 ? 2 : 1;
  const candidates = rooms.filter((r, i) => i > 0 && types.get(r) === ROOM_TYPE.REGULAR);
  rng.shuffle(candidates);
  for (let i = 0; i < Math.min(treasureCount, candidates.length); i++) {
    types.set(candidates[i], ROOM_TYPE.TREASURE);
  }

  return types;
}

// ── Spawn Generation ─────────────────────────────────────────────────────────

/**
 * Generate spawn markers for enemies, items, and the player start.
 * @returns {SpawnMarker[]}
 */
function generateSpawns(dungeonFloor, rooms, roomTypes, params, rng, startRoom) {
  /** @type {SpawnMarker[]} */
  const spawns = [];

  // Player start: center of first room (or next to up-stairs)
  const playerPos = startRoom.center;
  // If stairs-up occupies the center, offset by one tile
  const startTile = dungeonFloor.getTile(playerPos.x, playerPos.y);
  if (startTile && startTile.type === TILE_TYPES.STAIRS_UP) {
    const alt = findAdjacentFloor(dungeonFloor, playerPos);
    spawns.push({ type: 'player_start', pos: alt ?? playerPos });
  } else {
    spawns.push({ type: 'player_start', pos: playerPos });
  }

  // Enemies and items per room
  for (const room of rooms) {
    if (room === startRoom) continue; // no enemies in the start room

    const roomType = roomTypes.get(room) ?? ROOM_TYPE.REGULAR;
    const floorTiles = getRoomFloorTiles(dungeonFloor, room);
    if (floorTiles.length === 0) continue;

    rng.shuffle(floorTiles);
    let tileIdx = 0;

    // Enemy spawns
    let enemyCount;
    if (roomType === ROOM_TYPE.BOSS) {
      enemyCount = 1; // Boss is a single powerful entity
    } else {
      const base = roomType === ROOM_TYPE.TREASURE
        ? Math.ceil(params.enemyDensity * 0.5)
        : Math.ceil(params.enemyDensity);
      enemyCount = rng.nextInt(Math.max(1, base - 1), base + 1);
    }
    enemyCount = Math.min(enemyCount, Math.floor(floorTiles.length * 0.4));

    for (let i = 0; i < enemyCount && tileIdx < floorTiles.length; i++) {
      const enemyType = roomType === ROOM_TYPE.BOSS
        ? (params.hasBoss ? ENEMY_TYPES.DRAGON : rng.pick(params.enemyPool))
        : rng.pick(params.enemyPool);
      spawns.push({
        type: 'enemy',
        pos: floorTiles[tileIdx++],
        enemyType,
        roomType,
      });
    }

    // Item spawns
    let itemCount;
    if (roomType === ROOM_TYPE.TREASURE) {
      itemCount = rng.nextInt(2, 4); // Treasure rooms have more loot
    } else if (roomType === ROOM_TYPE.BOSS) {
      itemCount = rng.nextInt(3, 5); // Boss rooms reward handsomely
    } else {
      const base = Math.round(params.itemDensity);
      itemCount = rng.nextInt(0, base);
    }
    itemCount = Math.min(itemCount, floorTiles.length - tileIdx);

    for (let i = 0; i < itemCount && tileIdx < floorTiles.length; i++) {
      spawns.push({
        type: 'item',
        pos: floorTiles[tileIdx++],
        roomType,
      });
    }
  }

  return spawns;
}

/**
 * Find an adjacent walkable floor tile (for when center is occupied by stairs).
 */
function findAdjacentFloor(dungeonFloor, pos) {
  const offsets = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
  for (const off of offsets) {
    const nx = pos.x + off.x;
    const ny = pos.y + off.y;
    const tile = dungeonFloor.getTile(nx, ny);
    if (tile && tile.type === TILE_TYPES.FLOOR) {
      return createPosition(nx, ny);
    }
  }
  return null;
}

// ── Hook Registration ────────────────────────────────────────────────────────

/**
 * generateFloor hook — called by game.js when a new floor is needed.
 * Populates state.dungeonFloor and moves the player to the start position.
 */
registerHook('generateFloor', (state, floorNumber) => {
  const { floor, spawns } = generateDungeon(floorNumber);
  state.dungeonFloor = floor;

  // Place the player at the designated start position
  const playerSpawn = spawns.find(s => s.type === 'player_start');
  if (state.player && playerSpawn) {
    state.player.pos = { ...playerSpawn.pos };
  }

  // Store spawn markers on the floor for other modules (spawnEnemies, spawnItems)
  // Attach as a non-serialized transient property
  floor._spawns = spawns;
});

/**
 * spawnEnemies hook — reads spawn markers and creates enemy entities.
 * Other modules (combat, AI) will handle the actual Entity creation;
 * this hook places the markers on tiles so they can be read.
 */
registerHook('spawnEnemies', (state) => {
  const floor = state.dungeonFloor;
  if (!floor || !floor._spawns) return;

  const enemySpawns = floor._spawns.filter(s => s.type === 'enemy');
  for (const spawn of enemySpawns) {
    const tile = floor.getTile(spawn.pos.x, spawn.pos.y);
    if (!tile) continue;
    // Mark the tile for enemy placement; store metadata for other modules
    tile._enemySpawn = {
      enemyType: spawn.enemyType,
      roomType: spawn.roomType,
    };
  }
});

/**
 * spawnItems hook — marks tiles for item placement.
 */
registerHook('spawnItems', (state) => {
  const floor = state.dungeonFloor;
  if (!floor || !floor._spawns) return;

  const itemSpawns = floor._spawns.filter(s => s.type === 'item');
  for (const spawn of itemSpawns) {
    const tile = floor.getTile(spawn.pos.x, spawn.pos.y);
    if (!tile) continue;
    tile._itemSpawn = {
      roomType: spawn.roomType,
    };
  }
});
