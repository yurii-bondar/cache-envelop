// Jest substitutes `__mocks__/<pkg>.js` for a node_modules package automatically,
// with no jest.mock() call anywhere. Without these two lines this suite quietly
// tests the mocks against themselves and passes in milliseconds while the
// servers sit idle — which is exactly what it did before the guard below was
// added. Never delete them.
jest.unmock('ioredis');
jest.unmock('memcached');

const { Memcached, Memory, Redis } = require('../../index');
const { runCoreContract } = require('../support/coreContractScenario');

/**
 * The same contract as `test/coreContract.test.js`, run against real servers
 * instead of mocks. This is what makes the portable core a claim about
 * Memcached and Redis rather than a claim about two mock objects.
 *
 * Backends are opt-in through environment variables so the suite degrades to
 * whatever is actually reachable: `npm run test:integration` with none of them
 * set still exercises `Memory`, and CI sets all three.
 *
 *   INTEGRATION_REDIS_URL      redis://127.0.0.1:6379
 *   INTEGRATION_MEMCACHED      127.0.0.1:11211
 *   INTEGRATION_DRAGONFLY_URL  redis://127.0.0.1:6380
 */
/** The contract's own `close` test may already have shut the connection. */
async function closeQuietly(cache) {
  try {
    await cache.close();
  } catch {
    // already closed
  }
}

const backends = [{
  name: 'Memory (in-process)',
  createCache: () => ({ cache: new Memory(), client: null }),
  cleanup: (cache) => cache.close(),
}];

if (process.env.INTEGRATION_REDIS_URL) {
  backends.push({
    name: 'Redis (live server)',
    createCache: () => ({ cache: new Redis(process.env.INTEGRATION_REDIS_URL), client: null }),
    cleanup: closeQuietly,
  });
}

if (process.env.INTEGRATION_DRAGONFLY_URL) {
  backends.push({
    name: 'Dragonfly (live server, via the Redis wrapper)',
    createCache: () => ({ cache: new Redis(process.env.INTEGRATION_DRAGONFLY_URL), client: null }),
    cleanup: closeQuietly,
  });
}

if (process.env.INTEGRATION_MEMCACHED) {
  backends.push({
    name: 'Memcached (live server)',
    createCache: () => ({ cache: new Memcached(process.env.INTEGRATION_MEMCACHED), client: null }),
    cleanup: closeQuietly,
  });
}

describe('live backends under test', () => {
  test('reports which servers this run reached', () => {
    // Visible in the log so a run that silently tested nothing is obvious.
    // eslint-disable-next-line no-console
    console.log(`integration backends: ${backends.map((b) => b.name).join(', ')}`);
    expect(backends.length).toBeGreaterThan(0);
  });

  // The project's mocks expose a static `instances` array; the real packages do
  // not. If this fails, the suite is testing mocks and every result below is
  // worthless.
  test.each([['ioredis'], ['memcached']])('%s is the real package, not the mock', (moduleName) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    expect(require(moduleName).instances).toBeUndefined();
  });
});

backends.forEach(runCoreContract);
