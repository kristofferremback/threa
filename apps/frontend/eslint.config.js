import tsParser from "@typescript-eslint/parser"

/**
 * ESLint configuration for Threa frontend.
 *
 * Primary purpose: Enforce architectural boundaries (INV-15: Dumb Components).
 *
 * Components should handle UI rendering and local state only. They receive
 * capabilities via props/context and call them without knowing implementation.
 * This keeps components testable, reusable, and decoupled from persistence.
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
  },

  // INV-15: Components must not access database or persistence layer directly.
  // They receive capabilities (sendMessage, rename, etc.) via props or context.
  {
    files: ["src/components/**/*.{ts,tsx}", "src/pages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/db", "@/db/*"],
              message: "Components must not import database directly (INV-15). Use hooks or context to access data.",
            },
          ],
        },
      ],
    },
  },
]
