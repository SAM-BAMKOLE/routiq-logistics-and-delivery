export default {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { useESM: true }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  // Point the app under test at a throwaway PostGIS container.
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e/global-teardown.ts',
  // Workers cannot inherit globalSetup's env; setup-env reads the handoff file.
  setupFiles: ['<rootDir>/test/e2e/setup-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/e2e/setup-database.ts'],
  testTimeout: 120000,
  maxWorkers: 1,
};