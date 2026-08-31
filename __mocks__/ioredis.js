const { EventEmitter } = require('events');

/**
 * Minimal in-memory stand-in for ioredis, used by the test suite since no real
 * Redis server is available in this environment.
 *
 * It deliberately reproduces the three server-side errors the wrapper has to
 * design around, so a test cannot pass here and fail against a real server:
 *
 *   - `SET key value EX 0`   -> ERR invalid expire time in 'set' command
 *   - `SET key value EX 1.5` -> ERR value is not an integer or out of range
 *   - an unknown SET modifier -> ERR syntax error
 *
 * Expirations are recorded rather than enforced: tests assert on what was sent
 * to the server (`expirations`), which is what the wrapper is responsible for,
 * without needing fake timers.
 */
class RedisMock extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.store = new Map();
    this.expirations = new Map();
    this.forcedErrors = {};
    RedisMock.instances.push(this);
  }

  /** Makes the next call to `method` reject with `err`, once. */
  forceNextError(method, err) {
    this.forcedErrors[method] = err;
  }

  #takeForcedError(method) {
    const err = this.forcedErrors[method];
    if (!err) return null;
    this.forcedErrors[method] = null;
    return err;
  }

  /** Records the expiry a SET asked for, validating it the way Redis does. */
  #recordExpiry(key, mode, ttl) {
    if (mode === undefined) {
      this.expirations.delete(key);
      return;
    }

    const normalizedMode = String(mode).toUpperCase();
    if (normalizedMode !== 'EX' && normalizedMode !== 'PX') {
      throw new Error('ERR syntax error');
    }
    if (!Number.isInteger(ttl)) {
      throw new Error('ERR value is not an integer or out of range');
    }
    if (ttl <= 0) {
      throw new Error("ERR invalid expire time in 'set' command");
    }

    this.expirations.set(key, { mode: normalizedMode, ttl });
  }

  /** Resolves to the stored string, or `null` when the key is missing. */
  async get(key) {
    const err = this.#takeForcedError('get');
    if (err) throw err;
    return this.store.has(key) ? this.store.get(key) : null;
  }

  /** Supports `set(key, value)` and `set(key, value, 'EX' | 'PX', ttl)`. */
  async set(key, value, mode, ttl) {
    const err = this.#takeForcedError('set');
    if (err) throw err;

    this.#recordExpiry(key, mode, ttl);
    this.store.set(key, String(value));
    return 'OK';
  }

  /** Resolves to the number of keys removed, as Redis does. */
  async del(key) {
    const err = this.#takeForcedError('del');
    if (err) throw err;

    this.expirations.delete(key);
    return this.store.delete(key) ? 1 : 0;
  }

  quit(callback) {
    const err = this.#takeForcedError('quit');
    if (typeof callback === 'function') {
      callback(err || null, err ? undefined : 'OK');
      return undefined;
    }
    return err ? Promise.reject(err) : Promise.resolve('OK');
  }
}

RedisMock.instances = [];

module.exports = RedisMock;
