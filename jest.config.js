module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js'],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
};
