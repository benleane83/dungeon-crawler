/**
 * @file renderer.js
 * @description Complete Canvas rendering engine — tilemap, fog of war,
 * entities, items, UI overlays (minimap, message log, inventory).
 */

import {
  TILE_SIZE, VIEWPORT_WIDTH_TILES, VIEWPORT_HEIGHT_TILES,
  TILE_COLORS, TILE_TYPES, ENTITY_COLORS, ENTITY_TYPES,
  ENEMY_TYPES, CLASS_TYPES, ITEM_TYPES,
} from './constants.js';
import { registerHook, getState } from './game.js';

// ── State ────────────────────────────────────────────────────────────────────

/** @type {CanvasRenderingContext2D|null} */
let ctx = null;

/** @type {HTMLCanvasElement|null} */
let canvas = null;

/** Message log for on-canvas display */
const messages = [];
const MAX_MESSAGES = 5;

/** Damage flash effects: [{x, y, alpha, color}] */
const flashes = [];

/** Whether inventory panel is open */
let inventoryOpen = false;

/** Whether help overlay is open */
let helpOpen = false;

// ── Player colors by class ───────────────────────────────────────────────────

const PLAYER_COLORS = {
  [CLASS_TYPES.WARRIOR]: '#e94560',
  [CLASS_TYPES.MAGE]:    '#4ea8de',
  [CLASS_TYPES.ROGUE]:   '#50fa7b',
};

// ── Enemy colors by type ─────────────────────────────────────────────────────
// Falls back to ENTITY_COLORS from constants.js

// ── Item dot colors ──────────────────────────────────────────────────────────

const ITEM_DOT_COLORS = {
  [ITEM_TYPES.WEAPON]:  '#ff6666',
  [ITEM_TYPES.ARMOR]:   '#6699ff',
  [ITEM_TYPES.POTION]:  '#ff66ff',
  [ITEM_TYPES.SCROLL]:  '#ffff66',
};

// ── Camera ───────────────────────────────────────────────────────────────────

/**
 * Compute camera offset so the player is centered in the viewport.
 * @param {{x:number,y:number}} playerPos
 * @param {number} mapWidth
 * @param {number} mapHeight
 * @returns {{x:number, y:number}} top-left tile of the viewport
 */
function getCamera(playerPos, mapWidth, mapHeight) {
  const halfW = Math.floor(VIEWPORT_WIDTH_TILES / 2);
  const halfH = Math.floor(VIEWPORT_HEIGHT_TILES / 2);

  let camX = playerPos.x - halfW;
  let camY = playerPos.y - halfH;

  // Clamp to map bounds
  camX = Math.max(0, Math.min(camX, mapWidth - VIEWPORT_WIDTH_TILES));
  camY = Math.max(0, Math.min(camY, mapHeight - VIEWPORT_HEIGHT_TILES));

  return { x: camX, y: camY };
}

// ── Tile rendering ───────────────────────────────────────────────────────────

