/**
 * @file combat.js
 * @description Complete turn-based combat and enemy AI system.
 * Handles player actions (move/attack/ability), enemy AI behaviors
 * (aggressive, flanker, cautious, ranged), damage calculation,
 * status effects, death handling, and enemy spawning per floor.
 *
 * Registers with game.js via registerHook for:
 *   playerAction, enemyAction, statusTick, cleanup, spawnEnemies
 */

import { registerHook } from './game.js';
import { Entity, createPosition, Item } from './data-model.js';
import {
  ENTITY_TYPES, ENEMY_TYPES, CLASS_TYPES,
  CLASS_BASE_STATS, CLASS_ABILITIES,
  TILE_TYPES, STATUS_EFFECTS, FLOOR_DIFFICULTY,
  ATTACK_TYPES, ITEM_TYPES, POTION_SUBTYPES,
} from './constants.js';
import {
  chebyshevDistance, manhattanDistance, bresenhamLine,
  getNeighbors8, randomInt, randomFloat, randomChoice, clamp,
} from './utils.js';
import { generateLootDrop } from './items.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** AI behavior types */
const AI_BEHAVIOR = Object.freeze({
  AGGRESSIVE: 'aggressive',
  FLANKER:    'flanker',
  CAUTIOUS:   'cautious',
  RANGED:     'ranged',
});

/** XP awarded per enemy type (base, scaled by floor) */
const ENEMY_XP = Object.freeze({
  [ENEMY_TYPES.RAT]:       10,
  [ENEMY_TYPES.SLIME]:     12,
  [ENEMY_TYPES.GOBLIN]:    15,
  [ENEMY_TYPES.SKELETON]:  25,
  [ENEMY_TYPES.ORC]:       40,
  [ENEMY_TYPES.DARK_MAGE]: 45,
  [ENEMY_TYPES.WRAITH]:    50,
  [ENEMY_TYPES.DRAGON]:    500,
});

/** Enemy stat templates (base values before floor scaling) */
const ENEMY_TEMPLATES = Object.freeze({
  [ENEMY_TYPES.RAT]:      { hp: 15,  mp: 0,  stamina: 10, attack: 4,  defense: 1,  speed: 12, behavior: AI_BEHAVIOR.AGGRESSIVE },
  [ENEMY_TYPES.SLIME]:    { hp: 20,  mp: 0,  stamina: 10, attack: 3,  defense: 3,  speed: 4,  behavior: AI_BEHAVIOR.AGGRESSIVE },
  [ENEMY_TYPES.GOBLIN]:   { hp: 30,  mp: 0,  stamina: 15, attack: 6,  defense: 3,  speed: 10, behavior: AI_BEHAVIOR.AGGRESSIVE },
  [ENEMY_TYPES.SKELETON]: { hp: 50,  mp: 0,  stamina: 20, attack: 10, defense: 6,  speed: 8,  behavior: AI_BEHAVIOR.AGGRESSIVE },
  [ENEMY_TYPES.ORC]:      { hp: 80,  mp: 0,  stamina: 30, attack: 14, defense: 10, speed: 7,  behavior: AI_BEHAVIOR.FLANKER },
  [ENEMY_TYPES.DARK_MAGE]:{ hp: 45,  mp: 60, stamina: 10, attack: 5,  defense: 4,  speed: 9,  behavior: AI_BEHAVIOR.RANGED },
  [ENEMY_TYPES.WRAITH]:   { hp: 60,  mp: 20, stamina: 30, attack: 12, defense: 5,  speed: 14, behavior: AI_BEHAVIOR.CAUTIOUS },
  [ENEMY_TYPES.DRAGON]:   { hp: 300, mp: 80, stamina: 50, attack: 25, defense: 18, speed: 10, behavior: AI_BEHAVIOR.AGGRESSIVE },
});

