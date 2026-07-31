const { promisify } = require('util');
const Memcached = require('memcached');

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

  #maxLengthKey = 250;

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

  #checkKeyValidity(key) {
    if (key === undefined || key === null) throw new Error('The key cannot be empty');
    if (typeof key !== 'string' && typeof key !== 'number') {
      throw new Error('The key must be a string or a number');
    }

    const trimmedKey = String(key).replace(/\s/g, '');
    if (!trimmedKey) throw new Error('The key cannot be empty');
    if (trimmedKey.length > this.#maxLengthKey) {
      throw new Error(`The key must not exceed ${this.#maxLengthKey} characters`);
    }
  }

  /**
   * Parses a JSON string previously stored by this wrapper, raising a clear
   * error instead of letting a corrupted cache entry throw a cryptic
   * SyntaxError deep inside a hash/list operation.
   * @param {string} value
   * @returns {any}
   */
  // eslint-disable-next-line class-methods-use-this
  #parseStored(value) {
    try {
      return JSON.parse(value);
    } catch (err) {
      throw new Error(`Failed to parse cached value as JSON: ${err.message}`);
    }
  }

  /**
   * Retrieves a value from the cache.
   * @async
   * @param {string | number} key - The key to retrieve the value for.
   * @returns {Promise<any>} - The value stored in cache or null if not found.
   * @throws {Error} If the key is not a string or number, or if the retrieval fails.
   */
  async get(key) {
    this.#checkKeyValidity(key);
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
    this.#checkKeyValidity(key);
    if (data === undefined) throw new Error('The data to cache cannot be undefined');

    const numericTtl = Number(ttl);
    if (ttl === undefined || Number.isNaN(numericTtl) || numericTtl < 0) {
      throw new Error('The ttl must be a non-negative number of seconds (0 means no expiration)');
    }

    return this.setAsync(key, data, numericTtl);
  }

  /**
   * Deletes a value from the cache by key.
   * @async
   * @param {string | number} key - The key to delete from the cache.
   * @returns {Promise<string>} - 'OK' if the key was deleted successfully.
   * @throws {Error} If the key is not a string or number, or if the deletion fails.
   */
  async del(key) {
    this.#checkKeyValidity(key);
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
   * @param {number} ttl - The time-to-live (TTL) for the cached data in seconds.
   * @returns {Promise<void>}
   */
  async hashSet(key, field, data, ttl) {
    this.#checkKeyValidity(key);
    if (typeof field !== 'string') throw new Error('The field name must be a string');

    // Retrieve the existing hash from cache (single read) or initialize an empty object
    const hashString = await this.get(key);
    const hash = hashString ? this.#parseStored(hashString) : {};

    hash[field] = data;

    // Store the updated hash back in the cache with the specified TTL
    await this.set(key, JSON.stringify(hash), ttl);
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
    this.#checkKeyValidity(key);
    const hashString = await this.get(key);
    if (!hashString) return undefined;

    const hash = this.#parseStored(hashString);
    return field ? hash[field] : hash;
  }

  /**
   * @async
   * @method hashDel
   * @description Deletes a specific field from a hash or the entire hash if no field is specified.
   * @param {string} key - The key for the hash.
   * @param {string} [field] - The specific field to delete (optional).
   * @param {Object} [options] - Optional configurations.
   * @param {number} [options.ttl] - The TTL to re-apply when rewriting the hash after a removal.
   * @returns {Promise<string>} 'OK', or 'Data not found' if the hash/field is missing.
   */
  async hashDel(key, field, options = {}) {
    this.#checkKeyValidity(key);
    if (!field) return this.del(key);

    const hashString = await this.get(key);
    if (!hashString) return 'Data not found';

    const hash = this.#parseStored(hashString);
    if (hash[field] === undefined) return 'Data not found';

    delete hash[field];
    await this.set(key, JSON.stringify(hash), options.ttl);
    return 'OK';
  }

  /**
   * Updates a list stored in a cache key by applying actions such as 'push' or 'unshift',
   * or updating a specific index. If the list does not exist, it initializes one.
   * By default, the function uses 'unshift' to prepend the data to the list.
   *
   * @param {string} key - The cache key where the list is stored.
   * @param {*} data - The data to add or update in the list.
   * @param {number} [ttl] - The time-to-live in seconds for the key in the cache.
   * @param {Object} [options] - Additional options for the operation.
   * @param {number} [options.index] - The index of the element to update (0 is valid).
   * @param {boolean} [options.push=false] - Whether to append the data to the list.
   * @returns {Promise<void>} - Resolves after updating the cache.
   * @throws {Error} If the key is invalid.
   */
  async listSet(key, data, ttl, options = {}) {
    this.#checkKeyValidity(key);

    const listString = await this.get(key);
    const list = listString ? this.#parseStored(listString) : [];

    const { index, push = false } = options;
    const itemIndex = Number(index);
    const hasValidIndex = index !== undefined && !Number.isNaN(itemIndex) && itemIndex >= 0;

    if (hasValidIndex) list[itemIndex] = data;
    else if (push) list.push(data);
    else list.unshift(data);

    return this.set(key, JSON.stringify(list), ttl);
  }

  /**
   * Retrieves a list from memcached and optionally allows slicing or retrieving specific indices.
   * @param {string} key - The key used to retrieve the list from memcached.
   * @param {Object} [options={}] - Optional parameters for slicing or indexing the list.
   * @param {number} [options.index] - Specific index of the list to retrieve (0 is valid).
   * @param {number} [options.start] - Start index for slicing the list (0 is valid).
   * @param {number} [options.end] - End index for slicing the list (inclusive, 0 is valid).
   * @returns {Promise<any|undefined>} - The full list, a slice, or a specific item, per options.
   */
  async listGet(key, options = {}) {
    this.#checkKeyValidity(key);

    const listString = await this.get(key);
    const list = listString ? this.#parseStored(listString) : undefined;

    if (!list) return undefined;
    if (!options || !Object.keys(options).length) return list;

    const { index, start, end } = options;
    const itemIndex = Number(index);
    const startIndex = Number(start);
    const endIndex = Number(end);

    const hasIndex = index !== undefined && !Number.isNaN(itemIndex);
    const hasStart = start !== undefined && !Number.isNaN(startIndex);
    const hasEnd = end !== undefined && !Number.isNaN(endIndex);

    if (hasIndex) return list[itemIndex];
    if (hasStart && hasEnd) return list.slice(startIndex, endIndex + 1);
    if (hasStart) return list.slice(startIndex);
    if (hasEnd) return list.slice(0, endIndex + 1);
    return list;
  }

  /**
   * Deletes items from a list stored in the cache based on the given options.
   * If no options are provided, the entire list will be cleared.
   *
   * @param {string} key - The cache key where the list is stored.
   * @param {number} [ttl] - The time-to-live in seconds for the key in the cache.
   * @param {Object} [options={}] - Options to specify what to delete.
   * @param {number} [options.index] - The index of the item to delete (0 is valid).
   * @param {number} [options.start] - The start index for deleting a range of items (0 is valid).
   * @param {number} [options.end] - The end index for deleting a range of items (0 is valid).
   * @returns {Promise} - Resolves after updating the cache.
   * @throws {Error} If the key is invalid or the operation fails.
   */
  async listDel(key, ttl, options = {}) {
    this.#checkKeyValidity(key);

    if (!options || !Object.keys(options).length) return this.del(key);

    const listString = await this.get(key);
    const list = listString ? this.#parseStored(listString) : [];

    if (!list.length) return undefined;

    const { index, start, end } = options;
    const itemIndex = Number(index);
    const startIndex = Number(start);
    const endIndex = Number(end);

    if (itemIndex >= 0) list.splice(itemIndex, 1);
    else if (startIndex >= 0 && endIndex >= 0) list.splice(startIndex, endIndex - startIndex + 1);
    else if (startIndex >= 0) list.splice(startIndex);
    else if (endIndex >= 0) list.splice(0, endIndex + 1);
    else list.length = 0;

    return this.set(key, JSON.stringify(list), ttl);
  }

  /**
   * Ends the connection to the Memcached server.
   */
  close() {
    this.#client.end();
  }
}

module.exports = MemcachedWrapper;
