const Redis = require('ioredis');

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

class RedisWrapper {
  #client = null;

  #connectionArgs = '127.0.0.1:6379';

  /**
   * @constructor
   * @param {string | Object} connectionArgs - Redis connection string or ioredis options object.
   * @param {Object} [options] - Wrapper-level options.
   * @param {Function} [options.onError] - Called with the error whenever the client emits 'error'.
   */
  constructor(connectionArgs, options = {}) {
    this.connectionArgs = connectionArgs;
    this.#client = new Redis(this.connectionArgs);
    this.#client.close = this.close.bind(this);
    this.#client.on('error', options.onError || defaultErrorHandler);
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

  close(callback) {
    return this.client.quit(callback);
  }
}

module.exports = RedisWrapper;
