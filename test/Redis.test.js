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

  describe('close', () => {
    test('delegates to client.quit', async () => {
      const redis = new RedisWrapper();
      const quitSpy = jest.spyOn(redis.client, 'quit');

      const callback = jest.fn();
      redis.close(callback);

      expect(quitSpy).toHaveBeenCalledWith(callback);
    });

    test('is also reachable as client.close (bound)', () => {
      const redis = new RedisWrapper();
      const quitSpy = jest.spyOn(redis.client, 'quit');

      redis.client.close();

      expect(quitSpy).toHaveBeenCalled();
    });
  });
});
