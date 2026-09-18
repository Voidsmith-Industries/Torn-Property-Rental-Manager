'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'R4G3RUNN3R-Property-Rental-Manager.user.js');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const sourceFiles = [
  'src/property-core.js',
  'src/market-core.js',
  'src/api-core.js',
  'src/draft-core.js',
  'src/form-core.js',
  'src/settings-core.js',
  'src/update-core.js',
  'src/ui-observer.js',
  'src/app-runtime.js',
  'src/bootstrap.js'
];

// v0.4.0 ships the proven v0.3.10 behavior as one app-runtime block while the
// versioned source files remain in-repo as regression fixtures during the migration.
// They are not independent runtime modules anymore.
const appRuntimeSources = [
  'src/app.js',
  'src/app-v033.js',
  'src/app-v034.js',
  'src/app-v036.js',
  'src/app-v037.js',
  'src/app-v038.js',
  'src/app-v039.js',
  'src/app-v0310.js',
  'src/app-runtime.js'
];

function metadata() {
  return `// ==UserScript==
// @name         R4G3RUNN3R Property Rental Manager
// @namespace    https://github.com/Voidsmith-Industries/Torn-Property-Rental-Manager
// @version      ${packageJson.version}
// @description  Manage Torn rentals with truthful property/market timestamps, cache-aware cancellable scans, live diagnostics, and safe native actions.
// @author       R4G3RUNN3R
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/Voidsmith-Industries/Torn-Property-Rental-Manager/main/R4G3RUNN3R-Property-Rental-Manager.user.js
// @downloadURL  https://raw.githubusercontent.com/Voidsmith-Industries/Torn-Property-Rental-Manager/main/R4G3RUNN3R-Property-Rental-Manager.user.js
// @supportURL   https://github.com/Voidsmith-Industries/Torn-Property-Rental-Manager/issues
// @match        https://www.torn.com/properties.php*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==
`;
}

function readSource(file) {
  return fs.readFileSync(path.join(root, file), 'utf8').trimEnd();
}

function appRuntimeText() {
  return appRuntimeSources.map(file => `\n/* --- app runtime source: ${file} --- */\n${readSource(file)}\n`).join('');
}

function moduleText(file) {
  if (file === 'src/app-runtime.js') return appRuntimeText();
  return readSource(file);
}

function buildText() {
  const modules = sourceFiles.map(file => `\n/* ===== ${file} ===== */\n${moduleText(file)}\n`).join('');
  return `${metadata()}${modules}\n/* ===== userscript start ===== */\nR4G3PropertyRentalBootstrap.start();\n`;
}

function main() {
  const expected = buildText();
  if (process.argv.includes('--check')) {
    const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
    if (actual !== expected) {
      console.error('Userscript release is out of date. Run npm run build and commit the generated file.');
      process.exitCode = 1;
    }
    return;
  }

  fs.writeFileSync(outputPath, expected, 'utf8');
  console.log(`Built ${path.relative(root, outputPath)}`);
}

if (require.main === module) main();

module.exports = Object.freeze({ sourceFiles, appRuntimeSources, appRuntimeText, buildText });
