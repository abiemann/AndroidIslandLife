import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['scene/vendor/**', 'scene/node_modules/**', 'scene/test-results/**'] },
  {
    files: ['scene/src/**/*.js', 'scene/tests/**/*.{js,mjs}', 'scene/*.js', 'scripts/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
