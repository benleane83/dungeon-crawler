/**
 * @file items.js
 * @description Complete item, loot, and inventory system.
 * Handles item definitions, rarity tiers, random loot tables per floor,
 * item identification (potions/scrolls), inventory management, and equipment.
 */

import {
  ITEM_TYPES, ITEM_RARITY, EQUIPMENT_SLOTS,
  WEAPON_SUBTYPES, ARMOR_SUBTYPES, POTION_SUBTYPES, SCROLL_SUBTYPES,
  ENEMY_TYPES, MAX_FLOORS,
} from './constants.js';

import { Item } from './data-model.js';

import {
  randomInt, randomChoice, weightedRandom, shuffle, clamp,
} from './utils.js';

import { registerHook } from './game.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum inventory slots */
export const MAX_INVENTORY_SLOTS = 20;

/** Rarity stat multipliers */
const RARITY_MULTIPLIERS = Object.freeze({
  [ITEM_RARITY.COMMON]:    1.0,
  [ITEM_RARITY.UNCOMMON]:  1.3,
  [ITEM_RARITY.RARE]:      1.7,
  [ITEM_RARITY.LEGENDARY]: 2.5,
});

/** Rarity name prefixes for display */
const RARITY_PREFIX = Object.freeze({
  [ITEM_RARITY.COMMON]:    '',
  [ITEM_RARITY.UNCOMMON]:  'Fine',
  [ITEM_RARITY.RARE]:      'Superior',
  [ITEM_RARITY.LEGENDARY]: 'Legendary',
});

/** Gold value base per rarity */
const RARITY_VALUE = Object.freeze({
  [ITEM_RARITY.COMMON]:    10,
  [ITEM_RARITY.UNCOMMON]:  25,
  [ITEM_RARITY.RARE]:      60,
  [ITEM_RARITY.LEGENDARY]: 150,
});

// ── Weapon Definitions ───────────────────────────────────────────────────────

const WEAPON_DEFS = Object.freeze({
  [WEAPON_SUBTYPES.SWORD]:  { name: 'Sword',  baseDamage: 10, range: 1, speed: 10, slot: EQUIPMENT_SLOTS.WEAPON },
  [WEAPON_SUBTYPES.AXE]:    { name: 'Axe',    baseDamage: 14, range: 1, speed: 7,  slot: EQUIPMENT_SLOTS.WEAPON },
  [WEAPON_SUBTYPES.STAFF]:  { name: 'Staff',  baseDamage: 6,  range: 2, speed: 9,  slot: EQUIPMENT_SLOTS.WEAPON },
  [WEAPON_SUBTYPES.DAGGER]: { name: 'Dagger', baseDamage: 7,  range: 1, speed: 14, slot: EQUIPMENT_SLOTS.WEAPON },
  [WEAPON_SUBTYPES.BOW]:    { name: 'Bow',    baseDamage: 9,  range: 5, speed: 10, slot: EQUIPMENT_SLOTS.WEAPON },
});

// ── Armor Definitions ────────────────────────────────────────────────────────

const ARMOR_DEFS = Object.freeze({
  [ARMOR_SUBTYPES.HELMET]: { name: 'Helmet', baseDefense: 3, slot: EQUIPMENT_SLOTS.HELMET },
  [ARMOR_SUBTYPES.CHEST]:  { name: 'Chestplate', baseDefense: 6, slot: EQUIPMENT_SLOTS.CHEST },
  [ARMOR_SUBTYPES.LEGS]:   { name: 'Greaves', baseDefense: 4, slot: EQUIPMENT_SLOTS.LEGS },
  [ARMOR_SUBTYPES.SHIELD]: { name: 'Shield', baseDefense: 5, slot: EQUIPMENT_SLOTS.SHIELD },
});

// Note: constants.js ARMOR_SUBTYPES lacks BOOTS but EQUIPMENT_SLOTS lacks FEET.
// We work with what's defined: helmet, chest, legs, shield.

// ── Potion Definitions ───────────────────────────────────────────────────────

