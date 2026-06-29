// Frictionless Stack — canonical ESLint config (TS/React side).
//
// Counterpart to .golangci.yml. Tight, opinionated, no kitchen sink.
// Linters fall into three groups:
//   1. Default bug catchers          — js.recommended + tseslint type-checked
//   2. Stack-shaped (React + Vite)   — react-hooks, react-refresh
//   3. Generated / vendored ignores  — tygo output, shadcn primitives
//
// Type-aware linting (`recommendedTypeChecked`) is on. It costs ~1s of
// ESLint startup but pays for itself: `no-floating-promises` and
// `no-misused-promises` catch un-awaited mutateAsync / unhandled fetch
// rejections, which are the most common silent bugs in a TanStack Query
// + RHF codebase. If you find yourself disabling these per-line, think
// twice before doing it.
//
// To add a rule: edit this file in the canon repo and propagate. Do not
// fork per-project. Drift starts here.

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Generated wire types (tygo) and shadcn primitives are not hand-edited
  // and shouldn't be linted. dist is the vite build output.
  globalIgnores(['dist', 'src/types/**', 'src/components/ui/**']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      // Type-checked variant of typescript-eslint's recommended set.
      // Requires parserOptions.project (see below).
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    rules: {
      // form.watch() is intentional in this codebase — React Compiler cannot
      // memoize components that use it, but correctness is unaffected.
      'react-hooks/incompatible-library': 'off',
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        // Pick up tsconfig.app.json + tsconfig.node.json automatically so
        // type-aware rules know about every file in the project.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Config files and other root-level JS aren't part of the TS project,
  // so disable type-aware rules for them to avoid project-resolution errors.
  {
    files: ['*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
])
