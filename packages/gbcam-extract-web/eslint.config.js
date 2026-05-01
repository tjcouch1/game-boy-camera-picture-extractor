import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";
import root from "../../eslint.config.js";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default [
  ...root,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
        allowDefaultProject: ["*.config.js", "*.config.ts", "scripts/**/*.ts"],
      },
    },
  },
];
