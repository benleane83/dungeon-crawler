/**
 * @file utils.js
 * @description Shared utility functions used across all modules.
 * Pure functions only — no game state mutation here.
 */

// ── Random ───────────────────────────────────────────────────────────────────

/**
 * Random integer in [min, max] (inclusive).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Random float in [min, max).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * Pick a random element from an array.
 * @template T
 * @param {T[]} arr
 * @returns {T}
 */
export function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Shuffle an array in place (Fisher-Yates).
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Weighted random selection. weights[i] corresponds to items[i].
 * @template T
 * @param {T[]} items
 * @param {number[]} weights
 * @returns {T}
 */
export function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ── Distance / Geometry ──────────────────────────────────────────────────────

/**
 * Chebyshev (chessboard) distance between two positions.
 * Used for most game-distance calculations (movement, range).
 * @param {{x:number, y:number}} a
 * @param {{x:number, y:number}} b
 * @returns {number}
 */
export function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Manhattan distance between two positions.
 * @param {{x:number, y:number}} a
 * @param {{x:number, y:number}} b
 * @returns {number}
 */
export function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Euclidean distance between two positions.
 * @param {{x:number, y:number}} a
 * @param {{x:number, y:number}} b
 * @returns {number}
 */
export function euclideanDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get all 4-directional neighbors of a position.
 * @param {{x:number, y:number}} pos
 * @returns {{x:number, y:number}[]}
 */
export function getNeighbors4(pos) {
  return [
    { x: pos.x,     y: pos.y - 1 },
    { x: pos.x + 1, y: pos.y     },
    { x: pos.x,     y: pos.y + 1 },
    { x: pos.x - 1, y: pos.y     },
  ];
}

/**
 * Get all 8-directional neighbors of a position.
 * @param {{x:number, y:number}} pos
 * @returns {{x:number, y:number}[]}
 */
export function getNeighbors8(pos) {
  const n = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      n.push({ x: pos.x + dx, y: pos.y + dy });
    }
  }
  return n;
}

/**
 * Get positions in a line from a to b (Bresenham's).
 * @param {{x:number, y:number}} a
 * @param {{x:number, y:number}} b
 * @returns {{x:number, y:number}[]}
 */
export function bresenhamLine(a, b) {
  const points = [];
  let x0 = a.x, y0 = a.y;
  const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx)  { err += dx; y0 += sy; }
  }
  return points;
}

// ── Cloning / Serialization ──────────────────────────────────────────────────

/**
 * Deep clone a value via structured clone (or JSON fallback).
 * Do NOT use for objects with class instances — use their toJSON/fromJSON instead.
 * @template T
 * @param {T} obj
 * @returns {T}
 */
export function deepClone(obj) {
  if (typeof structuredClone === 'function') return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

// ── Math Helpers ─────────────────────────────────────────────────────────────

/**
 * Clamp a value to [min, max].
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} t — 0..1
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ── Unique ID ────────────────────────────────────────────────────────────────

let _uid = 0;

/**
 * Generate a simple unique ID string.
 * @param {string} [prefix='id']
 * @returns {string}
 */
export function uid(prefix = 'id') {
  return `${prefix}_${++_uid}`;
}
