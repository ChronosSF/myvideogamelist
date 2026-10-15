import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // "build" is the React Router output; ".react-router" is its generated route types.
  { ignores: ['dist', 'build', '.react-router'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // An underscore prefix marks a deliberately unused binding. Needed for arguments as well
      // as variables: a test double often has to declare a parameter it does not read, so that
      // its `mock.calls` are typed.
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
      }],

      // React Router route modules export data/config alongside the component by
      // design, so fast refresh has to treat those names as expected.
      'react-refresh/only-export-components': ['error', {
        allowExportNames: [
          'meta',
          'links',
          'headers',
          'handle',
          'loader',
          'clientLoader',
          'action',
          'clientAction',
          'middleware',
          'shouldRevalidate',
          'ErrorBoundary',
          'HydrateFallback',
          'Layout',
        ],
      }],

      // A loader's call to the API goes through `loaderFetch` from `@/lib/trace.server`, which
      // sends the render's trace. A call to `apiUrl(…)` made any other way reaches the API under a
      // trace of its own, and nothing then joins the API's log to the page that asked (ADR 0059).
      // Refused at the import rather than at the call, so that a URL kept in a variable first, or a
      // `globalThis.fetch`, is refused as well.
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@/lib/api',
          importNames: ['apiUrl'],
          message: "Call the API from a loader with loaderFetch(context, path) from @/lib/trace.server, which carries the render's traceparent.",
        }],
      }],
    },
  },
  {
    // The one module that may: `loaderFetch` itself. `apiFetch`, beside `apiUrl` in `@/lib/api`,
    // imports nothing.
    files: ['src/lib/trace.server.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
)
