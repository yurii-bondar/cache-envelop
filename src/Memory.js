const {
  checkKey,
  checkKeyBasics,
  checkTtl,
  stringifyForCache,
  parseStored,
} = require('./validators');

/**
 * @class MemoryWrapper
 * @description An in-process implementation of the portable cache core, backed
 * by a `Map`. It needs no server and no dependencies, which makes it the
 * default choice for tests and local development: code written against
 * `Memcached` or `Redis` runs unchanged against this one.
 *
 * Values go through the same JSON encoding as the other backends rather than
 * being stored by reference. That costs a copy, but it is the point: a value
 * that survives here survives in production, a value JSON cannot represent
 * fails here the same way it would there, and a caller mutating what `get`
 * returned cannot reach into the cache.
 *
 * Entries expire lazily, when a read finds them past their deadline — there are
 * no timers to leak or to keep the event loop alive. A key that is written and
 * never read again therefore holds its memory until eviction or `close()`; pass
 * `maxKeys` to bound that.
 */
class MemoryWrapper {
  #store = new Map();

  #maxKeys = 0;

  #strictKeys = false;

  /**
   * @constructor
   * @param {Object} [options]
   * @param {number} [options.maxKeys=0] - Maximum number of entries to keep; `0` means unbounded.
   *   Once exceeded, the least recently written entry is dropped. This is write-order eviction,
   *   not an LRU: reads do not make a key any safer. If you need real LRU behavior for a hot L1
   *   cache, reach for a dedicated library instead.
   * @param {boolean} [options.strictKeys=false] - Enforce Memcached's key rules (no whitespace,
   *   250 characters max). Useful in tests to catch keys that would not survive a switch to a
   *   real backend.
   */
  constructor(options = {}) {
    const { maxKeys = 0, strictKeys = false } = options || {};

    const numericMaxKeys = Number(maxKeys);
    if (!Number.isInteger(numericMaxKeys) || numericMaxKeys < 0) {
      throw new Error('The maxKeys option must be a non-negative integer (0 means unbounded)');
    }

    this.#maxKeys = numericMaxKeys;
    this.#strictKeys = Boolean(strictKeys);
  }

  /** Number of entries currently held, including any that have expired but not yet been read. */
  get size() {
    return this.#store.size;
  }

  #checkKey(key) {
    return this.#strictKeys ? checkKey(key) : checkKeyBasics(key);
  }

  /** Drops the oldest writes until the store is back within `maxKeys`. */
  #evictOverflow() {
    if (this.#maxKeys === 0) return;

    while (this.#store.size > this.#maxKeys) {
      const oldestKey = this.#store.keys().next().value;
      this.#store.delete(oldestKey);
    }
  }

  /**
   * Retrieves a value from the cache.
   * @async
   * @param {string | number} key
   * @returns {Promise<any>} The stored value, or `undefined` if the key is missing or expired.
   * @throws {Error} If the key is invalid.
   */
  async get(key) {
    const stringKey = this.#checkKey(key);
    const entry = this.#store.get(stringKey);

    if (entry === undefined) return undefined;

    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.#store.delete(stringKey);
      return undefined;
    }

    return parseStored(entry.value);
  }

  /**
   * Stores a value in the cache.
   * @async
   * @param {string | number} key
   * @param {any} data - Must be JSON-serializable.
   * @param {number} ttl - Required TTL in seconds. Use 0 for no expiration.
   * @returns {Promise<string>} 'OK'.
   * @throws {Error} If the key, data or ttl is invalid.
   */
  async set(key, data, ttl) {
    const stringKey = this.#checkKey(key);
    const serialized = stringifyForCache(data);
    const numericTtl = checkTtl(ttl);

    // Re-insert so that eviction order follows the most recent write.
    this.#store.delete(stringKey);
    this.#store.set(stringKey, {
      value: serialized,
      expiresAt: numericTtl === 0 ? null : Date.now() + numericTtl * 1000,
    });

    this.#evictOverflow();

    return 'OK';
  }

  /**
   * Deletes a value from the cache by key.
   * @async
   * @param {string | number} key
   * @returns {Promise<string>} 'OK', whether or not the key existed.
   * @throws {Error} If the key is invalid.
   */
  async del(key) {
    const stringKey = this.#checkKey(key);
    this.#store.delete(stringKey);
    return 'OK';
  }

  /** Drops every entry. There is no connection to tear down. */
  close() {
    this.#store.clear();
  }
}

module.exports = MemoryWrapper;
