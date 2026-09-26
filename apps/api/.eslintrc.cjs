module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: { sourceType: "module", ecmaVersion: 2022 },
  plugins: ["@typescript-eslint", "simple-import-sort", "unused-imports"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    // Last on purpose: turns off any stylistic ESLint/typescript-eslint rule
    // that would otherwise fight Prettier over formatting. Prettier owns
    // line-width/quotes/spacing (`pnpm run format`); ESLint owns everything
    // else (unused code, import order, correctness).
    "prettier",
  ],
  root: true,
  env: { node: true, jest: true },
  ignorePatterns: [".eslintrc.cjs", "dist"],
  rules: {
    // Replaces @typescript-eslint/no-unused-vars: same detection, but an
    // unused *import* is auto-fixable (the specifier just gets deleted)
    // instead of only warned about.
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-imports": "error",
    "unused-imports/no-unused-vars": [
      "warn",
      { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
    ],
    // Lexicographic import order, auto-fixable. One rule instead of the
    // multi-option `import/order` — no resolver plugin to configure, and
    // "just sort them" is all this project needs.
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error",
    "no-duplicate-imports": "error",
    eqeqeq: ["error", "always"],
    "prefer-const": "error",
    "no-var": "error",
    curly: ["error", "all"],
  },
};