const POTION_DEFS = Object.freeze({
  [POTION_SUBTYPES.HEALTH]:   { name: 'Health Potion',   effect: 'heal',     baseValue: 30 },
  [POTION_SUBTYPES.MANA]:     { name: 'Mana Potion',     effect: 'mana',     baseValue: 25 },
  [POTION_SUBTYPES.STRENGTH]: { name: 'Strength Potion', effect: 'strength', duration: 10, baseValue: 5 },
  [POTION_SUBTYPES.SPEED]:    { name: 'Speed Potion',    effect: 'speed',    duration: 10, baseValue: 3 },
});

// ── Scroll Definitions ───────────────────────────────────────────────────────

const SCROLL_DEFS = Object.freeze({
  [SCROLL_SUBTYPES.FIREBALL]:   { name: 'Scroll of Fireball',   effect: 'fireball',   damage: 25 },
  [SCROLL_SUBTYPES.TELEPORT]:   { name: 'Scroll of Teleport',   effect: 'teleport'   },
  [SCROLL_SUBTYPES.IDENTIFY]:   { name: 'Scroll of Identify',   effect: 'identify'   },
  [SCROLL_SUBTYPES.MAP_REVEAL]: { name: 'Scroll of Map Reveal', effect: 'map_reveal' },
  [SCROLL_SUBTYPES.ENCHANT]:    { name: 'Scroll of Enchant',    effect: 'enchant'    },
});

// ── Unidentified Name Pools ──────────────────────────────────────────────────

const UNIDENTIFIED_POTION_NAMES = Object.freeze([
  'Murky Potion', 'Bubbling Potion', 'Glowing Potion', 'Smoky Potion',
  'Crimson Potion', 'Azure Potion', 'Amber Potion', 'Jade Potion',
  'Violet Potion', 'Silver Potion',
]);

const UNIDENTIFIED_SCROLL_NAMES = Object.freeze([
  'Faded Scroll', 'Charred Scroll', 'Torn Scroll', 'Ancient Scroll',
  'Glittering Scroll', 'Dusty Scroll', 'Ornate Scroll', 'Sealed Scroll',
  'Cryptic Scroll', 'Runic Scroll',
]);

// ── Session Identification State ─────────────────────────────────────────────

/**
 * Per-session mapping of subtype → unidentified display name.
 * Randomized at session start so "Murky Potion" could be any potion type.
 * @type {Map<string, string>}
 */
let unidentifiedNameMap = new Map();

/**
 * Set of subtypes the player has identified this session.
 * @type {Set<string>}
 */
let identifiedSubtypes = new Set();

/**
 * Initialize the random name mapping for a new game session.
 * Call this once when a new game starts.
 */
export function initIdentificationSystem() {
  unidentifiedNameMap.clear();
  identifiedSubtypes.clear();

  const potionNames = shuffle([...UNIDENTIFIED_POTION_NAMES]);
  const potionKeys = Object.values(POTION_SUBTYPES);
  for (let i = 0; i < potionKeys.length; i++) {
    unidentifiedNameMap.set(potionKeys[i], potionNames[i % potionNames.length]);
  }

  const scrollNames = shuffle([...UNIDENTIFIED_SCROLL_NAMES]);
  const scrollKeys = Object.values(SCROLL_SUBTYPES);
  for (let i = 0; i < scrollKeys.length; i++) {
    unidentifiedNameMap.set(scrollKeys[i], scrollNames[i % scrollNames.length]);
  }
}

/**
 * Mark a subtype as identified for the rest of this run.
 * @param {string} subtype
 */
export function identifySubtype(subtype) {
  identifiedSubtypes.add(subtype);
}

/**
 * Check if a subtype has been identified this session.
 * @param {string} subtype
 * @returns {boolean}
 */
export function isSubtypeIdentified(subtype) {
  return identifiedSubtypes.has(subtype);
}

/**
 * Get the display name for an item, respecting identification state.
 * @param {Item} item
 * @returns {string}
 */
export function getDisplayName(item) {
  if (item.identified || identifiedSubtypes.has(item.subtype)) {
    const prefix = RARITY_PREFIX[item.rarity];
    return prefix ? `${prefix} ${item.name}` : item.name;
  }
  return item.unidentifiedName;
}

/**
 * Serialize identification state for saving.
 * @returns {Object}
 */
export function serializeIdentificationState() {
  return {
    nameMap: [...unidentifiedNameMap.entries()],
    identified: [...identifiedSubtypes],
  };
}

/**
 * Restore identification state from a save.
 * @param {Object} data
 */
