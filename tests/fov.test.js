/**
 * @file fov.test.js
 * @description Tests for the fog of war / field of view contracts:
 * player visibility, wall blocking, explored state, vision radius.
 */

const { describe, it, assert } = require('./test-runner');
const { loadModule, loadDataModel } = require('./loader');

const constants = loadModule('src/constants.js');
const utils = loadModule('src/utils.js');
const dm = loadDataModel(constants);
const { DungeonFloor, Tile } = dm;
const { TILE_TYPES, FOV_RADIUS } = constants;
const { euclideanDistance, bresenhamLine } = utils;

// ── FOV implementation for testing contracts ─────────────────────────────────

/**
 * Compute field of view using raycasting.
 * Sets tile.visible for tiles within radius that have unobstructed line of sight.
 * Previously visible tiles become explored.
 */
function computeFOV(floor, playerPos, radius) {
  // First: mark all tiles as not visible, preserve explored
  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      const tile = floor.getTile(x, y);
      if (tile.visible) tile.explored = true;
      tile.visible = false;
    }
  }

  // Player tile is always visible
  const playerTile = floor.getTile(playerPos.x, playerPos.y);
  if (playerTile) {
    playerTile.visible = true;
    playerTile.explored = true;
  }

  // Cast rays in all directions
  const steps = 360;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const targetX = Math.round(playerPos.x + Math.cos(angle) * radius);
    const targetY = Math.round(playerPos.y + Math.sin(angle) * radius);

    const line = bresenhamLine(playerPos, { x: targetX, y: targetY });
    for (const point of line) {
      if (!floor.inBounds(point.x, point.y)) break;

      const tile = floor.getTile(point.x, point.y);
      const dist = euclideanDistance(playerPos, point);
      if (dist > radius) break;

      tile.visible = true;
      tile.explored = true;

      // Stop at opaque tiles (but mark the wall itself as visible)
      if (tile.opaque) break;
    }
  }
}

// ── Helper to create a test map ──────────────────────────────────────────────

