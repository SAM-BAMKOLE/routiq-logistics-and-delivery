import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // These two React-Compiler-era rules flag patterns the console relies on:
      // rehydrating the session from localStorage in a mount effect (there is
      // no SSR-safe alternative that avoids a hydration mismatch), and flipping
      // `loading` at the start of an async fetch effect. Both are the documented
      // shapes for client-side data loading; every other hook rule stays on.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
