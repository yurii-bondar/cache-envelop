/**
 * The portable-core contract, written once and run against every backend.
 *
 * `test/coreContract.test.js` runs it against the in-memory mocks on every
 * commit; `test/integration/` runs the very same assertions against real
 * servers. Keeping one copy is the point: a contract that drifts between its
 * fast and its realistic run is not a contract.
 *
 * One instance is shared by the whole run rather than built per test: against a
 * real server a connection per test is both slow and flaky, and nothing in the
 * contract needs a fresh one — a per-test key prefix already keeps the tests
 * from seeing each other's data. The `close` test is the exception and builds
 * its own throwaway, since it deliberately tears the connection down.
 *
 * @param {Object} backend
 * @param {string} backend.name - Label for the test output.
 * @param {Function} backend.createCache - Returns `{ cache, client }` for one instance.
 * @param {boolean} [backend.hasClient=false] - Whether a transport exists that can be made to fail.
 * @param {Function} [backend.cleanup] - Awaited once at the end, to release the instance.
 */
function runCoreContract({
  name, createCache, hasClient = false, cleanup,
}) {
  describe(`portable cache core: ${name}`, () => {
    let cache;
    let client;
    let keyPrefix = '';

    beforeAll(() => {
      ({ cache, client } = createCache());
    });

    beforeEach(() => {
      // Real servers keep their data between tests; a per-test prefix keeps the
      // tests from seeing each other's keys without needing a flush.
      keyPrefix = `ce:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}:`;
    });

    afterAll(async () => {
      if (cleanup) await cleanup(cache, client);
    });

    const k = (suffix) => `${keyPrefix}${suffix}`;

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
        await cache.set(k('round-trip'), value, 60);
        await expect(cache.get(k('round-trip'))).resolves.toEqual(value);
      });

      test('distinguishes a stored null from a missing key', async () => {
        await cache.set(k('stored-null'), null, 60);

        await expect(cache.get(k('stored-null'))).resolves.toBeNull();
        await expect(cache.get(k('never-written'))).resolves.toBeUndefined();
      });

      test('accepts a numeric key', async () => {
        await cache.set(12345, 'by-number', 60);
        await expect(cache.get(12345)).resolves.toBe('by-number');
        await cache.del(12345);
      });

      test('overwrites an existing key', async () => {
        await cache.set(k('over'), 'first', 60);
        await cache.set(k('over'), 'second', 60);
        await expect(cache.get(k('over'))).resolves.toBe('second');
      });
    });

    describe('del', () => {
      test('removes the key and resolves to "OK"', async () => {
        await cache.set(k('del'), 'v', 60);

        await expect(cache.del(k('del'))).resolves.toBe('OK');
        await expect(cache.get(k('del'))).resolves.toBeUndefined();
      });

      test('resolves to "OK" for a key that never existed', async () => {
        await expect(cache.del(k('never-written'))).resolves.toBe('OK');
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
        await expect(cache.set(k('ttl'), 'v', ttl)).rejects.toThrow(
          'The ttl must be a non-negative number of seconds (0 means no expiration)',
        );
      });

      test('accepts ttl=0 as "no expiration" and still stores the value', async () => {
        await cache.set(k('permanent'), 'value', 0);
        await expect(cache.get(k('permanent'))).resolves.toBe('value');
      });
    });

    describe('data validation', () => {
      test('rejects undefined data', async () => {
        await expect(cache.set(k('undef'), undefined, 60)).rejects.toThrow(
          'The data to cache cannot be undefined',
        );
      });
    });

    (hasClient ? describe : describe.skip)('error propagation', () => {
      test.each([
        ['get', (c, key) => c.get(key)],
        ['set', (c, key) => c.set(key, 'v', 60)],
        ['del', (c, key) => c.del(key)],
      ])('%s surfaces an error from the underlying client', async (method, call) => {
        client.forceNextError(method, new Error('connection lost'));
        await expect(call(cache, k('boom'))).rejects.toThrow('connection lost');
      });
    });

    describe('close', () => {
      test('is callable and awaitable without throwing', async () => {
        // Its own instance: this test ends the connection on purpose.
        const { cache: throwaway } = createCache();
        await expect(Promise.resolve(throwaway.close())).resolves.not.toThrow();
      });
    });
  });
}

module.exports = { runCoreContract };