/** Enemy spawn tables per floor range */
const FLOOR_ENEMY_TABLE = [
  /* floor 1  */ [ENEMY_TYPES.RAT, ENEMY_TYPES.SLIME],
  /* floor 2  */ [ENEMY_TYPES.RAT, ENEMY_TYPES.GOBLIN, ENEMY_TYPES.SLIME],
  /* floor 3  */ [ENEMY_TYPES.GOBLIN, ENEMY_TYPES.SKELETON],
  /* floor 4  */ [ENEMY_TYPES.GOBLIN, ENEMY_TYPES.SKELETON, ENEMY_TYPES.ORC],
  /* floor 5  */ [ENEMY_TYPES.SKELETON, ENEMY_TYPES.ORC, ENEMY_TYPES.DARK_MAGE],       // + Ogre King boss
  /* floor 6  */ [ENEMY_TYPES.ORC, ENEMY_TYPES.DARK_MAGE, ENEMY_TYPES.WRAITH],
  /* floor 7  */ [ENEMY_TYPES.ORC, ENEMY_TYPES.DARK_MAGE, ENEMY_TYPES.WRAITH],
  /* floor 8  */ [ENEMY_TYPES.DARK_MAGE, ENEMY_TYPES.WRAITH, ENEMY_TYPES.SKELETON],
  /* floor 9  */ [ENEMY_TYPES.WRAITH, ENEMY_TYPES.ORC, ENEMY_TYPES.DARK_MAGE],
  /* floor 10 */ [ENEMY_TYPES.WRAITH, ENEMY_TYPES.ORC, ENEMY_TYPES.DARK_MAGE],         // + Dragon boss
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Check line of sight between two positions on the dungeon floor.
 * @param {import('./data-model.js').DungeonFloor} floor
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @returns {boolean}
 */
function hasLineOfSight(floor, from, to) {
  const line = bresenhamLine(from, to);
  // Skip the source tile, check intermediate tiles (not including target)
  for (let i = 1; i < line.length - 1; i++) {
    const tile = floor.getTile(line[i].x, line[i].y);
    if (!tile || tile.opaque) return false;
  }
  return true;
}

/**
 * Check if a tile is walkable and unoccupied.
 */
function isPassable(gameState, x, y) {
  const tile = gameState.dungeonFloor?.getTile(x, y);
  return tile && tile.walkable && !tile.entityId;
}

/**
 * Move an entity to a new position, updating tile occupancy.
 */
function moveEntity(gameState, entity, newX, newY) {
  const floor = gameState.dungeonFloor;
  if (!floor) return false;

  const oldTile = floor.getTile(entity.pos.x, entity.pos.y);
  const newTile = floor.getTile(newX, newY);
  if (!newTile || !newTile.walkable || newTile.entityId) return false;

  if (oldTile && oldTile.entityId === entity.id) oldTile.entityId = null;
  newTile.entityId = entity.id;
  entity.pos.x = newX;
  entity.pos.y = newY;
  return true;
}

/**
 * Get the effective attack stat including weapon bonus.
 */
function getEffectiveAttack(entity) {
  let atk = entity.attack;
  const weapon = entity.equipment?.weapon;
  if (weapon?.stats?.attack) atk += weapon.stats.attack;
  return atk;
}

/**
 * Get the effective defense stat including armor bonuses.
 */
function getEffectiveDefense(entity) {
  let def = entity.defense;
  for (const slot of Object.values(entity.equipment ?? {})) {
    if (slot?.stats?.defense) def += slot.stats.defense;
  }
  // Battle Cry / defense buff
  const defBuff = entity.statusEffects.find(e => e.type === 'defense_buff');
  if (defBuff) def += defBuff.potency;
  return def;
}

// ── Damage Calculation ───────────────────────────────────────────────────────

/**
 * Calculate damage: base_damage + weapon_bonus - target_armor, with ±20% variance.
 * Minimum damage is 1.
 */
function calculateDamage(attacker, defender, bonusDamage = 0) {
  const base = getEffectiveAttack(attacker) + bonusDamage;
  const armor = getEffectiveDefense(defender);
  const raw = base - armor;
  const variance = randomFloat(0.8, 1.2);
  return Math.max(1, Math.round(raw * variance));
}

/**
 * Apply damage to an entity and return the amount dealt.
 */
function applyDamage(entity, amount) {
  const dmg = Math.max(0, amount);
  entity.hp = clamp(entity.hp - dmg, 0, entity.maxHp);
  return dmg;
}

// ── Ability Helpers ──────────────────────────────────────────────────────────

/**
 * Check if an entity can pay the cost for an ability.
 */
function canPayAbilityCost(entity, ability) {
  if (ability.cost.mp && entity.mp < ability.cost.mp) return false;
  if (ability.cost.stamina && entity.stamina < ability.cost.stamina) return false;
  return true;
}

/**
 * Deduct the ability cost from the entity.
 */
function payAbilityCost(entity, ability) {
  if (ability.cost.mp) entity.mp -= ability.cost.mp;
  if (ability.cost.stamina) entity.stamina -= ability.cost.stamina;
}

/**
 * Get targets for an ability based on its shape.
 * Returns array of entity IDs that would be affected.
 */
function getAbilityTargets(gameState, caster, ability, targetPos) {
  const floor = gameState.dungeonFloor;
  const targets = [];

  if (ability.shape === 'single') {
    const tile = floor.getTile(targetPos.x, targetPos.y);
    if (tile?.entityId && tile.entityId !== caster.id) {
      targets.push(tile.entityId);
    }
  } else if (ability.shape === 'line') {
    const line = bresenhamLine(caster.pos, targetPos);
    for (const pt of line) {
      if (pt.x === caster.pos.x && pt.y === caster.pos.y) continue;
      const tile = floor.getTile(pt.x, pt.y);
      if (tile?.opaque) break;
      if (tile?.entityId && tile.entityId !== caster.id) {
        targets.push(tile.entityId);
        break; // Line abilities hit the first target
      }
    }
  } else if (ability.shape === 'aoe') {
    // AoE centered on targetPos, radius 1 for melee range, or 1 for ranged
    const radius = ability.range <= 1 ? 1 : 1;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = targetPos.x + dx;
        const ty = targetPos.y + dy;
        const tile = floor.getTile(tx, ty);
        if (tile?.entityId && tile.entityId !== caster.id) {
          targets.push(tile.entityId);
        }
      }
    }
  }

  return targets;
}

/**
 * Apply a status effect from an ability to a target entity.
 */