function renderTiles(state, cam) {
  const floor = state.dungeonFloor;
  if (!floor) return;

  for (let vy = 0; vy < VIEWPORT_HEIGHT_TILES; vy++) {
    for (let vx = 0; vx < VIEWPORT_WIDTH_TILES; vx++) {
      const mx = cam.x + vx;
      const my = cam.y + vy;
      const px = vx * TILE_SIZE;
      const py = vy * TILE_SIZE;

      const tile = floor.getTile(mx, my);
      if (!tile) {
        // Out of bounds — black
        ctx.fillStyle = '#000';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        continue;
      }

      if (!tile.explored) {
        // Unexplored — solid black
        ctx.fillStyle = '#000';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        continue;
      }

      // Draw tile base color
      ctx.fillStyle = TILE_COLORS[tile.type] ?? '#555';
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      if (!tile.visible) {
        // Explored but not visible — dark overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

// ── Item rendering ───────────────────────────────────────────────────────────

function renderItems(state, cam) {
  const floor = state.dungeonFloor;
  if (!floor) return;

  for (let vy = 0; vy < VIEWPORT_HEIGHT_TILES; vy++) {
    for (let vx = 0; vx < VIEWPORT_WIDTH_TILES; vx++) {
      const mx = cam.x + vx;
      const my = cam.y + vy;
      const tile = floor.getTile(mx, my);
      if (!tile || !tile.visible || tile.itemIds.length === 0) continue;

      const px = vx * TILE_SIZE;
      const py = vy * TILE_SIZE;

      // Draw a small colored dot for each item (max 3 dots)
      const count = Math.min(tile.itemIds.length, 3);
      for (let i = 0; i < count; i++) {
        const item = state.items.get(tile.itemIds[i]);
        if (!item) continue;
        ctx.fillStyle = ITEM_DOT_COLORS[item.type] ?? '#fff';
        ctx.beginPath();
        ctx.arc(
          px + 10 + i * 8,
          py + TILE_SIZE - 8,
          3, 0, Math.PI * 2,
        );
        ctx.fill();
      }
    }
  }
}

// ── Sprite Drawing Functions ─────────────────────────────────────────────────

/**
 * Draw warrior sprite — armored figure with sword/shield
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawWarriorSprite(x, y) {
  const cx = x + 12;
  const cy = y + 12;
  
  // Helmet
  ctx.fillStyle = '#c0c0c0';
  ctx.fillRect(cx - 3, cy - 8, 6, 5);
  
  // Body (armor)
  ctx.fillStyle = '#e94560';
  ctx.fillRect(cx - 4, cy - 3, 8, 8);
  
  // Arms
  ctx.fillStyle = '#c0c0c0';
  ctx.fillRect(cx - 6, cy - 2, 2, 6);
  ctx.fillRect(cx + 4, cy - 2, 2, 6);
  
  // Shield (left)
  ctx.fillStyle = '#888';
  ctx.fillRect(cx - 8, cy - 1, 2, 5);
  
  // Sword (right)
  ctx.fillStyle = '#aaa';
  ctx.fillRect(cx + 6, cy - 3, 1, 7);
  ctx.fillStyle = '#666';
  ctx.fillRect(cx + 5, cy + 3, 3, 2);
  
  // Legs
  ctx.fillStyle = '#a03040';
  ctx.fillRect(cx - 3, cy + 5, 2, 5);
  ctx.fillRect(cx + 1, cy + 5, 2, 5);
}

/**
 * Draw mage sprite — robed figure with staff
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawMageSprite(x, y) {
  const cx = x + 12;
  const cy = y + 12;
  
  // Hat
  ctx.fillStyle = '#3060a0';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 9);
  ctx.lineTo(cx - 4, cy - 4);
  ctx.lineTo(cx + 4, cy - 4);
  ctx.closePath();
  ctx.fill();
  
  // Head
  ctx.fillStyle = '#ffcc99';
  ctx.fillRect(cx - 2, cy - 4, 4, 4);
  
  // Robe
  ctx.fillStyle = '#4ea8de';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - 5, cy + 10);
  ctx.lineTo(cx + 5, cy + 10);
  ctx.closePath();
  ctx.fill();
  
  // Arms
  ctx.fillStyle = '#3080b0';
  ctx.fillRect(cx - 6, cy + 1, 2, 5);
  ctx.fillRect(cx + 4, cy + 1, 2, 5);
  
  // Staff
  ctx.fillStyle = '#8b4513';
  ctx.fillRect(cx + 6, cy - 5, 1, 14);
  
  // Staff orb
  ctx.fillStyle = '#88f';
  ctx.beginPath();
  ctx.arc(cx + 6.5, cy - 6, 2, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Draw rogue sprite — hooded/cloaked figure with dagger
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawRogueSprite(x, y) {
  const cx = x + 12;
  const cy = y + 12;
  
  // Hood
  ctx.fillStyle = '#2a4a2a';
  ctx.beginPath();
  ctx.arc(cx, cy - 5, 5, 0, Math.PI * 2);
  ctx.fill();
  
  // Face shadow
  ctx.fillStyle = '#111';
  ctx.fillRect(cx - 2, cy - 4, 4, 3);
  
  // Cloak
  ctx.fillStyle = '#50fa7b';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 2);
  ctx.lineTo(cx - 6, cy + 10);
  ctx.lineTo(cx + 6, cy + 10);
  ctx.closePath();
  ctx.fill();
  
  // Body
  ctx.fillStyle = '#3a5a3a';
  ctx.fillRect(cx - 3, cy, 6, 6);
  
  // Dagger
  ctx.fillStyle = '#ccc';
  ctx.fillRect(cx + 5, cy + 2, 1, 4);
  ctx.fillStyle = '#444';
  ctx.fillRect(cx + 4, cy + 5, 3, 1);
  
  // Legs
  ctx.fillStyle = '#2a4a2a';
  ctx.fillRect(cx - 3, cy + 6, 2, 4);
  ctx.fillRect(cx + 1, cy + 6, 2, 4);
}

/**
 * Draw skeleton sprite — bony figure, white/gray
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawSkeletonSprite(x, y) {
  const cx = x + 12;
  const cy = y + 12;
  
  // Skull
  ctx.fillStyle = '#eee';
  ctx.fillRect(cx - 3, cy - 7, 6, 6);
  
  // Eye sockets
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 2, cy - 5, 1, 2);
  ctx.fillRect(cx + 1, cy - 5, 1, 2);
  
  // Spine
  ctx.fillStyle = '#ddd';
  ctx.fillRect(cx - 1, cy - 1, 2, 8);
  
  // Ribs
  ctx.fillStyle = '#ccc';
  ctx.fillRect(cx - 3, cy + 1, 6, 1);
  ctx.fillRect(cx - 3, cy + 3, 6, 1);
  
  // Arm bones
  ctx.fillRect(cx - 5, cy, 2, 1);
  ctx.fillRect(cx + 3, cy, 2, 1);
  
  // Leg bones
  ctx.fillRect(cx - 2, cy + 7, 1, 3);
  ctx.fillRect(cx + 1, cy + 7, 1, 3);
}

/**
 * Draw goblin sprite — small green creature
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawGoblinSprite(x, y) {
  const cx = x + 12;
  const cy = y + 13;
  
  // Head (large)
  ctx.fillStyle = '#66cc33';
  ctx.fillRect(cx - 4, cy - 6, 8, 6);
  
  // Ears
  ctx.fillStyle = '#55aa22';
  ctx.fillRect(cx - 5, cy - 5, 1, 3);
  ctx.fillRect(cx + 4, cy - 5, 1, 3);
  
  // Eyes
  ctx.fillStyle = '#ff0';
  ctx.fillRect(cx - 2, cy - 4, 1, 1);
  ctx.fillRect(cx + 1, cy - 4, 1, 1);
  
  // Body (small)
  ctx.fillStyle = '#5a8830';
  ctx.fillRect(cx - 3, cy, 6, 5);
  
  // Arms
  ctx.fillStyle = '#66cc33';
  ctx.fillRect(cx - 5, cy + 1, 2, 3);
  ctx.fillRect(cx + 3, cy + 1, 2, 3);
  
  // Legs
  ctx.fillRect(cx - 2, cy + 5, 2, 3);
  ctx.fillRect(cx, cy + 5, 2, 3);
}

/**
 * Draw orc sprite — bulky green/brown creature
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawOrcSprite(x, y) {
  const cx = x + 12;
  const cy = y + 12;
  
  // Head
  ctx.fillStyle = '#8a9a5a';
  ctx.fillRect(cx - 4, cy - 7, 8, 6);
  
  // Tusks
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - 3, cy - 2, 1, 2);
  ctx.fillRect(cx + 2, cy - 2, 1, 2);
  
  // Eyes
  ctx.fillStyle = '#f00';
  ctx.fillRect(cx - 2, cy - 5, 2, 1);
  ctx.fillRect(cx, cy - 5, 2, 1);
  
  // Body (broad)
  ctx.fillStyle = '#6a5a3a';
  ctx.fillRect(cx - 5, cy - 1, 10, 7);
  
  // Arms
  ctx.fillStyle = '#8a9a5a';
  ctx.fillRect(cx - 7, cy, 2, 5);
  ctx.fillRect(cx + 5, cy, 2, 5);
  
  // Legs
  ctx.fillStyle = '#5a4a2a';
  ctx.fillRect(cx - 3, cy + 6, 2, 4);
  ctx.fillRect(cx + 1, cy + 6, 2, 4);
}

/**
 * Draw wraith sprite — ghostly floating figure, purple
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawWraithSprite(x, y) {
  const cx = x + 12;
  const cy = y + 12;
  
  // Hood
  ctx.fillStyle = '#7733aa';
  ctx.beginPath();
  ctx.arc(cx, cy - 4, 5, 0, Math.PI * 2);
  ctx.fill();
  
  // Face void
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 2, cy - 3, 4, 4);
  
  // Eyes (glowing)
  ctx.fillStyle = '#f0f';
  ctx.fillRect(cx - 2, cy - 2, 1, 1);
  ctx.fillRect(cx + 1, cy - 2, 1, 1);
  
  // Body (wispy, fading)
  ctx.fillStyle = 'rgba(153, 102, 255, 0.8)';
  ctx.beginPath();
  ctx.moveTo(cx, cy + 1);
  ctx.lineTo(cx - 5, cy + 6);
  ctx.lineTo(cx - 3, cy + 9);
  ctx.lineTo(cx + 3, cy + 9);
  ctx.lineTo(cx + 5, cy + 6);
  ctx.closePath();
  ctx.fill();
  
  // Tattered edges
  ctx.fillStyle = 'rgba(119, 51, 170, 0.5)';
  ctx.fillRect(cx - 6, cy + 7, 2, 2);
  ctx.fillRect(cx + 4, cy + 7, 2, 2);
}

/**
 * Draw dragon sprite — large red/orange creature with wings
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawDragonSprite(x, y) {
  const cx = x + 12;
  const cy = y + 12;
  
  // Wings
  ctx.fillStyle = '#cc5533';
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy);
  ctx.lineTo(cx - 4, cy - 3);
  ctx.lineTo(cx - 4, cy + 3);
  ctx.closePath();
  ctx.fill();
  
  ctx.beginPath();
  ctx.moveTo(cx + 8, cy);
  ctx.lineTo(cx + 4, cy - 3);
  ctx.lineTo(cx + 4, cy + 3);
  ctx.closePath();
  ctx.fill();
  
  // Body
  ctx.fillStyle = '#ff3333';
  ctx.fillRect(cx - 4, cy - 2, 8, 6);
  
  // Head
  ctx.fillStyle = '#ff4444';
  ctx.fillRect(cx - 3, cy - 6, 6, 4);
  
  // Horns
  ctx.fillStyle = '#aa2222';
  ctx.fillRect(cx - 3, cy - 8, 1, 2);
  ctx.fillRect(cx + 2, cy - 8, 1, 2);
  
  // Eyes
  ctx.fillStyle = '#ff0';
  ctx.fillRect(cx - 2, cy - 5, 1, 1);
  ctx.fillRect(cx + 1, cy - 5, 1, 1);
  
  // Tail
  ctx.fillStyle = '#ee3333';
  ctx.fillRect(cx + 4, cy + 2, 3, 2);
  ctx.fillRect(cx + 6, cy + 3, 2, 1);
  
  // Legs
  ctx.fillStyle = '#dd2222';
  ctx.fillRect(cx - 3, cy + 4, 2, 4);
  ctx.fillRect(cx + 1, cy + 4, 2, 4);
}

/**
 * Draw rat sprite — small brown creature
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawRatSprite(x, y) {
  const cx = x + 12;
  const cy = y + 14;
  
  // Body (oval)
  ctx.fillStyle = '#8b6f47';
  ctx.fillRect(cx - 4, cy - 2, 6, 4);
  
  // Head
  ctx.fillStyle = '#9a7f57';
  ctx.fillRect(cx - 5, cy - 3, 3, 3);
  
  // Ears
  ctx.fillStyle = '#aa8855';
  ctx.fillRect(cx - 5, cy - 5, 2, 2);
  ctx.fillRect(cx - 3, cy - 4, 1, 1);
  
  // Eye
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 4, cy - 2, 1, 1);
  
  // Tail
  ctx.fillStyle = '#7a5f37';
  ctx.fillRect(cx + 2, cy, 3, 1);
  ctx.fillRect(cx + 4, cy + 1, 2, 1);
  
  // Legs
  ctx.fillStyle = '#6b5f37';
  ctx.fillRect(cx - 3, cy + 2, 1, 2);
  ctx.fillRect(cx, cy + 2, 1, 2);
}

/**
 * Draw slime sprite — blob shape, teal
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawSlimeSprite(x, y) {
  const cx = x + 12;
  const cy = y + 14;
  
  // Base blob
  ctx.fillStyle = '#33cc99';
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();
  
  // Shine highlights
  ctx.fillStyle = '#66ffcc';
  ctx.fillRect(cx - 2, cy - 3, 2, 2);
  ctx.fillRect(cx + 1, cy - 4, 1, 1);
  
  // Eyes (simple dots)
  ctx.fillStyle = '#003322';
  ctx.fillRect(cx - 2, cy - 1, 1, 2);
  ctx.fillRect(cx + 1, cy - 1, 1, 2);
  
  // Bottom (darker, ground contact)
  ctx.fillStyle = 'rgba(0, 100, 80, 0.5)';
  ctx.fillRect(cx - 6, cy + 4, 12, 2);
}

/**
 * Draw dark mage sprite — dark robed figure, purple
 * @param {number} x - top-left pixel x
 * @param {number} y - top-left pixel y
 */
function drawDarkMageSprite(x, y) {
  const cx = x + 12;
  const cy = y + 12;
  
  // Hood (dark)
  ctx.fillStyle = '#330033';
  ctx.beginPath();
  ctx.arc(cx, cy - 4, 5, 0, Math.PI * 2);
  ctx.fill();
  
  // Face shadow (hidden)
  ctx.fillStyle = '#000';
  ctx.fillRect(cx - 3, cy - 3, 6, 4);
  
  // Eyes (glowing purple)
  ctx.fillStyle = '#cc33ff';
  ctx.fillRect(cx - 2, cy - 2, 1, 1);
  ctx.fillRect(cx + 1, cy - 2, 1, 1);
  
  // Robe
  ctx.fillStyle = '#660066';
  ctx.beginPath();
  ctx.moveTo(cx, cy + 1);
  ctx.lineTo(cx - 6, cy + 10);
  ctx.lineTo(cx + 6, cy + 10);
  ctx.closePath();
  ctx.fill();
  
  // Arms/sleeves
  ctx.fillStyle = '#550055';
  ctx.fillRect(cx - 7, cy + 2, 2, 5);
  ctx.fillRect(cx + 5, cy + 2, 2, 5);
  
  // Staff
  ctx.fillStyle = '#2a0a2a';
  ctx.fillRect(cx - 7, cy - 3, 1, 10);
  
  // Staff orb (purple)
  ctx.fillStyle = '#ff00ff';
  ctx.beginPath();
  ctx.arc(cx - 6.5, cy - 4, 2, 0, Math.PI * 2);
  ctx.fill();
}

// ── Entity rendering ─────────────────────────────────────────────────────────

function renderEntities(state, cam) {
  const floor = state.dungeonFloor;
  if (!floor) return;

  for (const entity of state.entities.values()) {
    if (!entity.alive) continue;

    const tile = floor.getTile(entity.pos.x, entity.pos.y);
    if (!tile || !tile.visible) continue;

    const vx = entity.pos.x - cam.x;
    const vy = entity.pos.y - cam.y;
    if (vx < 0 || vx >= VIEWPORT_WIDTH_TILES || vy < 0 || vy >= VIEWPORT_HEIGHT_TILES) continue;

    const px = vx * TILE_SIZE;
    const py = vy * TILE_SIZE;
    const inset = 4;

    // Draw sprite based on entity type
    if (entity.entityType === ENTITY_TYPES.PLAYER) {
      if (entity.classType === CLASS_TYPES.WARRIOR) {
        drawWarriorSprite(px + inset, py + inset);
      } else if (entity.classType === CLASS_TYPES.MAGE) {
        drawMageSprite(px + inset, py + inset);
      } else if (entity.classType === CLASS_TYPES.ROGUE) {
        drawRogueSprite(px + inset, py + inset);
      }
    } else {
      // Enemy sprites
      const enemyType = entity.classType; // classType stores enemy type for enemies
      if (enemyType === ENEMY_TYPES.SKELETON) {
        drawSkeletonSprite(px + inset, py + inset);
      } else if (enemyType === ENEMY_TYPES.GOBLIN) {
        drawGoblinSprite(px + inset, py + inset);
      } else if (enemyType === ENEMY_TYPES.ORC) {
        drawOrcSprite(px + inset, py + inset);
      } else if (enemyType === ENEMY_TYPES.WRAITH) {
        drawWraithSprite(px + inset, py + inset);
      } else if (enemyType === ENEMY_TYPES.DRAGON) {
        drawDragonSprite(px + inset, py + inset);
      } else if (enemyType === ENEMY_TYPES.RAT) {
        drawRatSprite(px + inset, py + inset);
      } else if (enemyType === ENEMY_TYPES.SLIME) {
        drawSlimeSprite(px + inset, py + inset);
      } else if (enemyType === ENEMY_TYPES.DARK_MAGE) {
        drawDarkMageSprite(px + inset, py + inset);
      }
    }

    // Enemy HP indicator (thin bar above)
    if (entity.entityType !== ENTITY_TYPES.PLAYER && entity.hp < entity.maxHp) {
      const ratio = entity.hp / entity.maxHp;
      ctx.fillStyle = '#e94560';
      ctx.fillRect(px + 2, py + 1, (TILE_SIZE - 4) * ratio, 2);
    }
  }
}

// ── Damage flash effects ─────────────────────────────────────────────────────

function renderFlashes(cam) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const vx = f.x - cam.x;
    const vy = f.y - cam.y;
    if (vx < 0 || vx >= VIEWPORT_WIDTH_TILES || vy < 0 || vy >= VIEWPORT_HEIGHT_TILES) {
      flashes.splice(i, 1);
      continue;
    }
    ctx.fillStyle = `rgba(255, 70, 70, ${f.alpha})`;
    ctx.fillRect(vx * TILE_SIZE, vy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    f.alpha -= 0.05;
    if (f.alpha <= 0) flashes.splice(i, 1);
  }
}

// ── Stat bars (on-canvas) ────────────────────────────────────────────────────

function renderStatBars(state) {
  const p = state.player;
  if (!p) return;

  const barX = 8;
  const barW = 160;
  const barH = 10;
  const gap = 14;
  let y = canvas.height - 56;

  const bars = [
    { label: 'HP', cur: p.hp, max: p.maxHp, color: '#e94560' },
    { label: 'MP', cur: p.mp, max: p.maxMp, color: '#4ea8de' },
    { label: 'SP', cur: p.stamina, max: p.maxStamina, color: '#f0c040' },
  ];

  for (const bar of bars) {
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(barX, y, barW, barH);
    // Fill
    const ratio = bar.max > 0 ? bar.cur / bar.max : 0;
    ctx.fillStyle = bar.color;
    ctx.fillRect(barX, y, barW * ratio, barH);
    // Label
    ctx.fillStyle = '#fff';
    ctx.font = '9px Courier New';
    ctx.fillText(`${bar.label}: ${bar.cur}/${bar.max}`, barX + 4, y + 8);
    y += gap;
  }
}

// ── Floor indicator ──────────────────────────────────────────────────────────

function renderFloorIndicator(state) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(canvas.width - 90, 4, 86, 20);
  ctx.fillStyle = '#FFD700';
  ctx.font = 'bold 12px Courier New';
  ctx.fillText(`Floor: ${state.currentFloor}`, canvas.width - 84, 18);
}

// ── Minimap ──────────────────────────────────────────────────────────────────

function renderMinimap(state) {
  const floor = state.dungeonFloor;
  if (!floor) return;

  const mmScale = 2;
  const mmW = floor.width * mmScale;
  const mmH = floor.height * mmScale;
  const mmX = canvas.width - mmW - 8;
  const mmY = 28;

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.fillRect(mmX - 1, mmY - 1, mmW + 2, mmH + 2);

  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      const tile = floor.tiles[y][x];
      if (!tile.explored) continue;

      if (tile.visible) {
        ctx.fillStyle = tile.type === TILE_TYPES.WALL ? '#444' : '#888';
      } else {
        ctx.fillStyle = tile.type === TILE_TYPES.WALL ? '#222' : '#444';
      }
      ctx.fillRect(mmX + x * mmScale, mmY + y * mmScale, mmScale, mmScale);
    }
  }

  // Player blip
  if (state.player) {
    ctx.fillStyle = '#0f0';
    ctx.fillRect(
      mmX + state.player.pos.x * mmScale,
      mmY + state.player.pos.y * mmScale,
      mmScale, mmScale,
    );
  }
}

