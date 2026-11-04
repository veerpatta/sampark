import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs (FlatCompat no longer needed).
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // New React Compiler rules from eslint-plugin-react-hooks 7 (came with Next 16).
    // Kept as warnings so existing code still lints clean; tighten when refactoring.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores(["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
