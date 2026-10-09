module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dist-renderer/'],
  moduleNameMapper: {
    '^@wokwi/elements$': '<rootDir>/test/stubs/empty.js',
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
