const { promisify } = require('util');
const Memcached = require('memcached');

const { checkKey, checkTtl, parseStored } = require('./validators');

const LIST_NUMERIC_OPTIONS = ['index', 'start', 'end'];

/**
 * Default handler for the underlying memcached client's diagnostic events
 * ('issue', 'failure', 'reconnecting', 'remove'). Unlike ioredis, the
 * `memcached` package does not emit an unhandled top-level 'error' that
 * crashes the process, but silently ignoring connectivity problems makes
 * failures invisible in production. Pass `onIssue` to override.
 * @param {Object} details
 */
function defaultIssueHandler(details) {
  // eslint-disable-next-line no-console
  console.error('[cache-envelop] Memcached client issue:', details);
}

/**
 * @class MemcachedWrapper
 * @description A wrapper class for interacting with Memcached using promises.
 */
class MemcachedWrapper {
  #client = null;

  #connectionArgs = '127.0.0.1:11211';

  #options = { timeout: 300 };

  /**
   * @constructor
   * @param {string | string[] | Object} connectionArgs - Memcached server(s) or configuration.
   * @param {Object} [options] - Optional configurations for Memcached client.
   * @param {Function} [options.onIssue] - Called on 'issue'/'failure'/'reconnecting'/'remove'.
   */
  constructor(connectionArgs, options = {}) {
    this.connectionArgs = connectionArgs;
    this.options = options;
    this.#client = new Memcached(this.connectionArgs, this.options);

    const onIssue = (options && options.onIssue) || defaultIssueHandler;
    ['issue', 'failure', 'reconnecting', 'remove'].forEach((event) => {
      this.#client.on(event, onIssue);
    });

    // Promisify Memcached methods
    this.getAsync = promisify(this.#client.get).bind(this.#client);
    this.setAsync = promisify(this.#client.set).bind(this.#client);
    this.delAsync = promisify(this.#client.del).bind(this.#client);
  }

  /**
   * @property {Object} options - Memcached client connection args.
   */
  set connectionArgs(value) {
    if (value === undefined) return;
    if (!value || (typeof value === 'string' && !value.trim())) {
      throw new Error('Invalid connection arguments provided for Memcached client');
    }
    this.#connectionArgs = value;
  }

  get connectionArgs() {
    return this.#connectionArgs;
  }

  /**
   * @property {Object} options - Memcached client options.
   */
  set options(value) {
    if (value) {
      const { onIssue, ...clientOptions } = value;
      this.#options = {
        ...this.#options,
        ...clientOptions,
      };
    }
  }

  get options() {
    return this.#options;
  }

  /**
   * Validates and normalizes the `options` object of the list helpers. Unknown
   * keys and out-of-range positions are rejected rather than ignored: a typo
   * such as `{ idx: 0 }` used to fall through to "no position given" and wipe
   * the whole list, and a negative index behaved differently in every method.
   * @param {Object} options - Raw options object supplied by the caller.
   * @param {string[]} allowedKeys - Option names this method understands.
   * @returns {Object} Normalized options; numeric positions coerced to numbers.
   */
  // eslint-disable-next-line class-methods-use-this
  #normalizeListOptions(options, allowedKeys) {
    if (options === undefined || options === null) return {};
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('The options argument must be an object');
    }

    const unknownKeys = Object.keys(options).filter((key) => !allowedKeys.includes(key));
    if (unknownKeys.length) {
      throw new Error(
        `Unknown option(s): ${unknownKeys.join(', ')}. Allowed option(s): ${allowedKeys.join(', ')}`,
      );
    }

    const normalized = {};

    LIST_NUMERIC_OPTIONS.filter((key) => allowedKeys.includes(key)).forEach((key) => {
      const value = options[key];
      if (value === undefined) return;

      const isNumeric = typeof value === 'number'
        || (typeof value === 'string' && value.trim() !== '');
      const numericValue = isNumeric ? Number(value) : NaN;

      if (!Number.isInteger(numericValue) || numericValue < 0) {
        throw new Error(`The "${key}" option must be a non-negative integer`);
      }
      normalized[key] = numericValue;
    });

    if (allowedKeys.includes('push')) normalized.push = Boolean(options.push);

    return normalized;
  }