export function restoreIdentificationState(data) {
  if (!data) return;
  unidentifiedNameMap = new Map(data.nameMap ?? []);
  identifiedSubtypes = new Set(data.identified ?? []);
}

// ── Loot Tables — Rarity Weights Per Floor Range ─────────────────────────────

/**
 * Rarity drop weights by floor range.
 * Keys: common, uncommon, rare, legendary
 */
const FLOOR_RARITY_WEIGHTS = Object.freeze([
  // Floors 1-3: mostly common, few uncommon
  { range: [1, 3],  weights: { common: 70, uncommon: 25, rare: 5, legendary: 0 } },
  // Floors 4-6: common/uncommon mix, rare possible
  { range: [4, 6],  weights: { common: 40, uncommon: 35, rare: 20, legendary: 5 } },
  // Floors 7-9: uncommon/rare mix, legendary possible
  { range: [7, 9],  weights: { common: 15, uncommon: 35, rare: 35, legendary: 15 } },
  // Floor 10: guaranteed rare+, boss drops legendary
  { range: [10, 10], weights: { common: 0, uncommon: 10, rare: 55, legendary: 35 } },
]);

/**
 * Get the rarity weights for a given floor number.
 * @param {number} floor
 * @returns {Object}
 */
function getRarityWeightsForFloor(floor) {
  for (const entry of FLOOR_RARITY_WEIGHTS) {
    if (floor >= entry.range[0] && floor <= entry.range[1]) {
      return entry.weights;
    }
  }
  // Fallback to last tier
  return FLOOR_RARITY_WEIGHTS[FLOOR_RARITY_WEIGHTS.length - 1].weights;
}

/**
 * Roll a rarity tier based on floor number.
 * @param {number} floorNumber
 * @returns {string} ITEM_RARITY value
 */
function rollRarity(floorNumber) {
  const w = getRarityWeightsForFloor(floorNumber);
  const rarities = [ITEM_RARITY.COMMON, ITEM_RARITY.UNCOMMON, ITEM_RARITY.RARE, ITEM_RARITY.LEGENDARY];
  const weights = [w.common, w.uncommon, w.rare, w.legendary];
  return weightedRandom(rarities, weights);
}

/**
 * Item type drop weights by floor range.
 */
const FLOOR_TYPE_WEIGHTS = Object.freeze([
  { range: [1, 3],   weights: { weapon: 25, armor: 25, potion: 35, scroll: 15 } },
  { range: [4, 6],   weights: { weapon: 25, armor: 25, potion: 25, scroll: 25 } },
  { range: [7, 10],  weights: { weapon: 30, armor: 30, potion: 20, scroll: 20 } },
]);

/**
 * Roll an item type based on floor number.
 * @param {number} floorNumber
 * @returns {string} ITEM_TYPES value
 */
function rollItemType(floorNumber) {
  let w;
  for (const entry of FLOOR_TYPE_WEIGHTS) {
    if (floorNumber >= entry.range[0] && floorNumber <= entry.range[1]) {
      w = entry.weights; break;
    }
  }
  w = w ?? FLOOR_TYPE_WEIGHTS[FLOOR_TYPE_WEIGHTS.length - 1].weights;
  const types = [ITEM_TYPES.WEAPON, ITEM_TYPES.ARMOR, ITEM_TYPES.POTION, ITEM_TYPES.SCROLL];
  const weights = [w.weapon, w.armor, w.potion, w.scroll];
  return weightedRandom(types, weights);
}

// ── Item Creation ────────────────────────────────────────────────────────────

/**
 * Create a weapon item.
 * @param {string} subtype — WEAPON_SUBTYPES value
 * @param {string} rarity — ITEM_RARITY value
 * @returns {Item}
 */
export function createWeapon(subtype, rarity) {
  const def = WEAPON_DEFS[subtype];
  const mult = RARITY_MULTIPLIERS[rarity];
  const prefix = RARITY_PREFIX[rarity];
  const name = prefix ? `${prefix} ${def.name}` : def.name;
  const damage = Math.round(def.baseDamage * mult);

  return new Item({
    type: ITEM_TYPES.WEAPON,
    subtype,
    name: def.name,
    rarity,
    identified: true,
    stats: {
      attack: damage,
      range: def.range,
      speed: def.speed,
    },
    value: Math.round(RARITY_VALUE[rarity] * 1.5),
  });
}

