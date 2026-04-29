import path from "node:path";
import { fileURLToPath } from "node:url";
import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gitignorePath = path.resolve(__dirname, ".gitignore");

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  {
    ignores: [
      "**/*.d.ts",
      "**/dist/**",
      "packages/gbcam-extract-web/src/shadcn/**",
      "packages/gbcam-extract-web/src/generated/**",
      "pnpm-lock.yaml",
      "supporting-materials/**",
      "test-input/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      eqeqeq: "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error", // OpenCV.js types are loose (mostly any-typed). These rules produce noise
      // without catching real bugs. Disable repo-wide.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
);
