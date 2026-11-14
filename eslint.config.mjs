import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// The therapist matching is a case study, not part of the deployed app
// (docs/case-studies/therapist-matching.md): nothing that ships imports it.
const CASE_STUDY = {
  group: ["**/case-studies/**", "**/catalogue/therapists.json"],
  message: "The therapist case study must not ship in the app.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**", "config/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [CASE_STUDY] }] },
  },
  // The hexagonal boundary: the core does no I/O and knows no adapter, so a
  // provider or store can be swapped without touching it (spec 5f). Flat
  // config replaces a rule's options per file, so it repeats CASE_STUDY.
  {
    files: ["src/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["next", "next/*"], message: "The core must not depend on Next.js." },
            { group: ["@supabase/*"], message: "The core must not depend on Supabase." },
            { group: ["@/adapters/*", "@/composition/*", "@/app/*"], message: "The core sees adapters only through ports." },
            CASE_STUDY,
          ],
          paths: [{ name: "node:child_process", message: "The core does no I/O." }],
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