/**
 * Create an armor item.
 * @param {string} subtype — ARMOR_SUBTYPES value
 * @param {string} rarity — ITEM_RARITY value
 * @returns {Item}
 */
export function createArmor(subtype, rarity) {
  const def = ARMOR_DEFS[subtype];
  const mult = RARITY_MULTIPLIERS[rarity];
  const defense = Math.round(def.baseDefense * mult);

  return new Item({
    type: ITEM_TYPES.ARMOR,
    subtype,
    name: def.name,
    rarity,
    identified: true,
    stats: { defense },
    value: Math.round(RARITY_VALUE[rarity] * 1.2),
  });
}

/**
 * Create a potion item (starts unidentified).
 * @param {string} subtype — POTION_SUBTYPES value
 * @param {string} rarity — ITEM_RARITY value
 * @returns {Item}
 */
export function createPotion(subtype, rarity) {
  const def = POTION_DEFS[subtype];
  const mult = RARITY_MULTIPLIERS[rarity];
  const alreadyKnown = identifiedSubtypes.has(subtype);

  const stats = {};
  if (def.effect === 'heal') stats.hp = Math.round(def.baseValue * mult);
  else if (def.effect === 'mana') stats.mp = Math.round(def.baseValue * mult);
  else if (def.effect === 'strength') { stats.attack = Math.round(def.baseValue * mult); stats.duration = def.duration; }
  else if (def.effect === 'speed') { stats.speed = Math.round(def.baseValue * mult); stats.duration = def.duration; }

  return new Item({
    type: ITEM_TYPES.POTION,
    subtype,
    name: def.name,
    rarity,
    identified: alreadyKnown,
    unidentifiedName: unidentifiedNameMap.get(subtype) ?? 'Strange Potion',
    stats,
    value: RARITY_VALUE[rarity],
  });
}

/**
 * Create a scroll item (starts unidentified).
 * @param {string} subtype — SCROLL_SUBTYPES value
 * @param {string} rarity — ITEM_RARITY value
 * @returns {Item}
 */
export function createScroll(subtype, rarity) {
  const def = SCROLL_DEFS[subtype];
  const mult = RARITY_MULTIPLIERS[rarity];
  const alreadyKnown = identifiedSubtypes.has(subtype);

  const stats = {};
  if (def.damage) stats.damage = Math.round(def.damage * mult);
  stats.effect = def.effect;

  return new Item({
    type: ITEM_TYPES.SCROLL,
    subtype,
    name: def.name,
    rarity,
    identified: alreadyKnown,
    unidentifiedName: unidentifiedNameMap.get(subtype) ?? 'Mysterious Scroll',
    stats,
    value: RARITY_VALUE[rarity],
  });
}

// ── Random Item Generation ───────────────────────────────────────────────────

/**
 * Generate a random item appropriate for the given floor.
 * @param {number} floorNumber — 1-based
 * @returns {Item}
 */
export function generateItem(floorNumber) {
  const floor = clamp(floorNumber, 1, MAX_FLOORS);
  const rarity = rollRarity(floor);
  const type = rollItemType(floor);

  switch (type) {
    case ITEM_TYPES.WEAPON:
      return createWeapon(randomChoice(Object.values(WEAPON_SUBTYPES)), rarity);
    case ITEM_TYPES.ARMOR:
      return createArmor(randomChoice(Object.values(ARMOR_SUBTYPES)), rarity);
    case ITEM_TYPES.POTION:
      return createPotion(randomChoice(Object.values(POTION_SUBTYPES)), rarity);
    case ITEM_TYPES.SCROLL:
      return createScroll(randomChoice(Object.values(SCROLL_SUBTYPES)), rarity);
    default:
      return createPotion(POTION_SUBTYPES.HEALTH, rarity);
  }
}

/**
 * Generate a loot drop from an enemy death.
 * Boss enemies on floor 10 guarantee legendary. Higher-tier enemies have better drops.
 * @param {number} floorNumber — 1-based
 * @param {string} enemyType — ENEMY_TYPES value
 * @returns {Item[]} Array of dropped items (may be empty)
 */
