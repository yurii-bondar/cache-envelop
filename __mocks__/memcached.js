const { EventEmitter } = require('events');

/**
 * Minimal in-memory stand-in for the `memcached` package, used by the test
 * suite since no real Memcached server is available in this environment.
 * Implements get/set/del with the same (err, data) callback signature as
 * the real client, plus a way to force the next call to fail so error
 * paths in the wrapper can be exercised.
 */
class MemcachedMock extends EventEmitter {
  constructor(servers, options) {
    super();
    this.servers = servers;
    this.options = options;
    this.store = new Map();
    this.forcedErrors = {};
    MemcachedMock.instances.push(this);
  }

  forceNextError(method, err) {
    this.forcedErrors[method] = err;
  }

  get(key, callback) {
    const err = this.forcedErrors.get;
    if (err) {
      this.forcedErrors.get = null;
      setImmediate(() => callback(err));
      return;
    }
    const value = this.store.has(key) ? this.store.get(key) : undefined;
    setImmediate(() => callback(null, value));
  }

  set(key, value, ttl, callback) {
    const err = this.forcedErrors.set;
    if (err) {
      this.forcedErrors.set = null;
      setImmediate(() => callback(err));
      return;
    }
    this.store.set(key, value);
    setImmediate(() => callback(null, true));
  }

  del(key, callback) {
    const err = this.forcedErrors.del;
    if (err) {
      this.forcedErrors.del = null;
      setImmediate(() => callback(err));
      return;
    }
    this.store.delete(key);
    setImmediate(() => callback(null, true));
  }

  // eslint-disable-next-line class-methods-use-this
  end() {}
}

MemcachedMock.instances = [];

module.exports = MemcachedMock;
