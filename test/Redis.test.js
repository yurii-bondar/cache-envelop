jest.mock('ioredis');

const RedisMockClient = require('ioredis');
const RedisWrapper = require('../src/Redis');

describe('RedisWrapper', () => {
  afterEach(() => {
    RedisMockClient.instances.length = 0;
    jest.restoreAllMocks();
  });

  describe('connectionArgs', () => {
    test('falls back to the default when no argument is provided', () => {
      const redis = new RedisWrapper();
      expect(redis.connectionArgs).toBe('127.0.0.1:6379');
    });

    test('accepts a connection string', () => {
      const redis = new RedisWrapper('redis://10.0.0.5:6380');
      expect(redis.connectionArgs).toBe('redis://10.0.0.5:6380');
    });

    test('accepts an ioredis options object', () => {
      const options = { host: '10.0.0.5', port: 6380 };
      const redis = new RedisWrapper(options);
      expect(redis.connectionArgs).toBe(options);
    });

    test('throws on an empty string instead of silently using the default', () => {
      expect(() => new RedisWrapper('')).toThrow('Invalid connection arguments provided for Redis client');
    });

    test('throws on a whitespace-only string', () => {
      expect(() => new RedisWrapper('   ')).toThrow('Invalid connection arguments provided for Redis client');
    });

    test('throws on null', () => {
      expect(() => new RedisWrapper(null)).toThrow('Invalid connection arguments provided for Redis client');
    });

    test('tolerates a null options argument', () => {
      expect(() => new RedisWrapper('127.0.0.1:6379', null)).not.toThrow();
    });
  });

  describe('client', () => {
    test('exposes the underlying ioredis instance', () => {
      const redis = new RedisWrapper();
      expect(redis.client).toBeInstanceOf(RedisMockClient);
    });
  });

  describe('error handling', () => {
    test('attaches a default error listener so an "error" event does not crash the process', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const redis = new RedisWrapper();

      expect(() => redis.client.emit('error', new Error('connection refused'))).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[cache-envelop] Redis client error:',
        'connection refused',
      );
    });

    test('uses a custom onError handler when provided', () => {
      const onError = jest.fn();
      const redis = new RedisWrapper('127.0.0.1:6379', { onError });
      const err = new Error('boom');

      redis.client.emit('error', err);

      expect(onError).toHaveBeenCalledWith(err);
    });
  });

  describe('key validation', () => {
    test('enforces only the portable minimum by default', async () => {
      const redis = new RedisWrapper();

      await expect(redis.get(undefined)).rejects.toThrow('The key cannot be empty');
      await expect(redis.get(null)).rejects.toThrow('The key cannot be empty');
      await expect(redis.get('   ')).rejects.toThrow('The key cannot be empty');
      await expect(redis.get({ foo: 'bar' })).rejects.toThrow('The key must be a string or a number');
    });

    test('accepts keys Redis allows but Memcached would reject', async () => {
      const redis = new RedisWrapper();

      await expect(redis.get('user 1')).resolves.toBeUndefined();
      await expect(redis.get('a'.repeat(300))).resolves.toBeUndefined();
    });

    test('strictKeys opts in to the Memcached key rules', async () => {
      const redis = new RedisWrapper('127.0.0.1:6379', { strictKeys: true });

      await expect(redis.get('user 1')).rejects.toThrow(
        'The key must not contain whitespace characters',
      );
      await expect(redis.get('a'.repeat(251))).rejects.toThrow(
        'The key must not exceed 250 characters',
      );
      await expect(redis.get('user:1')).resolves.toBeUndefined();
    });
  });

  describe('get/set/del', () => {
    let redis;

    beforeEach(() => {
      redis = new RedisWrapper();
    });

    test('round-trips strings, numbers, booleans, null, objects and arrays', async () => {
      const values = ['hello', 42, true, null, { a: 1, nested: { b: [1, 2] } }, [1, 'two']];

      await Promise.all(values.map((value, i) => redis.set(`k${i}`, value, 60)));

      await Promise.all(
        values.map((value, i) => expect(redis.get(`k${i}`)).resolves.toEqual(value)),
      );
    });

    test('keeps a numeric string a string, unlike a naive parse-if-possible', async () => {
      await redis.set('k', '42', 60);
      await expect(redis.get('k')).resolves.toBe('42');
    });

    test('get returns undefined for a missing key rather than null', async () => {
      await expect(redis.get('missing')).resolves.toBeUndefined();
    });

    test('set rejects undefined data', async () => {
      await expect(redis.set('k', undefined, 60)).rejects.toThrow(
        'The data to cache cannot be undefined',
      );
    });

    test('set rejects a value JSON cannot represent', async () => {
      await expect(redis.set('k', () => {}, 60)).rejects.toThrow(
        'The data to cache must be JSON-serializable',
      );
    });

    test('set reports a circular structure clearly', async () => {
      const circular = { name: 'loop' };
      circular.self = circular;

      await expect(redis.set('k', circular, 60)).rejects.toThrow(
        /^Failed to serialize the value as JSON:/,
      );
    });

    test('del resolves to "OK" for both an existing and a missing key', async () => {
      await redis.set('k', 'v', 60);
      await expect(redis.del('k')).resolves.toBe('OK');
      await expect(redis.get('k')).resolves.toBeUndefined();
      await expect(redis.del('k')).resolves.toBe('OK');
    });

    test('get raises a clear error on a value that is not JSON', async () => {
      redis.client.store.set('broken', 'not-json{');
      await expect(redis.get('broken')).rejects.toThrow('Failed to parse cached value as JSON');
    });

    test.each(['get', 'set', 'del'])('%s propagates errors from the client', async (method) => {
      redis.client.forceNextError(method, new Error('connection lost'));
      await expect(redis[method]('k', 'v', 60)).rejects.toThrow('connection lost');
    });
  });

  describe('ttl handling', () => {
    let redis;

    beforeEach(() => {
      redis = new RedisWrapper();
    });

    test('sends whole seconds as EX', async () => {
      await redis.set('k', 'v', 60);
      expect(redis.client.expirations.get('k')).toEqual({ mode: 'EX', ttl: 60 });
    });

    test('ttl=0 sends a plain SET, since Redis rejects EX 0', async () => {
      await redis.set('k', 'v', 0);
      expect(redis.client.expirations.has('k')).toBe(false);
      await expect(redis.get('k')).resolves.toBe('v');
    });

    test('sends a fractional ttl as PX instead of truncating it', async () => {
      await redis.set('k', 'v', 1.5);
      expect(redis.client.expirations.get('k')).toEqual({ mode: 'PX', ttl: 1500 });
    });

    test('never rounds a sub-millisecond ttl down to a rejected 0', async () => {
      await redis.set('k', 'v', 0.0001);
      expect(redis.client.expirations.get('k')).toEqual({ mode: 'PX', ttl: 1 });
    });

    test('rejects a missing, non-numeric or negative ttl', async () => {
      const ttlError = 'The ttl must be a non-negative number of seconds (0 means no expiration)';

      await expect(redis.set('k', 'v')).rejects.toThrow(ttlError);
      await expect(redis.set('k', 'v', 'soon')).rejects.toThrow(ttlError);
      await expect(redis.set('k', 'v', -5)).rejects.toThrow(ttlError);
    });
  });

  describe('close', () => {
    test('does not patch a close method onto the ioredis client', () => {
      const redis = new RedisWrapper();
      expect(redis.client.close).toBeUndefined();
    });

    test('delegates to client.quit', async () => {
      const redis = new RedisWrapper();
      const quitSpy = jest.spyOn(redis.client, 'quit');

      const callback = jest.fn();
      redis.close(callback);

      expect(quitSpy).toHaveBeenCalledWith(callback);
    });
  });
});
