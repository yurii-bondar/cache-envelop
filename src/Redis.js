const loadClient = require('./loadClient');
const {
  checkKey,
  checkKeyBasics,
  checkTtl,
  stringifyForCache,
  parseStored,
} = require('./validators');

/**
 * Default handler for the underlying ioredis client's `error` event.
 * ioredis is an EventEmitter — an `error` event with no listener attached
 * crashes the Node.js process with an uncaught exception. This wrapper
 * always attaches a listener so a dropped connection never takes the
 * whole application down; pass `onError` to override the behavior.
 * @param {Error} err
 */
function defaultErrorHandler(err) {
  // eslint-disable-next-line no-console
  console.error('[cache-envelop] Redis client error:', err && err.message);
}

/**
 * @class RedisWrapper
 * @description Wraps an ioredis client with the portable cache core —
 * `get` / `set` / `del` / `close` — that {@link MemcachedWrapper} also
 * implements, so the two are interchangeable for plain key/value work.
 * Everything beyond that core (hashes, sets, sorted sets, pipelines,
 * transactions) is reached through {@link RedisWrapper#client}, which stays
 * the raw ioredis instance.
 *
 * Values written through `set` are JSON-encoded and decoded again by `get`,
 * so what you put in is what you get out. That makes the wrapper the owner of
 * the stored format: keys written by something else are readable through
 * `.client`, not through `get`.
 */
class RedisWrapper {
  #client = null;

  #connectionArgs = '127.0.0.1:6379';

  #strictKeys = false;

  /**
   * @constructor
   * @param {string | Object} connectionArgs - Redis connection string or ioredis options object.
   * @param {Object} [options] - Wrapper-level options.
   * @param {Function} [options.onError] - Called with the error whenever the client emits 'error'.
   * @param {boolean} [options.strictKeys=false] - Enforce Memcached's key rules (no whitespace,
   *   250 characters max) on this client too. Redis itself accepts almost any key, so this is
   *   opt-in: turn it on to catch keys that would not survive a switch to the Memcached backend.
   */
  constructor(connectionArgs, options = {}) {
    const IORedis = loadClient('ioredis', 'RedisWrapper');

    this.connectionArgs = connectionArgs;
    this.#strictKeys = Boolean(options && options.strictKeys);
    this.#client = new IORedis(this.connectionArgs);
    this.#client.close = this.close.bind(this);
    this.#client.on('error', (options && options.onError) || defaultErrorHandler);
  }

  /**
   * @property {string | Object} connectionArgs - Redis client connection args.
   */
  set connectionArgs(value) {
    if (value === undefined) return;
    if (!value || (typeof value === 'string' && !value.trim())) {
      throw new Error('Invalid connection arguments provided for Redis client');
    }
    this.#connectionArgs = value;
  }

  get connectionArgs() {
    return this.#connectionArgs;
  }

  get client() {
    return this.#client;
  }

  /**
   * Redis has no key-length or whitespace limits of its own, so only the
   * portable minimum is enforced unless `strictKeys` was requested.
   * @param {string | number} key
   * @returns {string}
   */
  #checkKey(key) {
    return this.#strictKeys ? checkKey(key) : checkKeyBasics(key);
  }

  /**
   * Retrieves a value from the cache.
   * @async
   * @param {string | number} key - The key to retrieve the value for.
   * @returns {Promise<any>} The stored value, or `undefined` if the key does not exist.
   * @throws {Error} If the key is invalid or the stored value is not valid JSON.
   */
  async get(key) {
    const stringKey = this.#checkKey(key);
    const value = await this.#client.get(stringKey);

    // ioredis resolves a missing key to null; the portable core reports undefined.
    return value === null ? undefined : parseStored(value);
  }

  /**
   * Stores a value in the cache.
   * @async
   * @param {string | number} key - The key to store the value under.
   * @param {any} data - The data to store; must be JSON-serializable.
   * @param {number} ttl - Required TTL in seconds. Use 0 for no expiration.
   * @returns {Promise<string>} 'OK'.
   * @throws {Error} If the key, data or ttl is invalid.
   */
  async set(key, data, ttl) {
    const stringKey = this.#checkKey(key);
    const serialized = stringifyForCache(data);
    const numericTtl = checkTtl(ttl);

    // `SET key value EX 0` is an error in Redis, so "no expiration" is a plain SET.
    if (numericTtl === 0) return this.#client.set(stringKey, serialized);

    // EX only accepts whole seconds; a fractional ttl goes out as milliseconds
    // instead of being truncated, and never rounds down to a rejected 0.
    if (Number.isInteger(numericTtl)) {
      return this.#client.set(stringKey, serialized, 'EX', numericTtl);
    }
    return this.#client.set(stringKey, serialized, 'PX', Math.max(1, Math.round(numericTtl * 1000)));
  }

  /**
   * Deletes a value from the cache by key.
   * @async
   * @param {string | number} key - The key to delete from the cache.
   * @returns {Promise<string>} 'OK', whether or not the key existed.
   * @throws {Error} If the key is invalid or the deletion fails.
   */
  async del(key) {
    const stringKey = this.#checkKey(key);
    await this.#client.del(stringKey);
    return 'OK';
  }

  /**
   * Gracefully closes the connection.
   * @param {Function} [callback]
   * @returns {Promise<'OK'>}
   */
  close(callback) {
    return this.client.quit(callback);
  }
}

module.exports = RedisWrapper;
