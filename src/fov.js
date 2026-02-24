/**
 * @file fov.js
 * @description Field of view / fog of war system using recursive shadowcasting.
 * Updates tile visibility flags on the dungeon floor.
 */

import { FOV_RADIUS, CLASS_TYPES } from './constants.js';
import { registerHook } from './game.js';

// ── Vision radius per class ──────────────────────────────────────────────────

const CLASS_VISION_RADIUS = {
  [CLASS_TYPES.WARRIOR]: FOV_RADIUS,
  [CLASS_TYPES.MAGE]:    FOV_RADIUS,
  [CLASS_TYPES.ROGUE]:   FOV_RADIUS + 2,
};

// ── Octant multipliers for recursive shadowcasting ───────────────────────────

const OCTANT_MULTIPLIERS = [
  [1,  0,  0,  1],
  [0,  1,  1,  0],
  [0, -1,  1,  0],
  [-1, 0,  0,  1],
  [-1, 0,  0, -1],
  [0, -1, -1,  0],
  [0,  1, -1,  0],
  [1,  0,  0, -1],
];

// ── Recursive shadowcasting ──────────────────────────────────────────────────

/**
 * Cast light in one octant using recursive shadowcasting.
 * @param {import('./data-model.js').DungeonFloor} floor
 * @param {Set<string>} visible - Set of "x,y" keys
 * @param {number} cx - Origin x
 * @param {number} cy - Origin y
 * @param {number} radius
 * @param {number} row
 * @param {number} startSlope
 * @param {number} endSlope
 * @param {number} xx - Octant transform
 * @param {number} xy
 * @param {number} yx
 * @param {number} yy
 */
function castLight(floor, visible, cx, cy, radius, row, startSlope, endSlope, xx, xy, yx, yy) {
  if (startSlope < endSlope) return;

  let nextStartSlope = startSlope;

  for (let i = row; i <= radius; i++) {
    let blocked = false;

    for (let dx = -i, dy = -i; dx <= 0; dx++) {
      const mapX = cx + dx * xx + dy * xy;
      const mapY = cy + dx * yx + dy * yy;

      const leftSlope  = (dx - 0.5) / (dy + 0.5);
      const rightSlope = (dx + 0.5) / (dy - 0.5);

      if (startSlope < rightSlope) continue;
      if (endSlope > leftSlope) break;

      // Tile is within radius (Euclidean check)
      const distSq = dx * dx + dy * dy;
      if (distSq <= radius * radius) {
        if (floor.inBounds(mapX, mapY)) {
          visible.add(`${mapX},${mapY}`);
        }
      }

      const tile = floor.getTile(mapX, mapY);
      const isOpaque = !tile || tile.opaque;

      if (blocked) {
        if (isOpaque) {
          nextStartSlope = rightSlope;
        } else {
          blocked = false;
          startSlope = nextStartSlope;
        }
      } else if (isOpaque && i < radius) {
        blocked = true;
        castLight(floor, visible, cx, cy, radius, i + 1, startSlope, leftSlope, xx, xy, yx, yy);
        nextStartSlope = rightSlope;
      }
    }

    if (blocked) break;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute field of view from a position using recursive shadowcasting.
 * Updates tile.visible and tile.explored flags on the dungeon floor.
 * @param {import('./data-model.js').DungeonFloor} dungeonFloor
 * @param {{x: number, y: number}} playerPosition
 * @param {number} [visionRadius]
 * @returns {Set<string>} Set of "x,y" coordinate keys that are visible
 */
export function computeFOV(dungeonFloor, playerPosition, visionRadius = FOV_RADIUS) {
  const visible = new Set();
  const { x: cx, y: cy } = playerPosition;

  // Player's own tile is always visible
  visible.add(`${cx},${cy}`);

  // Cast light in all 8 octants
  for (const [xx, xy, yx, yy] of OCTANT_MULTIPLIERS) {
    castLight(dungeonFloor, visible, cx, cy, visionRadius, 1, 1.0, 0.0, xx, xy, yx, yy);
  }

  // Clear all visibility, then apply computed FOV
  for (let y = 0; y < dungeonFloor.height; y++) {
    for (let x = 0; x < dungeonFloor.width; x++) {
      dungeonFloor.tiles[y][x].visible = false;
    }
  }

  for (const key of visible) {
    const [x, y] = key.split(',').map(Number);
    const tile = dungeonFloor.getTile(x, y);
    if (tile) {
      tile.visible = true;
      tile.explored = true;
    }
  }

  return visible;
}

// ── Hook registration ────────────────────────────────────────────────────────

registerHook('computeFov', (state) => {
  if (!state.dungeonFloor || !state.player) return;
  const radius = CLASS_VISION_RADIUS[state.player.classType] ?? FOV_RADIUS;
  computeFOV(state.dungeonFloor, state.player.pos, radius);
});