function createTestMap(width, height) {
  const floor = new DungeonFloor(1, width, height);
  // Carve out an open room in the center
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      floor.setTile(x, y, TILE_TYPES.FLOOR);
    }
  }
  return floor;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Field of View', () => {
  describe('Player Visibility', () => {
    it('player position should always be visible', () => {
      const floor = createTestMap(20, 20);
      const playerPos = { x: 10, y: 10 };
      computeFOV(floor, playerPos, FOV_RADIUS);

      const tile = floor.getTile(playerPos.x, playerPos.y);
      assert.equal(tile.visible, true);
    });

    it('player tile should be explored after FOV computation', () => {
      const floor = createTestMap(20, 20);
      const playerPos = { x: 10, y: 10 };
      computeFOV(floor, playerPos, FOV_RADIUS);

      const tile = floor.getTile(playerPos.x, playerPos.y);
      assert.equal(tile.explored, true);
    });

    it('tiles near player should be visible in open room', () => {
      const floor = createTestMap(30, 30);
      const playerPos = { x: 15, y: 15 };
      computeFOV(floor, playerPos, FOV_RADIUS);

      // Adjacent tiles should be visible
      const adjacent = [
        { x: 14, y: 15 }, { x: 16, y: 15 },
        { x: 15, y: 14 }, { x: 15, y: 16 },
      ];
      adjacent.forEach(pos => {
        const tile = floor.getTile(pos.x, pos.y);
        assert.equal(tile.visible, true, `Tile (${pos.x},${pos.y}) should be visible`);
      });
    });
  });

  describe('Wall Blocking', () => {
    it('walls should block line of sight', () => {
      const floor = new DungeonFloor(1, 20, 20);
      // Create a room with a wall in the middle
      for (let y = 1; y < 19; y++) {
        for (let x = 1; x < 19; x++) {
          floor.setTile(x, y, TILE_TYPES.FLOOR);
        }
      }
      // Place a wall blocking east of player
      floor.setTile(12, 10, TILE_TYPES.WALL);

      const playerPos = { x: 10, y: 10 };
      computeFOV(floor, playerPos, FOV_RADIUS);

      // Wall itself should be visible
      assert.equal(floor.getTile(12, 10).visible, true, 'Wall should be visible');

      // Tile directly behind wall should not be visible
      const behindWall = floor.getTile(13, 10);
      assert.equal(behindWall.visible, false, 'Tile behind wall should not be visible');
    });

    it('doors should block line of sight (opaque)', () => {
      const tile = new Tile(TILE_TYPES.DOOR);
      assert.equal(tile.opaque, true, 'Doors should be opaque');
      assert.equal(tile.walkable, true, 'Doors should be walkable');
    });

    it('floor tiles should not block line of sight', () => {
      const tile = new Tile(TILE_TYPES.FLOOR);
      assert.equal(tile.opaque, false, 'Floor tiles should not be opaque');
    });

    it('corridor tiles should not block line of sight', () => {
      const tile = new Tile(TILE_TYPES.CORRIDOR);
      assert.equal(tile.opaque, false, 'Corridor tiles should not be opaque');
    });
  });

  describe('Explored State', () => {
    it('previously visible tiles should become explored', () => {
      const floor = createTestMap(30, 30);

      // First FOV computation at position A
      const posA = { x: 10, y: 10 };
      computeFOV(floor, posA, FOV_RADIUS);

      // Mark a tile near posA that was visible
      const nearA = floor.getTile(11, 10);
      assert.equal(nearA.visible, true);
      assert.equal(nearA.explored, true);

      // Second FOV computation at distant position B
      const posB = { x: 25, y: 25 };
      computeFOV(floor, posB, FOV_RADIUS);

      // Tile near A should now be explored but not visible
      assert.equal(nearA.visible, false, 'Tile should no longer be visible from new position');
      assert.equal(nearA.explored, true, 'Tile should remain explored');
    });

    it('unexplored tiles should not be visible or explored', () => {
      const floor = createTestMap(50, 50);
      const playerPos = { x: 5, y: 5 };
      computeFOV(floor, playerPos, FOV_RADIUS);

      // Far away tile should not be visible or explored
      const farTile = floor.getTile(45, 45);
      assert.equal(farTile.visible, false);
      assert.equal(farTile.explored, false);
    });

    it('explored tiles should persist through multiple FOV updates', () => {
      const floor = createTestMap(30, 30);

      computeFOV(floor, { x: 5, y: 5 }, FOV_RADIUS);
      const tile = floor.getTile(6, 5);
      assert.equal(tile.explored, true);

      computeFOV(floor, { x: 25, y: 25 }, FOV_RADIUS);
      assert.equal(tile.explored, true, 'Explored state should persist');

      computeFOV(floor, { x: 15, y: 15 }, FOV_RADIUS);
      assert.equal(tile.explored, true, 'Explored state should persist through multiple moves');
    });
  });

  describe('Vision Radius', () => {
    it('FOV_RADIUS should be 8 tiles', () => {
      assert.equal(FOV_RADIUS, 8);
    });

    it('tiles within radius should be visible in open space', () => {
      const floor = createTestMap(30, 30);
      const playerPos = { x: 15, y: 15 };
      computeFOV(floor, playerPos, FOV_RADIUS);

      // Tile within radius
      const nearTile = floor.getTile(15 + FOV_RADIUS - 2, 15);
      assert.equal(nearTile.visible, true, 'Tile within radius should be visible');
    });

    it('tiles beyond radius should not be visible', () => {
      const floor = createTestMap(40, 40);
      const playerPos = { x: 15, y: 15 };
      computeFOV(floor, playerPos, FOV_RADIUS);

      // Tile well beyond radius
      const farTile = floor.getTile(15 + FOV_RADIUS + 3, 15);
      assert.equal(farTile.visible, false, 'Tile beyond radius should not be visible');
    });

    it('vision should work in all directions', () => {
      const floor = createTestMap(30, 30);
      const playerPos = { x: 15, y: 15 };
      computeFOV(floor, playerPos, FOV_RADIUS);

      // Check tiles 3 away in each cardinal direction
      const dist = 3;
      const dirs = [
        { x: 15 + dist, y: 15 },     // east
        { x: 15 - dist, y: 15 },     // west
        { x: 15, y: 15 + dist },     // south
        { x: 15, y: 15 - dist },     // north
        { x: 15 + dist, y: 15 + dist }, // SE
        { x: 15 - dist, y: 15 - dist }, // NW
      ];

      dirs.forEach(pos => {
        const tile = floor.getTile(pos.x, pos.y);
        assert.equal(tile.visible, true, `Tile at (${pos.x},${pos.y}) should be visible`);
      });
    });

    it('custom radius should be respected', () => {
      const floor = createTestMap(30, 30);
      const playerPos = { x: 15, y: 15 };
      const smallRadius = 3;
      computeFOV(floor, playerPos, smallRadius);

      // Tile at distance 2 should be visible
      assert.equal(floor.getTile(17, 15).visible, true);

      // Tile at distance 5 should NOT be visible with radius 3
      assert.equal(floor.getTile(20, 15).visible, false);
    });
  });
});