// ── Message log (on-canvas overlay) ──────────────────────────────────────────

function renderMessages() {
  if (messages.length === 0) return;

  const lineH = 14;
  const padX = 8;
  const padY = 4;
  const displayCount = Math.min(messages.length, MAX_MESSAGES);
  const boxH = displayCount * lineH + padY * 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, canvas.width, boxH);

  ctx.fillStyle = '#ccc';
  ctx.font = '11px Courier New';
  for (let i = 0; i < displayCount; i++) {
    const msg = messages[messages.length - displayCount + i];
    ctx.fillText(msg, padX, padY + (i + 1) * lineH - 2);
  }
}

// ── Inventory panel ──────────────────────────────────────────────────────────

function renderInventory(state) {
  if (!inventoryOpen || !state.player) return;

  const p = state.player;
  const panelW = 280;
  const panelH = 360;
  const panelX = Math.floor((canvas.width - panelW) / 2);
  const panelY = Math.floor((canvas.height - panelH) / 2);

  // Panel background
  ctx.fillStyle = 'rgba(22, 33, 62, 0.95)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = '#0f3460';
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.fillStyle = '#e94560';
  ctx.font = 'bold 14px Courier New';
  ctx.fillText('INVENTORY (I to close)', panelX + 12, panelY + 22);

  ctx.font = '11px Courier New';
  ctx.fillStyle = '#ccc';
  let y = panelY + 42;

  // Equipment
  ctx.fillStyle = '#FFD700';
  ctx.fillText('— Equipment —', panelX + 12, y);
  y += 16;
  ctx.fillStyle = '#aaa';
  for (const [slot, item] of Object.entries(p.equipment)) {
    const name = item ? item.name : '(empty)';
    ctx.fillText(`${slot}: ${name}`, panelX + 16, y);
    y += 14;
  }

  y += 8;
  ctx.fillStyle = '#FFD700';
  ctx.fillText('— Backpack —', panelX + 12, y);
  y += 16;
  ctx.fillStyle = '#aaa';

  if (p.inventory.length === 0) {
    ctx.fillText('(empty)', panelX + 16, y);
  } else {
    for (const item of p.inventory) {
      if (y > panelY + panelH - 16) {
        ctx.fillText('...', panelX + 16, y);
        break;
      }
      ctx.fillText(`• ${item.name} [${item.rarity}]`, panelX + 16, y);
      y += 14;
    }
  }
}