function applyStatusEffect(target, effectType, potency = 0) {
  if (!effectType) return;

  const effectMap = {
    stun:      { type: STATUS_EFFECTS.STUN,   turnsLeft: 1, potency: 0 },
    burn:      { type: STATUS_EFFECTS.BURN,    turnsLeft: 3, potency: 5 },
    slow:      { type: STATUS_EFFECTS.SLOW,    turnsLeft: 2, potency: 0 },
    blind:     { type: STATUS_EFFECTS.BLIND,   turnsLeft: 2, potency: 0 },
    poison:    { type: STATUS_EFFECTS.POISON,  turnsLeft: 4, potency: 3 },
    debuff:    { type: 'defense_debuff', turnsLeft: 3, potency: 5 },
    // Special effects handled inline
    crit_bonus: null,
    teleport:   null,
  };

  const template = effectMap[effectType];
  if (template) {
    // Don't stack the same effect — refresh duration
    const existing = target.statusEffects.find(e => e.type === template.type);
    if (existing) {
      existing.turnsLeft = template.turnsLeft;
    } else {
      target.statusEffects.push({ ...template });
    }
  }
}

// ── Player Actions ───────────────────────────────────────────────────────────

/**
 * Process the player's chosen action for this turn.
 * Handles move (bump-to-attack), wait, ability usage.
 */
function handlePlayerAction(gameState, action) {
  const player = gameState.player;
  if (!player || !player.alive) return;

  // Stunned players skip their turn
  if (player.statusEffects.some(e => e.type === STATUS_EFFECTS.STUN)) {
    gameState.addLog('You are stunned and cannot act!');
    return;
  }

  switch (action.type) {
    case 'move':
      handleMove(gameState, player, action.payload);
      break;
    case 'wait':
      gameState.addLog('You wait...');
      // Recover 1 stamina on wait
      player.stamina = clamp(player.stamina + 2, 0, player.maxStamina);
      break;
    case 'ability':
      handleAbility(gameState, player, action.payload);
      break;
    default:
      break;
  }
}

/**
 * Handle movement / bump-attack.
 */
function handleMove(gameState, player, dir) {
  const nx = player.pos.x + dir.dx;
  const ny = player.pos.y + dir.dy;

  const floor = gameState.dungeonFloor;
  const tile = floor?.getTile(nx, ny);
  if (!tile) return;

  // Bump attack if there's an enemy on the target tile
  if (tile.entityId && tile.entityId !== player.id) {
    const target = gameState.entities.get(tile.entityId);
    if (target && target.alive && target.entityType === ENTITY_TYPES.ENEMY) {
      performMeleeAttack(gameState, player, target);
      return;
    }
  }

  // Otherwise, try to move
  if (tile.walkable && !tile.entityId) {
    moveEntity(gameState, player, nx, ny);
    // Regenerate small amount of resources each step
    player.stamina = clamp(player.stamina + 1, 0, player.maxStamina);
    player.mp = clamp(player.mp + 1, 0, player.maxMp);
  }
}

/**
 * Perform a melee attack from attacker to defender.
 */
function performMeleeAttack(gameState, attacker, defender) {
  const dmg = calculateDamage(attacker, defender);
  const dealt = applyDamage(defender, dmg);

  const aName = attacker.isPlayer ? 'You' : attacker.name;
  const dName = defender.isPlayer ? 'you' : defender.name;
  const verb = attacker.isPlayer ? 'hit' : 'hits';
  gameState.addLog(`${aName} ${verb} ${dName} for ${dealt} damage.`);

  if (defender.hp <= 0) {
    handleDeath(gameState, defender, attacker);
  }
}

/**
 * Handle ability usage from an action payload.
 */
function handleAbility(gameState, caster, payload) {
  const abilityIndex = payload.index;
  const ability = caster.abilities[abilityIndex];
  if (!ability) {
    gameState.addLog('No ability in that slot.');
    return;
  }

  if (!canPayAbilityCost(caster, ability)) {
    gameState.addLog(`Not enough resources for ${ability.name}.`);
    return;
  }

  // Find the nearest enemy for auto-targeting
  const target = findNearestEnemy(gameState, caster);

  // Special handling per ability effect
  switch (ability.id) {
    case 'shield_bash':
      executeTargetedAbility(gameState, caster, ability, target);
      break;
    case 'cleave':
      executeCleave(gameState, caster, ability);
      break;
    case 'war_cry':
      executeWarCry(gameState, caster, ability);
      break;
    case 'fireball':
      executeFireball(gameState, caster, ability, target);
      break;
    case 'ice_shard':
      executeIceShard(gameState, caster, ability, target);
      break;
    case 'teleport':
      executeTeleport(gameState, caster, ability);
      break;
    case 'backstab':
      executeBackstab(gameState, caster, ability, target);
      break;
    case 'smoke_bomb':
      executeSmokeBomb(gameState, caster, ability);
      break;
    case 'poison_dagger':
      executePoisonDagger(gameState, caster, ability, target);
      break;
    default:
      executeTargetedAbility(gameState, caster, ability, target);
      break;
  }
}

// ── Ability Implementations ──────────────────────────────────────────────────

function executeTargetedAbility(gameState, caster, ability, target) {
  if (!target) {
    gameState.addLog('No enemy in range.');
    return;
  }
  const dist = chebyshevDistance(caster.pos, target.pos);
  if (dist > ability.range) {
    gameState.addLog(`${ability.name}: target out of range.`);
    return;
  }
  if (ability.range > 1 && !hasLineOfSight(gameState.dungeonFloor, caster.pos, target.pos)) {
    gameState.addLog(`${ability.name}: no line of sight.`);
    return;
  }
  payAbilityCost(caster, ability);
  const dmg = calculateDamage(caster, target, ability.damage);
  const dealt = applyDamage(target, dmg);
  gameState.addLog(`${ability.name} hits ${target.name} for ${dealt} damage!`);
  if (ability.effect) applyStatusEffect(target, ability.effect);
  if (target.hp <= 0) handleDeath(gameState, target, caster);
}

