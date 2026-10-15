module.exports = {
  projects: [
    '<rootDir>/packages/core',
    '<rootDir>/packages/i18n',
    '<rootDir>/packages/api-gen',
    '<rootDir>/packages/api-decide',
    '<rootDir>/packages/ui',
    '<rootDir>/apps/mobile',
  ],
  coverageThreshold: { global: { lines: 70, branches: 60, functions: 70, statements: 70 } },
  collectCoverageFrom: ['packages/*/src/**/*.{ts,tsx}', '!**/src/client/**', '!**/index.ts', '!**/__tests__/**'],
};
