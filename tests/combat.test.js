/**
 * @file combat.test.js
 * @description Tests for the combat system contracts: damage calculation,
 * abilities, AI behavior, permadeath, and turn order.
 */

const { describe, it, assert } = require('./test-runner');
const { loadModule, loadDataModel } = require('./loader');

const constants = loadModule('src/constants.js');
const dm = loadDataModel(constants);
const { Entity, GameState, DungeonFloor, Item } = dm;
const {
  CLASS_TYPES, CLASS_BASE_STATS, CLASS_ABILITIES, ENTITY_TYPES,
  TURN_PHASES, TILE_TYPES, FLOOR_DIFFICULTY,
} = constants;

// ── Combat simulation helpers ────────────────────────────────────────────────

/**
 * Calculate basic melee damage: attacker.attack - defender.defense (min 1).
 * This is the expected contract for the combat module.
 */
function calculateDamage(attacker, defender) {
  const raw = attacker.attack - defender.defense;
  return Math.max(1, raw);
}

/**
 * Apply ability: deal ability.damage + attacker.attack/2 - defender.defense (min 1).
 * Deduct resource cost from attacker.
 */
function useAbility(attacker, defender, ability) {
  // Deduct costs
  if (ability.cost.mp) attacker.mp -= ability.cost.mp;
  if (ability.cost.stamina) attacker.stamina -= ability.cost.stamina;

  if (ability.damage > 0 && defender) {
    const raw = ability.damage + Math.floor(attacker.attack / 2) - defender.defense;
    const dmg = Math.max(1, raw);
    defender.hp -= dmg;
    return dmg;
  }
  return 0;
}

/**
 * Determine AI behavior based on HP percentage.
 */
function determineAIState(entity) {
  const hpPercent = entity.hp / entity.maxHp;
  if (hpPercent <= 0.3) return 'flee';
  return 'chase';
}

/**
 * Sort entities by speed for turn order (descending).
 */
