/**
 * @file data-model.test.js
 * @description Tests for the shared data model: GameState, Entity, Item, DungeonFloor, Position.
 */

const { describe, it, assert } = require('./test-runner');
const { loadModule, loadDataModel } = require('./loader');

const constants = loadModule('src/constants.js');
const dm = loadDataModel(constants);
const {
  createPosition, Tile, Room, DungeonFloor, Item, Entity, GameState,
} = dm;

const {
  TILE_TYPES, FLOOR_WIDTH, FLOOR_HEIGHT, CLASS_TYPES, CLASS_BASE_STATS,
  CLASS_ABILITIES, ENTITY_TYPES, EQUIPMENT_SLOTS, ITEM_TYPES, ITEM_RARITY,
  WEAPON_SUBTYPES, ARMOR_SUBTYPES,
} = constants;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createPosition', () => {
  it('should create a position with x and y', () => {
    const pos = createPosition(5, 10);
    assert.equal(pos.x, 5);
    assert.equal(pos.y, 10);
  });

  it('should create position at origin', () => {
    const pos = createPosition(0, 0);
    assert.equal(pos.x, 0);
    assert.equal(pos.y, 0);
  });
});

describe('Tile', () => {
  it('should default to WALL type', () => {
    const tile = new Tile();
    assert.equal(tile.type, TILE_TYPES.WALL);
    assert.equal(tile.walkable, false);
    assert.equal(tile.opaque, true);
  });

  it('should set FLOOR type as walkable and transparent', () => {
    const tile = new Tile(TILE_TYPES.FLOOR);
    assert.equal(tile.type, TILE_TYPES.FLOOR);
    assert.equal(tile.walkable, true);
    assert.equal(tile.opaque, false);
  });

  it('should set DOOR as walkable but opaque', () => {
    const tile = new Tile(TILE_TYPES.DOOR);
    assert.equal(tile.walkable, true);
    assert.equal(tile.opaque, true);
  });

  it('should default visibility to false and unexplored', () => {
    const tile = new Tile(TILE_TYPES.FLOOR);
    assert.equal(tile.visible, false);
    assert.equal(tile.explored, false);
  });

  it('should start with no entity and no items', () => {
    const tile = new Tile();
    assert.isNull(tile.entityId);
    assert.deepEqual(tile.itemIds, []);
  });

  it('should serialize and deserialize correctly', () => {
    const tile = new Tile(TILE_TYPES.CORRIDOR);
    tile.visible = true;
    tile.explored = true;
    tile.entityId = 'player';
    tile.itemIds = ['item_1', 'item_2'];

    const json = tile.toJSON();
    const restored = Tile.fromJSON(json);

    assert.equal(restored.type, TILE_TYPES.CORRIDOR);
    assert.equal(restored.walkable, true);
    assert.equal(restored.visible, true);
    assert.equal(restored.explored, true);
    assert.equal(restored.entityId, 'player');
    assert.deepEqual(restored.itemIds, ['item_1', 'item_2']);
  });
});

describe('Room', () => {
  it('should store position and dimensions', () => {
    const room = new Room(5, 10, 8, 6);
    assert.equal(room.x, 5);
    assert.equal(room.y, 10);
    assert.equal(room.width, 8);
    assert.equal(room.height, 6);
  });

  it('should calculate center correctly', () => {
    const room = new Room(0, 0, 10, 10);
    const center = room.center;
    assert.equal(center.x, 5);
    assert.equal(center.y, 5);
  });

  it('should detect positions inside the room', () => {
    const room = new Room(5, 5, 10, 10);
    assert.ok(room.contains({ x: 5, y: 5 }));
    assert.ok(room.contains({ x: 10, y: 10 }));
    assert.ok(room.contains({ x: 14, y: 14 }));
  });

  it('should reject positions outside the room', () => {
    const room = new Room(5, 5, 10, 10);
    assert.ok(!room.contains({ x: 4, y: 5 }));
    assert.ok(!room.contains({ x: 15, y: 5 }));
    assert.ok(!room.contains({ x: 5, y: 15 }));
  });

  it('should serialize and deserialize correctly', () => {
    const room = new Room(3, 7, 12, 8);
    const json = room.toJSON();
    const restored = Room.fromJSON(json);
    assert.equal(restored.x, 3);
    assert.equal(restored.y, 7);
    assert.equal(restored.width, 12);
    assert.equal(restored.height, 8);
  });
});

