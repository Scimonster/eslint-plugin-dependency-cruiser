// Loaded by ESLint through jiti, like a consumer's TypeScript config.
import tseslint from "typescript-eslint";
import dependencyCruiser from "eslint-plugin-dependency-cruiser";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
  },
  dependencyCruiser.configs.all,
];
