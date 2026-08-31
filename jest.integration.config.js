module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/integration/**/*.test.js'],

  // Real sockets are slower than a Map, and a wrong ttl should fail loudly
  // rather than hang.
  testTimeout: 15000,

  // The suite drives one connection per backend and closes each in afterAll,
  // but the client libraries keep pooled sockets and retry timers alive past
  // that, so Jest would sit waiting for an event loop that never drains. The
  // assertions have all run by then; only the exit is forced.
  forceExit: true,
};
