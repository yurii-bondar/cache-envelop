import IORedis, { RedisOptions } from 'ioredis';

/**
 * Keys accepted by the Memcached wrapper. Numbers are stringified before being
 * sent; both forms are validated against Memcached's own 250-byte, no-whitespace
 * key constraints.
 */
export type CacheKey = string | number;

/** Wrapper-level options for {@link Redis}. */
export interface RedisWrapperOptions {
  /**
   * Called with the error whenever the underlying ioredis client emits 'error'.
   * A default `console.error` handler is attached when this is omitted, so a
   * dropped connection never crashes the process with an unhandled 'error' event.
   */
  onError?: (err: Error) => void;
}

/**
 * Thin wrapper around an `ioredis` client that guarantees an 'error' listener is
 * attached. The full ioredis API is reachable through {@link Redis.client}.
 */
export class Redis {
  /**
   * @param connectionArgs Connection string or ioredis options. Omit for
   *   `127.0.0.1:6379`; an empty or whitespace-only string throws.
   */
  constructor(connectionArgs?: string | RedisOptions, options?: RedisWrapperOptions);

  /** The connection arguments the client was created with. */
  readonly connectionArgs: string | RedisOptions;

  /** The underlying ioredis client. */
  readonly client: IORedis;

  /** Gracefully closes the connection (`QUIT`). */
  close(callback?: (err: Error | null, res: 'OK') => void): Promise<'OK'>;
}

/**
 * Minimal structural type for the underlying `memcached` client. The `memcached`
 * package ships no type declarations of its own; install `@types/memcached` if
 * you need the full surface.
 */
export interface MemcachedClientOptions {
  [option: string]: unknown;
}

/** Constructor options for {@link Memcached}. */
export interface MemcachedWrapperOptions extends MemcachedClientOptions {
  /**
   * Called on the client's 'issue' / 'failure' / 'reconnecting' / 'remove'
   * events. Defaults to a `console.error` handler so connectivity problems are
   * never silent. Not forwarded to the underlying memcached client.
   */
  onIssue?: (details: unknown) => void;
}

/** Options for {@link Memcached.hashDel}. */
export interface HashDelOptions {
  /**
   * TTL in seconds to re-apply when rewriting the hash. Required whenever
   * `field` is given, since removing a field rewrites the whole key.
   */
  ttl?: number;
}

/** Options for {@link Memcached.listSet}. */
export interface ListSetOptions {
  /** Index to overwrite. Must be a non-negative integer. */
  index?: number | string;
  /** Append instead of the default prepend (`unshift`). */
  push?: boolean;
}

/** Options for {@link Memcached.listGet} and {@link Memcached.listDel}. */
export interface ListRangeOptions {
  /** Single index to read/remove. Must be a non-negative integer. */
  index?: number | string;
  /** Start of the range, inclusive. Must be a non-negative integer. */
  start?: number | string;
  /** End of the range, inclusive. Must be a non-negative integer. */
  end?: number | string;
}

/**
 * Promise-based wrapper around a `memcached` client, adding simulated hash and
 * list data types on top of plain get/set/del.
 *
 * The hash and list helpers are a read-modify-write cycle over a JSON blob and
 * are therefore **not atomic**; concurrent writers to the same key can lose an
 * update.
 */
export class Memcached {
  /**
   * @param connectionArgs Server string, array of servers, or a server/weight
   *   map. Omit for `127.0.0.1:11211`; an empty or whitespace-only string throws.
   */
  constructor(
    connectionArgs?: string | string[] | Record<string, number>,
    options?: MemcachedWrapperOptions | null,
  );

  /** The connection arguments the client was created with. */
  readonly connectionArgs: string | string[] | Record<string, number>;

  /** The resolved memcached client options (defaults merged with the overrides). */
  readonly options: MemcachedClientOptions;

  /** Promisified `get` on the underlying client. */
  getAsync(key: CacheKey): Promise<unknown>;

  /** Promisified `set` on the underlying client. */
  setAsync(key: CacheKey, data: unknown, ttl: number): Promise<boolean>;

  /** Promisified `del` on the underlying client. */
  delAsync(key: CacheKey): Promise<boolean>;

  /** Reads a raw value, or `undefined` when the key does not exist. */
  get(key: CacheKey): Promise<unknown>;

  /** Stores `data` for `ttl` seconds. `ttl` is required; `0` means no expiration. */
  set(key: CacheKey, data: unknown, ttl: number): Promise<boolean>;

  /** Deletes a key. Always resolves to `'OK'`. */
  del(key: CacheKey): Promise<'OK'>;

  /** Sets one field of the hash at `key`, rewriting the key with `ttl` (required). */
  hashSet(key: CacheKey, field: string, data: unknown, ttl: number): Promise<void>;

  /** Reads the whole hash, or one field. `undefined` when the key does not exist. */
  hashGet(key: CacheKey, field?: string): Promise<unknown>;

  /**
   * Without `field`, deletes the whole key. With `field`, removes that field and
   * rewrites the hash using `options.ttl` (required in that case).
   */
  hashDel(
    key: CacheKey,
    field?: string,
    options?: HashDelOptions | null,
  ): Promise<'OK' | 'Data not found'>;

  /**
   * Inserts `data` into the list at `key`: `options.index` overwrites that slot,
   * `options.push` appends, otherwise it prepends. `ttl` is required.
   */
  listSet(
    key: CacheKey,
    data: unknown,
    ttl: number,
    options?: ListSetOptions | null,
  ): Promise<boolean>;

  /**
   * Returns the full list, a single item (`options.index`) or an inclusive slice
   * (`options.start`/`options.end`). `undefined` when the key does not exist.
   */
  listGet(key: CacheKey, options?: ListRangeOptions | null): Promise<unknown>;

  /**
   * Without options, deletes the whole key. With options, removes the selected
   * item/range and rewrites the list with `ttl` (required in that case).
   * Resolves to `undefined` when the stored list is empty.
   */
  listDel(
    key: CacheKey,
    ttl?: number,
    options?: ListRangeOptions | null,
  ): Promise<'OK' | boolean | undefined>;

  /** Ends the connection to the Memcached server(s). */
  close(): void;
}
