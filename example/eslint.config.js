import js from "@eslint/js";
import tseslint from "typescript-eslint";
import dependencyCruiser from "eslint-plugin-dependency-cruiser";

export default tseslint.config(
  { ignores: ["dist/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  dependencyCruiser.configs.all,
  {
    settings: {
      "dependency-cruiser": {
        config: ".dependency-cruiser.cjs",
      },
    },
  }
);
