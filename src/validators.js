/**
 * Validation helpers shared by the cache wrappers.
 *
 * They live outside the wrapper classes so both backends enforce one contract
 * from one place: a key or ttl accepted by `Memcached` must mean the same thing
 * to `Redis`, and a rule can only be changed in one spot.
 */

/** Memcached's own key-length limit, in characters. */
const MAX_KEY_LENGTH = 250;

const TTL_ERROR = 'The ttl must be a non-negative number of seconds (0 means no expiration)';

/**
 * The portable minimum every backend agrees on: a key must be present and must
 * be a string or a number. Backend-specific limits are layered on top of this
 * by {@link checkKey}.
 * @param {string | number} key
 * @returns {string} The key as it will be sent to the server.
 * @throws {Error} If the key is missing, blank, or of an unsupported type.
 */
function checkKeyBasics(key) {
  if (key === undefined || key === null) throw new Error('The key cannot be empty');
  if (typeof key !== 'string' && typeof key !== 'number') {
    throw new Error('The key must be a string or a number');
  }

  const stringKey = String(key);
  if (!stringKey.trim()) throw new Error('The key cannot be empty');

  return stringKey;
}

/**
 * Validates a key against Memcached's protocol constraints: at most
 * {@link MAX_KEY_LENGTH} characters, and no whitespace anywhere (the text
 * protocol is space-delimited, so the server rejects such keys itself). Both
 * checks run against the key as it will actually be sent, so a key that passes
 * here is a key the server will accept.
 * @param {string | number} key
 * @returns {string} The key as it will be sent to the server.
 * @throws {Error} If the key is invalid.
 */
function checkKey(key) {
  const stringKey = checkKeyBasics(key);

  if (/\s/.test(stringKey)) {
    throw new Error('The key must not contain whitespace characters');
  }
  if (stringKey.length > MAX_KEY_LENGTH) {
    throw new Error(`The key must not exceed ${MAX_KEY_LENGTH} characters`);
  }

  return stringKey;
}

/**
 * Validates a TTL and returns it as a number. Every method that writes a key
 * requires one: silently reusing a default would reset the expiration of an
 * existing entry without the caller noticing.
 * @param {number} ttl
 * @returns {number}
 * @throws {Error} If the ttl is missing, not a number, or negative.
 */
function checkTtl(ttl) {
  const numericTtl = Number(ttl);
  if (ttl === undefined || Number.isNaN(numericTtl) || numericTtl < 0) {
    throw new Error(TTL_ERROR);
  }
  return numericTtl;
}

/**
 * Encodes a value for storage. Backends that persist strings need this, and
 * running every backend through the same encoder is what makes a value survive
 * the round trip identically no matter which one is behind the wrapper.
 * @param {any} data
 * @returns {string}
 * @throws {Error} If the value is undefined or JSON cannot represent it.
 */
function stringifyForCache(data) {
  if (data === undefined) throw new Error('The data to cache cannot be undefined');

  let serialized;
  try {
    serialized = JSON.stringify(data);
  } catch (err) {
    throw new Error(`Failed to serialize the value as JSON: ${err.message}`);
  }

  // JSON.stringify returns undefined for functions and symbols.
  if (serialized === undefined) throw new Error('The data to cache must be JSON-serializable');

  return serialized;
}

/**
 * Parses a JSON string previously stored by a wrapper, raising a clear error
 * instead of letting a corrupted cache entry throw a cryptic SyntaxError deep
 * inside a hash/list operation.
 * @param {string} value
 * @returns {any}
 * @throws {Error} If the value is not valid JSON.
 */
function parseStored(value) {
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`Failed to parse cached value as JSON: ${err.message}`);
  }
}

module.exports = {
  MAX_KEY_LENGTH,
  TTL_ERROR,
  checkKeyBasics,
  checkKey,
  checkTtl,
  stringifyForCache,
  parseStored,
};