export function generateLootDrop(floorNumber, enemyType) {
  const drops = [];

  // Drop chance based on enemy type
  const dropChances = {
    [ENEMY_TYPES.RAT]:       0.2,
    [ENEMY_TYPES.SLIME]:     0.25,
    [ENEMY_TYPES.SKELETON]:  0.35,
    [ENEMY_TYPES.GOBLIN]:    0.4,
    [ENEMY_TYPES.ORC]:       0.5,
    [ENEMY_TYPES.WRAITH]:    0.55,
    [ENEMY_TYPES.DARK_MAGE]: 0.6,
    [ENEMY_TYPES.DRAGON]:    0.9,
  };

  const chance = dropChances[enemyType] ?? 0.3;

  // Boss on floor 10 — guaranteed legendary
  if (floorNumber === MAX_FLOORS && (enemyType === ENEMY_TYPES.DRAGON || enemyType === ENEMY_TYPES.DARK_MAGE)) {
    const type = rollItemType(floorNumber);
    const subTypes = {
      [ITEM_TYPES.WEAPON]: WEAPON_SUBTYPES,
      [ITEM_TYPES.ARMOR]: ARMOR_SUBTYPES,
      [ITEM_TYPES.POTION]: POTION_SUBTYPES,
      [ITEM_TYPES.SCROLL]: SCROLL_SUBTYPES,
    };
    const pool = Object.values(subTypes[type] ?? WEAPON_SUBTYPES);
    const sub = randomChoice(pool);

    switch (type) {
      case ITEM_TYPES.WEAPON: drops.push(createWeapon(sub, ITEM_RARITY.LEGENDARY)); break;
      case ITEM_TYPES.ARMOR:  drops.push(createArmor(sub, ITEM_RARITY.LEGENDARY)); break;
      case ITEM_TYPES.POTION: drops.push(createPotion(sub, ITEM_RARITY.LEGENDARY)); break;
      case ITEM_TYPES.SCROLL: drops.push(createScroll(sub, ITEM_RARITY.LEGENDARY)); break;
    }
    return drops;
  }

  // Normal drop roll
  if (Math.random() < chance) {
    drops.push(generateItem(floorNumber));
  }

  // Rare double-drop for strong enemies
  if ((enemyType === ENEMY_TYPES.ORC || enemyType === ENEMY_TYPES.WRAITH ||
       enemyType === ENEMY_TYPES.DARK_MAGE || enemyType === ENEMY_TYPES.DRAGON) &&
      Math.random() < 0.15) {
    drops.push(generateItem(floorNumber));
  }

  return drops;
}

// ── Equipment Slot Mapping ───────────────────────────────────────────────────

/**
 * Get the equipment slot for an item, or null if not equippable.
 * @param {Item} item
 * @returns {string|null}
 */
export function getEquipSlot(item) {
  if (item.type === ITEM_TYPES.WEAPON) return EQUIPMENT_SLOTS.WEAPON;
  if (item.type === ITEM_TYPES.ARMOR) {
    const slotMap = {
      [ARMOR_SUBTYPES.HELMET]: EQUIPMENT_SLOTS.HELMET,
      [ARMOR_SUBTYPES.CHEST]:  EQUIPMENT_SLOTS.CHEST,
      [ARMOR_SUBTYPES.LEGS]:   EQUIPMENT_SLOTS.LEGS,
      [ARMOR_SUBTYPES.SHIELD]: EQUIPMENT_SLOTS.SHIELD,
    };
    return slotMap[item.subtype] ?? null;
  }
  return null;
}

// ── Inventory Management ─────────────────────────────────────────────────────

/**
 * Check if an entity's inventory is full.
 * @param {import('./data-model.js').Entity} entity
 * @returns {boolean}
 */
export function isInventoryFull(entity) {
  return entity.inventory.length >= MAX_INVENTORY_SLOTS;
}

/**
 * Add an item to an entity's inventory.
 * @param {import('./data-model.js').Entity} entity
 * @param {Item} item
 * @returns {boolean} True if added successfully
 */
export function addToInventory(entity, item) {
  if (isInventoryFull(entity)) return false;
  entity.inventory.push(item);
  return true;
}

/**
 * Remove an item from an entity's inventory by item ID.
 * @param {import('./data-model.js').Entity} entity
 * @param {string} itemId
 * @returns {Item|null} The removed item, or null if not found
 */
