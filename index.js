/**
 * The Memcached and Redis client packages are optional peer dependencies, loaded
 * only when their wrapper is constructed. Requiring this module therefore pulls
 * in neither, and the dependency-free `Memory` backend works with neither
 * installed.
 */
const MemcachedWrapper = require('./src/Memcached');
const RedisWrapper = require('./src/Redis');
const MemoryWrapper = require('./src/Memory');

module.exports = {
  Memcached: MemcachedWrapper,
  Redis: RedisWrapper,
  Memory: MemoryWrapper,
};
