/**
 * Compile-time smoke test for `index.d.ts`. It is never executed — `npm run
 * typecheck` fails the build if the published declarations stop matching the
 * documented API, which keeps the types from silently rotting.
 */
import { CacheCore, Memcached, Memory, Redis } from '../../index';

const redis = new Redis({ host: '127.0.0.1', port: 6379 }, {
  onError: (err: Error) => err.message,
});
const redisFromString = new Redis('127.0.0.1:6379', { strictKeys: true });
const redisDefault = new Redis();

void redis.client.get('key');
void redis.close();
void redisFromString.connectionArgs;
void redisDefault.client;

const memcached = new Memcached(['127.0.0.1:11211'], {
  retries: 5,
  onIssue: (details: unknown) => details,
});

async function exercise(): Promise<void> {
  await memcached.set('key', 'value', 60);
  await memcached.set(42, { nested: true }, 0);
  const raw: unknown = await memcached.get('key');
  void raw;

  const deleted: 'OK' = await memcached.del('key');
  void deleted;

  await memcached.hashSet('user:1', 'name', 'Alice', 3600);
  void (await memcached.hashGet('user:1'));
  void (await memcached.hashGet('user:1', 'name'));
  void (await memcached.hashDel('user:1'));
  void (await memcached.hashDel('user:1', 'name', { ttl: 3600 }));

  await memcached.listSet('queue', 'first', 3600, { push: true });
  await memcached.listSet('queue', 'replaced', 3600, { index: 0 });
  void (await memcached.listGet('queue'));
  void (await memcached.listGet('queue', { start: 0, end: 1 }));
  void (await memcached.listDel('queue'));
  void (await memcached.listDel('queue', 3600, { index: 0 }));

  memcached.close();
}

/**
 * The point of the portable core: one function, either backend. If the two
 * classes ever drift apart, this stops compiling.
 */
async function useAnyCache(cache: CacheCore): Promise<void> {
  await cache.set('key', { any: 'value' }, 60);
  await cache.set(42, 'by-number', 0);

  const value: unknown = await cache.get('key');
  void value;

  const removed: 'OK' = await cache.del('key');
  void removed;

  await cache.close();
}

const memory = new Memory();
const boundedMemory = new Memory({ maxKeys: 500, strictKeys: true });
void boundedMemory.size;

void useAnyCache(memcached);
void useAnyCache(memory);
void useAnyCache(boundedMemory);
void useAnyCache(redis);
void useAnyCache(redisFromString);

void exercise;
