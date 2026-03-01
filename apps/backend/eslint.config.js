import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import threaPlugin from "../../eslint/threa-plugin.js"

/**
 * ESLint configuration for Threa backend.
 *
 * Enforces CLAUDE invariants with clean syntactic signals:
 * - Runtime: do not import dotenv (Bun loads .env automatically)
 * - INV-28: raw provider SDK imports stay inside the AI wrapper
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
    files: ["src/**/*.ts", "tests/**/*.ts", "evals/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      threa: threaPlugin,
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

  // INV-28: provider SDK imports are only allowed inside the AI wrapper.
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "evals/**/*.ts", "scripts/**/*.ts"],
    ignores: ["src/lib/ai/ai.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...sharedRestrictedImportPatterns,
            {
              group: ["@openrouter/ai-sdk-provider", "@langchain/openai", "openai", "@anthropic-ai/sdk", "anthropic"],
              message: "Import AI provider SDKs only inside src/lib/ai/ai.ts (INV-28). Use createAI elsewhere.",
            },
          ],
        },
      ],
    },
  },

  // INV-51: lib/ cannot import from features/ (infrastructure must not depend on domain logic)
  // Exceptions:
  //   static-config-resolver.ts — aggregates AI configs from all features
  //   message-formatter — AI utility that resolves author names from member/persona repos
  //   outbox/broadcast-handler — resolves memberId→userId for socket routing
  //   outbox/repository — outbox payload types reference domain types (type-only, no runtime dep)
  {
    files: ["src/lib/**/*.ts"],
    ignores: [
      "src/lib/ai/static-config-resolver.ts",
      "src/lib/ai/message-formatter.ts",
      "src/lib/ai/message-formatter.test.ts",
      "src/lib/outbox/broadcast-handler.ts",
      "src/lib/outbox/repository.ts",
    ],
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

  // INV-52: Features import other features only through barrels (index.ts)
  // Uses explicit feature names because relative imports between features
  // (e.g., ../../attachments/excel/config) don't contain "features/" in the path.
  // Pattern `**/name/**` blocks internals but allows barrel imports (`**/name`)
  // since trailing /** requires at least one more path segment.
  {
    files: ["src/features/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...sharedRestrictedImportPatterns,
            {
              group: [
                "**/streams/**",
                "**/memos/**",
                "**/attachments/**",
                "**/conversations/**",
                "**/agents/**",
                "**/messaging/**",
                "**/search/**",
                "**/workspaces/**",
                "**/commands/**",
                "**/ai-usage/**",
                "**/emoji/**",
                "**/user-preferences/**",
              ],
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
