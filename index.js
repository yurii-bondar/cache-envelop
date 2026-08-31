const MemcachedWrapper = require('./src/Memcached');
const RedisWrapper = require('./src/Redis');
const MemoryWrapper = require('./src/Memory');

module.exports = {
  Memcached: MemcachedWrapper,
  Redis: RedisWrapper,
  Memory: MemoryWrapper,
};
