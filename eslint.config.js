// Lint doubles as an architecture guard: module-boundary and determinism rules from master
// Sections 13.2 and 14.3 are enforced here rather than left to prose.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const browserOnlyImports = ['three', 'three/*', 'react', 'react-dom', 'react-dom/*'];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', '.toolchain/**', 'test-results/**', 'playwright-report/**', 'artifacts/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.app.json', './tsconfig.node.json'], tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['error', 'warn'] }],
    },
  },
  {
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.flat['recommended-latest'].rules,
  },
  {
    files: ['tools/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  {
    // Authoritative simulation: pure, deterministic, renderer/DOM-free (Sections 13.2, 14.3).
    files: ['src/sim/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: browserOnlyImports, message: 'Simulation must not depend on rendering or UI libraries.' },
          { group: ['**/render/**', '**/ui/**', '**/app/**', '**/audio/**', '**/persistence/**'], message: 'Simulation must not import presentation or I/O modules.' },
        ],
      }],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'Use the named CG-XOR32-v1 stream (Section 16.7).' },
        { object: 'Date', property: 'now', message: 'Wall-clock time must not affect simulation.' },
        { object: 'performance', property: 'now', message: 'Wall-clock time must not affect simulation.' },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'requestAnimationFrame', 'setTimeout', 'setInterval'],
      'no-restricted-syntax': ['error', { selector: 'NewExpression[callee.name="Date"]', message: 'Wall-clock time must not affect simulation.' }],
    },
  },
  {
    // Rendering is a presentation consumer; it never owns UI or game rules.
    files: ['src/render/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/ui/**', 'react', 'react-dom'], message: 'Renderer must not depend on UI components.' }] }],
    },
  },
);