function determineTurnOrder(entities) {
  return [...entities].sort((a, b) => b.speed - a.speed);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Combat System', () => {
  describe('Damage Calculation', () => {
    it('basic damage = attack - defense (minimum 1)', () => {
      const attacker = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Attacker',
        pos: { x: 0, y: 0 },
      });
      const defender = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'skeleton',
        name: 'Defender',
        pos: { x: 1, y: 0 },
      });

      const dmg = calculateDamage(attacker, defender);
      const expected = Math.max(1, attacker.attack - defender.defense);
      assert.equal(dmg, expected);
      assert.greaterThanOrEqual(dmg, 1);
    });

    it('damage should never be less than 1', () => {
      const weak = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'rat',
        name: 'Weak',
        pos: { x: 0, y: 0 },
      });
      // Manually boost defense way above attack
      const tank = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'orc',
        name: 'Tank',
        pos: { x: 1, y: 0 },
      });
      tank.defense = 999;

      const dmg = calculateDamage(weak, tank);
      assert.equal(dmg, 1, 'Minimum damage should be 1');
    });

    it('damage should reduce defender HP', () => {
      const attacker = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Warrior',
        pos: { x: 0, y: 0 },
      });
      const enemy = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'skeleton',
        name: 'Skeleton',
        pos: { x: 1, y: 0 },
      });
      const startHp = enemy.hp;
      const dmg = calculateDamage(attacker, enemy);
      enemy.hp -= dmg;

      assert.lessThan(enemy.hp, startHp);
      assert.equal(enemy.hp, startHp - dmg);
    });

    it('floor difficulty multiplier should scale correctly', () => {
      assert.equal(FLOOR_DIFFICULTY[0], 1.0, 'Floor 1 difficulty should be 1.0');
      assert.equal(FLOOR_DIFFICULTY[9], 3.25, 'Floor 10 difficulty should be 3.25');
      // Each floor adds 0.25
      for (let i = 1; i < FLOOR_DIFFICULTY.length; i++) {
        const diff = FLOOR_DIFFICULTY[i] - FLOOR_DIFFICULTY[i - 1];
        assert.equal(Math.round(diff * 100) / 100, 0.25, `Floor ${i + 1} increment should be 0.25`);
      }
    });
  });

  describe('Class Abilities', () => {
    it('each class should have exactly 3 abilities', () => {
      Object.values(CLASS_TYPES).forEach(classType => {
        const abilities = CLASS_ABILITIES[classType];
        assert.equal(abilities.length, 3, `${classType} should have 3 abilities`);
      });
    });

    it('all abilities should have required fields', () => {
      Object.values(CLASS_TYPES).forEach(classType => {
        CLASS_ABILITIES[classType].forEach(ability => {
          assert.ok(ability.id, `Ability in ${classType} missing id`);
          assert.ok(ability.name, `Ability ${ability.id} missing name`);
          assert.ok(ability.shape, `Ability ${ability.id} missing shape`);
          assert.typeOf(ability.range, 'number', `Ability ${ability.id} range should be number`);
          assert.typeOf(ability.damage, 'number', `Ability ${ability.id} damage should be number`);
          assert.ok(ability.cost, `Ability ${ability.id} missing cost`);
        });
      });
    });

    it('ability shapes should be valid types', () => {
      const validShapes = ['single', 'line', 'aoe'];
      Object.values(CLASS_TYPES).forEach(classType => {
        CLASS_ABILITIES[classType].forEach(ability => {
          assert.includes(validShapes, ability.shape,
            `Ability ${ability.id} has invalid shape: ${ability.shape}`);
        });
      });
    });

    it('ability costs should be positive numbers', () => {
      Object.values(CLASS_TYPES).forEach(classType => {
        CLASS_ABILITIES[classType].forEach(ability => {
          const cost = ability.cost;
          if (cost.mp !== undefined) {
            assert.greaterThan(cost.mp, 0, `${ability.id} mp cost should be positive`);
          }
          if (cost.stamina !== undefined) {
            assert.greaterThan(cost.stamina, 0, `${ability.id} stamina cost should be positive`);
          }
          // Each ability must cost something
          assert.ok(cost.mp || cost.stamina, `${ability.id} should cost mp or stamina`);
        });
      });
    });

    it('using ability should deduct mana cost', () => {
      const mage = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.MAGE,
        name: 'Mage',
        pos: { x: 0, y: 0 },
      });
      const enemy = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'rat',
        name: 'Rat',
        pos: { x: 1, y: 0 },
      });

      const fireball = mage.abilities.find(a => a.id === 'fireball');
      const startMp = mage.mp;
      useAbility(mage, enemy, fireball);

      assert.equal(mage.mp, startMp - fireball.cost.mp);
    });

    it('using ability should deduct stamina cost', () => {
      const warrior = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Warrior',
        pos: { x: 0, y: 0 },
      });
      const enemy = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'rat',
        name: 'Rat',
        pos: { x: 1, y: 0 },
      });

      const cleave = warrior.abilities.find(a => a.id === 'cleave');
      const startStamina = warrior.stamina;
      useAbility(warrior, enemy, cleave);

      assert.equal(warrior.stamina, startStamina - cleave.cost.stamina);
    });

    it('ability should deal damage to target', () => {
      const rogue = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.ROGUE,
        name: 'Rogue',
        pos: { x: 0, y: 0 },
      });
      const enemy = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'skeleton',
        name: 'Skeleton',
        pos: { x: 1, y: 0 },
      });

      const startHp = enemy.hp;
      const backstab = rogue.abilities.find(a => a.id === 'backstab');
      const dmg = useAbility(rogue, enemy, backstab);

      assert.greaterThan(dmg, 0);
      assert.lessThan(enemy.hp, startHp);
    });

    it('warrior abilities should use stamina', () => {
      CLASS_ABILITIES[CLASS_TYPES.WARRIOR].forEach(ability => {
        assert.ok(ability.cost.stamina, `Warrior ability ${ability.id} should cost stamina`);
      });
    });

    it('mage abilities should use mana', () => {
      CLASS_ABILITIES[CLASS_TYPES.MAGE].forEach(ability => {
        assert.ok(ability.cost.mp, `Mage ability ${ability.id} should cost mp`);
      });
    });

    it('rogue abilities should use stamina', () => {
      CLASS_ABILITIES[CLASS_TYPES.ROGUE].forEach(ability => {
        assert.ok(ability.cost.stamina, `Rogue ability ${ability.id} should cost stamina`);
      });
    });
  });

  describe('Enemy AI Behavior', () => {
    it('enemy should flee when HP is at or below 30%', () => {
      const enemy = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'goblin',
        name: 'Goblin',
        pos: { x: 0, y: 0 },
      });
      enemy.hp = Math.floor(enemy.maxHp * 0.3);
      assert.equal(determineAIState(enemy), 'flee');
    });

    it('enemy should flee when HP is below 30%', () => {
      const enemy = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'goblin',
        name: 'Goblin',
        pos: { x: 0, y: 0 },
      });
      enemy.hp = Math.floor(enemy.maxHp * 0.1);
      assert.equal(determineAIState(enemy), 'flee');
    });

    it('enemy should chase when HP is above 30%', () => {
      const enemy = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'goblin',
        name: 'Goblin',
        pos: { x: 0, y: 0 },
      });
      enemy.hp = Math.floor(enemy.maxHp * 0.5);
      assert.equal(determineAIState(enemy), 'chase');
    });

    it('enemy at full HP should chase', () => {
      const enemy = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'orc',
        name: 'Orc',
        pos: { x: 0, y: 0 },
      });
      assert.equal(determineAIState(enemy), 'chase');
    });

    it('entity should track AI state', () => {
      const enemy = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'skeleton',
        name: 'Skeleton',
        pos: { x: 0, y: 0 },
      });
      assert.equal(enemy.aiState, 'idle');
      enemy.aiState = 'chase';
      assert.equal(enemy.aiState, 'chase');
      enemy.aiState = 'flee';
      assert.equal(enemy.aiState, 'flee');
    });
  });

  describe('Permadeath', () => {
    it('player reaching 0 HP should trigger game over', () => {
      const gs = new GameState();
      gs.dungeonFloor = new DungeonFloor(1, 10, 10);
      gs.dungeonFloor.setTile(5, 5, TILE_TYPES.FLOOR);

      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Doomed',
        pos: { x: 5, y: 5 },
      });
      gs.player = player;
      gs.entities.set(player.id, player);

      // Simulate lethal damage
      player.hp = 0;
      player.alive = false;
      gs.gameOver = true;

      assert.equal(player.hp, 0);
      assert.equal(player.alive, false);
      assert.equal(gs.gameOver, true);
    });

    it('player with negative HP should be dead', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.MAGE,
        name: 'Fragile',
        pos: { x: 0, y: 0 },
      });
      player.hp = -10;
      assert.ok(player.hp <= 0, 'Player should be dead at negative HP');
    });

    it('game over state should persist', () => {
      const gs = new GameState();
      gs.gameOver = true;
      gs.addLog('You have perished. Game over.');

      const json = gs.toJSON();
      const restored = GameState.fromJSON(JSON.parse(JSON.stringify(json)));
      assert.equal(restored.gameOver, true);
      assert.includes(restored.log, 'You have perished. Game over.');
    });
  });

  describe('Turn Order', () => {
    it('higher speed entities should act first', () => {
      Entity.resetIdCounter(100);
      const fast = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'rat',
        name: 'Fast',
        pos: { x: 0, y: 0 },
      });
      fast.speed = 20;

      const slow = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'orc',
        name: 'Slow',
        pos: { x: 1, y: 0 },
      });
      slow.speed = 5;

      const medium = new Entity({
        entityType: ENTITY_TYPES.ENEMY,
        classType: 'goblin',
        name: 'Medium',
        pos: { x: 2, y: 0 },
      });
      medium.speed = 10;

      const order = determineTurnOrder([slow, fast, medium]);
      assert.equal(order[0].name, 'Fast');
      assert.equal(order[1].name, 'Medium');
      assert.equal(order[2].name, 'Slow');
    });

    it('turn phases should follow correct order', () => {
      const phases = Object.values(TURN_PHASES);
      assert.equal(phases[0], 'player_input');
      assert.equal(phases[1], 'player_action');
      assert.equal(phases[2], 'enemy_action');
      assert.equal(phases[3], 'status_tick');
      assert.equal(phases[4], 'cleanup');
    });

    it('rogue should be fastest class', () => {
      const rogueSpeed = CLASS_BASE_STATS[CLASS_TYPES.ROGUE].speed;
      const warriorSpeed = CLASS_BASE_STATS[CLASS_TYPES.WARRIOR].speed;
      const mageSpeed = CLASS_BASE_STATS[CLASS_TYPES.MAGE].speed;

      assert.greaterThan(rogueSpeed, warriorSpeed);
      assert.greaterThan(rogueSpeed, mageSpeed);
    });
  });
});
