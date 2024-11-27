const { promisify } = require('util');
const Memcached = require('memcached');

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
   */
  constructor(connectionArgs, options = {}) {
    this.connectionArgs = connectionArgs;
    this.options = options;
    this.#client = new Memcached(this.connectionArgs, this.options);

    // Promisify Memcached methods
    this.getAsync = promisify(this.#client.get).bind(this.#client);
    this.setAsync = promisify(this.#client.set).bind(this.#client);
    this.delAsync = promisify(this.#client.del).bind(this.#client);
  }

  /**
   * @property {Object} options - Memcached client connection args.
   */
  set connectionArgs(value) {
    if (value) this.#connectionArgs = value;
  }

  /**
   * @property {Object} options - Memcached client options.
   */
  set options(value) {
    if (value) {
      this.#options = {
        ...this.#options,
        ...value,
      };
    }
  }

  get connectionArgs() {
    return this.#connectionArgs;
  }

  get options() {
    return this.#options;
  }

  #checkKeyValidity(key) {
    const trimmedKey = key?.replace(/\s/g,'');
    if (!trimmedKey) throw new Error('The key cannot be empty');
    if (typeof trimmedKey !== 'string') throw new Error('The key must be a string');
    if (trimmedKey.length > this.#maxLengthKey) throw new Error('The key must be at least one character');
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
   * @param {number} ttl - The time-to-live (TTL) for the cached data in seconds.
   * @returns {Promise<any>} - The cached data.
   * @throws {Error} If the key is not a string or number, or if the data or TTL is invalid.
   */
  async set(key, data, ttl) {
    this.#checkKeyValidity(key);
    if (!Number(ttl) || data === undefined) throw new Error('Invalid arguments for set operation');
    return this.setAsync(key, data, ttl);
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

    // Retrieve the existing hash from cache or initialize an empty object
    const hash = (await this.get(key)) ? JSON.parse(await this.get(key)) : {};

    // Update the specified field in the hash
    if (typeof field === 'string') {
      hash[field] = data;
    } else {
      throw new Error('The field name must be a string');
    }

    // Store the updated hash back in the cache with the specified TTL
    await this.set(key, JSON.stringify(hash), ttl);
  }


  /**
   * @async
   * @method hashGet
   * @description Retrieves the entire hash or a specific field from a hash stored in Memcached.
   * @param {string} key - The key for the hash.
   * @param {string} [field] - The specific field to retrieve (optional).
   * @returns {Promise<object|string|undefined>} Returns the hash, specific field value, or undefined if not found.
   */
  async hashGet(key, field) {
    this.#checkKeyValidity(key);
    const hashString = await this.get(key);
    const hash = hashString ? JSON.parse(hashString) : undefined;
    return field ? hash[field] : hash;
  }

  /**
   * @async
   * @method hashDel
   * @description Deletes a specific field from a hash or the entire hash if no field is specified.
   * @param {string} key - The key for the hash.
   * @param {string} [field] - The specific field to delete (optional).
   * @param {Object} [options] - Optional configurations
   * @returns {Promise<string>} Returns 'OK' if successful or 'Data not found' if the hash or field does not exist.
   */
  async hashDel(key, field, options) {
    this.#checkKeyValidity(key);
    if (!field) return this.del(key);

    const hashString = await this.get(key);
    if (!hashString) return 'Data not found';

    const hash = JSON.parse(hashString) || {};
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
   * @param {number} [options.index] - The index of the element to update (if applicable).
   * @param {boolean} [options.unshift=true] - Whether to append the data to the list (default: true).
   * @param {boolean} [options.push=false] - Whether to append the data to the list (default: false).
   * @returns {Promise<void>} - Resolves after updating the cache.
   * @throws {Error} If the key is invalid.
   */
  async listSet(key, data, ttl, options = {}) {
    this.#checkKeyValidity(key);

    const listString = await this.get(key);
    const list = listString ? JSON.parse(listString) : [];

    const { index, push = false } = options;
    const itemIndex = Number(index);

    if (itemIndex) list[itemIndex] = data;
    else if (push) list.push(data);
    else list.unshift(data);

    return this.set(key, JSON.stringify(list), ttl);
  }

  /**
   * Retrieves a list from memcached and optionally allows slicing or retrieving specific indices.
   * @param {string} key - The key used to retrieve the list from memcached.
   * @param {Object} [options={}] - Optional parameters for slicing or indexing the list.
   * @param {number} [options.index] - Specific index of the list to retrieve.
   * @param {number} [options.start] - Start index for slicing the list.
   * @param {number} [options.end] - End index for slicing the list (inclusive).
   * @returns {Promise<any|undefined>} - The full list, a slice, or a specific item depending on the options provided.
   */
  async listGet(key, options = {}) {
    const listString = await this.get(key);
    const list = listString ? JSON.parse(listString) : undefined;

    if (!options || !Object.keys(options).length) return list;

    const { index, start, end } = options;
    const itemIndex = Number(index);
    const startIndex = Number(start);
    const endIndex = Number(end);

    if (list) {
      if (itemIndex) return list[itemIndex];
      if (startIndex && endIndex) return list.slice(startIndex, endIndex + 1);
      if (startIndex && !endIndex) return list.slice(startIndex);
      if (!startIndex && endIndex) return list.slice(0, endIndex + 1);
      if (!startIndex && !endIndex) return list;
    }

    return undefined;
  }

  /**
   * Deletes items from a list stored in the cache based on the given options.
   * If no options are provided, the entire list will be cleared.
   *
   * @param {string} key - The cache key where the list is stored.
   * @param {number} [ttl] - The time-to-live in seconds for the key in the cache.
   * @param {Object} [options={}] - Options to specify what to delete.
   * @param {number} [options.index] - The index of the item to delete.
   * @param {number} [options.start] - The start index for deleting a range of items.
   * @param {number} [options.end] - The end index for deleting a range of items.
   * @returns {Promise} - Resolves after updating the cache.
   * @throws {Error} If the key is invalid or the operation fails.
   */
  async listDel(key, ttl, options = {}) {
    this.#checkKeyValidity(key);

    if (!options || !Object.keys(options).length) return this.del(key);

    const listString = await this.get(key);
    const list = listString ? JSON.parse(listString) : [];

    if (!list.length) return;

    const { index, start, end } = options;
    const itemIndex = Number(index);
    const startIndex = Number(start);
    const endIndex = Number(end);

    if (itemIndex >= 0) list.splice(itemIndex, 1);
    else if (startIndex >= 0 && endIndex >= 0) list.splice(startIndex, endIndex - startIndex + 1);
    else if (startIndex >= 0) list.splice(startIndex);
    else if (endIndex >= 0) list.splice(0, endIndex + 1);
    else list.length = 0;

    await this.set(key, JSON.stringify(list), ttl);
  }



  /**
   * Ends the connection to the Memcached server.
   */
  close() {
    this.#client.end();
  }
}

module.exports = MemcachedWrapper;