describe('DungeonFloor', () => {
  it('should create a grid with correct dimensions', () => {
    const floor = new DungeonFloor(1);
    assert.equal(floor.width, FLOOR_WIDTH);
    assert.equal(floor.height, FLOOR_HEIGHT);
    assert.equal(floor.tiles.length, FLOOR_HEIGHT);
    assert.equal(floor.tiles[0].length, FLOOR_WIDTH);
  });

  it('should initialize all tiles as walls', () => {
    const floor = new DungeonFloor(1, 10, 10);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        assert.equal(floor.getTile(x, y).type, TILE_TYPES.WALL);
      }
    }
  });

  it('should support custom dimensions', () => {
    const floor = new DungeonFloor(1, 20, 15);
    assert.equal(floor.width, 20);
    assert.equal(floor.height, 15);
    assert.equal(floor.tiles.length, 15);
    assert.equal(floor.tiles[0].length, 20);
  });

  it('getTile should return null for out-of-bounds', () => {
    const floor = new DungeonFloor(1, 10, 10);
    assert.isNull(floor.getTile(-1, 0));
    assert.isNull(floor.getTile(0, -1));
    assert.isNull(floor.getTile(10, 0));
    assert.isNull(floor.getTile(0, 10));
  });

  it('getTile should return tile for valid coordinates', () => {
    const floor = new DungeonFloor(1, 10, 10);
    assert.isNotNull(floor.getTile(0, 0));
    assert.isNotNull(floor.getTile(9, 9));
  });

  it('setTile should change tile type and derived flags', () => {
    const floor = new DungeonFloor(1, 10, 10);
    floor.setTile(3, 4, TILE_TYPES.FLOOR);
    const tile = floor.getTile(3, 4);
    assert.equal(tile.type, TILE_TYPES.FLOOR);
    assert.equal(tile.walkable, true);
    assert.equal(tile.opaque, false);
  });

  it('setTile should handle DOOR type correctly', () => {
    const floor = new DungeonFloor(1, 10, 10);
    floor.setTile(5, 5, TILE_TYPES.DOOR);
    const tile = floor.getTile(5, 5);
    assert.equal(tile.walkable, true);
    assert.equal(tile.opaque, true);
  });

  it('setTile should silently ignore out-of-bounds', () => {
    const floor = new DungeonFloor(1, 10, 10);
    floor.setTile(-1, 0, TILE_TYPES.FLOOR); // should not throw
    floor.setTile(100, 100, TILE_TYPES.FLOOR);
  });

  it('inBounds should validate coordinates', () => {
    const floor = new DungeonFloor(1, 10, 10);
    assert.ok(floor.inBounds(0, 0));
    assert.ok(floor.inBounds(9, 9));
    assert.ok(!floor.inBounds(-1, 0));
    assert.ok(!floor.inBounds(10, 0));
    assert.ok(!floor.inBounds(0, 10));
  });

  it('should initialize with empty rooms, corridors, and null stairs', () => {
    const floor = new DungeonFloor(1);
    assert.deepEqual(floor.rooms, []);
    assert.deepEqual(floor.corridors, []);
    assert.isNull(floor.stairsUp);
    assert.isNull(floor.stairsDown);
  });

  it('should serialize and deserialize correctly', () => {
    const floor = new DungeonFloor(3, 10, 10);
    floor.setTile(2, 3, TILE_TYPES.FLOOR);
    floor.rooms.push(new Room(1, 1, 5, 5));
    floor.stairsDown = { x: 5, y: 5 };

    const json = floor.toJSON();
    const restored = DungeonFloor.fromJSON(json);

    assert.equal(restored.floorNumber, 3);
    assert.equal(restored.width, 10);
    assert.equal(restored.height, 10);
    assert.equal(restored.getTile(2, 3).type, TILE_TYPES.FLOOR);
    assert.equal(restored.rooms.length, 1);
    assert.equal(restored.rooms[0].x, 1);
    assert.deepEqual(restored.stairsDown, { x: 5, y: 5 });
  });
});

