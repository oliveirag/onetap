module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/../shared/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
