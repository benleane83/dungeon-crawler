/**
 * @file game.js
 * @description Game loop skeleton — initialization, turn processing, state
 * management, save/load, and input handling. Specialist modules plug into
 * this loop via the hook functions below.
 *
 * Architecture:
 *   game.js owns the GameState instance and the main loop.
 *   Specialist modules (dungeon, combat, items, renderer, fov) register
 *   themselves and are called at the appropriate turn phase.
 */

import { GameState, Entity, createPosition } from './data-model.js';
import {
  TURN_PHASES, SAVE_KEY, HIGH_SCORE_KEY, MAX_HIGH_SCORES,
  CLASS_TYPES, ENTITY_TYPES, MAX_FLOORS,
} from './constants.js';

// ── Singleton game state ─────────────────────────────────────────────────────

/** @type {GameState} */
let state = new GameState();

/** Expose state for other modules (read-only intent — mutate via GameState methods) */
export function getState() { return state; }

// ── Module hooks — specialists register callbacks here ───────────────────────

/**
 * Registry for module hooks. Each key is a lifecycle event name,
 * and the value is an array of callbacks.
 *
 * Specialists call `registerHook(event, fn)` to plug in.
 */
const hooks = {
  /** Called once during init to generate / restore the dungeon floor */
  generateFloor:  [],   // (state, floorNumber) => void
  /** Called after floor generation to populate enemies */
  spawnEnemies:   [],   // (state) => void
  /** Called after floor generation to scatter loot */
  spawnItems:     [],   // (state) => void
  /** Called each frame to render the current state */
  render:         [],   // (state, ctx) => void
  /** Called to recompute field of view */
  computeFov:     [],   // (state) => void
  /** Called to process the player's chosen action */
  playerAction:   [],   // (state, action) => void
  /** Called to run enemy AI for all enemies */
  enemyAction:    [],   // (state) => void
  /** Called to tick status effects (poison, burn, etc.) */
  statusTick:     [],   // (state) => void
  /** Called at end of turn for cleanup (remove dead entities, etc.) */
  cleanup:        [],   // (state) => void
};

/**
 * Register a callback for a lifecycle event.
 * @param {string} event — Key from `hooks`
 * @param {Function} fn
 */
export function registerHook(event, fn) {
  if (!hooks[event]) {
    console.warn(`Unknown hook event: ${event}`);
    return;
  }
  hooks[event].push(fn);
}

/** Fire all callbacks for an event, passing args. */
function fireHooks(event, ...args) {
  for (const fn of hooks[event] ?? []) {
    fn(...args);
  }
}

// ── Input handling ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} PlayerAction
 * @property {string} type — 'move'|'attack'|'ability'|'use_item'|'pickup'|'wait'|'stairs'
 * @property {Object} [payload] — Action-specific data (direction, target, item id, etc.)
 */

/** @type {PlayerAction|null} Pending action from input */
let pendingAction = null;

/** Direction key mappings → {dx, dy} */
const KEY_MAP = Object.freeze({
  ArrowUp:    { dx:  0, dy: -1 },
  ArrowDown:  { dx:  0, dy:  1 },
  ArrowLeft:  { dx: -1, dy:  0 },
  ArrowRight: { dx:  1, dy:  0 },
  // Numpad / vi-keys
  k: { dx:  0, dy: -1 }, j: { dx:  0, dy:  1 },
  h: { dx: -1, dy:  0 }, l: { dx:  1, dy:  0 },
  y: { dx: -1, dy: -1 }, u: { dx:  1, dy: -1 },
  b: { dx: -1, dy:  1 }, n: { dx:  1, dy:  1 },
});

function handleKeyDown(e) {
  if (state.gameOver) return;
  if (state.turnPhase !== TURN_PHASES.PLAYER_INPUT) return;

  const dir = KEY_MAP[e.key];
  if (dir) {
    e.preventDefault();
    pendingAction = { type: 'move', payload: dir };
    return;
  }

  switch (e.key) {
    case '.': // Wait a turn
      pendingAction = { type: 'wait' };
      break;
    case ',': // Pick up item
    case 'g':
      pendingAction = { type: 'pickup' };
      break;
    case '>': // Descend stairs
      pendingAction = { type: 'stairs', payload: { direction: 'down' } };
      break;
    case '<': // Ascend stairs
      pendingAction = { type: 'stairs', payload: { direction: 'up' } };
      break;
    case '1': case '2': case '3':
      pendingAction = { type: 'ability', payload: { index: Number(e.key) - 1 } };
      break;
    default:
      break;
  }
}

// ── HUD update ───────────────────────────────────────────────────────────────

function updateHUD() {
  const p = state.player;
  if (!p) return;

  const setText = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  setText('hud-floor', state.currentFloor);
  setText('hud-hp', `${p.hp}/${p.maxHp}`);
  setText('hud-mp', `${p.mp}/${p.maxMp}`);
  setText('hud-sp', `${p.stamina}/${p.maxStamina}`);
  setText('hud-level', p.level);
  setText('hud-score', p.score);
}

