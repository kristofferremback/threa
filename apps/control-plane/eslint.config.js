import tsParser from "@typescript-eslint/parser"

/**
 * ESLint configuration for the control plane.
 *
 * Enforces CLAUDE invariants with clean syntactic signals:
 * - Runtime: do not import dotenv (Bun loads .env automatically)
 * - INV-47: no nested ternaries
 * - INV-51: lib/ is infrastructure — must not import from features/
 * - INV-52: Features import other features only through barrels (index.ts)
 * - INV-26 / INV-48: no skipped/todo tests and no mock.module()
 */
const sharedRestrictedImportPatterns = [
  {
    group: ["dotenv", "dotenv/config"],
    message: "Bun auto-loads .env. Do not import dotenv in this repo.",
  },
]

export default [
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    rules: {
      "no-nested-ternary": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: sharedRestrictedImportPatterns,
        },
      ],
    },
  },

  {
    files: ["src/lib/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...sharedRestrictedImportPatterns,
            {
              group: ["**/features/*", "**/features/**"],
              message:
                "lib/ is infrastructure — it must not import from features/ (INV-51). Move shared code to lib/ or invert the dependency.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["src/features/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...sharedRestrictedImportPatterns,
            {
              group: ["**/auth/**", "**/workspaces/**", "**/invitation-shadows/**"],
              message: "Import from feature barrels only (features/x/index.ts), not internals (INV-52).",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["**/*.{test,spec}.ts", "tests/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "describe",
          property: "skip",
          message: "Do not commit skipped tests (INV-26).",
        },
        {
          object: "describe",
          property: "todo",
          message: "Do not commit todo tests (INV-26).",
        },
        {
          object: "test",
          property: "skip",
          message: "Do not commit skipped tests (INV-26).",
        },
        {
          object: "test",
          property: "todo",
          message: "Do not commit todo tests (INV-26).",
        },
        {
          object: "it",
          property: "skip",
          message: "Do not commit skipped tests (INV-26).",
        },
        {
          object: "it",
          property: "todo",
          message: "Do not commit todo tests (INV-26).",
        },
        {
          object: "mock",
          property: "module",
          message: "Avoid mock.module(); prefer scoped spyOn patterns (INV-48).",
        },
      ],
    },
  },
]
