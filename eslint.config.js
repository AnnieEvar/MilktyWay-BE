import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "src/generated/**", "doc/.me/**", ".data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["**/*.ts"], rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/no-non-null-assertion": "error",
    "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
  } },
  { files: ["src/modules/*/application/**/*.ts", "src/modules/*/domain/**/*.ts"], rules: { "no-restricted-imports": ["error", { patterns: ["express", "@prisma/*", "**/generated/**", "**/infrastructure/**", "**/http/**"] }] } },
);
