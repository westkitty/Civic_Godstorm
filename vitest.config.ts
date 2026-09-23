import { defineConfig } from 'vitest/config';

// Two projects keep suite ownership explicit. `sim` is empty until M01 adds the kernel; vitest then
// exits nonzero ("No test files found"), which is the honest result for an unimplemented gate.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/tools/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'sim',
          include: ['tests/sim/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
