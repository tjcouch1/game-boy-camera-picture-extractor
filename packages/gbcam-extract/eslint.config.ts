import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";
import root from "../../eslint.config.ts";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default [
  ...root,
  {
    files: ["**/*.{ts,tsx,js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
        allowDefaultProject: [
          "eslint.config.ts",
          "vitest.config.ts",
          "vitest.setup.ts",
          "test-opencv-init-node.ts",
          "scripts/**/*.ts",
        ],
      },
    },
  },
];
