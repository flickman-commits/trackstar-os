import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // server/lib/cronJobs.js: ESLint 8's parser cannot read an import attribute
  // (`import x from '../../vercel.json' with { type: 'json' }`), which Node
  // runs fine. Lint it again once ESLint is on version 9.
  { ignores: ['dist', 'server/lib/cronJobs.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // Server, API, scripts and the render worker: plain JavaScript that nothing
  // type-checks. Only the rules that catch a crash waiting in a branch nobody
  // has run yet (an undefined name, a duplicate key, dead code after a
  // return), not style. Run by `npm run lint:server` and the build.
  {
    files: ['server/**/*.{js,mjs}', 'api/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', 'worker/**/*.{js,mjs}', 'middleware.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.builtin, ...globals.node },
    },
    rules: {
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
    },
  },
)
