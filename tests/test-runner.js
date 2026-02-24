/**
 * @file test-runner.js
 * @description Minimal test framework for Node.js. Provides describe/it/assert
 * pattern with coloured output. No dependencies required.
 */

const path = require('path');
const fs = require('fs');

// ── State ────────────────────────────────────────────────────────────────────

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;
const failures = [];

let currentSuite = '';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Define a test suite.
 * @param {string} name
 * @param {Function} fn
 */
function describe(name, fn) {
  const parent = currentSuite;
  currentSuite = parent ? `${parent} > ${name}` : name;
  console.log(`\n  \x1b[1m${currentSuite}\x1b[0m`);
  try {
    fn();
  } catch (err) {
    console.log(`    \x1b[31m✗ Suite error: ${err.message}\x1b[0m`);
    totalFailed++;
    failures.push({ suite: currentSuite, test: '(suite setup)', error: err });
  }
  currentSuite = parent;
}

/**
 * Define a test case.
 * @param {string} name
 * @param {Function} fn
 */
function it(name, fn) {
  try {
    fn();
    console.log(`    \x1b[32m✓\x1b[0m ${name}`);
    totalPassed++;
  } catch (err) {
    console.log(`    \x1b[31m✗ ${name}\x1b[0m`);
    console.log(`      \x1b[31m${err.message}\x1b[0m`);
    totalFailed++;
    failures.push({ suite: currentSuite, test: name, error: err });
  }
}

/**
 * Skip a test case (marks it as pending).
 * @param {string} name
 * @param {Function} [_fn]
 */
it.skip = function skip(name, _fn) {
  console.log(`    \x1b[33m- ${name} (skipped)\x1b[0m`);
  totalSkipped++;
};

// ── Assertions ───────────────────────────────────────────────────────────────

const assert = {
  ok(val, msg) {
    if (!val) throw new Error(msg || `Expected truthy, got ${JSON.stringify(val)}`);
  },
  equal(a, b, msg) {
    if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  deepEqual(a, b, msg) {
    const as = JSON.stringify(a);
    const bs = JSON.stringify(b);
    if (as !== bs) throw new Error(msg || `Expected ${bs}, got ${as}`);
  },
  notEqual(a, b, msg) {
    if (a === b) throw new Error(msg || `Expected not ${JSON.stringify(b)}`);
  },
  throws(fn, msg) {
    let threw = false;
    try { fn(); } catch { threw = true; }
    if (!threw) throw new Error(msg || 'Expected function to throw');
  },
  greaterThan(a, b, msg) {
    if (!(a > b)) throw new Error(msg || `Expected ${a} > ${b}`);
  },
  greaterThanOrEqual(a, b, msg) {
    if (!(a >= b)) throw new Error(msg || `Expected ${a} >= ${b}`);
  },
  lessThan(a, b, msg) {
    if (!(a < b)) throw new Error(msg || `Expected ${a} < ${b}`);
  },
  lessThanOrEqual(a, b, msg) {
    if (!(a <= b)) throw new Error(msg || `Expected ${a} <= ${b}`);
  },
  includes(arr, val, msg) {
    const has = Array.isArray(arr) ? arr.includes(val) : String(arr).includes(val);
    if (!has) throw new Error(msg || `Expected ${JSON.stringify(arr)} to include ${JSON.stringify(val)}`);
  },
  isNull(val, msg) {
    if (val !== null) throw new Error(msg || `Expected null, got ${JSON.stringify(val)}`);
  },
  isNotNull(val, msg) {
    if (val === null) throw new Error(msg || 'Expected non-null');
  },
  instanceOf(val, cls, msg) {
    if (!(val instanceof cls)) throw new Error(msg || `Expected instance of ${cls.name}`);
  },
  typeOf(val, type, msg) {
    if (typeof val !== type) throw new Error(msg || `Expected typeof ${type}, got ${typeof val}`);
  },
};

// ── Export for test files ────────────────────────────────────────────────────

module.exports = { describe, it, assert };

// ── Runner ───────────────────────────────────────────────────────────────────

if (require.main === module) {
  console.log('\x1b[1m\n🗡️  Dungeon Crawler Test Suite\x1b[0m');
  console.log('═'.repeat(50));

  const testDir = __dirname;
  const testFiles = fs.readdirSync(testDir)
    .filter(f => f.endsWith('.test.js'))
    .sort();

  if (testFiles.length === 0) {
    console.log('\n  No test files found.');
    process.exit(0);
  }

  // Make describe/it/assert globally available for test files
  global.describe = describe;
  global.it = it;
  global.assert = assert;

  for (const file of testFiles) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📄 ${file}`);
    try {
      require(path.join(testDir, file));
    } catch (err) {
      console.log(`\x1b[31m  ✗ Failed to load ${file}: ${err.message}\x1b[0m`);
      totalFailed++;
      failures.push({ suite: file, test: '(load)', error: err });
    }
  }

  // ── Summary ──
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`\x1b[1mResults:\x1b[0m`);
  console.log(`  \x1b[32m${totalPassed} passing\x1b[0m`);
  if (totalFailed > 0) console.log(`  \x1b[31m${totalFailed} failing\x1b[0m`);
  if (totalSkipped > 0) console.log(`  \x1b[33m${totalSkipped} skipped\x1b[0m`);

  if (failures.length > 0) {
    console.log(`\n\x1b[31mFailures:\x1b[0m`);
    failures.forEach((f, i) => {
      console.log(`  ${i + 1}) ${f.suite} > ${f.test}`);
      console.log(`     ${f.error.message}`);
    });
  }

  console.log('');
  process.exit(totalFailed > 0 ? 1 : 0);
}
