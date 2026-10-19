module.exports = {
  projects: ['<rootDir>/packages/*', '<rootDir>/apps/*'],
  coverageThreshold: { global: { lines: 70, branches: 60, functions: 70, statements: 70 } },
  collectCoverageFrom: ['packages/*/src/**/*.{ts,tsx}', 'apps/mobile/src/**/*.{ts,tsx}', '!apps/mobile/src/test-utils/**', '!**/src/client/**', '!**/src/search-client/**', '!**/index.ts', '!**/__tests__/**', '!**/*.d.ts'],
};
