jest.mock('memcached');
jest.mock('ioredis');

const MemcachedMockClient = require('memcached');
const RedisMockClient = require('ioredis');
const MemcachedWrapper = require('../src/Memcached');
const RedisWrapper = require('../src/Redis');
const MemoryWrapper = require('../src/Memory');

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
  ['Memcached', () => {
    const cache = new MemcachedWrapper();
    const { instances } = MemcachedMockClient;
    return { cache, client: instances[instances.length - 1] };
  }, { hasClient: true }],
  ['Redis', () => {
    const cache = new RedisWrapper();
    return { cache, client: cache.client };
  }, { hasClient: true }],
  ['Memory', () => ({ cache: new MemoryWrapper(), client: null }), { hasClient: false }],
];

const TTL_ERROR = 'The ttl must be a non-negative number of seconds (0 means no expiration)';

describe.each(backends)('portable cache core: %s', (_name, createCache, capabilities) => {
  let cache;
  let client;

  beforeEach(() => {
    ({ cache, client } = createCache());
  });

  afterEach(() => {
    MemcachedMockClient.instances.length = 0;
    RedisMockClient.instances.length = 0;
  });

  describe('set/get round-trip', () => {
    test.each([
      ['a string', 'hello'],
      ['an empty string', ''],
      ['a number', 42],
      ['zero', 0],
      ['a boolean', false],
      ['null', null],
      ['an object', { a: 1, nested: { b: [1, 2] } }],
      ['an array', [1, 'two', { three: 3 }]],
    ])('returns %s unchanged', async (_label, value) => {
      await cache.set('round-trip', value, 60);
      await expect(cache.get('round-trip')).resolves.toEqual(value);
    });

    test('distinguishes a stored null from a missing key', async () => {
      await cache.set('stored-null', null, 60);

      await expect(cache.get('stored-null')).resolves.toBeNull();
      await expect(cache.get('never-written')).resolves.toBeUndefined();
    });

    test('accepts a numeric key', async () => {
      await cache.set(12345, 'by-number', 60);
      await expect(cache.get(12345)).resolves.toBe('by-number');
    });

    test('overwrites an existing key', async () => {
      await cache.set('k', 'first', 60);
      await cache.set('k', 'second', 60);
      await expect(cache.get('k')).resolves.toBe('second');
    });
  });

  describe('del', () => {
    test('removes the key and resolves to "OK"', async () => {
      await cache.set('k', 'v', 60);

      await expect(cache.del('k')).resolves.toBe('OK');
      await expect(cache.get('k')).resolves.toBeUndefined();
    });

    test('resolves to "OK" for a key that never existed', async () => {
      await expect(cache.del('never-written')).resolves.toBe('OK');
    });
  });

  describe('key validation', () => {
    test.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty string', ''],
      ['a whitespace-only string', '   '],
    ])('rejects %s with the same message', async (_label, key) => {
      await expect(cache.get(key)).rejects.toThrow('The key cannot be empty');
    });

    test('rejects a key that is neither a string nor a number', async () => {
      await expect(cache.get({ foo: 'bar' })).rejects.toThrow(
        'The key must be a string or a number',
      );
    });
  });

  describe('ttl', () => {
    test.each([
      ['missing', undefined],
      ['non-numeric', 'soon'],
      ['negative', -5],
    ])('rejects a %s ttl with the same message', async (_label, ttl) => {
      await expect(cache.set('k', 'v', ttl)).rejects.toThrow(TTL_ERROR);
    });

    test('accepts ttl=0 as "no expiration" and still stores the value', async () => {
      await cache.set('permanent', 'value', 0);
      await expect(cache.get('permanent')).resolves.toBe('value');
    });
  });

  describe('data validation', () => {
    test('rejects undefined data', async () => {
      await expect(cache.set('k', undefined, 60)).rejects.toThrow(
        'The data to cache cannot be undefined',
      );
    });
  });

  (capabilities.hasClient ? describe : describe.skip)('error propagation', () => {
    test.each([
      ['get', (c) => c.get('k')],
      ['set', (c) => c.set('k', 'v', 60)],
      ['del', (c) => c.del('k')],
    ])('%s surfaces an error from the underlying client', async (method, call) => {
      client.forceNextError(method, new Error('connection lost'));
      await expect(call(cache)).rejects.toThrow('connection lost');
    });
  });

  describe('close', () => {
    test('is callable and awaitable without throwing', async () => {
      await expect(Promise.resolve(cache.close())).resolves.not.toThrow();
    });
  });
});
