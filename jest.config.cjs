module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dist-renderer/'],
  moduleNameMapper: {
    '^@wokwi/elements$': '<rootDir>/test/stubs/empty.js',
    // Single files (the LCD font) from the CommonJS build Jest can load.
    '^@wokwi/elements/dist/esm/(.*)$': '<rootDir>/node_modules/@wokwi/elements/dist/cjs/$1',
    '^\\.\\./elements/index\\.js$': '<rootDir>/test/stubs/empty.js'
  },
  collectCoverageFrom: [
    'src/main/**/*.js',
    'src/renderer/simulation/**/*.js',
    '!src/main/main.js',
    '!src/renderer/simulation/index.js',
    '!src/renderer/simulation/canvas.js'
  ],
  coverageDirectory: 'coverage',
  verbose: true
};