describe('Item', () => {
  // Reset ID counter before tests
  Item.resetIdCounter(1000);

  it('should create an item with required fields', () => {
    const item = new Item({
      type: ITEM_TYPES.WEAPON,
      subtype: WEAPON_SUBTYPES.SWORD,
      name: 'Iron Sword',
    });
    assert.ok(item.id.startsWith('item_'));
    assert.equal(item.type, ITEM_TYPES.WEAPON);
    assert.equal(item.subtype, WEAPON_SUBTYPES.SWORD);
    assert.equal(item.name, 'Iron Sword');
  });

  it('should default rarity to common', () => {
    const item = new Item({ type: ITEM_TYPES.WEAPON, subtype: 'sword', name: 'Sword' });
    assert.equal(item.rarity, ITEM_RARITY.COMMON);
  });

  it('should support all item types', () => {
    const types = [ITEM_TYPES.WEAPON, ITEM_TYPES.ARMOR, ITEM_TYPES.POTION, ITEM_TYPES.SCROLL];
    types.forEach(type => {
      const item = new Item({ type, subtype: 'test', name: 'Test' });
      assert.equal(item.type, type);
    });
  });

  it('should default to identified', () => {
    const item = new Item({ type: ITEM_TYPES.WEAPON, subtype: 'sword', name: 'Sword' });
    assert.equal(item.identified, true);
  });

  it('should support unidentified items', () => {
    const item = new Item({
      type: ITEM_TYPES.POTION,
      subtype: 'health',
      name: 'Health Potion',
      identified: false,
      unidentifiedName: 'Bubbling Red Potion',
    });
    assert.equal(item.identified, false);
    assert.equal(item.unidentifiedName, 'Bubbling Red Potion');
  });

  it('should store stat modifiers', () => {
    const item = new Item({
      type: ITEM_TYPES.WEAPON,
      subtype: 'sword',
      name: 'Great Sword',
      stats: { attack: 10, speed: -2 },
    });
    assert.equal(item.stats.attack, 10);
    assert.equal(item.stats.speed, -2);
  });

  it('should support all rarity tiers', () => {
    Object.values(ITEM_RARITY).forEach(rarity => {
      const item = new Item({
        type: ITEM_TYPES.ARMOR,
        subtype: 'chest',
        name: 'Armor',
        rarity,
      });
      assert.equal(item.rarity, rarity);
    });
  });

  it('should generate unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      const item = new Item({ type: 'weapon', subtype: 'sword', name: 'Sword' });
      assert.ok(!ids.has(item.id), `Duplicate ID: ${item.id}`);
      ids.add(item.id);
    }
  });

  it('should serialize and deserialize correctly', () => {
    const item = new Item({
      type: ITEM_TYPES.POTION,
      subtype: 'health',
      name: 'Health Potion',
      rarity: ITEM_RARITY.UNCOMMON,
      stats: { hp: 30 },
      identified: false,
      unidentifiedName: 'Red Potion',
      value: 25,
    });

    const json = item.toJSON();
    const restored = Item.fromJSON(json);

    assert.equal(restored.type, ITEM_TYPES.POTION);
    assert.equal(restored.name, 'Health Potion');
    assert.equal(restored.rarity, ITEM_RARITY.UNCOMMON);
    assert.equal(restored.identified, false);
    assert.equal(restored.unidentifiedName, 'Red Potion');
    assert.equal(restored.value, 25);
  });
});

