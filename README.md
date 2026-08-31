# Wrapper for working with caching services (Memcached, Redis)

[![CI](https://github.com/yurii-bondar/cache-envelop/actions/workflows/ci.yml/badge.svg)](https://github.com/yurii-bondar/cache-envelop/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/cache-envelop.svg)](https://www.npmjs.com/package/cache-envelop)

> #### Content
> [About](#about)<br>
> [Portable core](#portable-core)<br>
> [Connection configs](#connection-configs)<br>
> [Connecting Redis](#connecting-redis)<br>
> [Connecting Memcached](#connecting-memcached)<br>
> [In-process cache](#in-process-cache)<br>
> [Memcached API reference](#memcached-api-reference)<br>
> [TypeScript](#typescript)<br>
> [Error handling](#error-handling)<br>
> [Known limitations](#known-limitations)<br>
> [Testing](#testing)<br>
> [Changelog](#changelog)

<a name="about"><h2>About</h2></a>
Services often use Memcached and Redis at the same time.
This package is a helper wrapper to make it easier to work with them.

All three wrappers — `Memcached`, `Redis` and the dependency-free in-process
[`Memory`](#in-process-cache) — implement the same [portable core](#portable-core): `get`, `set`,
`del`, `close`. Plain key/value code reads the same whichever backend is behind it.

On top of that core, the Memcached wrapper simulates data types Memcached does not have,
so hashes and lists are available there too:
```js
// portable core — identical on both backends
get(key),
set(key, data, ttl),
del(key),
close(),

// Memcached only: simulated hash and list types
hashSet(key, field, data, ttl),
hashGet(key, field),
hashDel(key, field, options),
listSet(key, data, ttl, options = {}),
listGet(key, options = {}),
listDel(key, ttl, options = {})
```
For hashes, lists and every other native structure on the Redis side, use the raw client:
`redis.client.hset(...)`. See [Known limitations](#known-limitations).

<a name="portable-core"><h2>Portable core</h2></a>

`Memcached`, `Redis` and `Memory` implement four methods with identical, test-enforced behavior:

| Method | Contract |
| --- | --- |
| `get(key)` | The stored value, or `undefined` if the key does not exist. A stored `null` comes back as `null`, so it stays distinguishable from a miss. |
| `set(key, data, ttl)` | Stores `data` for `ttl` seconds. `ttl` is **required**; `0` means no expiration. |
| `del(key)` | Resolves to `'OK'`, whether or not the key existed. |
| `close()` | Closes the connection. Awaitable on both, though only Redis actually returns a promise. |

Keys may be a `string` or a `number`. Values survive the round trip unchanged — strings, numbers,
booleans, `null`, objects and arrays all come back as they went in, on both backends.

```js
const { Memcached, Redis } = require('cache-envelop');

// The same function works with either one.
async function cacheUser(cache, user) {
  await cache.set(`user:${user.id}`, user, 3600);
  return cache.get(`user:${user.id}`);
}

await cacheUser(new Memcached('127.0.0.1:11211'), user);
await cacheUser(new Redis('127.0.0.1:6379'), user);
await cacheUser(new Memory(), user); // no server needed
```

The same validation errors are raised by both: a missing/blank key, a key that is neither a string
nor a number, `undefined` data, and a missing/non-numeric/negative `ttl`.

Two things stay backend-specific by design:

- **Key rules.** Redis and `Memory` accept almost any key; Memcached's text protocol does not
  (250 characters, no whitespace). The first two therefore enforce only the portable minimum
  unless you opt in with `strictKeys: true`.
- **Value storage.** The Redis wrapper JSON-encodes on write and decodes on read, which makes it
  the owner of the stored format: keys written by something else are readable through
  `.client`, not through `get`.

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

const redis = new Redis(config.redis);

await redis.set('user:1', { name: 'Alice' }, 3600); // portable core
await redis.client.hset('user:1:meta', 'seen', Date.now()); // native ioredis
```
- Supports all possible formats of connection options that it supports [npm package ioredis](https://www.npmjs.com/package/ioredis)
- Implements the [portable core](#portable-core): `get`, `set`, `del`, `close`
- All methods and arguments implemented in the [npm package ioredis](https://www.npmjs.com/package/ioredis)
  remain available through `.client` — the wrapper adds to ioredis, it does not hide it
- `set` sends a whole-second `ttl` as `EX` and a fractional one as `PX`, so a `ttl` of `1.5` is
  1500 ms rather than being truncated to 1 second. `ttl: 0` is sent as a plain `SET`, since
  `SET key value EX 0` is an error in Redis.
- Values are JSON-encoded on write and decoded on read, so objects survive the round trip.
  A value that JSON cannot represent (a function, a symbol, a circular structure) throws a
  descriptive error instead of being silently stored as `'[object Object]'`.
- Passing an empty/blank connection string (or `null`) throws immediately instead of silently
  falling back to `127.0.0.1:6379` — a misconfigured connection should fail loudly, not connect
  to the wrong host. Omitting the argument entirely still uses that default.
- A second, optional argument configures wrapper-level behavior:
  ```js
  const redis = new Redis(config.redis, {
    onError: (err) => logger.error('Redis connection error', err),
    strictKeys: true,
  });
  ```
  `onError` — see [Error handling](#error-handling) for why this matters.
  `strictKeys` applies Memcached's key rules (no whitespace, 250 characters max) to this client
  too. Redis itself has no such limits, so it is off by default; turn it on to catch keys that
  would not survive a switch to the Memcached backend.
- **Deprecated:** the underlying client also answers to `redis.client.close()`, which forwards to
  the wrapper's `close()`. It predates the wrapper having an API of its own and will be removed in
  the next major — call `redis.close()` instead.

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
- Implements the [portable core](#portable-core): `get`, `set`, `del`, `close` — all asynchronous
- Keys may be a `string` or a `number` and are validated against Memcached's own protocol
  constraints: at most 250 characters, and **no whitespace anywhere** (the text protocol is
  space-delimited, so the server rejects `'user 1'` itself). Empty, whitespace-containing and
  over-length keys throw a descriptive `Error` synchronously — the length is measured on the key
  as it will actually be sent, not on a whitespace-stripped copy.
- **Every method that writes a key requires a non-negative numeric `ttl`** — `set`, `hashSet`,
  `listSet`, and `hashDel`/`listDel` when they rewrite the remainder of a hash/list. Use `ttl: 0`
  for "no expiration" (standard Memcached semantics), never `undefined`: silently reusing a
  default would reset the expiration of an existing entry behind the caller's back.
- The `options` object of `listSet`/`listGet`/`listDel` is **validated, not best-effort**: unknown
  keys and negative/fractional/non-numeric positions throw. A typo such as `{ idx: 0 }` used to
  fall through to "no position given" and wipe the entire list.
- Implemented simulation of working with hashes and lists — see the
  [Memcached API reference](#memcached-api-reference) below for exact signatures and behavior.

<a name="in-process-cache"><h2>In-process cache</h2></a>

`Memory` implements the [portable core](#portable-core) with a `Map`. No server, no connection
string, **no dependencies** — so the same code you ship can run in tests and local development
without Docker:

```js
const { Memory } = require('cache-envelop');

const cache = new Memory();
await cache.set('user:1', { name: 'Alice' }, 3600);
await cache.get('user:1'); // { name: 'Alice' }
```

- **Values are copied, not shared.** They go through the same JSON encoding as the other backends
  instead of being stored by reference. That costs a copy, and it is the point: a value that
  survives here survives in production, a value JSON cannot represent fails here the same way it
  would there, and mutating the object you passed in — or the one `get` handed back — cannot reach
  into the cache.
- **Expiration is lazy.** An entry is dropped when a read finds it past its deadline; there are no
  timers to leak or to keep the event loop alive. A key written and never read again therefore
  holds its memory until eviction or `close()`.
- **`maxKeys` bounds the store** (default `0`, unbounded). Once exceeded, the least recently
  *written* entry is dropped. This is write-order eviction, not an LRU — reads do not make a key
  any safer. For a hot L1 cache that needs real LRU, use a dedicated library.
- `close()` drops every entry; there is no connection to tear down.
- `size` reports how many entries are held, including any that have expired but not yet been read.

```js
const cache = new Memory({ maxKeys: 10_000, strictKeys: true });
```

`strictKeys` applies Memcached's key rules, which is worth turning on in tests: it catches keys
that would work here but fail against a real Memcached server.

<a name="memcached-api-reference"><h2>Memcached API reference</h2></a>

| Method | Description |
| --- | --- |
| `get(key)` | Returns the raw stored value, or `undefined` if the key does not exist. |
| `set(key, data, ttl)` | Stores `data` under `key` for `ttl` seconds (`0` = no expiration). `ttl` is required. |
| `del(key)` | Deletes `key`. Always resolves to `'OK'`. |
| `hashSet(key, field, data, ttl)` | Sets/updates a single `field` in the hash stored at `key`, creating the hash if it doesn't exist yet, and rewrites it with the given `ttl` (**required**). |
| `hashGet(key, [field])` | Returns the whole hash, or a single `field`'s value. Returns `undefined` if the key (or a JSON-null hash) doesn't exist. |
| `hashDel(key, [field], [options])` | Without `field`, deletes the whole key. With `field`, removes just that field and rewrites the hash using `options.ttl` (**required** in that case — omitting it throws a validation error rather than silently corrupting the TTL). Returns `'Data not found'` if the key or field doesn't exist. |
| `listSet(key, data, ttl, [options])` | Inserts `data` into the list at `key`. `ttl` is **required**. `options.index` (a non-negative integer, `0` included) overwrites that slot; `options.push: true` appends; otherwise the default is `unshift` (prepend). Any other option key, or a negative/fractional/non-numeric `index`, throws. |
| `listGet(key, [options])` | Without options, returns the full list (or `undefined`). `options.index` returns one item; `options.start`/`options.end` (inclusive) return a slice. All three must be non-negative integers (`0` included); unknown option keys throw. |
| `listDel(key, ttl, [options])` | Without options, deletes the whole key (no `ttl` needed). With `options.index` or `options.start`/`options.end`, removes just that item/range and rewrites the list with `ttl` (**required** in that case). Unknown option keys throw instead of clearing the list. Resolves to `undefined` if the stored list is empty. |

```js
await memcached.hashSet('user:1', 'name', 'Alice', 3600);
await memcached.hashSet('user:1', 'age', 30, 3600);
await memcached.hashGet('user:1');        // { name: 'Alice', age: 30 }
await memcached.hashGet('user:1', 'age'); // 30

await memcached.listSet('queue', 'first', 3600, { push: true });
await memcached.listSet('queue', 'second', 3600, { push: true });
await memcached.listGet('queue', { index: 0 }); // 'first' — index 0 works as expected
await memcached.listGet('queue', { start: 0, end: 0 }); // ['first']

// Validated, not best-effort — these throw instead of doing something surprising:
await memcached.get('user 1');                       // key contains whitespace
await memcached.listSet('queue', 'x', 3600, { index: -1 }); // index must be >= 0
await memcached.listDel('queue', 3600, { idx: 0 });  // unknown option (used to clear the list)
await memcached.listSet('queue', 'x');               // ttl is required
```

<a name="typescript"><h2>TypeScript</h2></a>

The package ships its own declarations (`index.d.ts`), so no `@types/...` install is needed:

```ts
import { Memcached, Redis } from 'cache-envelop';

const redis = new Redis({ host: '127.0.0.1', port: 6379 });
await redis.client.get('key');           // full ioredis typings via `.client`

const memcached = new Memcached(['127.0.0.1:11211'], { retries: 5 });
await memcached.hashSet('user:1', 'name', 'Alice', 3600);
const name = await memcached.hashGet('user:1', 'name'); // unknown — narrow it yourself
```

`CacheCore` is exported for code that should not care which backend it gets:

```ts
import { CacheCore } from 'cache-envelop';

async function cacheUser(cache: CacheCore, user: User): Promise<unknown> {
  await cache.set(`user:${user.id}`, user, 3600);
  return cache.get(`user:${user.id}`);
}

await cacheUser(memcached, user); // all three compile
await cacheUser(redis, user);
await cacheUser(new Memory(), user);
```

All three classes are declared `implements CacheCore`, so they cannot drift apart without
`npm run typecheck` failing.

`npm run typecheck` compiles the declarations against a usage fixture
(`test/types/usage.ts`) in CI, so the published types cannot drift from the implementation.
The package declares `engines: { node: ">=20" }`, matching the Node versions CI tests.

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
- The wrappers are interchangeable only for the [portable core](#portable-core)
  (`get`/`set`/`del`/`close`). Beyond it they intentionally differ: `MemcachedWrapper` adds
  simulated hashes and lists, while `RedisWrapper` exposes the raw `ioredis` client rather than
  re-implementing every Redis command. Redis has native `HSET`/`LPUSH`/`LRANGE` that are atomic
  and faster than anything an emulation layer could offer, so wrapping them would trade a real
  advantage for cosmetic symmetry.
- Even inside the core, the Redis wrapper's `get`/`set` own the stored format (JSON). Reading a key
  written by another service, or by `redis.client.set(...)` directly, must go through `.client`.

<a name="testing"><h2>Testing</h2></a>

```bash
npm test               # run the suite once
npm run test:coverage  # run with a coverage report (100% lines/branches/functions/statements)
npm run lint           # eslint (airbnb-base)
npm run typecheck      # compile index.d.ts against test/types/usage.ts
```

The suite runs fully offline: `__mocks__/ioredis.js` and `__mocks__/memcached.js` are small
in-memory stand-ins for the real clients (get/set/del backed by a `Map`, plus the ability to force
the next call to fail), so no live Redis/Memcached server is required to run or contribute to the
tests. The ioredis mock also reproduces the server-side errors the wrapper has to design around —
`SET key value EX 0`, a fractional `EX`, an unknown `SET` modifier — so a test cannot pass against
the mock and fail against a real server.

`test/coreContract.test.js` runs one shared scenario against all three wrappers with
`describe.each`, which is what turns the [portable core](#portable-core) from a promise in this
README into something CI enforces. `Memory` matters most there: being a completely different
implementation, it is the one that would expose the core as a description of ioredis rather than a
real abstraction.

<a name="changelog"><h2>Changelog</h2></a>

**Unreleased — minor, additive only:**
- New `Memory` backend: an in-process, dependency-free implementation of the
  [portable core](#portable-core) for tests and local development. Values are JSON-copied rather
  than stored by reference, expiration is lazy, and `maxKeys` bounds the store by write order.
- `Redis` now implements the [portable core](#portable-core) — `get`, `set`, `del` — alongside
  `close`, with the same contracts, validation and error messages as `Memcached`. `.client` is
  untouched, so nothing that used the raw ioredis instance changes.
- `Redis#set` sends a fractional `ttl` as `PX` rather than truncating it, and `ttl: 0` as a plain
  `SET` (`EX 0` is an error in Redis). Values are JSON-encoded on write and decoded on read.
- New `Redis` option `strictKeys: true` applies Memcached's key rules to a Redis client, to catch
  keys that would not survive a backend switch.
- New exported type `CacheCore`; both classes are declared `implements CacheCore`.
- Validation moved to `src/validators.js` so both backends enforce one contract from one place.
- New `test/coreContract.test.js` runs one scenario against both backends.
- **Deprecated:** `redis.client.close()`. Call `redis.close()`; the monkey-patched alias will be
  removed in the next major.

**3.0.0 (2026-08-31) — major, contains breaking behavior changes described below:**
- `Memcached`: keys containing whitespace are now rejected up front. Memcached's text protocol is
  space-delimited and the server rejects such keys itself, so they used to fail only at runtime.
- `Memcached`: the 250-character key limit is now measured on the raw key. Whitespace was stripped
  before the check, so a 349-character key with spaces in it passed validation.
- `Memcached#listSet` / `listGet` / `listDel`: `options` is validated. Unknown keys and
  negative / fractional / non-numeric `index`/`start`/`end` now throw. Previously a typo like
  `listDel(key, ttl, { idx: 0 })` fell through to the "no options" branch and **cleared the whole
  list**, a negative `index` silently became an `unshift` in `listSet`, and `listGet` accepted a
  negative index that `listSet` rejected.
- `Memcached#listSet` / `listDel` / `hashSet`: `ttl` is validated up front and is documented as
  required, matching `set` and `hashDel`. It was already effectively required (the internal `set`
  threw), but JSDoc marked it optional and the error surfaced only after a needless cache read.
- Added TypeScript declarations (`index.d.ts`), an `engines` field (`node >= 20`), and a
  `npm run typecheck` step in CI.

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