// ── Help overlay ─────────────────────────────────────────────────────────────

function renderHelp() {
  if (!helpOpen) return;

  const panelW = 320;
  const panelH = 310;
  const panelX = Math.floor((canvas.width - panelW) / 2);
  const panelY = Math.floor((canvas.height - panelH) / 2);

  // Panel background
  ctx.fillStyle = 'rgba(22, 33, 62, 0.95)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = '#0f3460';
  ctx.lineWidth = 2;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  ctx.fillStyle = '#e94560';
  ctx.font = 'bold 14px Courier New';
  ctx.fillText('HELP (? to close)', panelX + 12, panelY + 22);

  ctx.font = '11px Courier New';
  let y = panelY + 44;

  ctx.fillStyle = '#FFD700';
  ctx.fillText('— Keybindings —', panelX + 12, y);
  y += 20;

  const bindings = [
    ['Arrow keys / hjkl', 'Move (4-directional)'],
    ['yubn', 'Move (diagonal)'],
    [', or g', 'Pick up item'],
    ['> / <', 'Descend / Ascend stairs'],
    ['.', 'Wait a turn'],
    ['1 / 2 / 3', 'Use abilities'],
    ['I', 'Inventory'],
    ['?', 'This help screen'],
  ];

  for (const [key, desc] of bindings) {
    ctx.fillStyle = '#4ea8de';
    ctx.fillText(key, panelX + 16, y);
    ctx.fillStyle = '#aaa';
    ctx.fillText(desc, panelX + 160, y);
    y += 18;
  }

  y += 10;
  ctx.fillStyle = '#666';
  ctx.font = '10px Courier New';
  ctx.fillText('Press ? to close', panelX + 16, y);
}

