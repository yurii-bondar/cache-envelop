const MemcachedWrapper = require('./src/Memcached');
const RedisWrapper = require('./src/Redis');

module.exports = {
  Memcached: MemcachedWrapper,
  Redis: RedisWrapper,
};
