const MemoryWrapper = require('../src/Memory');

describe('MemoryWrapper', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('options', () => {
    test('needs no arguments at all', async () => {
      const cache = new MemoryWrapper();
      await cache.set('k', 'v', 60);
      await expect(cache.get('k')).resolves.toBe('v');
    });

    test('tolerates a null options argument', () => {
      expect(() => new MemoryWrapper(null)).not.toThrow();
    });

    test.each([
      ['a negative maxKeys', -1],
      ['a fractional maxKeys', 1.5],
      ['a non-numeric maxKeys', 'lots'],
    ])('rejects %s', (_label, maxKeys) => {
      expect(() => new MemoryWrapper({ maxKeys })).toThrow(
        'The maxKeys option must be a non-negative integer (0 means unbounded)',
      );
    });
  });

  describe('expiration', () => {
    test('drops an entry once its ttl has passed', async () => {
      jest.useFakeTimers();
      const cache = new MemoryWrapper();

      await cache.set('k', 'v', 60);
      await expect(cache.get('k')).resolves.toBe('v');

      jest.advanceTimersByTime(59_000);
      await expect(cache.get('k')).resolves.toBe('v');

      jest.advanceTimersByTime(1_001);
      await expect(cache.get('k')).resolves.toBeUndefined();
    });

    test('honours a fractional ttl in milliseconds', async () => {
      jest.useFakeTimers();
      const cache = new MemoryWrapper();

      await cache.set('k', 'v', 1.5);

      jest.advanceTimersByTime(1_400);
      await expect(cache.get('k')).resolves.toBe('v');

      jest.advanceTimersByTime(200);
      await expect(cache.get('k')).resolves.toBeUndefined();
    });

    test('keeps a ttl=0 entry indefinitely', async () => {
      jest.useFakeTimers();
      const cache = new MemoryWrapper();

      await cache.set('k', 'v', 0);

      jest.advanceTimersByTime(10 * 365 * 24 * 3_600_000);
      await expect(cache.get('k')).resolves.toBe('v');
    });

    test('reclaims the slot of an expired entry when it is read', async () => {
      jest.useFakeTimers();
      const cache = new MemoryWrapper();

      await cache.set('k', 'v', 1);
      expect(cache.size).toBe(1);

      jest.advanceTimersByTime(2_000);
      await cache.get('k');
      expect(cache.size).toBe(0);
    });
  });

  describe('maxKeys', () => {
    test('is unbounded by default', async () => {
      const cache = new MemoryWrapper();

      await Promise.all([...Array(50).keys()].map((i) => cache.set(`k${i}`, i, 60)));

      expect(cache.size).toBe(50);
    });

    test('drops the oldest write once the bound is exceeded', async () => {
      const cache = new MemoryWrapper({ maxKeys: 2 });

      await cache.set('a', 1, 60);
      await cache.set('b', 2, 60);
      await cache.set('c', 3, 60);

      expect(cache.size).toBe(2);
      await expect(cache.get('a')).resolves.toBeUndefined();
      await expect(cache.get('b')).resolves.toBe(2);
      await expect(cache.get('c')).resolves.toBe(3);
    });

    test('rewriting a key makes it the newest, not the oldest', async () => {
      const cache = new MemoryWrapper({ maxKeys: 2 });

      await cache.set('a', 1, 60);
      await cache.set('b', 2, 60);
      await cache.set('a', 'rewritten', 60);
      await cache.set('c', 3, 60);

      await expect(cache.get('a')).resolves.toBe('rewritten');
      await expect(cache.get('b')).resolves.toBeUndefined();
    });

    test('reading a key does not protect it — eviction is by write order, not LRU', async () => {
      const cache = new MemoryWrapper({ maxKeys: 2 });

      await cache.set('a', 1, 60);
      await cache.set('b', 2, 60);
      await cache.get('a');
      await cache.set('c', 3, 60);

      await expect(cache.get('a')).resolves.toBeUndefined();
    });
  });

  describe('isolation from the caller', () => {
    test('mutating a stored object does not change what is cached', async () => {
      const cache = new MemoryWrapper();
      const user = { name: 'Alice', tags: ['a'] };

      await cache.set('user', user, 60);
      user.name = 'Mallory';
      user.tags.push('b');

      await expect(cache.get('user')).resolves.toEqual({ name: 'Alice', tags: ['a'] });
    });

    test('mutating what get returned does not change what is cached', async () => {
      const cache = new MemoryWrapper();
      await cache.set('user', { name: 'Alice' }, 60);

      const first = await cache.get('user');
      first.name = 'Mallory';

      await expect(cache.get('user')).resolves.toEqual({ name: 'Alice' });
    });
  });

  describe('key validation', () => {
    test('enforces only the portable minimum by default', async () => {
      const cache = new MemoryWrapper();
      await expect(cache.get('user 1')).resolves.toBeUndefined();
      await expect(cache.get('a'.repeat(300))).resolves.toBeUndefined();
    });

    test('strictKeys opts in to the Memcached key rules', async () => {
      const cache = new MemoryWrapper({ strictKeys: true });

      await expect(cache.get('user 1')).rejects.toThrow(
        'The key must not contain whitespace characters',
      );
      await expect(cache.get('user:1')).resolves.toBeUndefined();
    });
  });

  describe('close', () => {
    test('drops every entry', async () => {
      const cache = new MemoryWrapper();
      await cache.set('k', 'v', 60);

      cache.close();

      expect(cache.size).toBe(0);
      await expect(cache.get('k')).resolves.toBeUndefined();
    });
  });
});
