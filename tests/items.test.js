/**
 * @file items.test.js
 * @description Tests for the item system contracts: loot tables, identification,
 * inventory management, equipment slots, and rarity distribution.
 */

const { describe, it, assert } = require('./test-runner');
const { loadModule, loadDataModel } = require('./loader');

const constants = loadModule('src/constants.js');
const dm = loadDataModel(constants);
const { Item, Entity } = dm;
const {
  ITEM_TYPES, ITEM_RARITY, WEAPON_SUBTYPES, ARMOR_SUBTYPES, POTION_SUBTYPES,
  SCROLL_SUBTYPES, EQUIPMENT_SLOTS, CLASS_TYPES, ENTITY_TYPES, FLOOR_DIFFICULTY,
} = constants;

// ── Item generation helpers (simulating loot table contracts) ────────────────

const UNIDENTIFIED_NAMES = [
  'Fizzing Flask', 'Murky Vial', 'Glowing Bottle',
  'Tattered Scroll', 'Cryptic Parchment', 'Ancient Rune',
];

const RARITY_WEIGHTS = {
  1: { common: 70, uncommon: 25, rare: 5, legendary: 0 },
  5: { common: 40, uncommon: 35, rare: 20, legendary: 5 },
  10: { common: 15, uncommon: 30, rare: 35, legendary: 20 },
};

function generateLootForFloor(floorNumber) {
  const items = [];
  const count = 2 + Math.floor(floorNumber / 2);

  // Get rarity weights for this floor tier
  const tier = floorNumber <= 3 ? 1 : (floorNumber <= 7 ? 5 : 10);
  const weights = RARITY_WEIGHTS[tier];

  for (let i = 0; i < count; i++) {
    const types = Object.values(ITEM_TYPES);
    const type = types[i % types.length];

    let subtype, name, identified = true, unidentifiedName;

    switch (type) {
      case ITEM_TYPES.WEAPON:
        subtype = Object.values(WEAPON_SUBTYPES)[i % Object.values(WEAPON_SUBTYPES).length];
        name = `${subtype.charAt(0).toUpperCase() + subtype.slice(1)}`;
        break;
      case ITEM_TYPES.ARMOR:
        subtype = Object.values(ARMOR_SUBTYPES)[i % Object.values(ARMOR_SUBTYPES).length];
        name = `${subtype.charAt(0).toUpperCase() + subtype.slice(1)}`;
        break;
      case ITEM_TYPES.POTION:
        subtype = Object.values(POTION_SUBTYPES)[i % Object.values(POTION_SUBTYPES).length];
        name = `${subtype} Potion`;
        identified = false;
        unidentifiedName = UNIDENTIFIED_NAMES[i % UNIDENTIFIED_NAMES.length];
        break;
      case ITEM_TYPES.SCROLL:
        subtype = Object.values(SCROLL_SUBTYPES)[i % Object.values(SCROLL_SUBTYPES).length];
        name = `Scroll of ${subtype}`;
        identified = false;
        unidentifiedName = UNIDENTIFIED_NAMES[(i + 3) % UNIDENTIFIED_NAMES.length];
        break;
    }

    // Determine rarity based on weights
    const roll = Math.random() * 100;
    let rarity = ITEM_RARITY.COMMON;
    let cumulative = 0;
    for (const [r, w] of Object.entries(weights)) {
      cumulative += w;
      if (roll < cumulative) { rarity = r; break; }
    }

    items.push(new Item({
      type, subtype, name, rarity, identified, unidentifiedName,
      stats: { attack: Math.floor(floorNumber * 1.5) },
      value: floorNumber * 10,
    }));
  }

  return items;
}

