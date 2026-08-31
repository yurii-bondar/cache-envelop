jest.mock('memcached');
jest.mock('ioredis');

const MemcachedMockClient = require('memcached');
const RedisMockClient = require('ioredis');
const MemcachedWrapper = require('../src/Memcached');
const RedisWrapper = require('../src/Redis');
const MemoryWrapper = require('../src/Memory');
const { runCoreContract } = require('./support/coreContractScenario');

/**
 * One scenario, both backends. This is what makes "portable core" a claim the
 * suite can enforce rather than a promise in the README: `get`, `set`, `del`
 * and `close` must behave identically on Memcached and Redis, so swapping one
 * for the other cannot change how calling code reads.
 *
 * Anything a backend deliberately does differently — Memcached's hash and list
 * emulation, Redis's key rules, what `close()` returns — belongs in the
 * per-backend suites, not here.
 *
 * `Memory` earns its place here twice over: it is the backend users run their
 * own tests against, and being a completely different implementation it is the
 * one that would expose the core as a description of ioredis rather than a real
 * abstraction. It has no transport, hence no client to fail on command.
 */
const backends = [
  {
    name: 'Memcached',
    hasClient: true,
    createCache: () => {
      const cache = new MemcachedWrapper();
      const { instances } = MemcachedMockClient;
      return { cache, client: instances[instances.length - 1] };
    },
  },
  {
    name: 'Redis',
    hasClient: true,
    createCache: () => {
      const cache = new RedisWrapper();
      return { cache, client: cache.client };
    },
  },
  {
    name: 'Memory',
    hasClient: false,
    createCache: () => ({ cache: new MemoryWrapper(), client: null }),
  },
];

afterEach(() => {
  MemcachedMockClient.instances.length = 0;
  RedisMockClient.instances.length = 0;
});

backends.forEach(runCoreContract);