describe('Entity', () => {
  Entity.resetIdCounter(1);

  it('should create a player entity with class stats', () => {
    const player = new Entity({
      entityType: ENTITY_TYPES.PLAYER,
      classType: CLASS_TYPES.WARRIOR,
      name: 'TestHero',
      pos: { x: 5, y: 5 },
    });

    assert.equal(player.id, 'player');
    assert.equal(player.entityType, ENTITY_TYPES.PLAYER);
    assert.equal(player.classType, CLASS_TYPES.WARRIOR);
    assert.ok(player.isPlayer);
    assert.equal(player.name, 'TestHero');
  });

  it('should use warrior base stats', () => {
    const player = new Entity({
      entityType: ENTITY_TYPES.PLAYER,
      classType: CLASS_TYPES.WARRIOR,
      name: 'Warrior',
      pos: { x: 0, y: 0 },
    });
    const base = CLASS_BASE_STATS[CLASS_TYPES.WARRIOR];
    assert.equal(player.maxHp, base.hp);
    assert.equal(player.hp, base.hp);
    assert.equal(player.attack, base.attack);
    assert.equal(player.defense, base.defense);
    assert.equal(player.speed, base.speed);
  });

  it('should use mage base stats', () => {
    const player = new Entity({
      entityType: ENTITY_TYPES.PLAYER,
      classType: CLASS_TYPES.MAGE,
      name: 'Mage',
      pos: { x: 0, y: 0 },
    });
    const base = CLASS_BASE_STATS[CLASS_TYPES.MAGE];
    assert.equal(player.maxMp, base.mp);
    assert.equal(player.mp, base.mp);
    assert.equal(player.maxHp, base.hp);
  });

  it('should use rogue base stats', () => {
    const player = new Entity({
      entityType: ENTITY_TYPES.PLAYER,
      classType: CLASS_TYPES.ROGUE,
      name: 'Rogue',
      pos: { x: 0, y: 0 },
    });
    const base = CLASS_BASE_STATS[CLASS_TYPES.ROGUE];
    assert.equal(player.maxStamina, base.stamina);
    assert.equal(player.stamina, base.stamina);
    assert.equal(player.speed, base.speed);
  });

  it('should create an enemy entity with auto-incrementing ID', () => {
    Entity.resetIdCounter(1);
    const enemy = new Entity({
      entityType: ENTITY_TYPES.ENEMY,
      classType: 'skeleton',
      name: 'Skeleton',
      pos: { x: 10, y: 10 },
    });
    assert.ok(enemy.id.startsWith('entity_'));
    assert.equal(enemy.entityType, ENTITY_TYPES.ENEMY);
    assert.ok(!enemy.isPlayer);
  });

  it('should default to alive with no status effects', () => {
    const entity = new Entity({
      entityType: ENTITY_TYPES.ENEMY,
      classType: 'rat',
      name: 'Rat',
      pos: { x: 0, y: 0 },
    });
    assert.equal(entity.alive, true);
    assert.deepEqual(entity.statusEffects, []);
  });

  it('should initialize empty equipment slots', () => {
    const player = new Entity({
      entityType: ENTITY_TYPES.PLAYER,
      classType: CLASS_TYPES.WARRIOR,
      name: 'Test',
      pos: { x: 0, y: 0 },
    });
    Object.values(EQUIPMENT_SLOTS).forEach(slot => {
      assert.isNull(player.equipment[slot]);
    });
  });

  it('should have correct number of abilities per class', () => {
    Object.values(CLASS_TYPES).forEach(classType => {
      const entity = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });
      assert.equal(entity.abilities.length, 3, `${classType} should have 3 abilities`);
    });
  });

  it('should copy position (not reference)', () => {
    const pos = { x: 5, y: 10 };
    const entity = new Entity({
      entityType: ENTITY_TYPES.PLAYER,
      classType: CLASS_TYPES.WARRIOR,
      name: 'Test',
      pos,
    });
    pos.x = 999;
    assert.equal(entity.pos.x, 5, 'Position should be copied, not referenced');
  });

  it('should serialize and deserialize correctly', () => {
    const player = new Entity({
      entityType: ENTITY_TYPES.PLAYER,
      classType: CLASS_TYPES.MAGE,
      name: 'Gandalf',
      pos: { x: 5, y: 10 },
      level: 3,
    });
    player.hp = 50;
    player.xp = 250;
    player.score = 1000;

    const json = player.toJSON();
    const restored = Entity.fromJSON(json);

    assert.equal(restored.id, 'player');
    assert.equal(restored.classType, CLASS_TYPES.MAGE);
    assert.equal(restored.name, 'Gandalf');
    assert.equal(restored.hp, 50);
    assert.equal(restored.level, 3);
    assert.equal(restored.xp, 250);
    assert.equal(restored.score, 1000);
    assert.equal(restored.pos.x, 5);
    assert.equal(restored.pos.y, 10);
  });

  it('enemies should fallback to default stats', () => {
    const enemy = new Entity({
      entityType: ENTITY_TYPES.ENEMY,
      classType: 'goblin',
      name: 'Goblin',
      pos: { x: 0, y: 0 },
    });
    // Goblin isn't in CLASS_BASE_STATS, so it uses defaults
    assert.equal(enemy.maxHp, 50);
    assert.equal(enemy.attack, 8);
    assert.equal(enemy.defense, 6);
  });
});

