module.exports = {
  projects: ['<rootDir>/packages/*', '<rootDir>/apps/*'],
  coverageThreshold: { global: { lines: 70, branches: 60, functions: 70, statements: 70 } },
  collectCoverageFrom: ['packages/*/src/**/*.{ts,tsx}', '!**/src/client/**', '!**/index.ts', '!**/__tests__/**', '!**/*.d.ts'],
};