function executeCleave(gameState, caster, ability) {
  payAbilityCost(caster, ability);
  const neighbors = getNeighbors8(caster.pos);
  let hitCount = 0;
  for (const pos of neighbors) {
    const tile = gameState.dungeonFloor?.getTile(pos.x, pos.y);
    if (tile?.entityId) {
      const target = gameState.entities.get(tile.entityId);
      if (target && target.alive && target.entityType === ENTITY_TYPES.ENEMY) {
        const dmg = calculateDamage(caster, target, ability.damage);
        const dealt = applyDamage(target, dmg);
        gameState.addLog(`Cleave hits ${target.name} for ${dealt} damage!`);
        if (target.hp <= 0) handleDeath(gameState, target, caster);
        hitCount++;
      }
    }
  }
  if (hitCount === 0) gameState.addLog('Cleave swings at empty air.');
}

function executeWarCry(gameState, caster, ability) {
  payAbilityCost(caster, ability);
  // Buff the caster's defense for 3 turns
  const existing = caster.statusEffects.find(e => e.type === 'defense_buff');
  if (existing) {
    existing.turnsLeft = 3;
  } else {
    caster.statusEffects.push({ type: 'defense_buff', turnsLeft: 3, potency: 6 });
  }
  // Debuff nearby enemies
  const neighbors = getNeighbors8(caster.pos);
  for (const pos of neighbors) {
    const tile = gameState.dungeonFloor?.getTile(pos.x, pos.y);
    if (tile?.entityId) {
      const target = gameState.entities.get(tile.entityId);
      if (target && target.alive && target.entityType === ENTITY_TYPES.ENEMY) {
        applyStatusEffect(target, 'debuff');
      }
    }
  }
  gameState.addLog('Battle Cry! Your defense is bolstered!');
}

function executeFireball(gameState, caster, ability, target) {
  if (!target) {
    gameState.addLog('No enemy in range.');
    return;
  }
  const dist = chebyshevDistance(caster.pos, target.pos);
  if (dist > ability.range) {
    gameState.addLog('Fireball: target out of range.');
    return;
  }
  if (!hasLineOfSight(gameState.dungeonFloor, caster.pos, target.pos)) {
    gameState.addLog('Fireball: no line of sight.');
    return;
  }
  payAbilityCost(caster, ability);
  // AoE 3×3 centered on target
  const targets = getAbilityTargets(gameState, caster, ability, target.pos);
  gameState.addLog(`Fireball explodes at (${target.pos.x}, ${target.pos.y})!`);
  for (const eid of targets) {
    const e = gameState.entities.get(eid);
    if (e && e.alive) {
      const dmg = calculateDamage(caster, e, ability.damage);
      const dealt = applyDamage(e, dmg);
      gameState.addLog(`  ${e.name} takes ${dealt} fire damage!`);
      applyStatusEffect(e, 'burn');
      if (e.hp <= 0) handleDeath(gameState, e, caster);
    }
  }
}

function executeIceShard(gameState, caster, ability, target) {
  if (!target) {
    gameState.addLog('No enemy in range.');
    return;
  }
  const dist = chebyshevDistance(caster.pos, target.pos);
  if (dist > ability.range) {
    gameState.addLog('Ice Shard: target out of range.');
    return;
  }
  if (!hasLineOfSight(gameState.dungeonFloor, caster.pos, target.pos)) {
    gameState.addLog('Ice Shard: no line of sight.');
    return;
  }
  payAbilityCost(caster, ability);
  const dmg = calculateDamage(caster, target, ability.damage);
  const dealt = applyDamage(target, dmg);
  gameState.addLog(`Ice Shard hits ${target.name} for ${dealt} damage and slows them!`);
  applyStatusEffect(target, 'slow');
  if (target.hp <= 0) handleDeath(gameState, target, caster);
}

function executeTeleport(gameState, caster, ability) {
  payAbilityCost(caster, ability);
  // Teleport the caster to a random walkable tile within range
  const floor = gameState.dungeonFloor;
  const candidates = [];
  for (let dy = -ability.range; dy <= ability.range; dy++) {
    for (let dx = -ability.range; dx <= ability.range; dx++) {
      const tx = caster.pos.x + dx;
      const ty = caster.pos.y + dy;
      if (chebyshevDistance(caster.pos, { x: tx, y: ty }) <= ability.range) {
        if (isPassable(gameState, tx, ty)) {
          candidates.push({ x: tx, y: ty });
        }
      }
    }
  }
  if (candidates.length > 0) {
    const dest = randomChoice(candidates);
    moveEntity(gameState, caster, dest.x, dest.y);
    gameState.addLog(`You teleport to (${dest.x}, ${dest.y})!`);
  } else {
    gameState.addLog('Teleport fizzles — no clear destination.');
  }
}