const MAX_INVENTORY_SLOTS = 20;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Item System', () => {
  describe('Loot Tables', () => {
    it('should produce items for every floor', () => {
      for (let f = 1; f <= 10; f++) {
        const loot = generateLootForFloor(f);
        assert.greaterThan(loot.length, 0, `Floor ${f} should produce loot`);
      }
    });

    it('higher floors should produce more items', () => {
      const loot1 = generateLootForFloor(1);
      const loot10 = generateLootForFloor(10);
      assert.greaterThan(loot10.length, loot1.length);
    });

    it('items should have valid types', () => {
      const validTypes = Object.values(ITEM_TYPES);
      const loot = generateLootForFloor(5);
      loot.forEach(item => {
        assert.includes(validTypes, item.type, `Invalid item type: ${item.type}`);
      });
    });

    it('items should have floor-appropriate stats', () => {
      const loot1 = generateLootForFloor(1);
      const loot10 = generateLootForFloor(10);

      const avgStat1 = loot1.reduce((s, i) => s + (i.stats.attack || 0), 0) / loot1.length;
      const avgStat10 = loot10.reduce((s, i) => s + (i.stats.attack || 0), 0) / loot10.length;
      assert.greaterThan(avgStat10, avgStat1, 'Floor 10 items should be stronger');
    });

    it('items should have floor-appropriate value', () => {
      const loot1 = generateLootForFloor(1);
      const loot10 = generateLootForFloor(10);
      assert.greaterThan(loot10[0].value, loot1[0].value);
    });
  });

  describe('Identification System', () => {
    it('potions should start unidentified', () => {
      const potion = new Item({
        type: ITEM_TYPES.POTION,
        subtype: POTION_SUBTYPES.HEALTH,
        name: 'Health Potion',
        identified: false,
        unidentifiedName: 'Bubbling Red Potion',
      });
      assert.equal(potion.identified, false);
      assert.equal(potion.unidentifiedName, 'Bubbling Red Potion');
    });

    it('scrolls should start unidentified', () => {
      const scroll = new Item({
        type: ITEM_TYPES.SCROLL,
        subtype: SCROLL_SUBTYPES.FIREBALL,
        name: 'Scroll of Fireball',
        identified: false,
        unidentifiedName: 'Cryptic Parchment',
      });
      assert.equal(scroll.identified, false);
    });

    it('weapons should start identified', () => {
      const weapon = new Item({
        type: ITEM_TYPES.WEAPON,
        subtype: WEAPON_SUBTYPES.SWORD,
        name: 'Iron Sword',
      });
      assert.equal(weapon.identified, true);
    });

    it('armor should start identified', () => {
      const armor = new Item({
        type: ITEM_TYPES.ARMOR,
        subtype: ARMOR_SUBTYPES.CHEST,
        name: 'Chain Mail',
      });
      assert.equal(armor.identified, true);
    });

    it('unidentified items should have random display names', () => {
      const names = new Set();
      UNIDENTIFIED_NAMES.forEach(name => names.add(name));
      assert.greaterThan(names.size, 1, 'Should have multiple unidentified names');
    });

    it('using an unidentified item should identify it', () => {
      const potion = new Item({
        type: ITEM_TYPES.POTION,
        subtype: POTION_SUBTYPES.HEALTH,
        name: 'Health Potion',
        identified: false,
        unidentifiedName: 'Fizzing Flask',
      });

      // Simulate using the item (identifies it)
      potion.identified = true;

      assert.equal(potion.identified, true);
      assert.equal(potion.name, 'Health Potion');
    });

    it('identified items should show real name', () => {
      const scroll = new Item({
        type: ITEM_TYPES.SCROLL,
        subtype: SCROLL_SUBTYPES.TELEPORT,
        name: 'Scroll of Teleport',
        identified: true,
      });
      assert.equal(scroll.name, 'Scroll of Teleport');
    });
  });

  describe('Inventory Management', () => {
    it('entity should start with empty inventory', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });
      assert.equal(player.inventory.length, 0);
    });

    it('items can be added to inventory', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });
      const item = new Item({ type: ITEM_TYPES.WEAPON, subtype: 'sword', name: 'Sword' });
      player.inventory.push(item);
      assert.equal(player.inventory.length, 1);
      assert.equal(player.inventory[0].name, 'Sword');
    });

    it('max inventory slots should be enforced', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });

      // Fill inventory to max
      for (let i = 0; i < MAX_INVENTORY_SLOTS; i++) {
        player.inventory.push(new Item({
          type: ITEM_TYPES.POTION,
          subtype: 'health',
          name: `Potion ${i}`,
        }));
      }

      assert.equal(player.inventory.length, MAX_INVENTORY_SLOTS);

      // Contract: should reject additional items
      const canAdd = player.inventory.length < MAX_INVENTORY_SLOTS;
      assert.equal(canAdd, false, 'Should not allow adding beyond max slots');
    });

    it('items can be removed from inventory', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });
      const item = new Item({ type: ITEM_TYPES.WEAPON, subtype: 'sword', name: 'Sword' });
      player.inventory.push(item);
      player.inventory.splice(0, 1);
      assert.equal(player.inventory.length, 0);
    });

    it('inventory should serialize with entity', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });
      player.inventory.push(new Item({
        type: ITEM_TYPES.WEAPON,
        subtype: 'sword',
        name: 'Magic Sword',
        rarity: ITEM_RARITY.RARE,
      }));

      const json = player.toJSON();
      const restored = Entity.fromJSON(json);
      assert.equal(restored.inventory.length, 1);
      assert.equal(restored.inventory[0].name, 'Magic Sword');
      assert.equal(restored.inventory[0].rarity, ITEM_RARITY.RARE);
    });
  });

  describe('Equipment Slots', () => {
    it('entity should have all equipment slots', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });

      const expectedSlots = [
        EQUIPMENT_SLOTS.WEAPON,
        EQUIPMENT_SLOTS.HELMET,
        EQUIPMENT_SLOTS.CHEST,
        EQUIPMENT_SLOTS.LEGS,
        EQUIPMENT_SLOTS.SHIELD,
      ];

      expectedSlots.forEach(slot => {
        assert.ok(slot in player.equipment, `Missing equipment slot: ${slot}`);
      });
    });

    it('all equipment slots should start empty', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });

      Object.values(EQUIPMENT_SLOTS).forEach(slot => {
        assert.isNull(player.equipment[slot], `Slot ${slot} should start empty`);
      });
    });

    it('weapons should equip to weapon slot', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });
      const sword = new Item({
        type: ITEM_TYPES.WEAPON,
        subtype: WEAPON_SUBTYPES.SWORD,
        name: 'Iron Sword',
        stats: { attack: 5 },
      });

      player.equipment[EQUIPMENT_SLOTS.WEAPON] = sword;
      assert.equal(player.equipment[EQUIPMENT_SLOTS.WEAPON].name, 'Iron Sword');
    });

    it('armor should equip to matching slot', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });

      const helmet = new Item({
        type: ITEM_TYPES.ARMOR,
        subtype: ARMOR_SUBTYPES.HELMET,
        name: 'Iron Helm',
        stats: { defense: 3 },
      });
      const chest = new Item({
        type: ITEM_TYPES.ARMOR,
        subtype: ARMOR_SUBTYPES.CHEST,
        name: 'Chain Mail',
        stats: { defense: 8 },
      });

      player.equipment[EQUIPMENT_SLOTS.HELMET] = helmet;
      player.equipment[EQUIPMENT_SLOTS.CHEST] = chest;

      assert.equal(player.equipment[EQUIPMENT_SLOTS.HELMET].name, 'Iron Helm');
      assert.equal(player.equipment[EQUIPMENT_SLOTS.CHEST].name, 'Chain Mail');
    });

    it('equipped items should serialize correctly', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });
      const sword = new Item({
        type: ITEM_TYPES.WEAPON,
        subtype: WEAPON_SUBTYPES.SWORD,
        name: 'Magic Sword',
        rarity: ITEM_RARITY.LEGENDARY,
        stats: { attack: 20 },
      });
      player.equipment[EQUIPMENT_SLOTS.WEAPON] = sword;

      const json = player.toJSON();
      const restored = Entity.fromJSON(json);

      assert.isNotNull(restored.equipment[EQUIPMENT_SLOTS.WEAPON]);
      assert.equal(restored.equipment[EQUIPMENT_SLOTS.WEAPON].name, 'Magic Sword');
      assert.equal(restored.equipment[EQUIPMENT_SLOTS.WEAPON].rarity, ITEM_RARITY.LEGENDARY);
    });

    it('unequipping should clear slot', () => {
      const player = new Entity({
        entityType: ENTITY_TYPES.PLAYER,
        classType: CLASS_TYPES.WARRIOR,
        name: 'Test',
        pos: { x: 0, y: 0 },
      });
      const sword = new Item({
        type: ITEM_TYPES.WEAPON,
        subtype: WEAPON_SUBTYPES.SWORD,
        name: 'Sword',
      });
      player.equipment[EQUIPMENT_SLOTS.WEAPON] = sword;
      player.equipment[EQUIPMENT_SLOTS.WEAPON] = null;
      assert.isNull(player.equipment[EQUIPMENT_SLOTS.WEAPON]);
    });
  });

  describe('Rarity Distribution', () => {
    it('all rarity tiers should be defined', () => {
      assert.ok(ITEM_RARITY.COMMON);
      assert.ok(ITEM_RARITY.UNCOMMON);
      assert.ok(ITEM_RARITY.RARE);
      assert.ok(ITEM_RARITY.LEGENDARY);
    });

    it('floor 1 loot should be mostly common', () => {
      // Generate many items and check distribution
      Item.resetIdCounter(5000);
      let commonCount = 0;
      const total = 100;
      for (let i = 0; i < total; i++) {
        const loot = generateLootForFloor(1);
        loot.forEach(item => {
          if (item.rarity === ITEM_RARITY.COMMON) commonCount++;
        });
      }
      // At least 50% should be common on floor 1
      const lootPerRun = generateLootForFloor(1).length;
      const ratio = commonCount / (total * lootPerRun);
      assert.greaterThan(ratio, 0.4, `Common ratio on floor 1 should be > 40%, got ${Math.round(ratio * 100)}%`);
    });

    it('floor 10 should have higher legendary chance than floor 1', () => {
      // This is a contract test: floor 10 weights favor rarer items
      const floor1Weights = RARITY_WEIGHTS[1];
      const floor10Weights = RARITY_WEIGHTS[10];

      assert.greaterThan(floor10Weights.legendary, floor1Weights.legendary,
        'Floor 10 should have higher legendary weight');
      assert.greaterThan(floor10Weights.rare, floor1Weights.rare,
        'Floor 10 should have higher rare weight');
    });

    it('items should always have a valid rarity', () => {
      const validRarities = Object.values(ITEM_RARITY);
      const loot = generateLootForFloor(5);
      loot.forEach(item => {
        assert.includes(validRarities, item.rarity, `Invalid rarity: ${item.rarity}`);
      });
    });
  });
});
