# Wrapper for working with caching services (Memcached, Redis)

[![CI](https://github.com/yurii-bondar/cache-envelop/actions/workflows/ci.yml/badge.svg)](https://github.com/yurii-bondar/cache-envelop/actions/workflows/ci.yml)

>#### Content
>[About](#about)
[Connection configs](#connection-configs)<br>
[Connecting Redis](#connecting-redis)
[Connecting Memcached](#connecting-memcached)
[Memcached API reference](#memcached-api-reference)
[Error handling](#error-handling)
[Known limitations](#known-limitations)
[Testing](#testing)
[Changelog](#changelog)

<a name="about"><h2>About</h2></a>
Services often use Memcached and Redis at the same time.
This package is a helper wrapper to make it easier to work with them.
It also extends the ability to work with Memcached, by simulating support for data types,
such as hash and list, available methods for them:
```js
get(key),
set(key, data, ttl),
del(key),
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
- Passing an empty/blank connection string (or `null`) throws immediately instead of silently
  falling back to `127.0.0.1:6379` — a misconfigured connection should fail loudly, not connect
  to the wrong host. Omitting the argument entirely still uses that default.
- A second, optional argument configures wrapper-level behavior:
  ```js
  const redis = new Redis(config.redis, {
    onError: (err) => logger.error('Redis connection error', err),
  });
  ```
  See [Error handling](#error-handling) for why this matters.

<a name="connecting-memcached"><h2>Connecting Memcached</h2></a>
```js
// memcachedConnect.js

const config = require('config')
const { Memcached } = require('cache-envelop');

const memcached = new Memcached(config.memcached.servers, {
  ...config.memcached.options,
  onIssue: (details) => logger.warn('Memcached connection issue', details),
});
```

- Supports all possible formats of connection options that it supports [npm package memcached](https://www.npmjs.com/package/memcached)
- Client methods are implemented as asynchronous: `get(key)`, `set(key, data, ttl)`, `del(key)`
- Keys may be a `string` or a `number`, up to 250 characters (Memcached's own limit); empty,
  whitespace-only or over-length keys throw a descriptive `Error` synchronously.
- `set(key, data, ttl)` requires a non-negative numeric `ttl`; use `ttl: 0` for "no expiration"
  (standard Memcached semantics), not `undefined`.
- Implemented simulation of working with hashes and lists — see the
  [Memcached API reference](#memcached-api-reference) below for exact signatures and behavior.

<a name="memcached-api-reference"><h2>Memcached API reference</h2></a>

| Method | Description |
| --- | --- |
| `get(key)` | Returns the raw stored value, or `undefined` if the key does not exist. |
| `set(key, data, ttl)` | Stores `data` under `key` for `ttl` seconds (`0` = no expiration). |
| `del(key)` | Deletes `key`. Always resolves to `'OK'`. |
| `hashSet(key, field, data, ttl)` | Sets/updates a single `field` in the hash stored at `key`, creating the hash if it doesn't exist yet, and rewrites it with the given `ttl`. |
| `hashGet(key, [field])` | Returns the whole hash, or a single `field`'s value. Returns `undefined` if the key (or a JSON-null hash) doesn't exist. |
| `hashDel(key, [field], [options])` | Without `field`, deletes the whole key. With `field`, removes just that field and rewrites the hash using `options.ttl` (**required** in that case — omitting it throws a validation error rather than silently corrupting the TTL). Returns `'Data not found'` if the key or field doesn't exist. |
| `listSet(key, data, ttl, [options])` | Inserts `data` into the list at `key`. `options.index` (any integer `>= 0`, including `0`) overwrites that slot; `options.push: true` appends; otherwise the default is `unshift` (prepend). |
| `listGet(key, [options])` | Without options, returns the full list (or `undefined`). `options.index` (`>= 0`) returns one item; `options.start`/`options.end` (both `>= 0`, inclusive) return a slice. `0` is a valid index/start/end and is handled correctly. |
| `listDel(key, ttl, [options])` | Without options, deletes the whole key. With `options.index`, `options.start`/`options.end`, removes just that item/range and rewrites the list with `ttl`. |

```js
await memcached.hashSet('user:1', 'name', 'Alice', 3600);
await memcached.hashSet('user:1', 'age', 30, 3600);
await memcached.hashGet('user:1');        // { name: 'Alice', age: 30 }
await memcached.hashGet('user:1', 'age'); // 30

await memcached.listSet('queue', 'first', 3600, { push: true });
await memcached.listSet('queue', 'second', 3600, { push: true });
await memcached.listGet('queue', { index: 0 }); // 'first' — index 0 works as expected
await memcached.listGet('queue', { start: 0, end: 0 }); // ['first']
```

<a name="error-handling"><h2>Error handling</h2></a>

- **Redis**: `ioredis` clients are `EventEmitter`s — an `error` event with no listener attached
  crashes the whole Node.js process with an uncaught exception. `RedisWrapper` always attaches a
  listener (a `console.error` by default) so a dropped connection degrades instead of taking the
  app down. Pass your own `onError` (see [Connecting Redis](#connecting-redis)) to route errors to
  your logger/metrics instead.
- **Memcached**: the `memcached` package does not emit an unhandled top-level `error` the way
  `ioredis` does, but it silently emits `issue` / `failure` / `reconnecting` / `remove` events that
  are easy to miss. `MemcachedWrapper` listens to all four (`console.error` by default,
  overridable via `onIssue`) so connectivity problems are visible instead of silent.
- Cache entries written by `hashSet`/`hashGet`/`hashDel`/`listSet`/`listGet`/`listDel` are JSON
  under the hood. If a value is corrupted (e.g. written by something other than this wrapper),
  these methods reject with a clear `Failed to parse cached value as JSON: ...` error instead of a
  raw `SyntaxError`.

<a name="known-limitations"><h2>Known limitations</h2></a>

- The Memcached hash/list helpers (`hashSet`, `hashDel`, `listSet`, `listDel`) are implemented as a
  read-modify-write cycle (`get` the JSON blob, mutate it, `set` it back) because plain Memcached
  has no native hash/list commands. This is **not atomic**: concurrent writers to the same key can
  race and one update can be lost. Fine for low-contention use (per-request caches, mostly-read
  data); if you need strong consistency under concurrent writers on the same key, use Redis (or a
  server-side lock) instead.
- `RedisWrapper` exposes the raw `ioredis` client (`.client`) rather than re-implementing every
  Redis command, so its API intentionally differs from `MemcachedWrapper`'s custom method set — the
  two are not drop-in replacements for each other.

<a name="testing"><h2>Testing</h2></a>

```bash
npm test            # run the suite once
npm run test:coverage  # run with a coverage report (100% lines/branches/functions/statements)
```

The suite runs fully offline: `__mocks__/ioredis.js` and `__mocks__/memcached.js` are small
in-memory stand-ins for the real clients (get/set/del backed by a `Map`, plus the ability to force
the next call to fail), so no live Redis/Memcached server is required to run or contribute to the
tests.

<a name="changelog"><h2>Changelog</h2></a>

**2.0.0 (2026-07-31) — major, contains breaking behavior changes described below:**
- `Memcached`: numeric keys (documented as supported) no longer throw a `TypeError`.
- `Memcached#set`: `ttl: 0` is now accepted (means "no expiration"); previously it was rejected the
  same as a missing ttl.
- `Memcached#listSet` / `listGet` / `listDel`: `index`/`start`/`end` of `0` are now handled
  correctly instead of being treated as "not provided".
- `Memcached#hashDel(key, field)` (without `options`) no longer throws a raw `TypeError`; it now
  throws a descriptive validation error if `options.ttl` is missing.
- `Memcached#hashGet(key, field)` on a missing key now returns `undefined` instead of throwing.
- `Redis`/`Memcached`: passing an empty/blank connection string now throws instead of silently
  connecting to `127.0.0.1`.
- `Redis`/`Memcached`: connection-level errors no longer go unhandled (see
  [Error handling](#error-handling)).

Also new in this release (non-breaking): a full Jest test suite with 100% coverage of `src/`, and
a GitHub Actions CI workflow that runs lint + the test suite on Node 20/22/24 for every push and
pull request against `main`.