  /**
   * Retrieves a value from the cache.
   * @async
   * @param {string | number} key - The key to retrieve the value for.
   * @returns {Promise<any>} - The value stored in cache or null if not found.
   * @throws {Error} If the key is not a string or number, or if the retrieval fails.
   */
  async get(key) {
    checkKey(key);
    return this.getAsync(key);
  }

  /**
   * Stores a value in the cache.
   * @async
   * @param {string | number} key - The key to store the value under.
   * @param {any} data - The data to store in cache.
   * @param {number} ttl - The TTL for the cached data in seconds. Use 0 for no expiration.
   * @returns {Promise<any>} - The cached data.
   * @throws {Error} If the key is not a string or number, or if the data or TTL is invalid.
   */
  async set(key, data, ttl) {
    checkKey(key);
    if (data === undefined) throw new Error('The data to cache cannot be undefined');

    return this.setAsync(key, data, checkTtl(ttl));
  }

  /**
   * Deletes a value from the cache by key.
   * @async
   * @param {string | number} key - The key to delete from the cache.
   * @returns {Promise<string>} - 'OK' if the key was deleted successfully.
   * @throws {Error} If the key is not a string or number, or if the deletion fails.
   */
  async del(key) {
    checkKey(key);
    await this.delAsync(key);
    return 'OK';
  }

  /**
   * @async
   * @method hashSet
   * @description Sets or updates a field in a hash stored in Memcached.
   * @param {string} key - The key for the hash.
   * @param {string} field - The field name within the hash to set or update.
   * @param {any} data - The data to store for the specified field in the hash.
   * @param {number} ttl - Required TTL in seconds for the rewritten hash (0 = no expiration).
   * @returns {Promise<void>}
   */
  async hashSet(key, field, data, ttl) {
    checkKey(key);
    if (typeof field !== 'string') throw new Error('The field name must be a string');
    const numericTtl = checkTtl(ttl);

    // Retrieve the existing hash from cache (single read) or initialize an empty object
    const hashString = await this.get(key);
    const hash = hashString ? parseStored(hashString) : {};

    hash[field] = data;

    // Store the updated hash back in the cache with the specified TTL
    await this.set(key, JSON.stringify(hash), numericTtl);
  }

  /**
   * @async
   * @method hashGet
   * @description Retrieves the entire hash or a specific field from a hash stored in Memcached.
   * @param {string} key - The key for the hash.
   * @param {string} [field] - The specific field to retrieve (optional).
   * @returns {Promise<object|any|undefined>} Hash, specific field value, or undefined if not found.
   */
  async hashGet(key, field) {
    checkKey(key);
    const hashString = await this.get(key);
    if (!hashString) return undefined;

    const hash = parseStored(hashString);
    return field ? hash[field] : hash;
  }

  /**
   * @async
   * @method hashDel
   * @description Deletes a specific field from a hash or the entire hash if no field is specified.
   * @param {string} key - The key for the hash.
   * @param {string} [field] - The specific field to delete (optional).
   * @param {Object} [options] - Optional configurations.
   * @param {number} options.ttl - TTL to re-apply when rewriting the hash; required when
   *   `field` is given, since removing a field rewrites the whole key.
   * @returns {Promise<string>} 'OK', or 'Data not found' if the hash/field is missing.
   */
  async hashDel(key, field, options = {}) {
    checkKey(key);
    if (!field) return this.del(key);

    const hashString = await this.get(key);
    if (!hashString) return 'Data not found';

    const hash = parseStored(hashString);
    if (hash[field] === undefined) return 'Data not found';

    delete hash[field];
    await this.set(key, JSON.stringify(hash), (options || {}).ttl);
    return 'OK';
  }

