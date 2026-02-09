import tsParser from "@typescript-eslint/parser"
import tsPlugin from "@typescript-eslint/eslint-plugin"

/**
 * ESLint configuration for Threa backend.
 *
 * Enforces architectural boundaries:
 * - INV-51: lib/ is infrastructure — must not import from features/
 * - INV-52: Features import other features only through barrels (index.ts)
 */
export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
  },

  // INV-51: lib/ cannot import from features/ (infrastructure must not depend on domain logic)
  // Exception: static-config-resolver.ts aggregates AI configs from all features by design
  {
    files: ["src/lib/**/*.ts"],
    ignores: ["src/lib/ai/static-config-resolver.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
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
]
