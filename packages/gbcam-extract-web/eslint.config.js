import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import root from "../../eslint.config.js";

const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

export default [
  ...root,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
        allowDefaultProject: ["eslint.config.js", "vite.config.ts", "scripts/**/*.ts"],
      },
    },
    settings: { react: { version: "detect" } },
  },
];