function executeBackstab(gameState, caster, ability, target) {
  if (!target) {
    gameState.addLog('No enemy in range.');
    return;
  }
  const dist = chebyshevDistance(caster.pos, target.pos);
  if (dist > ability.range) {
    gameState.addLog('Backstab: target out of range.');
    return;
  }
  payAbilityCost(caster, ability);
  // Bonus damage if attacking from behind (opposite side of target's last known direction)
  const isBehind = isBehindTarget(caster, target);
  const bonus = isBehind ? ability.damage * 2 : ability.damage;
  const dmg = calculateDamage(caster, target, bonus);
  const dealt = applyDamage(target, dmg);
  const extraMsg = isBehind ? ' (backstab bonus!)' : '';
  gameState.addLog(`Backstab hits ${target.name} for ${dealt} damage!${extraMsg}`);
  if (target.hp <= 0) handleDeath(gameState, target, caster);
}

function executeSmokeBomb(gameState, caster, ability) {
  payAbilityCost(caster, ability);
  // Make caster invisible for 2 turns
  const existing = caster.statusEffects.find(e => e.type === 'invisible');
  if (existing) {
    existing.turnsLeft = 2;
  } else {
    caster.statusEffects.push({ type: 'invisible', turnsLeft: 2, potency: 0 });
  }
  // Blind nearby enemies
  const aoeTargets = getAbilityTargets(gameState, caster, ability, caster.pos);
  for (const eid of aoeTargets) {
    const e = gameState.entities.get(eid);
    if (e && e.alive) applyStatusEffect(e, 'blind');
  }
  gameState.addLog('Smoke Bomb! You vanish into the haze.');
}

function executePoisonDagger(gameState, caster, ability, target) {
  if (!target) {
    gameState.addLog('No enemy in range.');
    return;
  }
  const dist = chebyshevDistance(caster.pos, target.pos);
  if (dist > ability.range) {
    gameState.addLog('Poison Dagger: target out of range.');
    return;
  }
  payAbilityCost(caster, ability);
  const dmg = calculateDamage(caster, target, ability.damage);
  const dealt = applyDamage(target, dmg);
  applyStatusEffect(target, 'poison');
  gameState.addLog(`Poison Dagger hits ${target.name} for ${dealt} damage! Poison applied.`);
  if (target.hp <= 0) handleDeath(gameState, target, caster);
}

// ── Backstab geometry ────────────────────────────────────────────────────────

/**
 * Determine if the attacker is "behind" the target.
 * Behind means the attacker is on the opposite side from where the target is facing
 * (approximated by the target's last movement direction toward the player).
 */
function isBehindTarget(attacker, target) {
  if (!target.lastKnownPlayerPos) return false;
  // Target faces toward the player position it last knew
  const faceDx = Math.sign((target.lastKnownPlayerPos.x ?? 0) - target.pos.x);
  const faceDy = Math.sign((target.lastKnownPlayerPos.y ?? 0) - target.pos.y);
  // Attacker direction relative to target
  const atkDx = Math.sign(attacker.pos.x - target.pos.x);
  const atkDy = Math.sign(attacker.pos.y - target.pos.y);
  // Behind if attacker is on the opposite side of facing direction
  return (faceDx !== 0 && atkDx === -faceDx) || (faceDy !== 0 && atkDy === -faceDy);
}

// ── Enemy AI ─────────────────────────────────────────────────────────────────

/**
 * Process all enemy turns in initiative order (sorted by speed, descending).
 */
function handleEnemyTurns(gameState) {
  const player = gameState.player;
  if (!player || !player.alive) return;

  const enemies = [...gameState.entities.values()]
    .filter(e => e.entityType === ENTITY_TYPES.ENEMY && e.alive)
    .sort((a, b) => b.speed - a.speed); // Fastest acts first

  for (const enemy of enemies) {
    if (!enemy.alive) continue;

    // Stunned enemies skip their turn
    if (enemy.statusEffects.some(e => e.type === STATUS_EFFECTS.STUN)) continue;

    // Slowed enemies have 50% chance to skip
    if (enemy.statusEffects.some(e => e.type === STATUS_EFFECTS.SLOW)) {
      if (Math.random() < 0.5) continue;
    }

    // Blinded enemies have 40% chance to skip
    if (enemy.statusEffects.some(e => e.type === STATUS_EFFECTS.BLIND)) {
      if (Math.random() < 0.4) continue;
    }

    // Player is invisible — enemies lose track
    if (player.statusEffects.some(e => e.type === 'invisible')) {
      enemyWander(gameState, enemy);
      continue;
    }

    const dist = chebyshevDistance(enemy.pos, player.pos);
    const canSee = dist <= 8 && hasLineOfSight(gameState.dungeonFloor, enemy.pos, player.pos);

    if (canSee) {
      enemy.lastKnownPlayerPos = { ...player.pos };
    }

    // Determine behavior from template
    const template = ENEMY_TEMPLATES[enemy.classType];
    const behavior = template?.behavior ?? AI_BEHAVIOR.AGGRESSIVE;

    // Cautious: retreat at low HP
    const hpRatio = enemy.hp / enemy.maxHp;
    if (behavior === AI_BEHAVIOR.CAUTIOUS && hpRatio < 0.3) {
      enemyRetreat(gameState, enemy, player);
      continue;
    }

    if (!canSee && !enemy.lastKnownPlayerPos) {
      enemyWander(gameState, enemy);
      continue;
    }

    switch (behavior) {
      case AI_BEHAVIOR.AGGRESSIVE:
        enemyAggressive(gameState, enemy, player);
        break;
      case AI_BEHAVIOR.FLANKER:
        enemyFlanker(gameState, enemy, player);
        break;
      case AI_BEHAVIOR.CAUTIOUS:
        enemyAggressive(gameState, enemy, player); // Cautious above 30% HP acts aggressive
        break;
      case AI_BEHAVIOR.RANGED:
        enemyRanged(gameState, enemy, player);
        break;
      default:
        enemyAggressive(gameState, enemy, player);
        break;
    }
  }
}