function updateLog() {
  const logEl = document.getElementById('log');
  if (!logEl) return;
  // Show last 50 messages
  const recent = state.log.slice(-50);
  logEl.innerHTML = recent.map(m => `<p>${m}</p>`).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

// ── Turn processing ──────────────────────────────────────────────────────────

function processTurn() {
  if (!pendingAction || state.gameOver) return;

  const action = pendingAction;
  pendingAction = null;

  // 1. Player action
  state.turnPhase = TURN_PHASES.PLAYER_ACTION;
  fireHooks('playerAction', state, action);

  // 2. Enemy AI
  state.turnPhase = TURN_PHASES.ENEMY_ACTION;
  fireHooks('enemyAction', state);

  // 3. Status effect ticks
  state.turnPhase = TURN_PHASES.STATUS_TICK;
  fireHooks('statusTick', state);

  // 4. Cleanup (remove dead, etc.)
  state.turnPhase = TURN_PHASES.CLEANUP;
  fireHooks('cleanup', state);

  // Increment turn
  state.turnCount++;

  // Check permadeath
  if (state.player && state.player.hp <= 0) {
    state.player.alive = false;
    state.gameOver = true;
    state.addLog('You have perished. Game over.');
    recordHighScore();
  }

  // Return to input phase
  state.turnPhase = TURN_PHASES.PLAYER_INPUT;
}

// ── Floor transitions ────────────────────────────────────────────────────────

/**
 * Change to a different floor. Generates it if it hasn't been visited.
 * @param {number} floorNumber — 1-based
 */
export function changeFloor(floorNumber) {
  if (floorNumber < 1 || floorNumber > MAX_FLOORS) return;

  // Cache current floor
  if (state.dungeonFloor) {
    state.floorCache.set(state.currentFloor, state.dungeonFloor);
  }

  state.currentFloor = floorNumber;

  // Restore or generate
  if (state.floorCache.has(floorNumber)) {
    state.dungeonFloor = state.floorCache.get(floorNumber);
  } else {
    fireHooks('generateFloor', state, floorNumber);
    fireHooks('spawnEnemies', state);
    fireHooks('spawnItems', state);
  }

  // Recompute FOV for new floor
  fireHooks('computeFov', state);
}

// ── Save / Load (LocalStorage) ───────────────────────────────────────────────

/**
 * Save the current game state to LocalStorage.
 * Called on page unload (save-on-exit only).
 */
export function saveGame() {
  try {
    const json = JSON.stringify(state.toJSON());
    localStorage.setItem(SAVE_KEY, json);
  } catch (err) {
    console.error('Save failed:', err);
  }
}

/**
 * Load a saved game from LocalStorage.
 * @returns {boolean} True if a save was loaded.
 */
export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    state = GameState.fromJSON(JSON.parse(raw));
    localStorage.removeItem(SAVE_KEY); // Permadeath: consume the save
    return true;
  } catch (err) {
    console.error('Load failed:', err);
    return false;
  }
}

/** Clear saved game (called on death). */
export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

// ── High Scores ──────────────────────────────────────────────────────────────

/**
 * Record the current run to the high score table.
 */
function recordHighScore() {
  const scores = getHighScores();
  scores.push({
    name: state.player?.name ?? 'Unknown',
    classType: state.player?.classType ?? '',
    score: state.player?.score ?? 0,
    floor: state.currentFloor,
    turns: state.turnCount,
    date: new Date().toISOString(),
  });
  scores.sort((a, b) => b.score - a.score);
  scores.length = Math.min(scores.length, MAX_HIGH_SCORES);
  localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(scores));
  clearSave();
}

/**
 * Get the high score table.
 * @returns {Object[]}
 */
export function getHighScores() {
  try {
    return JSON.parse(localStorage.getItem(HIGH_SCORE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

// ── Initialization ───────────────────────────────────────────────────────────

/**
 * Start a new game with the given class.
 * @param {string} classType — CLASS_TYPES value
 * @param {string} [playerName='Adventurer']
 */
export function newGame(classType = CLASS_TYPES.WARRIOR, playerName = 'Adventurer') {
  state = new GameState();

  // Create player entity
  const player = new Entity({
    entityType: ENTITY_TYPES.PLAYER,
    classType,
    name: playerName,
    pos: createPosition(0, 0), // Will be placed by dungeon generator
  });
  state.player = player;
  state.entities.set(player.id, player);

  // Generate floor 1
  changeFloor(1);

  state.addLog(`${playerName} the ${classType} enters the dungeon.`);
}

// ── Main Loop ────────────────────────────────────────────────────────────────

/** @type {CanvasRenderingContext2D|null} */
let ctx = null;

function gameLoop() {
  processTurn();
  fireHooks('computeFov', state);
  if (ctx) fireHooks('render', state, ctx);
  updateHUD();
  updateLog();
  requestAnimationFrame(gameLoop);
}

/**
 * Entry point — called when the page loads.
 */
function init() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
  if (canvas) {
    ctx = canvas.getContext('2d');
  }

  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('beforeunload', () => {
    if (!state.gameOver) saveGame();
  });

  // Try to restore a saved game, otherwise start new
  if (!loadGame()) {
    newGame(CLASS_TYPES.WARRIOR);
  }

  state.addLog('Use arrow keys or hjkl to move. Press ? for help.');
  gameLoop();
}

// ── Load specialist modules (they self-register hooks on import) ─────────────
// Dynamic imports ensure this module's bindings (hooks, state) are fully
// initialized before specialists call registerHook.
Promise.all([
  import('./dungeon.js'),
  import('./combat.js'),
  import('./items.js'),
  import('./fov.js'),
  import('./renderer.js'),
]).then(() => {
  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
});