  /**
   * Updates a list stored in a cache key by applying actions such as 'push' or 'unshift',
   * or updating a specific index. If the list does not exist, it initializes one.
   * By default, the function uses 'unshift' to prepend the data to the list.
   *
   * @param {string} key - The cache key where the list is stored.
   * @param {*} data - The data to add or update in the list.
   * @param {number} ttl - Required TTL in seconds for the rewritten list (0 = no expiration).
   * @param {Object} [options] - Additional options for the operation.
   * @param {number} [options.index] - Index of the element to update; a non-negative integer.
   * @param {boolean} [options.push=false] - Whether to append the data to the list.
   * @returns {Promise<any>} - Resolves after updating the cache.
   * @throws {Error} If the key, ttl or options are invalid.
   */
  async listSet(key, data, ttl, options = {}) {
    checkKey(key);
    const numericTtl = checkTtl(ttl);
    const { index, push } = this.#normalizeListOptions(options, ['index', 'push']);

    const listString = await this.get(key);
    const list = listString ? parseStored(listString) : [];

    if (index !== undefined) list[index] = data;
    else if (push) list.push(data);
    else list.unshift(data);

    return this.set(key, JSON.stringify(list), numericTtl);
  }

  /**
   * Retrieves a list from memcached and optionally allows slicing or retrieving specific indices.
   * @param {string} key - The key used to retrieve the list from memcached.
   * @param {Object} [options={}] - Optional parameters for slicing or indexing the list.
   * @param {number} [options.index] - Index of the item to retrieve; a non-negative integer.
   * @param {number} [options.start] - Start index for slicing; a non-negative integer.
   * @param {number} [options.end] - End index for slicing (inclusive); a non-negative integer.
   * @returns {Promise<any|undefined>} - The full list, a slice, or a specific item, per options.
   * @throws {Error} If the key or options are invalid.
   */
  async listGet(key, options = {}) {
    checkKey(key);
    const { index, start, end } = this.#normalizeListOptions(options, LIST_NUMERIC_OPTIONS);

    const listString = await this.get(key);
    const list = listString ? parseStored(listString) : undefined;

    if (!list) return undefined;

    if (index !== undefined) return list[index];
    if (start !== undefined && end !== undefined) return list.slice(start, end + 1);
    if (start !== undefined) return list.slice(start);
    if (end !== undefined) return list.slice(0, end + 1);
    return list;
  }

  /**
   * Deletes items from a list stored in the cache based on the given options.
   * If no options are provided, the entire key is deleted.
   *
   * @param {string} key - The cache key where the list is stored.
   * @param {number} [ttl] - TTL in seconds for the rewritten list; required whenever
   *   `options` selects a subset (the remaining list is written back).
   * @param {Object} [options={}] - Options to specify what to delete.
   * @param {number} [options.index] - Index of the item to delete; a non-negative integer.
   * @param {number} [options.start] - Start index of the range to delete; a non-negative integer.
   * @param {number} [options.end] - End index of the range to delete; a non-negative integer.
   * @returns {Promise<any>} - Resolves after updating the cache.
   * @throws {Error} If the key, ttl or options are invalid.
   */
  async listDel(key, ttl, options = {}) {
    checkKey(key);
    const { index, start, end } = this.#normalizeListOptions(options, LIST_NUMERIC_OPTIONS);

    if (index === undefined && start === undefined && end === undefined) return this.del(key);

    const numericTtl = checkTtl(ttl);

    const listString = await this.get(key);
    const list = listString ? parseStored(listString) : [];

    if (!list.length) return undefined;

    if (index !== undefined) list.splice(index, 1);
    else if (start !== undefined && end !== undefined) list.splice(start, end - start + 1);
    else if (start !== undefined) list.splice(start);
    else list.splice(0, end + 1);

    return this.set(key, JSON.stringify(list), numericTtl);
  }

  /**
   * Ends the connection to the Memcached server.
   */
  close() {
    this.#client.end();
  }
}

module.exports = MemcachedWrapper;
