#!/usr/bin/env node

/**
 * Packs the package exactly as npm would publish it, installs the tarball into
 * a throwaway project with no peer dependencies, and checks the three claims
 * the optional-peer setup rests on:
 *
 *   1. `require('cache-envelop')` works with neither client installed.
 *   2. The `Memory` backend is fully usable in that state.
 *   3. Constructing a wrapper whose client is missing names the package to
 *      install, rather than failing at import time for everyone.
 *
 * The unit tests cover `loadClient` in isolation; only a real `npm install` can
 * show that `files`, the lazy requires and `peerDependenciesMeta` line up.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-envelop-smoke-'));

try {
  process.stdout.write('packing the publishable tarball...\n');
  const packed = run(npm, ['pack', '--silent', '--pack-destination', workDir], repoRoot)
    .trim()
    .split('\n')
    .pop();

  const consumer = path.join(workDir, 'consumer');
  fs.mkdirSync(consumer);
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }, null, 2)}\n`,
  );

  process.stdout.write('installing it with no peer dependencies...\n');
  run(npm, [
    'install', '--silent', '--omit=peer', '--no-audit', '--no-fund',
    path.join(workDir, packed),
  ], consumer);

  const installed = fs.readdirSync(path.join(consumer, 'node_modules'));
  const leaked = ['ioredis', 'memcached'].filter((name) => installed.includes(name));
  if (leaked.length) {
    throw new Error(`optional peers were installed anyway: ${leaked.join(', ')}`);
  }

  fs.writeFileSync(path.join(consumer, 'smoke.js'), `
    const assert = require('assert');
    const { Memcached, Memory, Redis } = require('cache-envelop');

    (async () => {
      const cache = new Memory();
      await cache.set('user:1', { name: 'Alice' }, 60);
      assert.deepStrictEqual(await cache.get('user:1'), { name: 'Alice' });
      assert.strictEqual(await cache.del('user:1'), 'OK');
      cache.close();

      for (const [Wrapper, pkg] of [[Redis, 'ioredis'], [Memcached, 'memcached']]) {
        assert.throws(() => new Wrapper(), (err) => {
          assert.match(err.message, new RegExp('requires the "' + pkg + '" package'));
          assert.match(err.message, new RegExp('npm install ' + pkg));
          return true;
        }, pkg + ' should report how to install itself');
      }

      console.log('smoke: require, Memory, and both install messages all behave');
    })().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `);

  process.stdout.write(run(process.execPath, ['smoke.js'], consumer));
  process.stdout.write('smoke test passed\n');
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
