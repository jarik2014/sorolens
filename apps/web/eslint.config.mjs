import nextPlugin from "@next/eslint-plugin-next";

export default [
  // lib/openapi.generated.ts is produced by scripts/generate-openapi-operations.mjs.
  { ignores: ["lib/openapi.generated.ts"] },
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
];