export function removeFromInventory(entity, itemId) {
  const idx = entity.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return null;
  return entity.inventory.splice(idx, 1)[0];
}

/**
 * Equip an item from inventory. If a slot is occupied, the old item goes back to inventory.
 * @param {import('./data-model.js').Entity} entity
 * @param {string} itemId — ID of the item in inventory to equip
 * @returns {{ success: boolean, message: string }}
 */
export function equipItem(entity, itemId) {
  const item = entity.inventory.find(i => i.id === itemId);
  if (!item) return { success: false, message: 'Item not in inventory.' };

  const slot = getEquipSlot(item);
  if (!slot) return { success: false, message: `${getDisplayName(item)} cannot be equipped.` };

  // Unequip current item in that slot first
  const current = entity.equipment[slot];
  if (current) {
    if (entity.inventory.length >= MAX_INVENTORY_SLOTS) {
      return { success: false, message: 'Inventory full — cannot swap equipment.' };
    }
    unapplyItemStats(entity, current);
    entity.inventory.push(current);
  }

  // Remove from inventory and equip
  removeFromInventory(entity, itemId);
  entity.equipment[slot] = item;
  applyItemStats(entity, item);

  return { success: true, message: `Equipped ${getDisplayName(item)}.` };
}

/**
 * Unequip an item from a slot back to inventory.
 * @param {import('./data-model.js').Entity} entity
 * @param {string} slot — EQUIPMENT_SLOTS value
 * @returns {{ success: boolean, message: string }}
 */
export function unequipItem(entity, slot) {
  const item = entity.equipment[slot];
  if (!item) return { success: false, message: 'Nothing equipped in that slot.' };
  if (isInventoryFull(entity)) return { success: false, message: 'Inventory full.' };

  unapplyItemStats(entity, item);
  entity.equipment[slot] = null;
  entity.inventory.push(item);

  return { success: true, message: `Unequipped ${getDisplayName(item)}.` };
}

/**
 * Apply an equipment item's stat bonuses to an entity.
 * @param {import('./data-model.js').Entity} entity
 * @param {Item} item
 */
function applyItemStats(entity, item) {
  if (item.stats.attack) entity.attack += item.stats.attack;
  if (item.stats.defense) entity.defense += item.stats.defense;
  if (item.stats.speed) entity.speed += item.stats.speed;
}

/**
 * Remove an equipment item's stat bonuses from an entity.
 * @param {import('./data-model.js').Entity} entity
 * @param {Item} item
 */
function unapplyItemStats(entity, item) {
  if (item.stats.attack) entity.attack -= item.stats.attack;
  if (item.stats.defense) entity.defense -= item.stats.defense;
  if (item.stats.speed) entity.speed -= item.stats.speed;
}

// ── Item Usage (Consumables) ─────────────────────────────────────────────────

/**
 * Use a consumable item (potion or scroll) from inventory.
 * Using an unidentified item identifies it for the rest of the run.
 * @param {import('./data-model.js').Entity} entity
 * @param {string} itemId
 * @param {import('./data-model.js').GameState} gameState
 * @returns {{ success: boolean, message: string }}
 */
export function useItem(entity, itemId, gameState) {
  const item = entity.inventory.find(i => i.id === itemId);
  if (!item) return { success: false, message: 'Item not in inventory.' };

  if (item.type !== ITEM_TYPES.POTION && item.type !== ITEM_TYPES.SCROLL) {
    return { success: false, message: `${getDisplayName(item)} cannot be used — equip it instead.` };
  }

  // Identify on use
  if (!item.identified && !identifiedSubtypes.has(item.subtype)) {
    identifiedSubtypes.add(item.subtype);
    item.identified = true;
  }

  let message = '';

  if (item.type === ITEM_TYPES.POTION) {
    message = applyPotion(entity, item);
  } else if (item.type === ITEM_TYPES.SCROLL) {
    message = applyScroll(entity, item, gameState);
  }

  // Consume the item
  removeFromInventory(entity, itemId);
  return { success: true, message };
}

/**
 * Apply a potion's effect to an entity.
 * @param {import('./data-model.js').Entity} entity
 * @param {Item} potion
 * @returns {string} Log message
 */