/**
 * Aggressive AI: move toward player, attack when adjacent.
 */
function enemyAggressive(gameState, enemy, player) {
  const dist = chebyshevDistance(enemy.pos, player.pos);
  if (dist <= 1) {
    performMeleeAttack(gameState, enemy, player);
  } else {
    moveToward(gameState, enemy, player.pos);
  }
}

/**
 * Flanker AI: try to get behind or to the side of the player before attacking.
 */
function enemyFlanker(gameState, enemy, player) {
  const dist = chebyshevDistance(enemy.pos, player.pos);
  if (dist <= 1) {
    performMeleeAttack(gameState, enemy, player);
    return;
  }

  // Try to move to a tile adjacent to player that is on the side/behind
  const neighbors = getNeighbors8(player.pos);
  let bestPos = null;
  let bestScore = -Infinity;

  for (const pos of neighbors) {
    if (!isPassable(gameState, pos.x, pos.y)) continue;
    const moveDist = chebyshevDistance(enemy.pos, pos);
    // Prefer tiles that aren't directly in front of the player
    // "Front" approximated as the direction the player last moved
    let flanking = 1;
    // Just prefer tiles that are farther from other enemies (spread out)
    const otherEnemiesNearby = [...gameState.entities.values()]
      .filter(e => e.entityType === ENTITY_TYPES.ENEMY && e.id !== enemy.id && e.alive)
      .some(e => chebyshevDistance(e.pos, pos) <= 1);
    if (!otherEnemiesNearby) flanking += 2;

    const score = flanking - moveDist * 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }

  if (bestPos) {
    moveToward(gameState, enemy, bestPos);
  } else {
    moveToward(gameState, enemy, player.pos);
  }
}

/**
 * Ranged AI: maintain distance, shoot from afar.
 */
function enemyRanged(gameState, enemy, player) {
  const dist = chebyshevDistance(enemy.pos, player.pos);
  const canSee = hasLineOfSight(gameState.dungeonFloor, enemy.pos, player.pos);

  // If too close, try to retreat
  if (dist <= 2) {
    enemyRetreat(gameState, enemy, player);
    return;
  }

  // If in range and line of sight, shoot
  if (dist <= 5 && canSee) {
    const dmg = calculateDamage(enemy, player, 4); // Ranged bonus
    const dealt = applyDamage(player, dmg);
    gameState.addLog(`${enemy.name} casts a bolt at you for ${dealt} damage!`);
    // Dark mages can apply burn
    if (enemy.classType === ENEMY_TYPES.DARK_MAGE && Math.random() < 0.3) {
      applyStatusEffect(player, 'burn');
      gameState.addLog(`You catch fire!`);
    }
    if (player.hp <= 0) handleDeath(gameState, player, enemy);
    return;
  }

  // Move closer (but not too close)
  if (dist > 5) {
    moveToward(gameState, enemy, player.pos);
  }
}

/**
 * Retreat: move away from the player.
 */
function enemyRetreat(gameState, enemy, player) {
  // Try to use a healing item if available
  const healItem = enemy.inventory.find(
    i => i.type === ITEM_TYPES.POTION && i.subtype === POTION_SUBTYPES.HEALTH
  );
  if (healItem) {
    const healAmt = healItem.stats?.hp ?? 20;
    enemy.hp = clamp(enemy.hp + healAmt, 0, enemy.maxHp);
    enemy.inventory = enemy.inventory.filter(i => i.id !== healItem.id);
    gameState.addLog(`${enemy.name} drinks a healing potion!`);
    return;
  }

  // Move away from the player
  moveAway(gameState, enemy, player.pos);
}

/**
 * Wander randomly.
 */
function enemyWander(gameState, enemy) {
  const neighbors = getNeighbors8(enemy.pos).filter(
    p => isPassable(gameState, p.x, p.y)
  );
  if (neighbors.length > 0) {
    const dest = randomChoice(neighbors);
    moveEntity(gameState, enemy, dest.x, dest.y);
  }
}

// ── Pathfinding (simple greedy step) ─────────────────────────────────────────

/**
 * Move one step toward a target position (greedy best-first).
 */
function moveToward(gameState, entity, targetPos) {
  const neighbors = getNeighbors8(entity.pos);
  let best = null;
  let bestDist = Infinity;

  for (const pos of neighbors) {
    if (!isPassable(gameState, pos.x, pos.y)) continue;
    const d = chebyshevDistance(pos, targetPos);
    if (d < bestDist) {
      bestDist = d;
      best = pos;
    }
  }

  if (best) {
    moveEntity(gameState, entity, best.x, best.y);
  }
}

/**
 * Move one step away from a target position.
 */
