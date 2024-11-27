# Wrapper for working with caching services (Memcached, Redis)

>#### Content
>[About](#about)   
[Connection configs](#connection-configs)<br>
[Connecting Redis](#connecting-redis)     
[Connecting Memcached](#connecting-memcached)

<a name="about"><h2>About</h2></a>
Services often use Memcached and Redis at the same time. 
This package is a helper wrapper to make it easier to work with them. 
It also extends the ability to work with Memcached, by simulating support for data types,
such as hash and list, available methods for them:
```js
hashSet(key, field, data, ttl),
hashGet(key, field), 
hashDel(key, field, options), 
listSet(key, data, ttl, options = {}),
listGet(key, options = {}),
listDel(key, ttl, options = {})
```

<a name="connection-configs"><h2>Connection configs</h2></a>
```js
// config/default.js

module.exports = {
    redis: {
        port: 6379,
        host: "127.0.0.1",
        username: "redisUser",
        password: "redis$password",
        db: 0, // Defaults to 0
    },
    memcached: {
        servers: [ '127.0.0.1:11211', '127.0.0.1:11212', '127.0.0.1:11213' ],
        options: {
            retries: 5,
            retry: 5000,
            remove:true,
            failOverServers:['127.0.0.1:11214', '127.0.0.1:11215']
        }
    }
};
```

<a name="connecting-redis"><h2>Connecting Redis</h2></a>
```js
// redisConnect.js

const config = require('config')
const { Redis } = require('cache-envelop');

const redis = new Redis(config.redis).client;
```
- Supports all possible formats of connection options that it supports [npm package ioredis](https://www.npmjs.com/package/ioredis)
- All methods and arguments implemented in the [npm package ioredis](https://www.npmjs.com/package/ioredis) are available

<a name="connecting-memcached"><h2>Connecting Memcached</h2></a>
```js
// memcachedConnect.js

const config = require('config')
const { Memcached } = require('cache-envelop');

const memcached =  new Memcached(config.memcached);
```

- Supports all possible formats of connection options that it supports [npm package memcached](https://www.npmjs.com/package/memcached)
- Client methods are implemented as asynchronous:
  - get(key)
  - set(key, data, ttl)
  - del(key)
- Implemented simulation of working with hashes and lists:
  - hashSet(key, field, data, ttl) — sets or updates a field in a hash stored in Memcached
  - hashGet(key, field) — retrieves the entire hash or a specific field from a hash stored in Memcached
  - hashDel(key, field, options) — deletes a specific field from a hash or the entire hash if no field is specified
  - listSet(key, data, ttl, options = {}) — updates a list stored in a cache key by applying actions such as 'push' or 'unshift',
    or updating a specific index
  - listGet(key, options = {}) — retrieves a list from memcached and optionally allows slicing or retrieving specific indices
  - listDel(key, ttl, options = {}) — deletes items from a list stored in the cache based on the given options
