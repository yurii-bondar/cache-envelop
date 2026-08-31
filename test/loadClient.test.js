const loadClient = require('../src/loadClient');

describe('loadClient', () => {
  test('returns the module when it is installed', () => {
    expect(loadClient('util', 'SomeWrapper')).toBe(require('util')); // eslint-disable-line global-require
  });

  test('explains which package to install when it is missing', () => {
    expect(() => loadClient('not-an-installed-package', 'RedisWrapper')).toThrow(
      'cache-envelop: RedisWrapper requires the "not-an-installed-package" package, '
      + 'which is not installed. Install it with `npm install not-an-installed-package`.',
    );
  });

  test('names the wrapper that asked, so the message points at the right install', () => {
    expect(() => loadClient('also-missing', 'MemcachedWrapper')).toThrow(
      /MemcachedWrapper requires the "also-missing" package/,
    );
  });
});