function moveAway(gameState, entity, targetPos) {
  const neighbors = getNeighbors8(entity.pos);
  let best = null;
  let bestDist = -Infinity;

  for (const pos of neighbors) {
    if (!isPassable(gameState, pos.x, pos.y)) continue;
    const d = chebyshevDistance(pos, targetPos);
    if (d > bestDist) {
      bestDist = d;
      best = pos;
    }
  }

  if (best) {
    moveEntity(gameState, entity, best.x, best.y);
  }
}

/**
 * Find the nearest enemy to a given entity.
 */
function findNearestEnemy(gameState, caster) {
  const isPlayerCaster = caster.isPlayer;
  let nearest = null;
  let nearestDist = Infinity;

  for (const e of gameState.entities.values()) {
    if (!e.alive) continue;
    if (isPlayerCaster && e.entityType !== ENTITY_TYPES.ENEMY) continue;
    if (!isPlayerCaster && e.entityType !== ENTITY_TYPES.PLAYER) continue;

    const d = chebyshevDistance(caster.pos, e.pos);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = e;
    }
  }

  return nearest;
}

// ── Status Effect Ticks ──────────────────────────────────────────────────────

/**
 * Tick all status effects for all entities.
 */
function handleStatusTicks(gameState) {
  for (const entity of gameState.entities.values()) {
    if (!entity.alive) continue;

    for (const effect of entity.statusEffects) {
      switch (effect.type) {
        case STATUS_EFFECTS.POISON:
          applyDamage(entity, effect.potency);
          if (entity.isPlayer) gameState.addLog(`Poison deals ${effect.potency} damage to you.`);
          else gameState.addLog(`${entity.name} takes ${effect.potency} poison damage.`);
          if (entity.hp <= 0) handleDeath(gameState, entity, null);
          break;
        case STATUS_EFFECTS.BURN:
          applyDamage(entity, effect.potency);
          if (entity.isPlayer) gameState.addLog(`Burn deals ${effect.potency} damage to you.`);
          else gameState.addLog(`${entity.name} takes ${effect.potency} burn damage.`);
          if (entity.hp <= 0) handleDeath(gameState, entity, null);
          break;
        default:
          break;
      }
      effect.turnsLeft--;
    }

    // Remove expired effects
    entity.statusEffects = entity.statusEffects.filter(e => e.turnsLeft > 0);
  }
}

// ── Death Handling ───────────────────────────────────────────────────────────

/**
 * Handle entity death — XP/loot for enemies, game over for player.
 */
function handleDeath(gameState, entity, killer) {
  entity.alive = false;
  entity.hp = 0;

  if (entity.isPlayer) {
    gameState.addLog('You have been slain!');
    // Game over handled in game.js processTurn
    return;
  }

  // Enemy died
  gameState.addLog(`${entity.name} is defeated!`);

  // Award XP to player
  if (killer?.isPlayer) {
    const baseXP = ENEMY_XP[entity.classType] ?? 15;
    const floorMult = FLOOR_DIFFICULTY[gameState.currentFloor - 1] ?? 1;
    const xp = Math.round(baseXP * floorMult);
    killer.xp += xp;
    killer.score += xp;
    gameState.addLog(`  +${xp} XP`);

    // Level up check
    checkLevelUp(gameState, killer);
  }

  // Drop loot at the entity's position
  dropEnemyLoot(gameState, entity);

  // Remove from map
  gameState.removeEntity(entity.id);
}

/**
 * Check if the player has enough XP to level up.
 */
function checkLevelUp(gameState, player) {
  while (player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level++;
    player.xpToNext = Math.round(player.xpToNext * 1.5);

    // Stat gains
    const classStats = CLASS_BASE_STATS[player.classType];
    player.maxHp += Math.round(classStats.hp * 0.1);
    player.hp = clamp(player.hp + Math.round(classStats.hp * 0.1), 0, player.maxHp);
    player.maxMp += Math.round(classStats.mp * 0.05);
    player.mp = clamp(player.mp + Math.round(classStats.mp * 0.05), 0, player.maxMp);
    player.maxStamina += Math.round(classStats.stamina * 0.05);
    player.stamina = clamp(player.stamina + Math.round(classStats.stamina * 0.05), 0, player.maxStamina);
    player.attack += 1;
    player.defense += 1;

    gameState.addLog(`*** LEVEL UP! You are now level ${player.level}! ***`);
  }
}

/**
 * Drop loot items where the enemy died using the full loot table system.
 */
