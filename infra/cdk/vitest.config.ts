import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['lambda/**/*.test.ts', 'lib/**/*.test.ts'],
    environment: 'node',
  },
});
