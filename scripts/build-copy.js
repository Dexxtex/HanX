#!/usr/bin/env node
/**
 * Script build — sostituisce shx per evitare dipendenze vulnerabili.
 * Replica: mkdir -p + cp -r + cp file con Node.js nativo.
 * Usato da: pnpm run build
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

// mkdir -p
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// cp -r src dist
function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    mkdirp(dest);
    for (const file of fs.readdirSync(src)) {
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// cp src/config/*.json dist/config/
function copyConfigFiles() {
  const srcConfig = path.join(root, 'src', 'config');
  const distConfig = path.join(root, 'dist', 'config');
  mkdirp(distConfig);

  const files = fs.readdirSync(srcConfig).filter(f => f.endsWith('.json'));
  for (const file of files) {
    copyRecursive(
      path.join(srcConfig, file),
      path.join(distConfig, file)
    );
  }
}

// Esecuzione
const distConfig = path.join(root, 'dist', 'config');
mkdirp(distConfig);
copyRecursive(path.join(root, 'config'), distConfig);
copyConfigFiles();

// Anime mapping data (JSON) + optional overrides
const mappingDataSrc = path.join(root, 'src', 'mapping', 'data');
const mappingDataDest = path.join(root, 'dist', 'mapping', 'data');
if (fs.existsSync(mappingDataSrc)) {
  copyRecursive(mappingDataSrc, mappingDataDest);
}
const mappingOverrides = path.join(root, 'src', 'mapping', 'overrides.json');
if (fs.existsSync(mappingOverrides)) {
  mkdirp(path.join(root, 'dist', 'mapping'));
  fs.copyFileSync(mappingOverrides, path.join(root, 'dist', 'mapping', 'overrides.json'));
}

console.log('✅ Build copy scripts completed');
