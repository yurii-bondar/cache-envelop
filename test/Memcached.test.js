jest.mock('memcached');

const MemcachedMockClient = require('memcached');
const MemcachedWrapper = require('../src/Memcached');

function lastClient() {
  return MemcachedMockClient.instances[MemcachedMockClient.instances.length - 1];
}

describe('MemcachedWrapper', () => {
  afterEach(() => {
    MemcachedMockClient.instances.length = 0;
    jest.restoreAllMocks();
  });

  describe('connectionArgs', () => {
    test('falls back to the default when no argument is provided', () => {
      const cache = new MemcachedWrapper();
      expect(cache.connectionArgs).toBe('127.0.0.1:11211');
    });

    test('accepts a servers array', () => {
      const servers = ['127.0.0.1:11211', '127.0.0.1:11212'];
      const cache = new MemcachedWrapper(servers);
      expect(cache.connectionArgs).toBe(servers);
    });

    test('throws on an empty string instead of silently using the default', () => {
      expect(() => new MemcachedWrapper('')).toThrow(
        'Invalid connection arguments provided for Memcached client',
      );
    });

    test('throws on a whitespace-only string', () => {
      expect(() => new MemcachedWrapper('   ')).toThrow(
        'Invalid connection arguments provided for Memcached client',
      );
    });
  });

  describe('options', () => {
    test('merges provided options with the defaults', () => {
      const cache = new MemcachedWrapper(undefined, { retries: 5 });
      expect(cache.options).toEqual({ timeout: 300, retries: 5 });
    });

    test('keeps the defaults when options is falsy', () => {
      const cache = new MemcachedWrapper('127.0.0.1:11211', null);
      expect(cache.options).toEqual({ timeout: 300 });
    });

    test('does not forward onIssue to the underlying memcached client options', () => {
      const onIssue = jest.fn();
      const cache = new MemcachedWrapper(undefined, { onIssue, retries: 2 });
      expect(cache.options).toEqual({ timeout: 300, retries: 2 });
    });
  });

  describe('connection issue events', () => {
    test.each(['issue', 'failure', 'reconnecting', 'remove'])(
      'forwards "%s" events to the default handler without throwing',
      (eventName) => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const cache = new MemcachedWrapper();
        const details = { server: '127.0.0.1:11211' };

        // eslint-disable-next-line no-underscore-dangle
        expect(() => lastClient().emit(eventName, details)).not.toThrow();
        expect(consoleSpy).toHaveBeenCalledWith('[cache-envelop] Memcached client issue:', details);
        expect(cache).toBeInstanceOf(MemcachedWrapper);
      },
    );

    test('uses a custom onIssue handler when provided', () => {
      const onIssue = jest.fn();
      // eslint-disable-next-line no-new
      new MemcachedWrapper(undefined, { onIssue });
      const details = { server: '127.0.0.1:11211' };

      lastClient().emit('failure', details);

      expect(onIssue).toHaveBeenCalledWith(details);
    });
  });

  describe('key validation', () => {
    let cache;

    beforeEach(() => {
      cache = new MemcachedWrapper();
    });

    test('rejects an undefined key', async () => {
      await expect(cache.get(undefined)).rejects.toThrow('The key cannot be empty');
    });

    test('rejects a null key', async () => {
      await expect(cache.get(null)).rejects.toThrow('The key cannot be empty');
    });

    test('rejects a whitespace-only key', async () => {
      await expect(cache.get('   ')).rejects.toThrow('The key cannot be empty');
    });

    test('rejects a non-string, non-number key', async () => {
      await expect(cache.get({ foo: 'bar' })).rejects.toThrow('The key must be a string or a number');
    });

    test('rejects a key longer than 250 characters', async () => {
      await expect(cache.get('a'.repeat(251))).rejects.toThrow(
        'The key must not exceed 250 characters',
      );
    });

    test('accepts a numeric key', async () => {
      await expect(cache.get(12345)).resolves.toBeUndefined();
    });

    test('accepts a valid string key', async () => {
      await expect(cache.get('valid-key')).resolves.toBeUndefined();
    });
  });

  describe('get/set/del', () => {
    let cache;

    beforeEach(() => {
      cache = new MemcachedWrapper();
    });

    test('set stores data and get retrieves it', async () => {
      await cache.set('k1', 'hello', 60);
      await expect(cache.get('k1')).resolves.toBe('hello');
    });

    test('set rejects undefined data', async () => {
      await expect(cache.set('k1', undefined, 60)).rejects.toThrow(
        'The data to cache cannot be undefined',
      );
    });

    test('set rejects a missing ttl', async () => {
      await expect(cache.set('k1', 'hello')).rejects.toThrow(
        'The ttl must be a non-negative number of seconds (0 means no expiration)',
      );
    });

    test('set rejects a non-numeric ttl', async () => {
      await expect(cache.set('k1', 'hello', 'soon')).rejects.toThrow(
        'The ttl must be a non-negative number of seconds (0 means no expiration)',
      );
    });

    test('set rejects a negative ttl', async () => {
      await expect(cache.set('k1', 'hello', -5)).rejects.toThrow(
        'The ttl must be a non-negative number of seconds (0 means no expiration)',
      );
    });

    test('set accepts ttl=0 to mean "no expiration"', async () => {
      await cache.set('permanent', 'value', 0);
      await expect(cache.get('permanent')).resolves.toBe('value');
    });

    test('del removes a key and returns "OK"', async () => {
      await cache.set('k1', 'hello', 60);
      await expect(cache.del('k1')).resolves.toBe('OK');
      await expect(cache.get('k1')).resolves.toBeUndefined();
    });

    test('get propagates errors from the underlying client', async () => {
      lastClient().forceNextError('get', new Error('connection lost'));
      await expect(cache.get('k1')).rejects.toThrow('connection lost');
    });

    test('set propagates errors from the underlying client', async () => {
      lastClient().forceNextError('set', new Error('connection lost'));
      await expect(cache.set('k1', 'v', 60)).rejects.toThrow('connection lost');
    });

    test('del propagates errors from the underlying client', async () => {
      lastClient().forceNextError('del', new Error('connection lost'));
      await expect(cache.del('k1')).rejects.toThrow('connection lost');
    });
  });

  describe('corrupted cache data', () => {
    let cache;

    beforeEach(() => {
      cache = new MemcachedWrapper();
    });

    test('hashGet raises a clear error instead of a raw SyntaxError', async () => {
      lastClient().store.set('broken', 'not-json{');
      await expect(cache.hashGet('broken')).rejects.toThrow('Failed to parse cached value as JSON');
    });
  });

  describe('hashSet/hashGet/hashDel', () => {
    let cache;

    beforeEach(() => {
      cache = new MemcachedWrapper();
    });

    test('hashSet rejects a non-string field name', async () => {
      await expect(cache.hashSet('h1', 42, 'value', 60)).rejects.toThrow(
        'The field name must be a string',
      );
    });

    test('hashSet initializes a new hash and hashGet reads the whole hash', async () => {
      await cache.hashSet('h1', 'name', 'Alice', 60);
      await expect(cache.hashGet('h1')).resolves.toEqual({ name: 'Alice' });
    });

    test('hashSet updates an existing hash without dropping other fields', async () => {
      await cache.hashSet('h1', 'name', 'Alice', 60);
      await cache.hashSet('h1', 'age', 30, 60);
      await expect(cache.hashGet('h1')).resolves.toEqual({ name: 'Alice', age: 30 });
    });

    test('hashGet reads a single field', async () => {
      await cache.hashSet('h1', 'name', 'Alice', 60);
      await expect(cache.hashGet('h1', 'name')).resolves.toBe('Alice');
    });

    test('hashGet returns undefined for a missing key', async () => {
      await expect(cache.hashGet('missing')).resolves.toBeUndefined();
    });

    test('hashDel with no field deletes the whole hash', async () => {
      await cache.hashSet('h1', 'name', 'Alice', 60);
      await expect(cache.hashDel('h1')).resolves.toBe('OK');
      await expect(cache.hashGet('h1')).resolves.toBeUndefined();
    });

    test('hashDel returns "Data not found" when the key does not exist', async () => {
      await expect(cache.hashDel('missing', 'field')).resolves.toBe('Data not found');
    });

    test('hashDel returns "Data not found" when the field does not exist', async () => {
      await cache.hashSet('h1', 'name', 'Alice', 60);
      await expect(cache.hashDel('h1', 'unknownField', { ttl: 60 })).resolves.toBe('Data not found');
    });

    test('hashDel removes a single field and keeps the rest', async () => {
      await cache.hashSet('h1', 'name', 'Alice', 60);
      await cache.hashSet('h1', 'age', 30, 60);
      await expect(cache.hashDel('h1', 'age', { ttl: 60 })).resolves.toBe('OK');
      await expect(cache.hashGet('h1')).resolves.toEqual({ name: 'Alice' });
    });

    test('hashDel without options.ttl surfaces a clear validation error', async () => {
      await cache.hashSet('h1', 'name', 'Alice', 60);
      await expect(cache.hashDel('h1', 'name')).rejects.toThrow(
        'The ttl must be a non-negative number of seconds (0 means no expiration)',
      );
    });
  });

  describe('listSet/listGet/listDel', () => {
    let cache;

    beforeEach(() => {
      cache = new MemcachedWrapper();
    });

    test('listSet initializes a list with unshift by default', async () => {
      await cache.listSet('l1', 'b', 60);
      await cache.listSet('l1', 'a', 60);
      await expect(cache.listGet('l1')).resolves.toEqual(['a', 'b']);
    });

    test('listSet appends when options.push is true', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await cache.listSet('l1', 'b', 60, { push: true });
      await expect(cache.listGet('l1')).resolves.toEqual(['a', 'b']);
    });

    test('listSet writes to index 0 without falling back to unshift', async () => {
      await cache.listSet('l1', 'first', 60, { push: true });
      await cache.listSet('l1', 'second', 60, { push: true });
      await cache.listSet('l1', 'REPLACED', 60, { index: 0 });
      await expect(cache.listGet('l1')).resolves.toEqual(['REPLACED', 'second']);
    });

    test('listSet ignores a negative index and falls back to unshift', async () => {
      await cache.listSet('l1', 'a', 60, { index: -1 });
      await expect(cache.listGet('l1')).resolves.toEqual(['a']);
    });

    test('listSet ignores a non-numeric index and falls back to unshift', async () => {
      await cache.listSet('l1', 'a', 60, { index: 'not-a-number' });
      await expect(cache.listGet('l1')).resolves.toEqual(['a']);
    });

    test('listGet returns undefined for a missing key', async () => {
      await expect(cache.listGet('missing')).resolves.toBeUndefined();
    });

    test('listGet returns the full list when no options are given', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await expect(cache.listGet('l1', {})).resolves.toEqual(['a']);
    });

    test('listGet retrieves index 0 without treating it as falsy', async () => {
      await cache.listSet('l1', 'zero', 60, { push: true });
      await cache.listSet('l1', 'one', 60, { push: true });
      await expect(cache.listGet('l1', { index: 0 })).resolves.toBe('zero');
    });

    test('listGet slices from start to end inclusive, including start=0/end=0', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await cache.listSet('l1', 'b', 60, { push: true });
      await cache.listSet('l1', 'c', 60, { push: true });

      await expect(cache.listGet('l1', { start: 0, end: 0 })).resolves.toEqual(['a']);
      await expect(cache.listGet('l1', { start: 1 })).resolves.toEqual(['b', 'c']);
      await expect(cache.listGet('l1', { end: 1 })).resolves.toEqual(['a', 'b']);
    });

    test('listGet falls back to the full list when options match no known key', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await expect(cache.listGet('l1', { unrelated: true })).resolves.toEqual(['a']);
    });

    test('listDel with no options clears the whole key', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await expect(cache.listDel('l1')).resolves.toBe('OK');
      await expect(cache.listGet('l1')).resolves.toBeUndefined();
    });

    test('listDel on a missing key with options is a no-op', async () => {
      await expect(cache.listDel('missing', 60, { index: 0 })).resolves.toBeUndefined();
    });

    test('listDel removes index 0 without treating it as falsy', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await cache.listSet('l1', 'b', 60, { push: true });
      await cache.listDel('l1', 60, { index: 0 });
      await expect(cache.listGet('l1')).resolves.toEqual(['b']);
    });

    test('listDel removes a start..end range including 0', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await cache.listSet('l1', 'b', 60, { push: true });
      await cache.listSet('l1', 'c', 60, { push: true });
      await cache.listDel('l1', 60, { start: 0, end: 1 });
      await expect(cache.listGet('l1')).resolves.toEqual(['c']);
    });

    test('listDel removes from a start index to the end', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await cache.listSet('l1', 'b', 60, { push: true });
      await cache.listSet('l1', 'c', 60, { push: true });
      await cache.listDel('l1', 60, { start: 1 });
      await expect(cache.listGet('l1')).resolves.toEqual(['a']);
    });

    test('listDel removes from the beginning up to an end index', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await cache.listSet('l1', 'b', 60, { push: true });
      await cache.listSet('l1', 'c', 60, { push: true });
      await cache.listDel('l1', 60, { end: 1 });
      await expect(cache.listGet('l1')).resolves.toEqual(['c']);
    });

    test('listDel with unrecognized options clears the entire list', async () => {
      await cache.listSet('l1', 'a', 60, { push: true });
      await cache.listDel('l1', 60, { unrelated: true });
      await expect(cache.listGet('l1')).resolves.toEqual([]);
    });
  });

  describe('close', () => {
    test('ends the underlying client connection', () => {
      const cache = new MemcachedWrapper();
      const endSpy = jest.spyOn(lastClient(), 'end');
      cache.close();
      expect(endSpy).toHaveBeenCalled();
    });
  });
});
