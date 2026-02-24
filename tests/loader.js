/**
 * @file loader.js
 * @description ESM-to-CJS loader for test files. Strips ES module syntax
 * and evaluates source files in a CommonJS-compatible context.
 */

const fs = require('fs');
const path = require('path');

/**
 * Rewrite ESM source to CJS-compatible code. Keeps local bindings intact
 * and adds exports at the end.
 */
function rewriteESM(code) {
  const exportedNames = [];

  // Strip import statements
  code = code.replace(/import\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?/g, '');
  code = code.replace(/import\s+.*?from\s+['"][^'"]+['"];?/g, '');

  // `export function X(` → `function X(` and track name
  code = code.replace(/export\s+function\s+(\w+)/g, (_, name) => {
    exportedNames.push(name);
    return `function ${name}`;
  });

  // `export class X` → `class X` and track name
  code = code.replace(/export\s+class\s+(\w+)/g, (_, name) => {
    exportedNames.push(name);
    return `class ${name}`;
  });

  // `export const X` → `const X` and track name
  code = code.replace(/export\s+const\s+(\w+)/g, (_, name) => {
    exportedNames.push(name);
    return `const ${name}`;
  });

  // `export let X` → `let X` and track name
  code = code.replace(/export\s+let\s+(\w+)/g, (_, name) => {
    exportedNames.push(name);
    return `let ${name}`;
  });

  // Add exports at end
  if (exportedNames.length > 0) {
    code += '\n\n// Auto-generated exports\n';
    for (const name of exportedNames) {
      code += `exports.${name} = ${name};\n`;
    }
  }

  return code;
}

/**
 * Load a source module, converting ESM to CJS.
 * @param {string} relPath - Path relative to project root
 * @returns {Object} Module exports
 */
function loadModule(relPath) {
  const fullPath = path.resolve(__dirname, '..', relPath);
  let code = fs.readFileSync(fullPath, 'utf-8');
  code = rewriteESM(code);

  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', code);
  fn(mod, mod.exports, require, path.dirname(fullPath), fullPath);
  return mod.exports;
}

/**
 * Load data-model.js with constants injected into scope.
 * @param {Object} constants - The loaded constants module
 * @returns {Object} Module exports
 */
function loadDataModel(constants) {
  const fullPath = path.resolve(__dirname, '..', 'src/data-model.js');
  let code = fs.readFileSync(fullPath, 'utf-8');
  code = rewriteESM(code);

  const mod = { exports: {} };
  const paramNames = Object.keys(constants);
  const paramValues = Object.values(constants);

  const wrapper = new Function(
    'module', 'exports', 'require', '__dirname', '__filename',
    ...paramNames,
    code
  );
  wrapper(mod, mod.exports, require, path.dirname(fullPath), fullPath, ...paramValues);
  return mod.exports;
}

module.exports = { loadModule, loadDataModel };
