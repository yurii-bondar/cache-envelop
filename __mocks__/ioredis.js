const { EventEmitter } = require('events');

/**
 * Minimal in-memory stand-in for ioredis, used by the test suite since no
 * real Redis server is available in this environment. Only implements what
 * RedisWrapper touches directly (construction, events, quit).
 */
class RedisMock extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    RedisMock.instances.push(this);
  }

  // eslint-disable-next-line class-methods-use-this
  quit(callback) {
    if (typeof callback === 'function') {
      callback(null, 'OK');
      return undefined;
    }
    return Promise.resolve('OK');
  }
}

RedisMock.instances = [];

module.exports = RedisMock;
