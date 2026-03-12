/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ["plugin:@typescript-eslint/recommended", "next/core-web-vitals"],
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
  ignorePatterns: [".next/", "node_modules/", "next-env.d.ts"],
};