function applyPotion(entity, potion) {
  const def = POTION_DEFS[potion.subtype];
  if (!def) return `Used ${potion.name} but nothing happened.`;

  switch (def.effect) {
    case 'heal': {
      const heal = potion.stats.hp ?? 30;
      const before = entity.hp;
      entity.hp = clamp(entity.hp + heal, 0, entity.maxHp);
      return `Drank ${potion.name}. Restored ${entity.hp - before} HP.`;
    }
    case 'mana': {
      const restore = potion.stats.mp ?? 25;
      const before = entity.mp;
      entity.mp = clamp(entity.mp + restore, 0, entity.maxMp);
      return `Drank ${potion.name}. Restored ${entity.mp - before} MP.`;
    }
    case 'strength': {
      const buff = potion.stats.attack ?? 5;
      const dur = potion.stats.duration ?? 10;
      entity.statusEffects.push({ type: 'strength_buff', turnsLeft: dur, potency: buff });
      entity.attack += buff;
      return `Drank ${potion.name}. Attack +${buff} for ${dur} turns.`;
    }
    case 'speed': {
      const buff = potion.stats.speed ?? 3;
      const dur = potion.stats.duration ?? 10;
      entity.statusEffects.push({ type: 'speed_buff', turnsLeft: dur, potency: buff });
      entity.speed += buff;
      return `Drank ${potion.name}. Speed +${buff} for ${dur} turns.`;
    }
    default:
      return `Drank ${potion.name}.`;
  }
}

/**
 * Apply a scroll's effect.
 * @param {import('./data-model.js').Entity} entity
 * @param {Item} scroll
 * @param {import('./data-model.js').GameState} gameState
 * @returns {string} Log message
 */
function applyScroll(entity, scroll, gameState) {
  const def = SCROLL_DEFS[scroll.subtype];
  if (!def) return `Read ${scroll.name} but the words faded.`;

  switch (def.effect) {
    case 'fireball': {
      const dmg = scroll.stats.damage ?? 25;
      // Deal damage to all enemies within 3 tiles
      let hits = 0;
      if (gameState) {
        for (const [, ent] of gameState.entities) {
          if (ent.isPlayer || !ent.alive) continue;
          const dx = Math.abs(ent.pos.x - entity.pos.x);
          const dy = Math.abs(ent.pos.y - entity.pos.y);
          if (Math.max(dx, dy) <= 3) {
            ent.hp -= dmg;
            hits++;
          }
        }
      }
      return `Read ${scroll.name}. Fireball hits ${hits} enemies for ${dmg} damage!`;
    }
    case 'teleport': {
      // Teleport to a random walkable tile on the floor
      if (gameState?.dungeonFloor) {
        const floor = gameState.dungeonFloor;
        const candidates = [];
        for (let y = 0; y < floor.height; y++) {
          for (let x = 0; x < floor.width; x++) {
            const tile = floor.getTile(x, y);
            if (tile && tile.walkable && !tile.entityId) {
              candidates.push({ x, y });
            }
          }
        }
        if (candidates.length > 0) {
          const oldTile = floor.getTile(entity.pos.x, entity.pos.y);
          if (oldTile) oldTile.entityId = null;
          const dest = randomChoice(candidates);
          entity.pos.x = dest.x;
          entity.pos.y = dest.y;
          const newTile = floor.getTile(dest.x, dest.y);
          if (newTile) newTile.entityId = entity.id;
        }
      }
      return `Read ${scroll.name}. Teleported to a new location!`;
    }
    case 'identify': {
      // Identify all unidentified items in inventory
      let count = 0;
      for (const inv of entity.inventory) {
        if (!inv.identified && !identifiedSubtypes.has(inv.subtype)) {
          identifiedSubtypes.add(inv.subtype);
          inv.identified = true;
          count++;
        }
      }
      return count > 0
        ? `Read ${scroll.name}. Identified ${count} item(s)!`
        : `Read ${scroll.name}. Nothing new to identify.`;
    }
    case 'map_reveal': {
      // Reveal all tiles on current floor
      if (gameState?.dungeonFloor) {
        for (const row of gameState.dungeonFloor.tiles) {
          for (const tile of row) {
            tile.explored = true;
          }
        }
      }
      return `Read ${scroll.name}. The entire floor is revealed!`;
    }
    case 'enchant': {
      // Upgrade a random equipped item's stats
      const equipped = Object.values(entity.equipment).filter(Boolean);
      if (equipped.length === 0) return `Read ${scroll.name} but have nothing to enchant.`;
      const target = randomChoice(equipped);
      if (target.stats.attack) target.stats.attack += randomInt(2, 5);
      if (target.stats.defense) target.stats.defense += randomInt(1, 3);
      return `Read ${scroll.name}. ${getDisplayName(target)} glows with power!`;
    }
    default:
      return `Read ${scroll.name}.`;
  }
}

