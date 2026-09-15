// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

/**
 * One flat config for the whole monorepo.
 *
 * The rule set is deliberately focused on things that cause real defects -
 * floating promises, unsafe `any` boundaries, missing hook dependencies -
 * rather than formatting. Style is not enforced here; it would only produce
 * noise that trains people to ignore lint output.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      'apps/api/prisma/migrations/**',
      'eslint.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  /* ---- shared TypeScript rules ---------------------------------------- */
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      // An unused parameter is often intentional (interface conformance);
      // an unused *variable* usually is not. `_`-prefix opts out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // `any` disables the type checker exactly where bugs hide. Warn rather
      // than error so a genuine third-party boundary is not a blocker.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Real-defect rules.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-alert': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-return-await': 'error',
      'require-atomic-updates': 'error',
    },
  },

  /* ---- backend --------------------------------------------------------- */
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'no-type-imports' }],
      // NestJS decorators legitimately produce "unused" constructor params.
      '@typescript-eslint/no-extraneous-class': 'off',
      // The seed script and bootstrap logging print to stdout on purpose.
      'no-console': 'off',
    },
  },

  /* ---- Prisma seed / scripts ------------------------------------------- */
  {
    files: ['apps/api/prisma/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  /* ---- React apps ------------------------------------------------------ */
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A missing dependency is a stale-closure bug waiting to happen.
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  /* ---- tests ----------------------------------------------------------- */
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/*.test.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
);