describe('GameState', () => {
  it('should initialize with default values', () => {
    const gs = new GameState();
    assert.equal(gs.currentFloor, 1);
    assert.isNull(gs.player);
    assert.equal(gs.entities.size, 0);
    assert.equal(gs.items.size, 0);
    assert.isNull(gs.dungeonFloor);
    assert.equal(gs.turnPhase, 'player_input');
    assert.equal(gs.turnCount, 0);
    assert.equal(gs.gameOver, false);
    assert.deepEqual(gs.log, []);
  });

  it('addLog should add messages', () => {
    const gs = new GameState();
    gs.addLog('Hello');
    gs.addLog('World');
    assert.equal(gs.log.length, 2);
    assert.equal(gs.log[0], 'Hello');
    assert.equal(gs.log[1], 'World');
  });

  it('addLog should cap at 200 messages', () => {
    const gs = new GameState();
    for (let i = 0; i < 210; i++) {
      gs.addLog(`Message ${i}`);
    }
    assert.equal(gs.log.length, 200);
    assert.equal(gs.log[0], 'Message 10');
  });

  it('addEntity should register entity and set tile', () => {
    const gs = new GameState();
    gs.dungeonFloor = new DungeonFloor(1, 10, 10);
    gs.dungeonFloor.setTile(5, 5, TILE_TYPES.FLOOR);

    const entity = new Entity({
      entityType: ENTITY_TYPES.ENEMY,
      classType: 'rat',
      name: 'Rat',
      pos: { x: 5, y: 5 },
    });
    gs.addEntity(entity);

    assert.ok(gs.entities.has(entity.id));
    assert.equal(gs.dungeonFloor.getTile(5, 5).entityId, entity.id);
  });

  it('removeEntity should unregister entity and clear tile', () => {
    const gs = new GameState();
    gs.dungeonFloor = new DungeonFloor(1, 10, 10);
    gs.dungeonFloor.setTile(3, 3, TILE_TYPES.FLOOR);

    const entity = new Entity({
      entityType: ENTITY_TYPES.ENEMY,
      classType: 'rat',
      name: 'Rat',
      pos: { x: 3, y: 3 },
    });
    gs.addEntity(entity);
    gs.removeEntity(entity.id);

    assert.ok(!gs.entities.has(entity.id));
    assert.isNull(gs.dungeonFloor.getTile(3, 3).entityId);
  });

  it('addItem should register item and add to tile', () => {
    const gs = new GameState();
    gs.dungeonFloor = new DungeonFloor(1, 10, 10);
    gs.dungeonFloor.setTile(4, 4, TILE_TYPES.FLOOR);

    const item = new Item({ type: 'weapon', subtype: 'sword', name: 'Sword' });
    gs.addItem(item, { x: 4, y: 4 });

    assert.ok(gs.items.has(item.id));
    assert.includes(gs.dungeonFloor.getTile(4, 4).itemIds, item.id);
  });

  it('removeItem should unregister and clean tile references', () => {
    const gs = new GameState();
    gs.dungeonFloor = new DungeonFloor(1, 10, 10);
    gs.dungeonFloor.setTile(4, 4, TILE_TYPES.FLOOR);

    const item = new Item({ type: 'weapon', subtype: 'sword', name: 'Sword' });
    gs.addItem(item, { x: 4, y: 4 });
    gs.removeItem(item.id);

    assert.ok(!gs.items.has(item.id));
    assert.ok(!gs.dungeonFloor.getTile(4, 4).itemIds.includes(item.id));
  });

  it('should serialize and deserialize full game state', () => {
    const gs = new GameState();
    gs.dungeonFloor = new DungeonFloor(1, 10, 10);
    gs.dungeonFloor.setTile(5, 5, TILE_TYPES.FLOOR);
    gs.currentFloor = 2;
    gs.turnCount = 42;
    gs.gameOver = false;
    gs.addLog('Test message');

    const player = new Entity({
      entityType: ENTITY_TYPES.PLAYER,
      classType: CLASS_TYPES.WARRIOR,
      name: 'Hero',
      pos: { x: 5, y: 5 },
    });
    gs.player = player;
    gs.entities.set(player.id, player);

    const json = gs.toJSON();
    const jsonStr = JSON.stringify(json);
    const restored = GameState.fromJSON(JSON.parse(jsonStr));

    assert.equal(restored.currentFloor, 2);
    assert.equal(restored.turnCount, 42);
    assert.equal(restored.gameOver, false);
    assert.equal(restored.log.length, 1);
    assert.equal(restored.log[0], 'Test message');
    assert.isNotNull(restored.player);
    assert.equal(restored.player.name, 'Hero');
    assert.equal(restored.player.classType, CLASS_TYPES.WARRIOR);
  });
});
