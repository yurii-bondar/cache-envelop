const Redis = require('ioredis');

class RedisWrapper {
  #client = null;

  #connectionArgs = '127.0.0.1:6379';

  constructor(connectionArgs) {
    this.connectionArgs = connectionArgs;
    this.#client = new Redis(this.connectionArgs);
    this.#client.close = this.close.bind(this);
  }

  /**
   * @property {Object} options - Redis client connection args.
   */
  set connectionArgs(value) {
    if (value) this.#connectionArgs = value;
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