function dropEnemyLoot(gameState, enemy) {
  const drops = generateLootDrop(gameState.currentFloor, enemy.classType);
  for (const item of drops) {
    gameState.addItem(item, enemy.pos);
  }
  if (drops.length > 0) {
    gameState.addLog(`${enemy.name} dropped something!`);
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * End-of-turn cleanup: remove dead entities.
 */
function handleCleanup(gameState) {
  const toRemove = [];
  for (const [id, entity] of gameState.entities) {
    if (!entity.alive && !entity.isPlayer) {
      toRemove.push(id);
    }
  }
  for (const id of toRemove) {
    gameState.removeEntity(id);
  }
}

// ── Enemy Spawning ───────────────────────────────────────────────────────────

/**
 * Create a single enemy entity with stats scaled to the floor.
 */
export function createEnemy(enemyType, pos, floorNumber) {
  const template = ENEMY_TEMPLATES[enemyType];
  if (!template) return null;

  const scale = FLOOR_DIFFICULTY[floorNumber - 1] ?? 1;

  const name = enemyType.charAt(0).toUpperCase() + enemyType.slice(1).replace('_', ' ');
  const enemy = new Entity({
    entityType: ENTITY_TYPES.ENEMY,
    classType: enemyType,
    name,
    pos: createPosition(pos.x, pos.y),
  });

  // Override stats with template values scaled by floor difficulty
  enemy.maxHp = Math.round(template.hp * scale);
  enemy.hp = enemy.maxHp;
  enemy.maxMp = Math.round(template.mp * scale);
  enemy.mp = enemy.maxMp;
  enemy.maxStamina = Math.round(template.stamina * scale);
  enemy.stamina = enemy.maxStamina;
  enemy.attack = Math.round(template.attack * scale);
  enemy.defense = Math.round(template.defense * scale);
  enemy.speed = template.speed;
  enemy.aiState = 'idle';

  // Give cautious enemies a health potion
  if (template.behavior === AI_BEHAVIOR.CAUTIOUS) {
    enemy.inventory.push(new Item({
      type: ITEM_TYPES.POTION,
      subtype: POTION_SUBTYPES.HEALTH,
      name: 'Health Potion',
      stats: { hp: Math.round(20 * scale) },
      value: 10,
    }));
  }

  return enemy;
}

/**
 * Create a boss enemy for a specific floor.
 */
export function createBoss(floorNumber, pos) {
  if (floorNumber === 5) {
    // Ogre King boss
    const boss = createEnemy(ENEMY_TYPES.ORC, pos, floorNumber);
    if (boss) {
      boss.name = 'Ogre King';
      boss.maxHp = Math.round(boss.maxHp * 2.5);
      boss.hp = boss.maxHp;
      boss.attack = Math.round(boss.attack * 1.8);
      boss.defense = Math.round(boss.defense * 1.5);
    }
    return boss;
  }
  if (floorNumber === 10) {
    // Dragon boss
    const boss = createEnemy(ENEMY_TYPES.DRAGON, pos, floorNumber);
    if (boss) {
      boss.name = 'Ancient Dragon';
    }
    return boss;
  }
  return null;
}

/**
 * Spawn enemies on the current floor. Called via 'spawnEnemies' hook.
 */
function spawnEnemies(gameState) {
  const floor = gameState.dungeonFloor;
  if (!floor) return;

  const floorNum = floor.floorNumber;
  const table = FLOOR_ENEMY_TABLE[floorNum - 1] ?? FLOOR_ENEMY_TABLE[0];
  const enemyCount = randomInt(4, 6) + Math.floor(floorNum / 2);

  // Collect walkable floor tiles not occupied and not at stairs
  const candidates = [];
  for (let y = 0; y < floor.height; y++) {
    for (let x = 0; x < floor.width; x++) {
      const tile = floor.getTile(x, y);
      if (tile && tile.walkable && !tile.entityId) {
        // Don't spawn on stairs
        if (floor.stairsUp && x === floor.stairsUp.x && y === floor.stairsUp.y) continue;
        if (floor.stairsDown && x === floor.stairsDown.x && y === floor.stairsDown.y) continue;
        // Don't spawn too close to player
        if (gameState.player) {
          const d = chebyshevDistance({ x, y }, gameState.player.pos);
          if (d < 5) continue;
        }
        candidates.push({ x, y });
      }
    }
  }

  for (let i = 0; i < enemyCount && candidates.length > 0; i++) {
    const idx = randomInt(0, candidates.length - 1);
    const pos = candidates.splice(idx, 1)[0];
    const type = randomChoice(table);
    const enemy = createEnemy(type, pos, floorNum);
    if (enemy) gameState.addEntity(enemy);
  }

  // Spawn boss on boss floors
  if (floorNum === 5 || floorNum === 10) {
    if (candidates.length > 0) {
      const idx = randomInt(0, candidates.length - 1);
      const pos = candidates.splice(idx, 1)[0];
      const boss = createBoss(floorNum, pos);
      if (boss) {
        gameState.addEntity(boss);
        gameState.addLog(`A powerful ${boss.name} lurks on this floor!`);
      }
    }
  }
}

// ── Player Factory ───────────────────────────────────────────────────────────

/**
 * Create a new player entity of the given class.
 * @param {string} className — CLASS_TYPES value ('warrior' | 'mage' | 'rogue')
 * @param {string} [name='Adventurer']
 * @returns {Entity}
 */
export function createPlayer(className, name = 'Adventurer') {
  return new Entity({
    entityType: ENTITY_TYPES.PLAYER,
    classType: className,
    name,
    pos: createPosition(0, 0),
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Process a player combat action.
 * @param {import('./data-model.js').GameState} gameState
 * @param {Object} action — PlayerAction
 */
export function processCombat(gameState, action) {
  handlePlayerAction(gameState, action);
}

/**
 * Process all enemy turns.
 * @param {import('./data-model.js').GameState} gameState
 */
export function processEnemyTurns(gameState) {
  handleEnemyTurns(gameState);
}

// ── Hook Registration ────────────────────────────────────────────────────────

registerHook('playerAction', handlePlayerAction);
registerHook('enemyAction',  handleEnemyTurns);
registerHook('statusTick',   handleStatusTicks);
registerHook('cleanup',      handleCleanup);
registerHook('spawnEnemies',  spawnEnemies);
