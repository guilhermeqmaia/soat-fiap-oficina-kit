// Mesmo gate da aplicacao (80% em todas as dimensoes). `testing/`, `test-utils/`
// e os barrels nao sao codigo de producao.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  setupFiles: ['<rootDir>/test-utils/jest-setup-env.ts'],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/index.ts',
    '!**/*.module.ts',
    '!**/testing/**',
    '!**/test-utils/**',
    '!**/*.spec.ts',
  ],
  coverageDirectory: '../coverage',
  coverageThreshold: { global: { lines: 80, functions: 80, branches: 80, statements: 80 } },
};
