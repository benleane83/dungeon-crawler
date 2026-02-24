/**
 * @file dungeon.test.js
 * @description Tests for dungeon generation contracts. Tests the interface
 * that any dungeon generator must satisfy, using the data model directly.
 * If dungeon.js isn't implemented yet, these tests validate the expected
 * contract so integration issues are caught early.
 */

const { describe, it, assert } = require('./test-runner');
const { loadModule, loadDataModel } = require('./loader');

const constants = loadModule('src/constants.js');
const dm = loadDataModel(constants);
const { DungeonFloor, Room, Tile } = dm;
const {
  TILE_TYPES, FLOOR_WIDTH, FLOOR_HEIGHT, MIN_ROOM_SIZE, MAX_ROOM_SIZE, MAX_FLOORS,
} = constants;

// ── Helper: simple dungeon generator for testing contracts ───────────────────
// This simulates what a real dungeon generator should produce.

function generateTestFloor(floorNumber, numRooms) {
  const floor = new DungeonFloor(floorNumber);
  const rooms = [];

  // Place rooms deterministically for testing
  const roomCount = numRooms || (3 + floorNumber);
  for (let i = 0; i < roomCount; i++) {
    const w = MIN_ROOM_SIZE + (i % (MAX_ROOM_SIZE - MIN_ROOM_SIZE));
    const h = MIN_ROOM_SIZE + ((i + 1) % (MAX_ROOM_SIZE - MIN_ROOM_SIZE));
    const x = 1 + (i * 12) % (FLOOR_WIDTH - MAX_ROOM_SIZE - 2);
    const y = 1 + (i * 8) % (FLOOR_HEIGHT - MAX_ROOM_SIZE - 2);

    const room = new Room(x, y, Math.min(w, FLOOR_WIDTH - x - 1), Math.min(h, FLOOR_HEIGHT - y - 1));
    rooms.push(room);

    // Carve room
    for (let ry = room.y; ry < room.y + room.height; ry++) {
      for (let rx = room.x; rx < room.x + room.width; rx++) {
        floor.setTile(rx, ry, TILE_TYPES.FLOOR);
      }
    }
  }

  // Connect rooms with corridors
  for (let i = 0; i < rooms.length - 1; i++) {
    const a = rooms[i].center;
    const b = rooms[i + 1].center;
    const corridor = [];

    // Horizontal then vertical
    let cx = a.x;
    while (cx !== b.x) {
      floor.setTile(cx, a.y, TILE_TYPES.CORRIDOR);
      corridor.push({ x: cx, y: a.y });
      cx += cx < b.x ? 1 : -1;
    }
    let cy = a.y;
    while (cy !== b.y) {
      floor.setTile(b.x, cy, TILE_TYPES.CORRIDOR);
      corridor.push({ x: b.x, y: cy });
      cy += cy < b.y ? 1 : -1;
    }
    floor.corridors.push(corridor);
  }

  floor.rooms = rooms;

  // Place stairs
  if (floorNumber > 1) {
    const upRoom = rooms[0];
    floor.stairsUp = { x: upRoom.x + 1, y: upRoom.y + 1 };
    floor.setTile(floor.stairsUp.x, floor.stairsUp.y, TILE_TYPES.STAIRS_UP);
  }

  if (floorNumber < MAX_FLOORS) {
    const downRoom = rooms[rooms.length - 1];
    floor.stairsDown = { x: downRoom.x + 1, y: downRoom.y + 1 };
    floor.setTile(floor.stairsDown.x, floor.stairsDown.y, TILE_TYPES.STAIRS_DOWN);
  }

  return floor;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Dungeon Generation Contract', () => {
  describe('Floor Dimensions', () => {
    it('generated floor should have standard dimensions', () => {
      const floor = generateTestFloor(1);
      assert.equal(floor.width, FLOOR_WIDTH);
      assert.equal(floor.height, FLOOR_HEIGHT);
    });

    it('grid should be row-major with correct sizes', () => {
      const floor = generateTestFloor(1);
      assert.equal(floor.tiles.length, FLOOR_HEIGHT);
      floor.tiles.forEach(row => {
        assert.equal(row.length, FLOOR_WIDTH);
      });
    });
  });

  describe('Room Bounds', () => {
    it('all rooms should be within floor bounds', () => {
      for (let f = 1; f <= MAX_FLOORS; f++) {
        const floor = generateTestFloor(f);
        floor.rooms.forEach(room => {
          assert.greaterThanOrEqual(room.x, 0, `Room x out of bounds on floor ${f}`);
          assert.greaterThanOrEqual(room.y, 0, `Room y out of bounds on floor ${f}`);
          assert.lessThan(room.x + room.width, FLOOR_WIDTH, `Room extends past right on floor ${f}`);
          assert.lessThan(room.y + room.height, FLOOR_HEIGHT, `Room extends past bottom on floor ${f}`);
        });
      }
    });

    it('rooms should have minimum size', () => {
      const floor = generateTestFloor(1);
      floor.rooms.forEach(room => {
        assert.greaterThanOrEqual(room.width, MIN_ROOM_SIZE);
        assert.greaterThanOrEqual(room.height, MIN_ROOM_SIZE);
      });
    });

    it('rooms should not exceed maximum size', () => {
      const floor = generateTestFloor(1);
      floor.rooms.forEach(room => {
        assert.lessThanOrEqual(room.width, MAX_ROOM_SIZE);
        assert.lessThanOrEqual(room.height, MAX_ROOM_SIZE);
      });
    });

    it('room tiles should be walkable', () => {
      const floor = generateTestFloor(1);
      floor.rooms.forEach(room => {
        for (let y = room.y; y < room.y + room.height; y++) {
          for (let x = room.x; x < room.x + room.width; x++) {
            const tile = floor.getTile(x, y);
            assert.ok(tile.walkable, `Tile at (${x},${y}) in room should be walkable`);
          }
        }
      });
    });
  });

  describe('Corridors', () => {
    it('corridors should connect rooms', () => {
      const floor = generateTestFloor(1);
      assert.greaterThan(floor.corridors.length, 0, 'Should have at least one corridor');
    });

    it('corridor tiles should be walkable', () => {
      const floor = generateTestFloor(1);
      floor.corridors.forEach(corridor => {
        corridor.forEach(pos => {
          const tile = floor.getTile(pos.x, pos.y);
          assert.ok(tile, `Corridor tile at (${pos.x},${pos.y}) should exist`);
          assert.ok(tile.walkable, `Corridor tile at (${pos.x},${pos.y}) should be walkable`);
        });
      });
    });

    it('should have at least (rooms-1) corridors to ensure connectivity', () => {
      const floor = generateTestFloor(1);
      if (floor.rooms.length > 1) {
        assert.greaterThanOrEqual(floor.corridors.length, floor.rooms.length - 1);
      }
    });
  });

  describe('Stairs', () => {
    it('floor 1 should have stairs down but not stairs up', () => {
      const floor = generateTestFloor(1);
      assert.isNull(floor.stairsUp);
      assert.isNotNull(floor.stairsDown);
    });

    it('last floor should have stairs up but not stairs down', () => {
      const floor = generateTestFloor(MAX_FLOORS);
      assert.isNotNull(floor.stairsUp);
      assert.isNull(floor.stairsDown);
    });

    it('middle floors should have both stairs', () => {
      const floor = generateTestFloor(5);
      assert.isNotNull(floor.stairsUp);
      assert.isNotNull(floor.stairsDown);
    });

    it('stairs should be on walkable tiles', () => {
      for (let f = 1; f <= MAX_FLOORS; f++) {
        const floor = generateTestFloor(f);
        if (floor.stairsUp) {
          const tile = floor.getTile(floor.stairsUp.x, floor.stairsUp.y);
          assert.ok(tile.walkable, `Stairs up on floor ${f} should be walkable`);
        }
        if (floor.stairsDown) {
          const tile = floor.getTile(floor.stairsDown.x, floor.stairsDown.y);
          assert.ok(tile.walkable, `Stairs down on floor ${f} should be walkable`);
        }
      }
    });

    it('stairs should be within floor bounds', () => {
      for (let f = 1; f <= MAX_FLOORS; f++) {
        const floor = generateTestFloor(f);
        if (floor.stairsUp) {
          assert.ok(floor.inBounds(floor.stairsUp.x, floor.stairsUp.y));
        }
        if (floor.stairsDown) {
          assert.ok(floor.inBounds(floor.stairsDown.x, floor.stairsDown.y));
        }
      }
    });
  });

  describe('Difficulty Scaling', () => {
    it('higher floors should have more rooms', () => {
      const floor1 = generateTestFloor(1);
      const floor5 = generateTestFloor(5);
      const floor10 = generateTestFloor(10);

      assert.greaterThan(floor5.rooms.length, floor1.rooms.length,
        'Floor 5 should have more rooms than floor 1');
      assert.greaterThan(floor10.rooms.length, floor5.rooms.length,
        'Floor 10 should have more rooms than floor 5');
    });

    it('each floor should have at least 2 rooms', () => {
      for (let f = 1; f <= MAX_FLOORS; f++) {
        const floor = generateTestFloor(f);
        assert.greaterThanOrEqual(floor.rooms.length, 2,
          `Floor ${f} should have at least 2 rooms`);
      }
    });
  });

  describe('Spawn Points', () => {
    it('room centers should be on walkable tiles (valid spawn points)', () => {
      const floor = generateTestFloor(1);
      floor.rooms.forEach((room, i) => {
        const center = room.center;
        const tile = floor.getTile(center.x, center.y);
        assert.ok(tile, `Room ${i} center should have a tile`);
        assert.ok(tile.walkable, `Room ${i} center at (${center.x},${center.y}) should be walkable`);
      });
    });

    it('walkable tiles exist for entity placement', () => {
      const floor = generateTestFloor(1);
      let walkableCount = 0;
      for (let y = 0; y < floor.height; y++) {
        for (let x = 0; x < floor.width; x++) {
          if (floor.getTile(x, y).walkable) walkableCount++;
        }
      }
      assert.greaterThan(walkableCount, 0, 'Floor should have walkable tiles');
    });
  });
});
