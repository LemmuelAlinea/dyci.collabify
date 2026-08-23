import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

/**
 * The rule that earns this file is `react-hooks/exhaustive-deps`.
 *
 * `Modal.tsx` carries a comment about a bug where a dependency read through a
 * ref was the fix for focus being stolen back on every keystroke. That is the
 * class of defect nobody finds by reading, and the one a linter finds for
 * nothing.
 *
 * Deliberately not turned on: stylistic rules. Formatting is not what this is
 * for, and a lint run that reports two hundred spacing complaints is a lint run
 * everybody learns to ignore.
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'docs/*.html'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      /**
       * Off, with a reason.
       *
       * This fires 56 times, every one of them on the same line:
       * `useEffect(() => { void load() }, [load])`. `load` sets a loading flag
       * before it awaits, so the rule sees a synchronous setState in an effect.
       *
       * It is not wrong that this causes an extra render. It is wrong that
       * silencing it means rewriting how all thirty-odd pages fetch their data,
       * which is a change with real regression risk and no user-visible gain.
       * Turning the rule off deliberately is more honest than leaving 56 errors
       * that teach everyone to ignore the output.
       */
      'react-hooks/set-state-in-effect': 'off',

      /**
       * Warnings, not errors. Both fire on reading the clock during render —
       * `new Date(due).getTime() < Date.now()` to decide whether a chip shows
       * as overdue. Strictly impure, and correct for the purpose: moving it to
       * state would freeze the answer at mount, which is worse than the
       * impurity. Kept visible so a genuinely new one is noticed.
       */
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',

      // An unused name is usually a leftover from an edit that was not
      // finished. Underscore-prefixed is the way to say "on purpose".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // Node scripts, not browser code: they legitimately use process and console.
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
)
