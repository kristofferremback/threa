import tsParser from "@typescript-eslint/parser"
import threaPlugin, { dotenvRestrictedImportPattern } from "../../eslint/threa-plugin.js"

/**
 * ESLint config for the Threa backoffice app.
 *
 * Mirrors the main frontend's rules minus the persistence invariants: the
 * backoffice has no IndexedDB/Dexie layer, so the `@/db` restriction is
 * unnecessary. The shared no-nested-component-definitions and
 * no-nested-ternary rules stay.
 */
export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      threa: threaPlugin,
    },
    rules: {
      "no-nested-ternary": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [dotenvRestrictedImportPattern],
        },
      ],
    },
  },

  {
    files: ["src/components/**/*.{ts,tsx}", "src/pages/**/*.{ts,tsx}"],
    rules: {
      "threa/no-nested-component-definitions": "error",
      "threa/no-queryclient-getquerydata-in-render": "error",
    },
  },
]