// ── Input listener for inventory toggle ──────────────────────────────────────

function handleRendererKey(e) {
  if (e.key === 'i' || e.key === 'I') {
    inventoryOpen = !inventoryOpen;
  }
  if (e.key === '?') {
    helpOpen = !helpOpen;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the renderer with a canvas and game state.
 * @param {HTMLCanvasElement} canvasEl
 * @param {import('./data-model.js').GameState} gameState
 */
export function initRenderer(canvasEl, gameState) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  document.addEventListener('keydown', handleRendererKey);
}

/**
 * Main render function — draws everything.
 * @param {import('./data-model.js').GameState} state
 */
export function render(state) {
  if (!ctx || !canvas) return;
  if (!state.dungeonFloor || !state.player) return;

  const cam = getCamera(state.player.pos, state.dungeonFloor.width, state.dungeonFloor.height);

  // Clear canvas
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  renderTiles(state, cam);
  renderItems(state, cam);
  renderEntities(state, cam);
  renderFlashes(cam);
  renderStatBars(state);
  renderFloorIndicator(state);
  renderMinimap(state);
  renderMessages();
  renderInventory(state);
  renderHelp();
}

/**
 * Add a message to the on-canvas message log.
 * @param {string} text
 */
export function addMessage(text) {
  messages.push(text);
  if (messages.length > 50) messages.shift();
}

/**
 * Trigger a damage flash at a tile position.
 * @param {number} x
 * @param {number} y
 * @param {string} [color]
 */
export function flashTile(x, y, color = 'red') {
  flashes.push({ x, y, alpha: 0.7, color });
}

// ── Hook registration ────────────────────────────────────────────────────────

registerHook('render', (state, canvasCtx) => {
  // Auto-init on first render call if not yet initialized
  if (!canvas) {
    const canvasEl = document.getElementById('game-canvas');
    if (canvasEl) initRenderer(canvasEl, state);
  }
  render(state);
});

// Sync game log messages to the on-canvas overlay
registerHook('cleanup', (state) => {
  const recent = state.log.slice(-MAX_MESSAGES);
  messages.length = 0;
  messages.push(...recent);
});
