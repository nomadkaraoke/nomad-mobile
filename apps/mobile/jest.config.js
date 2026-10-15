module.exports = {
  preset: 'jest-expo/ios',
  displayName: 'mobile',
  setupFiles: ['../../packages/ui/jest.setup.js', '<rootDir>/jest.setup.js'],
  // Uniwind compiles global.css in Metro; jest just needs the import to resolve.
  moduleNameMapper: { '\\.css$': '<rootDir>/src/test-utils/styleStub.js' },
  ...require('../../jest.shared'),
};