// ── Drop Item ────────────────────────────────────────────────────────────────

/**
 * Drop an item from inventory onto the current tile.
 * @param {import('./data-model.js').Entity} entity
 * @param {string} itemId
 * @param {import('./data-model.js').GameState} gameState
 * @returns {{ success: boolean, message: string }}
 */
export function dropItem(entity, itemId, gameState) {
  const item = removeFromInventory(entity, itemId);
  if (!item) return { success: false, message: 'Item not in inventory.' };

  if (gameState) {
    gameState.addItem(item, entity.pos);
  }
  return { success: true, message: `Dropped ${getDisplayName(item)}.` };
}

// ── Pickup Item ──────────────────────────────────────────────────────────────

/**
 * Pick up an item from the floor at the entity's position.
 * @param {import('./data-model.js').Entity} entity
 * @param {string} itemId
 * @param {import('./data-model.js').GameState} gameState
 * @returns {{ success: boolean, message: string }}
 */
export function pickupItem(entity, itemId, gameState) {
  if (isInventoryFull(entity)) {
    return { success: false, message: 'Inventory is full!' };
  }

  const item = gameState.items.get(itemId);
  if (!item) return { success: false, message: 'Item not found.' };

  gameState.removeItem(itemId);
  entity.inventory.push(item);

  return { success: true, message: `Picked up ${getDisplayName(item)}.` };
}

// ── Computed Equipment Stats ─────────────────────────────────────────────────

/**
 * Get the total attack bonus from all equipped items.
 * @param {import('./data-model.js').Entity} entity
 * @returns {number}
 */
export function getTotalEquippedAttack(entity) {
  let total = 0;
  for (const item of Object.values(entity.equipment)) {
    if (item?.stats?.attack) total += item.stats.attack;
  }
  return total;
}

/**
 * Get the total defense bonus from all equipped items.
 * @param {import('./data-model.js').Entity} entity
 * @returns {number}
 */
export function getTotalEquippedDefense(entity) {
  let total = 0;
  for (const item of Object.values(entity.equipment)) {
    if (item?.stats?.defense) total += item.stats.defense;
  }
  return total;
}

/**
 * Get the equipped weapon's range (default 1 for melee).
 * @param {import('./data-model.js').Entity} entity
 * @returns {number}
 */
export function getWeaponRange(entity) {
  const weapon = entity.equipment[EQUIPMENT_SLOTS.WEAPON];
  return weapon?.stats?.range ?? 1;
}

// ── Player Action Hook — Pickup ──────────────────────────────────────────────

/**
 * Handle pickup action when player presses ',' or 'g'.
 * Picks up all items on the player's current tile (up to inventory cap).
 * @param {import('./data-model.js').GameState} gameState
 * @param {{ type: string }} action
 */
function handlePlayerAction(gameState, action) {
  if (action.type !== 'pickup') return;

  const player = gameState.player;
  if (!player || !player.alive) return;

  const tile = gameState.dungeonFloor?.getTile(player.pos.x, player.pos.y);
  if (!tile || tile.itemIds.length === 0) {
    gameState.addLog('Nothing to pick up here.');
    return;
  }

  // Copy the array since pickupItem mutates tile.itemIds via removeItem
  const itemIds = [...tile.itemIds];
  let picked = 0;

  for (const itemId of itemIds) {
    if (isInventoryFull(player)) {
      gameState.addLog('Inventory is full!');
      break;
    }
    const result = pickupItem(player, itemId, gameState);
    if (result.success) {
      gameState.addLog(result.message);
      picked++;
    }
  }

  if (picked === 0 && !isInventoryFull(player)) {
    gameState.addLog('Nothing to pick up here.');
  }
}

// ── Hook Registration ────────────────────────────────────────────────────────

registerHook('playerAction', handlePlayerAction);
