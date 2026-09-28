module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: { sourceType: "module", ecmaVersion: 2022 },
  plugins: ["@typescript-eslint", "simple-import-sort", "unused-imports"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  root: true,
  env: { node: true },
  ignorePatterns: [".eslintrc.cjs", "dist"],
  rules: {
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-imports": "error",
    "unused-imports/no-unused-vars": [
      "warn",
      { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
    ],
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error",
    "no-duplicate-imports": "error",
    eqeqeq: ["error", "always"],
    "prefer-const": "error",
    "no-var": "error",
    curly: ["error", "all"],
  },
};
