import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('build-copy tolerates a missing src/config directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'hanx-build-copy-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'config'), { recursive: true });
    copyFileSync(join(process.cwd(), 'scripts', 'build-copy.js'), join(root, 'scripts', 'build-copy.js'));
    writeFileSync(join(root, 'config', 'domains.json'), '{}');

    const result = spawnSync(process.execPath, [join(root, 'scripts', 'build-copy.js')], {
      cwd: root,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(root, 'dist', 'config', 'domains.json')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
